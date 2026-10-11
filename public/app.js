'use strict';
// 플랜두씨 다이어리 화면 코드 — 행운 A '클로버 가든' 웹 버전
// 모든 사용자 글자는 textContent로만 화면에 넣는다(innerHTML 사용 금지) → 스크립트 모양 글자도 글자 그대로 보인다.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const TZ = 'Asia/Seoul';
const PRIORITY = { 1: '높음', 2: '보통', 3: '낮음' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SORT_RULES = {
  due: '정렬 기준: 마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 작은 순 (서버에서 정렬)',
  priority: '정렬 기준: 우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 ID 작은 순 (서버에서 정렬)',
  estimate: '정렬 기준: 예상 시간 긴 순 → 같으면 마감일 빠른 순 → 같으면 ID 작은 순 (서버에서 정렬)',
  created: '정렬 기준: 최근에 만든 순 → 같으면 ID 큰 순 (서버에서 정렬)',
};

const state = {
  plans: [], planId: null, tasks: [], allTasks: [], logs: [], review: null,
  period: { from: '', to: '' }, metric: null, justDone: null, justAdded: null, prevStats: {},
  view: 'list', calMonth: null, timer: null, openTask: null,
};
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 작은 도구 ----------
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
// 아이콘·거북이는 index.html에 미리 그려 둔 것을 복제해 쓴다 (innerHTML을 쓰지 않는다).
const svgIcon = (name) => $('#tpl-icons').content.querySelector(`[data-icon="${name}"]`).cloneNode(true);
const turtleArt = (cls) => {
  const t = $('.brand-turtle').cloneNode(true);
  t.setAttribute('class', cls);
  return t;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) {
    const e = new Error((data && data.error) || `요청이 실패했습니다 (${res.status}).`);
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}

// ---------- 날짜·시간 (저장은 분·서울 날짜, 보여 줄 때만 바꾼다) ----------
const seoulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const seoulDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const ymdToUTC = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (ymd, n) => new Date(ymdToUTC(ymd) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((ymdToUTC(b) - ymdToUTC(a)) / 86400000);
const dowOf = (ymd) => WEEK[new Date(ymdToUTC(ymd)).getUTCDay()];
const fmtDate = (ymd) => { const [y, m, d] = ymd.split('-'); return `${y}년 ${Number(m)}월 ${Number(d)}일`; };
const fmtDot = (ymd) => `${ymd.replaceAll('-', '.')} (${dowOf(ymd)})`;
const fmtShort = (ymd) => `${ymd.slice(5).replace('-', '.')} (${dowOf(ymd)})`;
const fmtHM = (iso) => new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const fmtTime = (iso) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));
const fmtDur = (m) => {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  if (a < 60) return `${sign}${a}분`;
  return `${sign}${Math.floor(a / 60)}시간${a % 60 ? ` ${a % 60}분` : ''}`;
};
const fmtMin = (m) => (Math.abs(m) >= 60 ? `${m}분 (${fmtDur(m)})` : `${m}분`);
const dday = (end) => { const n = daysBetween(seoulToday(), end); return n > 0 ? `D-${n}` : n === 0 ? 'D-day' : '끝남'; };
// datetime-local 값은 서울 시각으로 보고 +09:00을 붙여 보낸다.
const localToSeoulIso = (v) => (v ? `${v.length === 16 ? v + ':00' : v}+09:00` : '');
const isoToSeoulLocal = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const splitTags = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const plan = () => state.plans.find((p) => p.id === state.planId);
const tagClass = (t) => `tag tg${[...t].reduce((a, c) => a + c.codePointAt(0), 0) % 6}`;
const tagEl = (t) => el('i', { class: tagClass(t), text: t, title: t });
const statusBadge = (t) => (t.done ? el('i', { class: 'bd ok', text: '완료' })
  : t.delayed ? el('i', { class: 'bd late', text: '지연' })
    : t.blocked ? el('i', { class: 'bd block', text: '막힘' })
      : el('i', { class: 'bd', text: '진행 중' }));

function openDialog(d) {
  const err = d.querySelector('.form-error');
  if (err) err.textContent = '';
  d.showModal();
}
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- 화면 바꾸기 (왼쪽 메뉴) ----------
const SCREENS = ['home', 'plan', 'tasks', 'logs', 'review'];
const ALIAS = { history: 'plan', see: 'review', do: 'tasks' };
function showScreen(name, { push = true, top = true } = {}) {
  name = ALIAS[name] || name;
  if (!SCREENS.includes(name)) name = 'home';
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  $$('.nav-btn').forEach((b) => {
    if (b.dataset.go === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (top) scrollTo({ top: 0 });
  if (push) {
    try { history.replaceState(null, '', `${location.pathname}${location.search}${name === 'home' ? '' : `#${name}`}`); } catch { /* 무시 */ }
  }
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); showScreen(go.dataset.go); }
});
window.addEventListener('hashchange', () => showScreen(location.hash.slice(1), { push: false }));

// ---------- 포춘쿠키 ----------
const FORTUNES = [
  '느려도 괜찮아,\n멈추지만 않으면 돼',
  '좋은 일이 분명히\n생길 거야',
  '오늘 한 칸이면 충분해',
  '계획이 빗나가도\n그건 배운 거야',
  '작은 체크 하나가\n행운을 불러와',
  '어제보다 한 걸음,\n그거면 돼',
  '쉬는 것도\n계획의 일부야',
  '네잎클로버는\n꾸준한 사람 눈에 띄어',
];
let fortuneIdx = daysBetween('2026-01-01', seoulToday()) % FORTUNES.length;
function showFortune(next = false) {
  if (next) fortuneIdx = (fortuneIdx + 1 + Math.floor(Math.random() * (FORTUNES.length - 1))) % FORTUNES.length;
  const f = $('#fortune');
  f.textContent = '';
  FORTUNES[fortuneIdx].split('\n').forEach((line, i) => { if (i) f.append(el('br')); f.append(line); });
  f.prepend('"'); f.append('"');
  if (next) {
    const card = $('.c-fortune');
    card.classList.add('opened');
    card.classList.remove('cracked'); void card.offsetWidth; card.classList.add('cracked');
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  }
}
$('#cookie-hit').addEventListener('click', () => showFortune(true));
$('#fortune-again').addEventListener('click', () => showFortune(true));

// ---------- 계획 ----------
async function loadPlans(selectId) {
  state.plans = await api('/api/plans');
  const saved = Number(new URLSearchParams(location.search).get('plan'));
  const want = selectId || state.planId || saved;
  state.planId = state.plans.some((p) => p.id === want) ? want : (state.plans.at(-1)?.id ?? null);
  renderPlanNav();
  document.body.classList.toggle('no-plan', !state.planId);
  if (state.planId) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('plan', state.planId);
      history.replaceState(null, '', url);
    } catch { /* 파일로 열었을 때 등 주소를 못 바꾸는 환경에서는 건너뛴다 */ }
  }
}

// 왼쪽 '내 계획' 목록
function renderPlanNav() {
  $('#plan-nav').replaceChildren(...[...state.plans].reverse().map((p) => {
    const on = p.id === state.planId;
    return el('li', {}, el('button', {
      type: 'button', class: 'plan-btn', 'aria-current': on ? 'true' : null, title: `#${p.id} ${p.title}`,
      onclick: () => selectPlan(p.id),
    }, on || p.carried_lesson ? svgIcon('clover') : el('span', { class: 'pd' }),
    el('span', { class: 'pt', text: p.title }), el('em', { text: dday(p.end_date) })));
  }));
  $$('.current-plan-title').forEach((n) => { n.textContent = plan()?.title || ''; });
}

async function selectPlan(pid) {
  if (pid === state.planId) return;
  state.planId = pid;
  state.metric = null;
  state.openTask = null;
  state.prevStats = {};
  resetEvidence();
  await loadPlans(pid);
  await refreshAll();
}

function renderPlan() {
  const p = plan();
  if (!p) return;
  $('#plan-heading').textContent = p.title;
  $('#plan-sub').textContent = `계획 #${p.id} · 지금 ${p.current_revision}판 · 마지막 수정 ${fmtTime(p.updated_at)}`;
  const facts = [
    ['기간', `${p.start_date.replaceAll('-', '.')} ~ ${p.end_date.replaceAll('-', '.')} (${dday(p.end_date)})`],
    ['우선순위', el('span', { class: `prio prio-${p.priority}`, text: PRIORITY[p.priority] })],
    ['성공 기준', p.success_criteria],
    ['예상 시간', fmtMin(p.estimated_minutes)],
  ];
  $('#plan-facts').replaceChildren(...facts.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', {}, v))));
  $('#carried-note').hidden = !p.carried_lesson;
  $('#carried-text').textContent = p.carried_lesson || '';
  $('#count-history').textContent = `${p.current_revision}판`;
  $$('.current-plan-title').forEach((n) => { n.textContent = p.title; });
  // 홈 배너
  $('#hero-title').textContent = p.title;
  $('#hero-dday').textContent = dday(p.end_date);
  $('#hero-meta').textContent = `${p.start_date.replaceAll('-', '.')} ~ ${p.end_date.slice(5).replace('-', '.')} · 우선순위 ${PRIORITY[p.priority]} · 성공 기준: ${p.success_criteria}`;
  $('#hero-lesson').hidden = !p.carried_lesson;
  $('#hero-lesson').textContent = p.carried_lesson ? `🍀 ${p.carried_lesson}` : '';
}

// 수정 이력: 판마다 바뀐 칸을 "전 → 후"로 보여 준다
const REV_FIELDS = [
  ['title', '계획 이름', (v) => v],
  ['start_date', '시작일', (v) => v.replaceAll('-', '.')],
  ['end_date', '종료일', (v) => v.replaceAll('-', '.')],
  ['priority', '우선순위', (v) => PRIORITY[v]],
  ['success_criteria', '성공 기준', (v) => v],
  ['estimated_minutes', '예상 시간', (v) => fmtDur(v)],
];
async function loadHistory() {
  const revs = await api(`/api/plans/${state.planId}/revisions`);
  $('#history-list').replaceChildren(...revs.map((r, i) => {
    const older = revs[i + 1];
    const changes = older ? REV_FIELDS.filter(([k]) => older[k] !== r[k]) : [];
    return el('li', { class: r.revision_no === 1 ? 'first' : null },
      el('div', { class: 'rev-head' }, el('span', { class: 'rev-badge', text: `${r.revision_no}판` }), el('span', { text: fmtTime(r.created_at) })),
      el('p', { class: 'rev-note', text: r.revision_no === 1 ? (r.change_note || '처음 세운 계획') : (r.change_note || '고친 이유 없음') }),
      changes.length ? el('ul', { class: 'rev-changes' }, ...changes.map(([k, label, f]) => el('li', {},
        `${label} `, el('span', { text: f(older[k]) }), ' → ', el('span', { class: 'changed', text: f(r[k]) })))) : null,
      r.revision_no === 1 ? el('p', { class: 'rev-full', text: `처음 계획: ${r.title} · ${r.start_date} ~ ${r.end_date} · 우선순위 ${PRIORITY[r.priority]} · 예상 ${r.estimated_minutes}분 · 성공 기준 "${r.success_criteria}"` }) : null);
  }));
}

let planMode = 'new';
function fillPlanForm(p) {
  const f = $('#plan-form');
  const today = seoulToday();
  f.title.value = p?.title || '';
  f.start_date.value = p?.start_date || today;
  f.end_date.value = p?.end_date || addDays(today, 30);
  f.priority.value = String(p?.priority || 2);
  f.estimated_minutes.value = p ? p.estimated_minutes : '';
  f.success_criteria.value = p?.success_criteria || '';
  f.change_note.value = '';
}
function openNewPlan() {
  planMode = 'new';
  fillPlanForm(null);
  $('#plan-dialog-title').textContent = '새 계획 세우기';
  $('#plan-dialog-hint').textContent = '운동·공부·업무처럼 지금 실제로 하고 있는 일 하나를 골라 계획으로 옮겨 보세요.';
  $('#change-note-wrap').hidden = true;
  openDialog($('#plan-dialog'));
}
['#btn-new-plan', '#btn-new-plan-3'].forEach((s) => $(s)?.addEventListener('click', openNewPlan));
$('#btn-edit-plan').addEventListener('click', () => {
  if (!plan()) return openNewPlan();
  planMode = 'edit';
  fillPlanForm(plan());
  $('#plan-dialog-title').textContent = `계획 #${state.planId} 고치기`;
  $('#plan-dialog-hint').textContent = '고쳐도 예전 판은 수정 이력에 그대로 남습니다.';
  $('#change-note-wrap').hidden = false;
  openDialog($('#plan-dialog'));
});
$('#plan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const d = formData(f);
  const body = { ...d, priority: Number(d.priority), estimated_minutes: d.estimated_minutes };
  try {
    const p = planMode === 'new'
      ? await api('/api/plans', { method: 'POST', body })
      : await api(`/api/plans/${state.planId}`, { method: 'PUT', body });
    $('#plan-dialog').close();
    state.prevStats = {};
    await loadPlans(p.id);
    await refreshAll();
    showScreen(planMode === 'new' ? 'home' : 'plan');
    toast(planMode === 'new' ? `계획 #${p.id}을 저장했습니다. 이제 할 일을 붙여 보세요. 🍀` : `계획 #${p.id}을 ${p.current_revision}판으로 고쳤습니다.`);
  } catch (err) { f.querySelector('.form-error').textContent = err.message; }
});

// ---------- 실행 기록 ----------
async function loadLogFeed() {
  const logs = await api(`/api/plans/${state.planId}/logs`);
  state.logs = logs;
  if (state.view === 'calendar') renderCalendar();
  renderWeek();
  $('#count-logs').textContent = logs.length || '';
  const total = logs.reduce((a, l) => a + l.actual_minutes, 0);
  const sum = $('#log-summary');
  sum.replaceChildren();
  if (logs.length) sum.append('지금까지 ', el('b', { text: `${logs.length}건` }), ' · 실제로 한 시간 ', el('b', { text: fmtMin(total) }), ' · 최근 기록부터');
  const feed = $('#log-feed');
  if (!logs.length) {
    feed.replaceChildren(el('div', { class: 'card empty' }, '아직 실행 기록이 없어요. 오른쪽 위 "＋ 실제로 한 일 적기"나 할 일의 ⏱ 타이머로 남겨 보세요.'));
    return;
  }
  feed.replaceChildren(...logs.map((l, i) => logCard(l, i === 0)));
}

function logCard(l, latest) {
  const sDay = seoulDay(l.started_at);
  const eDay = seoulDay(l.ended_at);
  const endLabel = eDay === sDay ? fmtHM(l.ended_at) : `${eDay.slice(5).replace('-', '.')} ${fmtHM(l.ended_at)}`;
  const tags = l.task_tags || [];
  return el('article', { class: 'card log-card', id: `log-${l.id}` },
    el('div', { class: 'log-top' }, el('span', { class: 'date' }, svgIcon('cal'), fmtDot(sDay)), tags.length ? tagEl(tags[0]) : null),
    el('h3', { class: 'log-title' }, svgIcon('note'),
      el('a', { href: `#task-${l.task_id}`, onclick: (e) => { e.preventDefault(); jumpToTask(l.task_id); } }, l.task_title),
      el('small', { text: `할 일 #${l.task_id}` })),
    el('div', { class: 'time-row' }, el('span', {}, '시작', el('b', { text: fmtHM(l.started_at) })), el('span', { class: 'arrow', 'aria-hidden': 'true' }), el('span', {}, '끝', el('b', { text: endLabel }))),
    el('p', { class: 'real' }, svgIcon('clock'), '실제 시간 ', el('b', { text: fmtDur(l.actual_minutes) }), el('span', { text: `(${l.actual_minutes}분)` })),
    l.blocker ? el('div', { class: 'blocker' }, '막혔던 이유', el('p', { text: l.blocker })) : null,
    el('div', { class: 'log-foot' },
      latest ? el('div', { class: 'sticker' }, el('span', { text: '오늘도 수고했어요 ✿' })) : el('span'),
      el('button', { type: 'button', class: 'mini danger', text: `기록 #${l.id} 지우기`, onclick: () => removeLog(l) })));
}

async function removeLog(l) {
  if (!confirm(`실행 기록 #${l.id}을 지울까요?`)) return;
  try { await api(`/api/logs/${l.id}`, { method: 'DELETE' }); toast(`실행 기록 #${l.id}을 지웠습니다.`); await refreshAll(); }
  catch (err) { toast(err.message, true); }
}

// 홈: 이번 주(오늘 포함 7일) 실제로 한 시간
function renderWeek() {
  const today = seoulToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const mins = Object.fromEntries(days.map((d) => [d, 0]));
  for (const l of state.logs) { const d = seoulDay(l.started_at); if (d in mins) mins[d] += l.actual_minutes; }
  const max = Math.max(60, ...Object.values(mins));
  const total = Object.values(mins).reduce((a, b) => a + b, 0);
  $('#week-total').textContent = `합계 ${fmtDur(total)}`;
  $('#week-bars').replaceChildren(...days.map((d) => el('div', {
    class: `wb${d === today ? ' today' : ''}`, title: `${fmtDate(d)} · ${mins[d]}분`, role: 'img', 'aria-label': `${dowOf(d)}요일 ${mins[d]}분`,
  }, el('i', { style: `--h:${(mins[d] / max).toFixed(3)}` }), el('span', { text: dowOf(d) }))));
}

// ---------- 할 일 ----------
function filters() {
  return {
    q: $('#f-q').value.trim(),
    status: $('#f-status').value,
    priority: $('#f-priority').value,
    tag: $('#f-tag').value,
    sort: $('#f-sort').value,
  };
}
function syncChips() {
  const st = $('#f-status').value;
  $$('.chip[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === st)));
  $('#chip-important').setAttribute('aria-pressed', String($('#f-priority').value === '1'));
}

async function loadTasks() {
  const f = filters();
  const qs = new URLSearchParams({ plan_id: state.planId, sort: f.sort });
  for (const k of ['q', 'priority', 'tag']) if (f[k]) qs.set(k, f[k]);
  if (f.status !== 'all') qs.set('status', f.status);
  syncChips();
  state.tasks = await api(`/api/tasks?${qs}`);
  await refreshTagOptions();
  renderTasks();
}

async function refreshTagOptions() {
  const all = await api(`/api/tasks?plan_id=${state.planId}`);
  state.allTasks = all;
  $('#count-tasks').textContent = all.length || '';
  const tags = [...new Set(all.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'ko'));
  const sel = $('#f-tag');
  const cur = sel.value;
  sel.replaceChildren(el('option', { value: '', text: '전부' }), ...tags.map((t) => el('option', { value: t, text: t })));
  sel.value = tags.includes(cur) ? cur : '';
  renderHomeTasks();
  renderTip();
  renderTagRows();
}

// 홈: 진행률 배너와 오늘 할 일 (오늘 마감 + 지연된 할 일)
function renderHomeTasks() {
  const all = state.allTasks;
  const done = all.filter((t) => t.done).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  const p = plan();
  $('#hero-bar').style.width = `${pct}%`;
  $('#hero-bar-wrap').setAttribute('aria-valuenow', String(pct));
  $('#hero-progress').textContent = `할 일 ${all.length}개 중 ${done}개 완료 · ${pct}%${p ? ` · ${dday(p.end_date)}` : ''}`;
  const today = seoulToday();
  // 오늘 해야 할 일 = 오늘 마감 + 밀린(지연) 할 일 + 오늘 끝낸 할 일
  const list = all.filter((t) => t.due_date === today || t.delayed || (t.done && t.completed_at && seoulDay(t.completed_at) === today));
  renderTrail(list);
  const doneN = list.filter((t) => t.done).length;
  $('#today-count').textContent = list.length ? `${list.length}개 중 ${doneN}개 완료` : '';
  $('#today-list').replaceChildren(...(list.length ? list.slice(0, 6).map((t) => el('li', { class: t.done ? 'done' : null },
    el('button', {
      type: 'button', class: `check${t.done ? ' on' : ''}`, text: t.done ? '✓' : '',
      'aria-label': t.done ? `#${t.id} 진행 중으로 되돌리기` : `#${t.id} 완료로 바꾸기`,
      onclick: (e) => (t.done ? reopen(t) : complete(t, e.currentTarget)),
    }),
    el('span', { class: 'tt', text: t.title, title: t.title }),
    t.delayed ? el('i', { class: 'bd late', text: '지연' }) : (t.tags[0] ? tagEl(t.tags[0]) : null),
    el('em', { text: fmtDur(t.estimated_minutes) })))
    : [el('li', { class: 'empty', text: '오늘 마감인 할 일이 없어요. 여유 있게 다음 할 일을 살펴봐요.' })]));
  // 남는 자리에는 다가오는 할 일을 보여 준다
  const upcoming = all.filter((t) => !t.done && t.due_date > today).slice(0, Math.max(0, 5 - list.length));
  if (upcoming.length) {
    $('#today-list').append(el('li', { class: 'tl-sub', text: '다가오는 할 일' }),
      ...upcoming.map((t) => el('li', { class: 'up' },
        el('button', { type: 'button', class: 'check', 'aria-label': `#${t.id} 완료로 바꾸기`, onclick: (e) => complete(t, e.currentTarget) }),
        el('span', { class: 'tt', text: t.title, title: t.title }),
        t.tags[0] ? tagEl(t.tags[0]) : null,
        el('em', { text: fmtShort(t.due_date) }))));
  }
}

// ---------- 오늘의 산책길: 체크한 만큼 거북이가 걸어간다 ----------
let trailP = null;
let trailPlan = null;
let walkTimer = null;
function renderTrail(list) {
  if (trailPlan !== state.planId) { trailP = null; trailPlan = state.planId; }
  const total = list.length;
  const done = list.filter((t) => t.done).length;
  const p = total ? done / total : 0;
  const walker = $('#walker');
  const track = $('#track');
  $('#trail-count').textContent = total ? `${done} / ${total} 걸음` : '';
  $('#trail-stops').replaceChildren(...list.map((t, i) => el('li', {
    class: i < done ? 'on' : null, style: `left:${total === 1 ? 50 : ((i + 1) / total) * 100}%`,
    title: `${i + 1}번째 걸음`,
  })));
  const msg = $('#trail-msg');
  msg.replaceChildren();
  if (!total) msg.append('오늘 할 일이 생기면 거북이가 산책을 시작해요. 마감일을 오늘로 둔 할 일을 붙여 보세요.');
  else if (done === total) msg.append(el('b', { text: '도착! ' }), `오늘 할 일 ${total}개를 모두 끝내서 거북이가 네잎클로버에 닿았어요.`);
  else msg.append(`할 일 하나를 체크할 때마다 거북이가 한 걸음씩 걸어가요. 클로버까지 `, el('b', { text: `${total - done}걸음` }), ' 남았어요.');
  // 처음 열 때는 출발점에서 지금 자리까지 걸어간다
  const from = trailP === null ? 0 : trailP;
  if (from !== p) {
    walker.classList.toggle('back', p < from);
    walker.classList.add('walking');
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => walker.classList.remove('walking', 'back'), reducedMotion() ? 0 : 1600);
  }
  if (trailP === null) { walker.style.setProperty('--p', 0); void walker.offsetWidth; }
  requestAnimationFrame(() => walker.style.setProperty('--p', p));
  const arrived = total > 0 && done === total;
  const justArrived = arrived && trailP !== null && trailP < 1;
  track.classList.toggle('arrived', arrived && !justArrived);
  if (justArrived) {
    setTimeout(() => {
      track.classList.add('arrived');
      burst($('#goal'));
      toast('오늘 할 일을 모두 끝냈어요! 거북이가 네잎클로버에 도착했어요 🍀');
    }, reducedMotion() ? 0 : 1500);
  }
  trailP = p;
}

function renderTip() {
  const today = seoulToday();
  const left = state.allTasks.filter((t) => t.due_date === today && !t.done).length;
  const late = state.allTasks.filter((t) => t.delayed).length;
  $('#tip-text').textContent = left ? `오늘 마감인 할 일이 ${left}개 남았어요. 하나씩 천천히!`
    : late ? `지연된 할 일이 ${late}개 있어요. 마감일을 다시 잡아 볼까요?`
      : state.allTasks.length ? '오늘 마감은 다 끝냈어요. 내일 할 일을 미리 살펴볼까요?'
        : '첫 할 일을 붙여 보세요. 작은 것부터 시작해도 충분해요.';
}

function renderTasks() {
  const f = filters();
  const filtered = f.q || f.status !== 'all' || f.priority || f.tag;
  const v = state.view;
  $('#task-table').hidden = v !== 'list';
  $('#board').hidden = v !== 'board';
  $('#calendar').hidden = v !== 'calendar';
  $('#sort-rule').textContent = v === 'calendar'
    ? '캘린더: 할 일은 마감일 칸에, 실행 기록이 있는 날은 실제로 한 분을 초록으로 표시합니다 (서울 날짜 기준)'
    : SORT_RULES[f.sort] + (v === 'board' ? ' · 칸 안에서도 같은 순서' : '');
  $('#task-empty').hidden = state.tasks.length > 0;
  $('#task-empty').textContent = filtered
    ? '조건에 맞는 할 일이 없어요. 검색어나 거르기를 바꿔 보세요.'
    : '아직 할 일이 없어요. 오른쪽 위 "＋ 할 일 붙이기"로 이 계획에 딸린 할 일을 붙여 보세요.';
  $('#task-list').replaceChildren(...(v === 'list' ? state.tasks.map(taskRow) : []));
  if (v === 'board') renderBoard(); else $('#board').replaceChildren();
  if (v === 'calendar') renderCalendar(); else $('#calendar').replaceChildren();
  state.justDone = null;
  state.justAdded = null;
}

function setView(v) {
  state.view = v;
  $$('.view-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  renderTasks();
}
$$('.view-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function taskRow(t) {
  const isOpen = state.openTask === t.id;
  const cls = ['task', t.done && 'done', isOpen && 'open', state.justDone === t.id && 'pop', state.justAdded === t.id && 'new'].filter(Boolean).join(' ');
  const li = el('li', { class: cls, id: `task-${t.id}`, tabindex: '-1' });
  const detail = el('div', { class: 'task-detail', hidden: !isOpen });
  const more = el('button', { type: 'button', class: 'more-btn', 'aria-expanded': String(isOpen), 'aria-label': `#${t.id} 자세히 보기` }, svgIcon('chev'));
  const toggle = async () => {
    const open = detail.hidden;
    $$('.task.open').forEach((n) => { if (n !== li) { n.classList.remove('open'); n.querySelector('.task-detail').hidden = true; n.querySelector('.more-btn').setAttribute('aria-expanded', 'false'); } });
    detail.hidden = !open;
    li.classList.toggle('open', open);
    more.setAttribute('aria-expanded', String(open));
    state.openTask = open ? t.id : null;
    if (open) await fillDetail(t, detail);
  };
  more.addEventListener('click', toggle);
  li.append(
    el('div', { class: 'trow' },
      el('span', { class: 'c-chk' }, el('button', {
        type: 'button', class: 'check', text: t.done ? '✓' : '',
        'aria-label': t.done ? `#${t.id} 진행 중으로 되돌리기` : `#${t.id} 완료로 바꾸기`,
        title: t.done ? '진행 중으로 되돌리기' : '완료로 바꾸기',
        onclick: (e) => (t.done ? reopen(t) : complete(t, e.currentTarget)),
      })),
      el('span', { class: 'c-ttl' },
        el('button', { type: 'button', class: 'ttl', onclick: toggle }, t.title, el('small', { text: `#${t.id}` })),
        el('span', { class: 'cell-m' }, fmtShort(t.due_date), ...t.tags.slice(0, 2).map(tagEl), `예상 ${fmtDur(t.estimated_minutes)}`, statusBadge(t))),
      el('span', { class: 'c-due', text: fmtShort(t.due_date) }),
      el('span', { class: 'c-tags tags' }, ...t.tags.slice(0, 2).map(tagEl), t.tags.length > 2 ? el('small', { text: `+${t.tags.length - 2}` }) : null),
      el('span', { class: 'c-est', text: fmtDur(t.estimated_minutes) }),
      el('span', { class: `c-real${t.actual_minutes > t.estimated_minutes ? ' r' : ''}`, text: t.log_count ? fmtDur(t.actual_minutes) : '–' }),
      el('span', { class: 'c-st' }, statusBadge(t)),
      el('span', { class: 'c-act acts' }, timerButton(t), more)),
    detail);
  if (isOpen) fillDetail(t, detail);
  return li;
}

async function fillDetail(t, box) {
  const logsBox = el('div', { class: 'logs' }, el('p', { class: 'hint', text: '실행 기록을 불러오는 중…' }));
  box.replaceChildren(
    el('p', { class: 'facts' },
      el('span', {}, '우선순위 ', el('b', { text: PRIORITY[t.priority] })),
      el('span', {}, '마감 ', el('b', { text: fmtDate(t.due_date) })),
      el('span', {}, '예상 ', el('b', { text: fmtDur(t.estimated_minutes) })),
      el('span', {}, '실제 ', el('b', { text: `${t.actual_minutes}분` }), ` · 기록 ${t.log_count}건`),
      t.done ? el('span', {}, '완료 ', el('b', { text: fmtTime(t.completed_at) })) : null,
      t.tags.length ? el('span', {}, '태그 ', ...t.tags.map(tagEl)) : null),
    el('div', { class: 'task-actions' },
      el('button', { type: 'button', class: 'mini', text: '실제로 한 일 적기', onclick: () => openLog(t) }),
      el('button', { type: 'button', class: 'mini', text: '고치기', onclick: () => openTaskEdit(t) }),
      el('button', { type: 'button', class: 'mini danger', text: '지우기', onclick: () => removeTask(t) })),
    logsBox);
  await renderLogs(t, logsBox);
}

async function renderLogs(t, box) {
  const logs = await api(`/api/tasks/${t.id}/logs`);
  box.replaceChildren(
    el('b', { text: `할 일 #${t.id}에 붙은 실행 기록 ${logs.length}건` }),
    logs.length ? el('ul', {}, ...logs.map((l) => logItem(l)))
      : el('p', { class: 'hint', text: '아직 기록이 없어요. "실제로 한 일 적기"나 ⏱ 타이머로 남겨 보세요.' }));
}

function logItem(l) {
  return el('li', { class: 'log' },
    el('span', { text: `기록 #${l.id} · 할 일 #${l.task_id}` }),
    el('span', { text: `${fmtTime(l.started_at)} → ${fmtTime(l.ended_at)}` }),
    el('b', { text: `실제 ${l.actual_minutes}분` }),
    el('span', { class: 'why', text: l.blocker ? `막혔던 이유: ${l.blocker}` : '막힘 없음' }));
}

// 할 일 붙이기
$('#btn-add-task-home')?.addEventListener('click', () => $('#btn-add-task').click());
$('#btn-add-task').addEventListener('click', () => {
  if (!plan()) return openNewPlan();
  const f = $('#task-form');
  if (!f.due_date.value) f.due_date.value = seoulToday();
  $('#task-add-dialog .add-for').textContent = `계획 "${plan().title}"에 붙습니다.`;
  openDialog($('#task-add-dialog'));
  f.title.focus();
});
$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const d = formData(f);
  try {
    const t = await api('/api/tasks', {
      method: 'POST',
      body: { plan_id: state.planId, title: d.title, due_date: d.due_date, priority: Number(d.priority), estimated_minutes: d.estimated_minutes, tags: splitTags(d.tags) },
    });
    f.title.value = ''; f.tags.value = '';
    $('#task-add-dialog').close();
    state.justAdded = t.id;
    toast(`할 일 #${t.id}을 붙였습니다.`);
    await refreshAll();
  } catch (err) { f.querySelector('.form-error').textContent = err.message; }
});

let editing = null;
function openTaskEdit(t) {
  editing = t;
  const f = $('#task-edit-form');
  f.title.value = t.title; f.due_date.value = t.due_date; f.priority.value = String(t.priority);
  f.estimated_minutes.value = t.estimated_minutes; f.tags.value = t.tags.join(', ');
  openDialog($('#task-dialog'));
}
$('#task-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const d = formData(f);
  try {
    await api(`/api/tasks/${editing.id}`, {
      method: 'PUT',
      body: { title: d.title, due_date: d.due_date, priority: Number(d.priority), estimated_minutes: d.estimated_minutes, tags: splitTags(d.tags) },
    });
    $('#task-dialog').close();
    toast(`할 일 #${editing.id}을 고쳤습니다.`);
    await refreshAll();
  } catch (err) { f.querySelector('.form-error').textContent = err.message; }
});

async function removeTask(t) {
  if (!confirm(`할 일 #${t.id} "${t.title}"을(를) 지울까요? 돌아보기 집계에서도 빠집니다.`)) return;
  try {
    await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
    if (state.openTask === t.id) state.openTask = null;
    toast(`할 일 #${t.id}을 지웠습니다.`);
    await refreshAll();
  } catch (err) { toast(err.message, true); }
}

// 완료: 버튼을 잠그지 않는다. 연달아 눌러 요청이 두 번 가도 DB 제약이 한 건만 남긴다.
let dupCount = 0;
async function complete(t, btn) {
  try {
    const r = await api(`/api/tasks/${t.id}/complete`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    if (r.created) { burst(btn); state.justDone = t.id; toast(`할 일 #${t.id} 완료! 🍀 완료 기록 1건이 생겼습니다.`); }
    else { dupCount += 1; toast(`이미 완료된 할 일 #${t.id}입니다. 겹친 요청은 기록하지 않았습니다 (지금까지 ${dupCount}번 막음).`); }
    await refreshAll();
  } catch (err) { toast(err.message, true); }
}
async function reopen(t) {
  try { await api(`/api/tasks/${t.id}/reopen`, { method: 'POST' }); toast(`할 일 #${t.id}을 진행 중으로 되돌렸습니다.`); await refreshAll(); }
  catch (err) { toast(err.message, true); }
}

// 검색·거르기
let debounce;
const reloadTasks = () => loadTasks().catch((e) => toast(e.message, true));
$('#f-q').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(reloadTasks, 250); });
['#f-priority', '#f-tag', '#f-sort'].forEach((s) => $(s).addEventListener('change', reloadTasks));
$$('.chip[data-status]').forEach((b) => b.addEventListener('click', () => { $('#f-status').value = b.dataset.status; reloadTasks(); }));
$('#chip-important').addEventListener('click', () => { $('#f-priority').value = $('#f-priority').value === '1' ? '' : '1'; reloadTasks(); });
$('#btn-filter').addEventListener('click', (e) => {
  const p = $('#filter-panel');
  p.hidden = !p.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!p.hidden));
});

// ---------- 칸반 보드 ----------
const COLS = [['todo', '진행 중'], ['delayed', '지연'], ['done', '완료']];
const colOf = (t) => (t.done ? 'done' : t.delayed ? 'delayed' : 'todo');
let dragId = null;
function renderBoard() {
  $('#board').replaceChildren(...COLS.map(([key, label]) => {
    const items = state.tasks.filter((t) => colOf(t) === key);
    const body = el('div', { class: 'col-body' }, ...items.map(boardCard));
    if (!items.length) body.append(el('p', { class: 'col-empty', text: key === 'done' ? '여기로 끌어다 놓으면 완료' : '비어 있음' }));
    const col = el('section', { class: `col col-${key}`, 'aria-label': `${label} ${items.length}개` },
      el('h3', {}, el('span', { class: 'col-dot', 'aria-hidden': 'true' }), el('span', { text: label }), el('em', { class: 'cnt', text: String(items.length) })),
      body);
    col.addEventListener('dragover', (e) => { if (dragId === null) return; e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const t = state.tasks.find((x) => x.id === dragId);
      dragId = null;
      if (t) moveTo(t, key, col.querySelector('h3'));
    });
    return col;
  }));
}
function boardCard(t) {
  const card = el('article', { class: ['bcard', t.done && 'done', state.justDone === t.id && 'pop'].filter(Boolean).join(' '), draggable: 'true', id: `card-${t.id}` },
    el('p', { class: 'card-title' }, t.title, el('small', { class: 'muted', text: ` #${t.id}` })),
    el('div', { class: 'bsub' }, fmtShort(t.due_date), ...t.tags.slice(0, 2).map(tagEl), `${fmtDur(t.actual_minutes)} / ${fmtDur(t.estimated_minutes)}`, t.blocked ? el('i', { class: 'bd block', text: '막힘' }) : null),
    el('div', { class: 'card-actions' },
      el('button', { type: 'button', class: 'mini', text: t.done ? '되돌리기' : '완료', onclick: (e) => (t.done ? reopen(t) : complete(t, e.currentTarget)) }),
      timerButton(t),
      el('button', { type: 'button', class: 'mini', text: '자세히', onclick: () => jumpToTask(t.id) })));
  card.addEventListener('dragstart', (e) => { dragId = t.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragId = null; $$('.col.over').forEach((c) => c.classList.remove('over')); });
  return card;
}
async function moveTo(t, key, anchor) {
  if (colOf(t) === key) return;
  if (key === 'done') return complete(t, anchor);
  if (t.done) return reopen(t);
  toast('지연 칸은 마감일이 지나면 저절로 옮겨집니다. 마감일은 "고치기"에서 바꾸세요.');
}

// ---------- 캘린더 ----------
function shiftMonth(n) {
  const [y, m] = state.calMonth.split('-').map(Number);
  state.calMonth = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  renderCalendar();
}
function renderCalendar() {
  if (state.view !== 'calendar') return;
  const today = seoulToday();
  if (!state.calMonth) state.calMonth = today.slice(0, 7);
  const [y, m] = state.calMonth.split('-').map(Number);
  const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDue = new Map();
  for (const t of state.tasks) { if (!byDue.has(t.due_date)) byDue.set(t.due_date, []); byDue.get(t.due_date).push(t); }
  const logMin = new Map();
  for (const l of state.logs) { const d = seoulDay(l.started_at); logMin.set(d, (logMin.get(d) || 0) + l.actual_minutes); }
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(el('div', { class: 'cal-cell blank', 'aria-hidden': 'true' }));
  for (let d = 1; d <= days; d += 1) {
    const ymd = `${state.calMonth}-${String(d).padStart(2, '0')}`;
    const tasks = byDue.get(ymd) || [];
    const dow = (startDow + d - 1) % 7;
    const mins = logMin.get(ymd);
    const shown = tasks.slice(0, 3);
    cells.push(el('div', {
      class: ['cal-cell', ymd === today && 'today', dow === 0 && 'sun', dow === 6 && 'sat'].filter(Boolean).join(' '),
      'aria-label': `${m}월 ${d}일, 할 일 ${tasks.length}개${mins ? `, 실행 기록 ${mins}분` : ''}`,
    },
    el('div', { class: 'cal-head' }, el('span', { class: 'cal-day', text: String(d) }), mins ? el('span', { class: 'cal-min', text: `${mins}분` }) : null),
    ...shown.map((t) => el('button', { type: 'button', class: ['cal-task', t.done && 'done', t.delayed && 'late'].filter(Boolean).join(' '), title: `#${t.id} ${t.title}`, onclick: () => jumpToTask(t.id) }, t.title)),
    tasks.length > shown.length ? el('span', { class: 'cal-more', text: `+${tasks.length - shown.length}개` }) : null));
  }
  $('#calendar').replaceChildren(
    el('div', { class: 'cal-bar' },
      el('button', { type: 'button', class: 'mini', 'aria-label': '이전 달', text: '‹', onclick: () => shiftMonth(-1) }),
      el('h3', { class: 'cal-title', text: `${y}년 ${m}월` }),
      el('button', { type: 'button', class: 'mini', 'aria-label': '다음 달', text: '›', onclick: () => shiftMonth(1) }),
      el('button', { type: 'button', class: 'mini', text: '오늘', onclick: () => { state.calMonth = today.slice(0, 7); renderCalendar(); } })),
    el('div', { class: 'cal-grid' }, ...WEEK.map((w, i) => el('div', { class: `cal-week${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, text: w })), ...cells));
}

// ---------- 타이머 ----------
let timerTick = null;
const baseTitle = document.title;
const fmtClock = (ms) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600); const mm = Math.floor((sec % 3600) / 60); const ss = sec % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p2(mm)}:${p2(ss)}` : `${p2(mm)}:${p2(ss)}`;
};
async function loadTimer() {
  const { timer } = await api('/api/timer');
  state.timer = timer;
  renderTimer();
}
function renderTimer() {
  clearInterval(timerTick);
  const t = state.timer;
  const pill = $('#timer-pill');
  if (!t) { pill.hidden = true; document.title = baseTitle; return; }
  pill.hidden = false;
  $('#timer-task').textContent = `#${t.task_id} ${t.task_title}`;
  const tick = () => {
    const c = fmtClock(Date.now() - new Date(t.started_at));
    $('#timer-clock').textContent = c;
    document.title = `⏱ ${c} · ${baseTitle}`;
  };
  tick();
  timerTick = setInterval(tick, 1000);
}
function timerButton(t) {
  if (t.done) return null;
  const running = state.timer && state.timer.task_id === t.id;
  return el('button', {
    type: 'button', class: `mini${running ? ' running' : ''}`,
    text: running ? '⏱ 재는 중' : '⏱ 시작',
    onclick: () => (running ? openTimerStop() : startTimer(t)),
  });
}
async function startTimer(t) {
  try {
    const r = await api(`/api/tasks/${t.id}/timer`, { method: 'POST' });
    state.timer = r.timer;
    renderTimer();
    renderTasks();
    toast(`할 일 #${t.id} 타이머를 시작했습니다. 끝나면 아래 거북이 옆 "정지"를 누르세요.`);
  } catch (err) {
    if (err.data && err.data.timer) { state.timer = err.data.timer; renderTimer(); }
    toast(err.message, true);
  }
}
function openTimerStop() {
  const t = state.timer;
  if (!t) return;
  $('#timer-form').blocker.value = '';
  $('#timer-summary').textContent = `할 일 #${t.task_id} "${t.task_title}" · ${fmtTime(t.started_at)}부터 ${fmtClock(Date.now() - new Date(t.started_at))} 동안 재었습니다. 저장하면 시작·끝 시각과 걸린 분이 실행 기록 한 건으로 남습니다.`;
  openDialog($('#timer-dialog'));
}
$('#btn-timer-stop').addEventListener('click', openTimerStop);
$('#timer-task').addEventListener('click', async (e) => {
  e.preventDefault();
  const t = state.timer;
  if (!t) return;
  if (t.plan_id !== state.planId) await selectPlan(t.plan_id);
  await jumpToTask(t.task_id);
});
$('#timer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    const l = await api('/api/timer/stop', { method: 'POST', body: { blocker: f.blocker.value } });
    $('#timer-dialog').close();
    state.timer = null;
    renderTimer();
    toast(`실행 기록 #${l.id}을 할 일 #${l.task_id}에 저장했습니다 (${l.actual_minutes}분).`);
    await refreshAll();
  } catch (err) {
    f.querySelector('.form-error').textContent = err.message;
    if (err.status === 404) { state.timer = null; renderTimer(); }
  }
});
$('#btn-timer-discard').addEventListener('click', async () => {
  if (!confirm('이 타이머를 기록 없이 버릴까요?')) return;
  try {
    await api('/api/timer', { method: 'DELETE' });
    $('#timer-dialog').close();
    state.timer = null;
    renderTimer();
    renderTasks();
    toast('타이머를 기록 없이 버렸습니다.');
  } catch (err) { toast(err.message, true); }
});

// 완료했을 때 버튼 자리에서 별이 터진다.
function burst(anchor) {
  if (!anchor || reducedMotion()) return;
  const r = anchor.getBoundingClientRect();
  const layer = $('#burst-layer');
  const colors = ['#2fa862', '#f5c542', '#8fd67a', '#e0584f'];
  for (let i = 0; i < 14; i += 1) {
    const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const d = 38 + Math.random() * 34;
    const bit = el('span', { class: `bit ${['leaf', 'star', 'dot'][i % 3]}` });
    bit.style.left = `${r.left + r.width / 2}px`;
    bit.style.top = `${r.top + r.height / 2}px`;
    bit.style.background = colors[i % colors.length];
    bit.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    bit.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    bit.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
    bit.addEventListener('animationend', () => bit.remove());
    layer.append(bit);
  }
}

// 숫자가 바뀌면 이전 값에서 새 값까지 굴러간다.
function countUp(node, from, to, fmt) {
  if (from === undefined || from === to || reducedMotion()) { node.textContent = fmt(to); return; }
  const start = performance.now();
  const dur = 450;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = fmt(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


// ---------- 실제로 한 일 적기 ----------
let minutesTouched = false;
function openLog(t) {
  minutesTouched = false;
  const f = $('#log-form');
  const tasks = state.allTasks;
  if (!tasks.length) { toast('먼저 할 일을 하나 붙여 주세요. 실행 기록은 할 일에 붙습니다.', true); return; }
  f.task_id.replaceChildren(...tasks.map((x) => el('option', { value: x.id, text: `#${x.id} ${x.title}` })));
  f.task_id.value = String(t ? t.id : tasks.find((x) => !x.done)?.id ?? tasks[0].id);
  f.started_at.value = ''; f.ended_at.value = isoToSeoulLocal(new Date().toISOString()); f.actual_minutes.value = ''; f.blocker.value = '';
  openDialog($('#log-dialog'));
}
$('#btn-add-log').addEventListener('click', () => (plan() ? openLog(null) : openNewPlan()));
function autoMinutes() {
  const f = $('#log-form');
  if (minutesTouched || !f.started_at.value || !f.ended_at.value) return;
  const m = Math.round((new Date(localToSeoulIso(f.ended_at.value)) - new Date(localToSeoulIso(f.started_at.value))) / 60000);
  if (m >= 0) f.actual_minutes.value = m;
}
$('#log-form').started_at.addEventListener('change', autoMinutes);
$('#log-form').ended_at.addEventListener('change', autoMinutes);
$('#log-form').actual_minutes.addEventListener('input', () => { minutesTouched = true; });
$('#log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const d = formData(f);
  try {
    const l = await api(`/api/tasks/${Number(d.task_id)}/logs`, {
      method: 'POST',
      body: { started_at: localToSeoulIso(d.started_at), ended_at: localToSeoulIso(d.ended_at), actual_minutes: d.actual_minutes === '' ? undefined : Number(d.actual_minutes), blocker: d.blocker },
    });
    $('#log-dialog').close();
    toast(`실행 기록 #${l.id}을 할 일 #${l.task_id}에 붙였습니다. 오늘도 수고했어요!`);
    await refreshAll();
  } catch (err) { f.querySelector('.form-error').textContent = err.message; }
});

// ---------- 돌아보기 ----------
const METRICS = {
  planned: { label: '계획 수', rule: '이 계획에 딸린, 지우지 않은 할 일', unit: '개' },
  done: { label: '완료 수', rule: '그중 지금 완료 상태인 할 일', unit: '개' },
  delayed: { label: '지연 수', rule: '완료하지 않았고 마감일이 서울 기준 오늘보다 앞선 할 일 (완료한 할 일은 세지 않음)', unit: '개' },
  blocked: { label: '막힘 수', rule: '막혔던 이유가 하나라도 적힌 실행 기록이 있는 할 일', unit: '개' },
  estimated: { label: '예상 시간', rule: '대상 할 일의 예상 시간 합계', unit: '분' },
  actual: { label: '실제 시간', rule: '대상 할 일에 붙은 실행 기록의 실제 시간 합계', unit: '분' },
  diff: { label: '차이 (실제−예상)', rule: '할 일마다 실제 시간 − 예상 시간, 그리고 그 합', unit: '분' },
};
const RAW_KEY = { planned: 'planned', done: 'done', delayed: 'delayed', blocked: 'blocked', estimated: 'estimated_minutes', actual: 'actual_minutes', diff: 'diff_minutes' };
const fmtMetric = (k, n) => (METRICS[k].unit === '분' ? `${k === 'diff' && n > 0 ? '+' : ''}${fmtDur(n)}` : `${n}${METRICS[k].unit}`);

function periodQs() {
  const qs = new URLSearchParams();
  if (state.period.from) qs.set('from', state.period.from);
  if (state.period.to) qs.set('to', state.period.to);
  return qs;
}
const inPeriod = (t) => (!state.period.from || t.due_date >= state.period.from) && (!state.period.to || t.due_date <= state.period.to);

async function loadReview() {
  const r = await api(`/api/plans/${state.planId}/review?${periodQs()}`);
  state.review = r;
  const p = plan();
  $('#review-range').textContent = r.from || r.to
    ? `${(r.from || '처음').replaceAll('-', '.')} ~ ${(r.to || '끝').replaceAll('-', '.')} · 마감일 기준 · 서울 시간`
    : `${p.start_date.replaceAll('-', '.')} ~ ${p.end_date.replaceAll('-', '.')} · 전체 기간 · 서울 시간`;
  $('#review-basis').textContent = `서울 기준 오늘 ${r.today_seoul} · 시간은 분 단위로 저장하고 ○시간 ○분으로 보여 줘요`;
  const samePlan = state.prevStats.planId === state.planId;
  const raw = Object.fromEntries(Object.entries(RAW_KEY).map(([k, f]) => [k, r[f]]));
  $('#stats').replaceChildren(...Object.keys(METRICS).map((k) => {
    const prev = samePlan ? state.prevStats[k] : undefined;
    const num = el('b', { text: fmtMetric(k, raw[k]) });
    const btn = el('button', {
      type: 'button', class: `stat k-${k}${k === 'diff' && raw[k] > 0 ? ' over' : ''}${prev !== undefined && prev !== raw[k] ? ' bump' : ''}`,
      'data-metric': k, 'aria-pressed': String(state.metric === k), 'aria-label': `${METRICS[k].label} ${fmtMetric(k, raw[k])}, 근거 보기`,
      onclick: () => showEvidence(k),
    }, el('span', { text: METRICS[k].label }), num);
    countUp(num, prev, raw[k], (n) => fmtMetric(k, n));
    return btn;
  }));
  const rate = r.planned ? Math.round((r.done / r.planned) * 100) : 0;
  $('#ring').setAttribute('stroke-dasharray', `${rate} 100`);
  countUp($('#rate'), samePlan ? state.prevStats.rate : undefined, rate, (n) => `${n}%`);
  $('#donut').setAttribute('aria-label', `완료율 ${rate}% (완료 ${r.done} ÷ 계획 ${r.planned}), 완료한 할 일 보기`);
  $('#rate-note').textContent = `완료 ${r.done}개 ÷ 계획 ${r.planned}개. 숫자나 동그라미를 누르면 근거가 오른쪽에 나와요.`;
  // 홈 '돌아보기 한눈에'
  const glance = [['done', '완료율', `${rate}%`, false, `${r.done} / ${r.planned}개 완료`], ['delayed', '지연', `${r.delayed}`, r.delayed > 0, '마감이 지난 할 일'], ['blocked', '막힘', `${r.blocked}`, r.blocked > 0, '막힌 이유를 적은 일'], ['diff', '시간 차이', fmtDur(r.diff_minutes).replace(/^(?!-)/, r.diff_minutes > 0 ? '+' : ''), r.diff_minutes > 0, '실제 − 예상']];
  $('#glance').replaceChildren(...glance.map(([k, label, val, warn, hint]) => el('button', {
    type: 'button', 'aria-label': `${label} ${val}, 돌아보기에서 근거 보기`,
    onclick: async () => { showScreen('review'); await showEvidence(k); },
  class: `gl gl-${k}`,
  }, el('span', { text: label }), el('b', { class: warn ? 'r' : null, text: val }), el('small', { text: hint }))));
  state.prevStats = { ...raw, rate, planId: state.planId };
  renderTagRows();
  if (state.metric) await showEvidence(state.metric, false);
}

// 태그별 예상 vs 실제 (할 일에 태그가 여러 개면 각 태그에 한 번씩 셉니다)
function renderTagRows() {
  if (!state.planId) return;
  const sums = new Map();
  for (const t of state.allTasks.filter(inPeriod)) {
    for (const g of (t.tags.length ? t.tags : ['태그 없음'])) {
      const s = sums.get(g) || { e: 0, a: 0, n: 0, le: 0, la: 0 };
      s.e += t.estimated_minutes; s.a += t.actual_minutes; s.n += 1;
      if (t.log_count > 0) { s.le += t.estimated_minutes; s.la += t.actual_minutes; }
      sums.set(g, s);
    }
  }
  const rows = [...sums].sort((x, y) => y[1].e - x[1].e).slice(0, 5);
  const max = Math.max(1, ...rows.map(([, s]) => Math.max(s.e, s.a)));
  $('#tag-rows').replaceChildren(...(rows.length ? rows.map(([g, s]) => {
    const d = s.a - s.e;
    return el('div', { class: 'tagrow' }, g === '태그 없음' ? el('i', { class: 'tag', text: g }) : tagEl(g),
      el('div', { class: 'pair' },
        el('p', {}, el('i', { style: `width:${(s.e / max) * 70}%` }), el('span', { text: `예상 ${fmtDur(s.e)}` })),
        el('p', {}, el('i', { class: 'act', style: `width:${(s.a / max) * 70}%` }), el('span', { text: `실제 ${s.a ? fmtDur(s.a) : '0분'}` }))),
      el('b', { class: d > 0 ? 'r' : 'g', text: `${d > 0 ? '+' : ''}${fmtDur(d)}` }));
  }) : [el('p', { class: 'hint', text: '할 일에 태그를 붙이면 태그별로 얼마나 빗나갔는지 보여 드려요.' })]));
  const cand = rows.filter(([, s]) => s.le > 0 && s.la > 0).map(([g, s]) => [g, s.la / s.le]).sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1));
  const it = $('#insight-text');
  it.replaceChildren();
  if (!cand.length) it.append('실행 기록이 쌓이면 어느 쪽 계획이 자주 빗나가는지 알려 드릴게요.');
  else {
    const [g, ratio] = cand[0];
    it.append(el('b', { text: g }), ratio >= 1 ? '은(는) 기록이 있는 할 일 기준으로 예상보다 ' : '은(는) 기록이 있는 할 일 기준으로 예상의 ', el('b', { text: `${ratio.toFixed(1)}배` }),
      ratio >= 1 ? ' 걸렸어요. 다음 계획에선 넉넉히 잡아 볼까요?' : '만에 끝났어요. 예상을 조금 줄여도 되겠어요.');
  }
}

function resetEvidence() {
  state.metric = null;
  $('#evidence-title').textContent = '근거';
  $('#evidence-rule').textContent = '위의 숫자나 완료율을 누르면, 그 숫자를 만든 할 일과 실행 기록이 여기에 나옵니다.';
  $('#evidence-list').replaceChildren();
  $$('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

async function showEvidence(metric, focus = true) {
  state.metric = metric;
  $$('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === metric)));
  const qs = periodQs(); qs.set('metric', metric);
  const ev = await api(`/api/plans/${state.planId}/review/evidence?${qs}`);
  const r = state.review;
  const val = r ? ` ${fmtMetric(metric, r[RAW_KEY[metric]])}` : '';
  $('#evidence-title').textContent = `'${METRICS[metric].label}${val}'의 근거: 할 일 ${ev.tasks.length}개`;
  $('#evidence-rule').textContent = `세는 규칙: ${METRICS[metric].rule}`;
  const logsByTask = ev.logs.reduce((a, l) => ((a[l.task_id] ||= []).push(l), a), {});
  const items = ev.tasks.map((t) => {
    const logs = logsByTask[t.id] || [];
    const showLogs = ['actual', 'blocked', 'diff'].includes(metric) ? logs.filter((l) => metric !== 'blocked' || l.blocker.trim()) : [];
    const extra = metric === 'diff' ? `예상 ${fmtDur(t.estimated_minutes)} / 실제 ${fmtDur(t.actual_minutes)} / 차이 ${fmtDur(t.actual_minutes - t.estimated_minutes)}`
      : metric === 'estimated' ? `예상 ${fmtDur(t.estimated_minutes)}`
        : metric === 'actual' ? `실제 ${fmtDur(t.actual_minutes)}`
          : `마감 ${t.due_date}${t.done ? ' · 완료' : ''}`;
    return el('li', {},
      el('a', { href: `#task-${t.id}`, onclick: (e) => { e.preventDefault(); jumpToTask(t.id); } }, `할 일 #${t.id} ${t.title}`),
      el('span', { class: 'ex', text: extra }),
      showLogs.length ? el('ul', {}, ...showLogs.map((l) => logItem(l))) : null);
  });
  if (!items.length) items.push(el('li', { class: 'hint', text: '이 숫자에 해당하는 기록이 없습니다.' }));
  const sums = { e: ev.tasks.reduce((a, t) => a + t.estimated_minutes, 0), a: ev.tasks.reduce((a, t) => a + t.actual_minutes, 0) };
  if (metric === 'estimated') items.push(el('li', { class: 'sum', text: `합계 ${fmtDur(sums.e)} (${sums.e}분)` }));
  if (metric === 'actual') items.push(el('li', { class: 'sum', text: `합계 ${fmtDur(sums.a)} (${sums.a}분, 기록 ${ev.logs.length}건)` }));
  if (metric === 'diff') items.push(el('li', { class: 'sum', text: `실제 ${fmtDur(sums.a)} − 예상 ${fmtDur(sums.e)} = ${fmtDur(sums.a - sums.e)} (${sums.a - sums.e}분)` }));
  $('#evidence-list').replaceChildren(...items);
  const box = $('#evidence');
  if (focus) {
    box.classList.remove('reveal'); void box.offsetWidth; box.classList.add('reveal');
    box.scrollIntoView({ block: 'nearest' }); box.focus({ preventScroll: true });
  }
}
$('#donut').addEventListener('click', () => showEvidence('done'));

// 근거 → 할 일로 가서 펼치고 실행 기록까지 보여 준다
async function jumpToTask(taskId) {
  showScreen('tasks', { top: false });
  if (state.view !== 'list') setView('list');
  let node = document.getElementById(`task-${taskId}`);
  if (!node) {
    $('#f-q').value = ''; $('#f-status').value = 'all'; $('#f-priority').value = ''; $('#f-tag').value = '';
    await loadTasks();
    node = document.getElementById(`task-${taskId}`);
  }
  if (!node) return toast(`할 일 #${taskId}을 찾을 수 없습니다.`, true);
  const more = node.querySelector('.more-btn');
  if (more && more.getAttribute('aria-expanded') === 'false') more.click();
  node.scrollIntoView({ block: 'center' });
  node.focus({ preventScroll: true });
  node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash');
}

$('#btn-period').addEventListener('click', (e) => {
  const f = $('#period-form');
  f.hidden = !f.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!f.hidden));
});
$('#period-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = formData(e.currentTarget);
  if (d.from && d.to && d.to < d.from) return toast('기간 끝은 시작과 같거나 뒤여야 합니다.', true);
  state.period = { from: d.from, to: d.to };
  await loadReview().catch((err) => toast(err.message, true));
});
$('#btn-period-all').addEventListener('click', async () => {
  const f = $('#period-form'); f.from.value = ''; f.to.value = '';
  state.period = { from: '', to: '' };
  await loadReview().catch((err) => toast(err.message, true));
});

$('#lesson-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    const r = await api(`/api/plans/${state.planId}/reviews`, { method: 'POST', body: { lesson: f.lesson.value, from: state.period.from, to: state.period.to } });
    f.lesson.value = '';
    toast(`돌아보기 #${r.id}을 저장했습니다. 아래에서 다음 계획으로 넘길 수 있어요.`);
    await loadReviews();
  } catch (err) { toast(err.message, true); }
});

async function loadReviews() {
  const list = await api(`/api/plans/${state.planId}/reviews`);
  $('#review-list').replaceChildren(...list.map((r) => {
    const s = r.snapshot;
    return el('li', {},
      el('small', { text: `돌아보기 #${r.id} · ${fmtTime(r.created_at)} · 그때 숫자: 계획 ${s.planned} / 완료 ${s.done} / 지연 ${s.delayed} / 막힘 ${s.blocked} / 예상 ${s.estimated_minutes}분 / 실제 ${s.actual_minutes}분 / 차이 ${s.diff_minutes}분` }),
      el('p', { class: 'lesson-line', text: `고칠 점: ${r.lesson}` }),
      r.carried_to_plan_id
        ? el('span', { class: 'carried' }, '🍀 다음 계획 ',
          el('a', { href: `?plan=${r.carried_to_plan_id}`, onclick: async (e) => { e.preventDefault(); await selectPlan(r.carried_to_plan_id); showScreen('plan'); } }, `#${r.carried_to_plan_id}`),
          '(으)로 넘어감')
        : el('button', { type: 'button', class: 'btn-primary small', text: `${'🍀'} 다음 계획으로 넘기기`, onclick: () => openCarry(r) }));
  }));
}

let carryReview = null;
function openCarry(r) {
  carryReview = r;
  const p = plan();
  const f = $('#carry-form');
  $('#carry-lesson').textContent = r.lesson;
  f.title.value = `${p.title} (다음)`;
  f.start_date.value = seoulToday(); f.end_date.value = addDays(seoulToday(), 30);
  f.priority.value = String(p.priority); f.estimated_minutes.value = p.estimated_minutes;
  f.success_criteria.value = p.success_criteria;
  openDialog($('#carry-dialog'));
}
$('#carry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const d = formData(f);
  try {
    const p = await api(`/api/reviews/${carryReview.id}/carry`, { method: 'POST', body: { ...d, priority: Number(d.priority), estimated_minutes: d.estimated_minutes } });
    $('#carry-dialog').close();
    state.prevStats = {};
    resetEvidence();
    await loadPlans(p.id);
    await refreshAll();
    showScreen('plan');
    toast(`고칠 점을 새 계획 #${p.id}로 넘겼습니다. 🍀`);
  } catch (err) { f.querySelector('.form-error').textContent = err.message; }
});

// ---------- 시작 ----------
async function refreshAll() {
  if (!state.planId) { renderPlanNav(); return; }
  state.plans = await api('/api/plans');
  renderPlan();
  renderPlanNav();
  await Promise.all([loadTimer(), loadLogFeed()]);
  await Promise.all([loadTasks(), loadReview(), loadReviews(), loadHistory()]);
}

(async () => {
  const today = seoulToday();
  $('#today-label').textContent = `${fmtDate(today)} ${dowOf(today)}요일`;
  $('#task-form').due_date.value = today;
  // 행운 쪽지는 쿠키를 누르기 전에는 보여 주지 않는다
  showScreen(location.hash.slice(1), { push: false });
  try {
    await loadPlans();
    await refreshAll();
  } catch (err) {
    toast(`자료를 불러오지 못했습니다: ${err.message}`, true);
  }
})();

// ---------- 음악 (왼쪽 메뉴 아래 작은 플레이어, 누를 때만 재생) ----------
(() => {
  const box = $('#music');
  if (!box) return;
  const audio = new Audio('/audio/bright-walk.mp3');
  audio.preload = 'none';
  audio.loop = true;
  audio.volume = 0.55;
  const btn = $('#music-play');
  function setPlaying(on) {
    box.classList.toggle('playing', on);
    $('#music-state').textContent = on ? '음악 재생 중' : '음악 정지 중';
    btn.setAttribute('aria-label', on ? '음악 멈추기' : '음악 재생');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  btn.addEventListener('click', () => {
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => { setPlaying(false); toast('음악을 재생하지 못했어요.', true); });
    else { audio.pause(); setPlaying(false); }
  });
  $('#music-vol').addEventListener('input', (e) => { audio.volume = Number(e.target.value) / 100; });
})();

// ---------- 시간 입력: 분 대신 "○시간 ○분"으로 적기 (저장은 그대로 분) ----------
(() => {
  const NAMES = ['estimated_minutes', 'actual_minutes'];
  const widgets = [];
  $$('form input[type="number"]').filter((i) => NAMES.includes(i.name)).forEach((inp) => {
    const label = inp.closest('label');
    const h = el('input', { type: 'number', min: '0', max: '1666', step: '1', inputmode: 'numeric', 'aria-label': '시간', class: 'dur-h' });
    const m = el('input', { type: 'number', min: '0', max: '59', step: '1', inputmode: 'numeric', 'aria-label': '분', class: 'dur-m' });
    const box = el('span', { class: 'dur' }, h, el('span', { class: 'dur-u', text: '시간' }), m, el('span', { class: 'dur-u', text: '분' }));
    inp.classList.add('dur-src');
    inp.tabIndex = -1;
    inp.setAttribute('aria-hidden', 'true');
    inp.after(box);
    // 라벨의 "(분)" 글자는 지운다
    for (const n of label.childNodes) if (n.nodeType === 3) n.textContent = n.textContent.replace('(분)', '');
    const fromSrc = () => {
      const v = inp.value === '' ? null : Number(inp.value);
      const cur = (h.value === '' && m.value === '') ? null : (Number(h.value || 0) * 60 + Number(m.value || 0));
      if (v === cur) return;
      if (v === null) { h.value = ''; m.value = ''; return; }
      h.value = String(Math.floor(v / 60)); m.value = String(v % 60);
    };
    const toSrc = () => {
      if (h.value === '' && m.value === '') inp.value = '';
      else {
        let mm = Number(m.value || 0);
        let hh = Number(h.value || 0);
        if (mm >= 60) { hh += Math.floor(mm / 60); mm %= 60; h.value = String(hh); m.value = String(mm); }
        inp.value = String(Math.max(0, hh * 60 + mm));
      }
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    h.addEventListener('input', (e) => { e.stopPropagation(); toSrc(); });
    m.addEventListener('input', (e) => { e.stopPropagation(); toSrc(); });
    // 시작·끝 시각을 바꾸면 분이 자동으로 계산되므로 그때마다 화면 칸도 맞춘다
    inp.form.addEventListener('input', () => setTimeout(fromSrc, 0));
    inp.form.addEventListener('change', () => setTimeout(fromSrc, 0));
    widgets.push(fromSrc);
  });
  const orig = openDialog;
  // eslint-disable-next-line no-func-assign
  openDialog = (d) => { orig(d); widgets.forEach((f) => f()); };
})();
