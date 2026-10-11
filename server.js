'use strict';
// 플랜두씨 다이어리 서버 — Express + PostgreSQL
// 비밀값(DATABASE_URL)은 환경변수로만 받고, 어떤 응답·로그에도 내보내지 않는다.

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 없습니다. .env.example을 참고하세요.');
  process.exit(1);
}

// PGSSL: 비우면 암호화+인증서 검증(Neon 등), no-verify면 암호화는 하되 인증서 검증 생략(Supabase 풀러), disable이면 암호화 없음(내 컴퓨터).
const SSL_MODE = process.env.PGSSL || 'verify';
// 접속 문자열의 sslmode 값이 아래 ssl 설정을 덮어쓰지 않도록 떼어 낸다.
const DB_URL = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
const pool = new Pool({
  connectionString: DB_URL,
  ssl: SSL_MODE === 'disable' ? false : { rejectUnauthorized: SSL_MODE !== 'no-verify' },
  max: 5,
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

// 보안 헤더: 인라인 스크립트 금지, 스크립트는 같은 출처에서만.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ---------- 입력 검사 ----------
class BadRequest extends Error {}
const bad = (msg) => { throw new BadRequest(msg); };

function text(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    bad(`${name}을(를) 입력하세요.`);
  }
  if (typeof v !== 'string') bad(`${name} 형식이 잘못되었습니다.`);
  const s = v.trim();
  if (s.length < min && !(optional && s.length === 0)) bad(`${name}을(를) 입력하세요.`);
  if (s.length > max) bad(`${name}은(는) ${max}자 이하로 적어 주세요.`);
  return optional && s.length === 0 ? null : s;
}
function date(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${name}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) bad(`${name}이(가) 없는 날짜입니다.`);
  return v;
}
function timestamp(v, name) {
  // 서울 시간(+09:00)을 붙인 ISO 문자열을 받는다.
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    bad(`${name} 형식이 잘못되었습니다.`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) bad(`${name}이(가) 없는 시각입니다.`);
  return d.toISOString();
}
function int(v, name, min, max) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) bad(`${name}은(는) ${min}~${max} 사이 정수여야 합니다.`);
  return n;
}
function id(v, name = 'ID') { return int(v, name, 1, Number.MAX_SAFE_INTEGER); }
function tags(v) {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))];
  if (out.length > 10) bad('태그는 10개까지 넣을 수 있습니다.');
  out.forEach((t) => { if (t.length > 30) bad('태그 하나는 30자 이하로 적어 주세요.'); });
  return out;
}
function uuid(v) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    bad('Idempotency-Key 헤더에 UUID가 필요합니다.');
  }
  return v.toLowerCase();
}
function planFields(b) {
  const f = {
    title: text(b.title, '계획 이름', { max: 120 }),
    start_date: date(b.start_date, '시작일'),
    end_date: date(b.end_date, '종료일'),
    priority: int(b.priority, '우선순위', 1, 3),
    success_criteria: text(b.success_criteria, '성공 기준', { max: 1000 }),
    estimated_minutes: int(b.estimated_minutes, '예상 시간(분)', 0, 100000),
  };
  if (f.end_date < f.start_date) bad('종료일은 시작일과 같거나 뒤여야 합니다.');
  return f;
}
function taskFields(b) {
  return {
    title: text(b.title, '할 일', { max: 200 }),
    due_date: date(b.due_date, '마감일'),
    priority: int(b.priority, '우선순위', 1, 3),
    tags: tags(b.tags),
    estimated_minutes: int(b.estimated_minutes, '예상 시간(분)', 0, 100000),
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// 모든 조회에서 날짜를 'YYYY-MM-DD' 문자열로, 시각을 ISO 문자열로 돌려준다(시간대 변환 없이 그대로 복원되도록).
const PLAN_COLS = `id, current_revision, title, to_char(start_date,'YYYY-MM-DD') AS start_date,
  to_char(end_date,'YYYY-MM-DD') AS end_date, priority, success_criteria, estimated_minutes,
  carried_lesson, carried_from_review_id, created_at, updated_at`;
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Seoul')::date`;

// ---------- 계획 ----------
app.get('/api/plans', wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PLAN_COLS} FROM plans ORDER BY id`);
  res.json(rows);
}));

app.post('/api/plans', wrap(async (req, res) => {
  const f = planFields(req.body || {});
  const plan = await tx(async (c) => {
    const { rows: [p] } = await c.query(
      `INSERT INTO plans (title,start_date,end_date,priority,success_criteria,estimated_minutes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${PLAN_COLS}`,
      [f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimated_minutes]);
    await c.query(
      `INSERT INTO plan_revisions (plan_id,revision_no,title,start_date,end_date,priority,success_criteria,estimated_minutes,change_note)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,'처음 세운 계획')`,
      [p.id, f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimated_minutes]);
    return p;
  });
  res.status(201).json(plan);
}));

app.put('/api/plans/:id', wrap(async (req, res) => {
  const planId = id(req.params.id);
  const f = planFields(req.body || {});
  const note = text(req.body.change_note, '고친 이유', { max: 300, optional: true });
  const plan = await tx(async (c) => {
    const { rows: [cur] } = await c.query('SELECT current_revision, carried_lesson FROM plans WHERE id=$1 FOR UPDATE', [planId]);
    if (!cur) return null;
    const rev = cur.current_revision + 1;
    await c.query(
      `INSERT INTO plan_revisions (plan_id,revision_no,title,start_date,end_date,priority,success_criteria,estimated_minutes,carried_lesson,change_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [planId, rev, f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimated_minutes, cur.carried_lesson, note]);
    const { rows: [p] } = await c.query(
      `UPDATE plans SET current_revision=$2, title=$3, start_date=$4, end_date=$5, priority=$6,
         success_criteria=$7, estimated_minutes=$8, updated_at=now()
       WHERE id=$1 RETURNING ${PLAN_COLS}`,
      [planId, rev, f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimated_minutes]);
    return p;
  });
  if (!plan) return res.status(404).json({ error: '그 계획을 찾을 수 없습니다.' });
  res.json(plan);
}));

app.get('/api/plans/:id/revisions', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, plan_id, revision_no, title, to_char(start_date,'YYYY-MM-DD') AS start_date,
       to_char(end_date,'YYYY-MM-DD') AS end_date, priority, success_criteria, estimated_minutes,
       carried_lesson, change_note, created_at
     FROM plan_revisions WHERE plan_id=$1 ORDER BY revision_no DESC`, [id(req.params.id)]);
  res.json(rows);
}));

// ---------- 할 일 ----------
const TASK_SELECT = `
  SELECT t.id, t.plan_id, t.title, to_char(t.due_date,'YYYY-MM-DD') AS due_date, t.priority, t.tags,
    t.estimated_minutes, t.created_at, t.updated_at,
    c.completed_at,
    (c.id IS NOT NULL) AS done,
    (c.id IS NULL AND t.due_date < ${TODAY_SQL}) AS delayed,
    COALESCE(w.actual_minutes, 0)::int AS actual_minutes,
    COALESCE(w.log_count, 0)::int AS log_count,
    COALESCE(w.blocked, false) AS blocked
  FROM tasks t
  LEFT JOIN task_completions c ON c.task_id = t.id AND c.reopened_at IS NULL
  LEFT JOIN (
    SELECT task_id, SUM(actual_minutes) AS actual_minutes, COUNT(*) AS log_count,
           bool_or(btrim(blocker) <> '') AS blocked
    FROM work_logs GROUP BY task_id
  ) w ON w.task_id = t.id
  WHERE t.deleted_at IS NULL`;

// 정렬 기준은 여기 적힌 것만 쓴다. 값이 같으면 마지막에 ID 오름차순으로 순서를 고정한다.
const SORTS = {
  due: 't.due_date ASC, t.priority ASC, t.id ASC',
  priority: 't.priority ASC, t.due_date ASC, t.id ASC',
  estimate: 't.estimated_minutes DESC, t.due_date ASC, t.id ASC',
  created: 't.created_at DESC, t.id DESC',
};

app.get('/api/tasks', wrap(async (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };

  add('t.plan_id = ?', id(q.plan_id, '계획 ID'));
  if (q.q) {
    const s = text(q.q, '검색어', { max: 100 }).replace(/[\\%_]/g, (m) => '\\' + m);
    add(`(t.title ILIKE ? OR array_to_string(t.tags, ' ') ILIKE $${params.length + 1})`, `%${s}%`);
  }
  if (q.status === 'todo') where.push('c.id IS NULL');
  else if (q.status === 'done') where.push('c.id IS NOT NULL');
  else if (q.status === 'delayed') where.push(`c.id IS NULL AND t.due_date < ${TODAY_SQL}`);
  else if (q.status === 'blocked') where.push('COALESCE(w.blocked,false)');
  else if (q.status && q.status !== 'all') bad('상태 거르기 값이 잘못되었습니다.');
  if (q.priority) add('t.priority = ?', int(q.priority, '우선순위', 1, 3));
  if (q.tag) add('? = ANY(t.tags)', text(q.tag, '태그', { max: 30 }));

  const sortKey = q.sort || 'due';
  if (!SORTS[sortKey]) bad('정렬 기준이 잘못되었습니다.');
  const sql = `${TASK_SELECT} ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY ${SORTS[sortKey]}`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

async function taskById(taskId) {
  const { rows: [t] } = await pool.query(`${TASK_SELECT} AND t.id = $1`, [taskId]);
  return t;
}

app.post('/api/tasks', wrap(async (req, res) => {
  const b = req.body || {};
  const planId = id(b.plan_id, '계획 ID');
  const f = taskFields(b);
  const { rows: [p] } = await pool.query('SELECT id FROM plans WHERE id=$1', [planId]);
  if (!p) return res.status(404).json({ error: '그 계획을 찾을 수 없습니다.' });
  const { rows: [t] } = await pool.query(
    `INSERT INTO tasks (plan_id,title,due_date,priority,tags,estimated_minutes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [planId, f.title, f.due_date, f.priority, f.tags, f.estimated_minutes]);
  res.status(201).json(await taskById(t.id));
}));

app.put('/api/tasks/:id', wrap(async (req, res) => {
  const taskId = id(req.params.id);
  const f = taskFields(req.body || {});
  const { rowCount } = await pool.query(
    `UPDATE tasks SET title=$2, due_date=$3, priority=$4, tags=$5, estimated_minutes=$6, updated_at=now()
     WHERE id=$1 AND deleted_at IS NULL`,
    [taskId, f.title, f.due_date, f.priority, f.tags, f.estimated_minutes]);
  if (!rowCount) return res.status(404).json({ error: '그 할 일을 찾을 수 없습니다.' });
  res.json(await taskById(taskId));
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  const taskId = id(req.params.id);
  const { rowCount } = await pool.query(
    'UPDATE tasks SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL', [taskId]);
  if (!rowCount) return res.status(404).json({ error: '그 할 일을 찾을 수 없습니다.' });
  await pool.query('DELETE FROM running_timer WHERE task_id=$1', [taskId]);
  res.json({ deleted: true });
}));

// 완료: 같은 키로 다시 오거나(재전송), 이미 완료인데 또 오면(연속 클릭) 새 기록을 만들지 않는다.
// 막는 곳은 DB의 유일 제약 두 개다: idempotency_key UNIQUE, (task_id) WHERE reopened_at IS NULL UNIQUE.
app.post('/api/tasks/:id/complete', wrap(async (req, res) => {
  const taskId = id(req.params.id);
  const key = uuid(req.get('Idempotency-Key'));
  const { rows: [t] } = await pool.query('SELECT id FROM tasks WHERE id=$1 AND deleted_at IS NULL', [taskId]);
  if (!t) return res.status(404).json({ error: '그 할 일을 찾을 수 없습니다.' });
  const { rowCount } = await pool.query(
    `INSERT INTO task_completions (task_id, idempotency_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [taskId, key]);
  res.status(rowCount ? 201 : 200).json({ created: rowCount === 1, task: await taskById(taskId) });
}));

app.post('/api/tasks/:id/reopen', wrap(async (req, res) => {
  const taskId = id(req.params.id);
  await pool.query(
    'UPDATE task_completions SET reopened_at=now() WHERE task_id=$1 AND reopened_at IS NULL', [taskId]);
  const t = await taskById(taskId);
  if (!t) return res.status(404).json({ error: '그 할 일을 찾을 수 없습니다.' });
  res.json({ task: t });
}));

// ---------- 실행 기록 ----------
app.get('/api/tasks/:id/logs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, task_id, started_at, ended_at, actual_minutes, blocker, created_at
     FROM work_logs WHERE task_id=$1 ORDER BY started_at DESC, id DESC`, [id(req.params.id)]);
  res.json(rows);
}));

app.post('/api/tasks/:id/logs', wrap(async (req, res) => {
  const taskId = id(req.params.id);
  const b = req.body || {};
  const started = timestamp(b.started_at, '시작 시각');
  const ended = timestamp(b.ended_at, '끝난 시각');
  if (ended < started) bad('끝난 시각은 시작 시각과 같거나 뒤여야 합니다.');
  const minutes = int(b.actual_minutes, '실제 걸린 시간(분)', 0, 100000);
  const blocker = text(b.blocker, '막혔던 이유', { max: 1000, optional: true }) || '';
  const { rows: [t] } = await pool.query('SELECT id FROM tasks WHERE id=$1 AND deleted_at IS NULL', [taskId]);
  if (!t) return res.status(404).json({ error: '그 할 일을 찾을 수 없습니다.' });
  const { rows: [log] } = await pool.query(
    `INSERT INTO work_logs (task_id, started_at, ended_at, actual_minutes, blocker)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, task_id, started_at, ended_at, actual_minutes, blocker, created_at`,
    [taskId, started, ended, minutes, blocker]);
  res.status(201).json(log);
}));

// 한 계획의 실행 기록 전체 (실행 기록 탭)
app.get('/api/plans/:id/logs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.id, w.task_id, t.title AS task_title, t.tags AS task_tags, w.started_at, w.ended_at, w.actual_minutes, w.blocker, w.created_at
     FROM work_logs w JOIN tasks t ON t.id = w.task_id
     WHERE t.plan_id = $1 AND t.deleted_at IS NULL
     ORDER BY w.started_at DESC, w.id DESC`, [id(req.params.id)]);
  res.json(rows);
}));

app.delete('/api/logs/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM work_logs WHERE id=$1', [id(req.params.id)]);
  if (!rowCount) return res.status(404).json({ error: '그 실행 기록을 찾을 수 없습니다.' });
  res.json({ deleted: true });
}));

// ---------- 타이머 ----------
// 시작하면 running_timer에 한 줄, 정지하면 그 줄을 지우고 같은 트랜잭션에서 실행 기록 한 건을 만든다.
// 정지를 두 번 보내도 두 번째는 지울 줄이 없어 기록이 겹치지 않는다.
const TIMER_SELECT = `SELECT r.task_id, r.started_at, t.title AS task_title, t.plan_id
  FROM running_timer r JOIN tasks t ON t.id = r.task_id`;

app.get('/api/timer', wrap(async (req, res) => {
  const { rows: [t] } = await pool.query(TIMER_SELECT);
  res.json({ timer: t || null });
}));

app.post('/api/tasks/:id/timer', wrap(async (req, res) => {
  const taskId = id(req.params.id);
  const { rows: [task] } = await pool.query('SELECT id FROM tasks WHERE id=$1 AND deleted_at IS NULL', [taskId]);
  if (!task) return res.status(404).json({ error: '그 할 일을 찾을 수 없습니다.' });
  const { rowCount } = await pool.query(
    'INSERT INTO running_timer (id, task_id) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [taskId]);
  const { rows: [t] } = await pool.query(TIMER_SELECT);
  if (!rowCount) {
    return res.status(409).json({ error: `이미 할 일 #${t.task_id}의 타이머가 돌고 있습니다. 먼저 정지하세요.`, timer: t });
  }
  res.status(201).json({ timer: t });
}));

app.post('/api/timer/stop', wrap(async (req, res) => {
  const blocker = text((req.body || {}).blocker, '막혔던 이유', { max: 1000, optional: true }) || '';
  const log = await tx(async (c) => {
    const { rows: [r] } = await c.query('DELETE FROM running_timer WHERE id=1 RETURNING task_id, started_at');
    if (!r) return null;
    const { rows: [l] } = await c.query(
      `INSERT INTO work_logs (task_id, started_at, ended_at, actual_minutes, blocker)
       VALUES ($1, $2, now(), GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - $2::timestamptz)) / 60))::int, $3)
       RETURNING id, task_id, started_at, ended_at, actual_minutes, blocker, created_at`,
      [r.task_id, r.started_at, blocker]);
    return l;
  });
  if (!log) return res.status(404).json({ error: '돌고 있는 타이머가 없습니다.' });
  res.status(201).json(log);
}));

app.delete('/api/timer', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM running_timer WHERE id=1');
  res.json({ discarded: rowCount === 1 });
}));

// ---------- 돌아보기 ----------
// 대상: 그 계획에 딸린, 지우지 않은 할 일 (기간을 주면 마감일이 그 기간 안에 드는 것만)
function periodFilter(q, params) {
  const parts = [];
  if (q.from) { params.push(date(q.from, '기간 시작')); parts.push(`t.due_date >= $${params.length}`); }
  if (q.to) { params.push(date(q.to, '기간 끝')); parts.push(`t.due_date <= $${params.length}`); }
  return parts.length ? 'AND ' + parts.join(' AND ') : '';
}

async function computeReview(planId, q) {
  const params = [planId];
  const period = periodFilter(q, params);
  const { rows: [r] } = await pool.query(`
    WITH t AS (${TASK_SELECT} AND t.plan_id = $1 ${period})
    SELECT COUNT(*)::int AS planned,
      COUNT(*) FILTER (WHERE done)::int AS done,
      COUNT(*) FILTER (WHERE delayed)::int AS delayed,
      COUNT(*) FILTER (WHERE blocked)::int AS blocked,
      COALESCE(SUM(estimated_minutes),0)::int AS estimated_minutes,
      COALESCE(SUM(actual_minutes),0)::int AS actual_minutes,
      to_char(${TODAY_SQL},'YYYY-MM-DD') AS today_seoul
    FROM t`, params);
  r.diff_minutes = r.actual_minutes - r.estimated_minutes;
  r.from = q.from || null;
  r.to = q.to || null;
  return r;
}

app.get('/api/plans/:id/review', wrap(async (req, res) => {
  res.json(await computeReview(id(req.params.id), req.query));
}));

const METRIC_FILTERS = {
  planned: 'true', done: 'done', delayed: 'delayed', blocked: 'blocked',
  estimated: 'true', actual: 'log_count > 0', diff: 'true',
};

// 집계 숫자를 누르면 오는 곳: 그 숫자를 만든 할 일과 실행 기록
app.get('/api/plans/:id/review/evidence', wrap(async (req, res) => {
  const planId = id(req.params.id);
  const metric = req.query.metric;
  if (!METRIC_FILTERS[metric]) bad('집계 항목이 잘못되었습니다.');
  const params = [planId];
  const period = periodFilter(req.query, params);
  const { rows: tasks } = await pool.query(
    `SELECT * FROM (${TASK_SELECT} AND t.plan_id = $1 ${period}) x WHERE ${METRIC_FILTERS[metric]}
     ORDER BY due_date ASC, id ASC`, params);
  const ids = tasks.map((t) => t.id);
  const { rows: logs } = ids.length ? await pool.query(
    `SELECT id, task_id, started_at, ended_at, actual_minutes, blocker FROM work_logs
     WHERE task_id = ANY($1::bigint[]) ORDER BY started_at ASC, id ASC`, [ids]) : { rows: [] };
  res.json({ metric, tasks, logs });
}));

app.get('/api/plans/:id/reviews', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, plan_id, snapshot, lesson, carried_to_plan_id, created_at FROM reviews
     WHERE plan_id=$1 ORDER BY id DESC`, [id(req.params.id)]);
  res.json(rows);
}));

app.post('/api/plans/:id/reviews', wrap(async (req, res) => {
  const planId = id(req.params.id);
  const b = req.body || {};
  const lesson = text(b.lesson, '고칠 점', { max: 300 });
  const { rows: [p] } = await pool.query('SELECT id FROM plans WHERE id=$1', [planId]);
  if (!p) return res.status(404).json({ error: '그 계획을 찾을 수 없습니다.' });
  const snapshot = await computeReview(planId, { from: b.from || undefined, to: b.to || undefined });
  const { rows: [r] } = await pool.query(
    `INSERT INTO reviews (plan_id, snapshot, lesson) VALUES ($1,$2,$3)
     RETURNING id, plan_id, snapshot, lesson, carried_to_plan_id, created_at`,
    [planId, snapshot, lesson]);
  res.status(201).json(r);
}));

// 고칠 점을 다음 계획으로 넘긴다. 한 돌아보기는 한 번만 넘길 수 있다(carried_to_plan_id UNIQUE + 잠금).
app.post('/api/reviews/:id/carry', wrap(async (req, res) => {
  const reviewId = id(req.params.id);
  const f = planFields(req.body || {});
  const result = await tx(async (c) => {
    const { rows: [r] } = await c.query('SELECT id, lesson, carried_to_plan_id FROM reviews WHERE id=$1 FOR UPDATE', [reviewId]);
    if (!r) return { status: 404, body: { error: '그 돌아보기를 찾을 수 없습니다.' } };
    if (r.carried_to_plan_id) return { status: 409, body: { error: '이미 다음 계획으로 넘긴 돌아보기입니다.', plan_id: r.carried_to_plan_id } };
    const { rows: [p] } = await c.query(
      `INSERT INTO plans (title,start_date,end_date,priority,success_criteria,estimated_minutes,carried_lesson,carried_from_review_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PLAN_COLS}`,
      [f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimated_minutes, r.lesson, r.id]);
    await c.query(
      `INSERT INTO plan_revisions (plan_id,revision_no,title,start_date,end_date,priority,success_criteria,estimated_minutes,carried_lesson,change_note)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimated_minutes, r.lesson, `돌아보기 #${r.id}에서 넘어온 계획`]);
    await c.query('UPDATE reviews SET carried_to_plan_id=$2 WHERE id=$1', [r.id, p.id]);
    return { status: 201, body: p };
  });
  res.status(result.status).json(result.body);
}));

// ---------- 내보내기 ----------
app.get('/api/export', wrap(async (req, res) => {
  const q = (sql) => pool.query(sql).then((r) => r.rows);
  const data = {
    format: 'pds-diary-export',
    schema: 'contracts/pds-schema-v2.json',
    exported_at: new Date().toISOString(),
    rules: { date_only: 'YYYY-MM-DD, Asia/Seoul 달력 날짜', timestamps: 'ISO 8601 UTC', duration_unit: 'minutes' },
    plans: await q(`SELECT ${PLAN_COLS} FROM plans ORDER BY id`),
    plan_revisions: await q(`SELECT id, plan_id, revision_no, title, to_char(start_date,'YYYY-MM-DD') AS start_date,
      to_char(end_date,'YYYY-MM-DD') AS end_date, priority, success_criteria, estimated_minutes, carried_lesson,
      change_note, created_at FROM plan_revisions ORDER BY plan_id, revision_no`),
    tasks: await q(`SELECT id, plan_id, title, to_char(due_date,'YYYY-MM-DD') AS due_date, priority, tags,
      estimated_minutes, deleted_at, created_at, updated_at FROM tasks ORDER BY id`),
    task_completions: await q('SELECT id, task_id, idempotency_key, completed_at, reopened_at FROM task_completions ORDER BY id'),
    work_logs: await q('SELECT id, task_id, started_at, ended_at, actual_minutes, blocker, created_at FROM work_logs ORDER BY id'),
    reviews: await q('SELECT id, plan_id, snapshot, lesson, carried_to_plan_id, created_at FROM reviews ORDER BY id'),
    running_timer: await q('SELECT task_id, started_at FROM running_timer'),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="pds-diary-${stamp}.json"`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
}));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/api', (req, res) => res.status(404).json({ error: '없는 주소입니다.' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// 오류 응답에는 내부 정보(쿼리, 접속 문자열)를 싣지 않는다.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 형식이 잘못되었습니다.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '보낸 내용이 너무 깁니다.' });
  if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') {
    return res.status(400).json({ error: '입력값이 허용 범위를 벗어났습니다.' });
  }
  console.error('[error]', err.code || '', err.message);
  res.status(500).json({ error: '서버에서 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.' });
});

const port = Number(process.env.PORT) || 3000;
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
  app.listen(port, () => console.log(`플랜두씨 다이어리: http://localhost:${port}`));
})().catch((e) => {
  console.error('시작 실패:', e.code || '', e.message);
  process.exit(1);
});
