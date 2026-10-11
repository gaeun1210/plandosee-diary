-- 플랜두씨 다이어리 스키마 (v2)
-- 날짜 규칙: 날짜만 있는 값(DATE)은 서울 달력 날짜, 시각(TIMESTAMPTZ)은 UTC로 저장하고 화면에서 Asia/Seoul로 보여 준다.
-- 시간 단위: 모든 *_minutes 칸은 '분'(정수).
-- 서버가 시작될 때마다 실행되므로 모든 문장은 여러 번 실행해도 안전해야 한다.

CREATE TABLE IF NOT EXISTS plans (
  id                BIGSERIAL PRIMARY KEY,
  current_revision  INT NOT NULL DEFAULT 1,
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  priority          SMALLINT NOT NULL CHECK (priority BETWEEN 1 AND 3),
  success_criteria  TEXT NOT NULL CHECK (char_length(success_criteria) BETWEEN 1 AND 1000),
  estimated_minutes INT NOT NULL CHECK (estimated_minutes BETWEEN 0 AND 100000),
  carried_lesson    TEXT CHECK (carried_lesson IS NULL OR char_length(carried_lesson) <= 300),
  carried_from_review_id BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

-- 계획의 모든 판(版). 1판이 처음 세운 계획이며, 고칠 때마다 새 판이 쌓인다. 지우거나 고칠 수 없다.
CREATE TABLE IF NOT EXISTS plan_revisions (
  id                BIGSERIAL PRIMARY KEY,
  plan_id           BIGINT NOT NULL REFERENCES plans(id),
  revision_no       INT NOT NULL,
  title             TEXT NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  priority          SMALLINT NOT NULL,
  success_criteria  TEXT NOT NULL,
  estimated_minutes INT NOT NULL,
  carried_lesson    TEXT,
  change_note       TEXT CHECK (change_note IS NULL OR char_length(change_note) <= 300),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, revision_no)
);

CREATE OR REPLACE FUNCTION forbid_revision_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'plan_revisions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plan_revisions_append_only ON plan_revisions;
CREATE TRIGGER plan_revisions_append_only
  BEFORE UPDATE OR DELETE ON plan_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_revision_change();

CREATE TABLE IF NOT EXISTS tasks (
  id                BIGSERIAL PRIMARY KEY,
  plan_id           BIGINT NOT NULL REFERENCES plans(id),
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  due_date          DATE NOT NULL,
  priority          SMALLINT NOT NULL CHECK (priority BETWEEN 1 AND 3),
  tags              TEXT[] NOT NULL DEFAULT '{}',
  estimated_minutes INT NOT NULL CHECK (estimated_minutes BETWEEN 0 AND 100000),
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_plan_idx ON tasks(plan_id) WHERE deleted_at IS NULL;

-- 완료 기록. 할 일이 '완료'인지는 되돌리지 않은 완료 기록이 있는지로 정한다.
CREATE TABLE IF NOT EXISTS task_completions (
  id              BIGSERIAL PRIMARY KEY,
  task_id         BIGINT NOT NULL REFERENCES tasks(id),
  idempotency_key UUID NOT NULL UNIQUE,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_at     TIMESTAMPTZ
);
-- 한 할 일에 되돌리지 않은 완료 기록은 한 건만 있을 수 있다 (연속 클릭·동시 요청 중복 방지).
CREATE UNIQUE INDEX IF NOT EXISTS one_open_completion_per_task
  ON task_completions(task_id) WHERE reopened_at IS NULL;

-- 실행 기록. 계획·할 일 표와 분리되어 있어 저장해도 계획 값을 덮어쓰지 않는다.
CREATE TABLE IF NOT EXISTS work_logs (
  id             BIGSERIAL PRIMARY KEY,
  task_id        BIGINT NOT NULL REFERENCES tasks(id),
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ NOT NULL,
  actual_minutes INT NOT NULL CHECK (actual_minutes BETWEEN 0 AND 100000),
  blocker        TEXT NOT NULL DEFAULT '' CHECK (char_length(blocker) <= 1000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS work_logs_task_idx ON work_logs(task_id);

-- 돌아보기. 저장할 때의 집계 숫자와 고칠 점 한 줄을 남기고, 넘긴 다음 계획을 가리킨다.
CREATE TABLE IF NOT EXISTS reviews (
  id                 BIGSERIAL PRIMARY KEY,
  plan_id            BIGINT NOT NULL REFERENCES plans(id),
  snapshot           JSONB NOT NULL,
  lesson             TEXT NOT NULL CHECK (char_length(lesson) BETWEEN 1 AND 300),
  carried_to_plan_id BIGINT UNIQUE REFERENCES plans(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 돌고 있는 타이머. 한 번에 하나만 돌 수 있다(id=1 고정). 정지하면 지워지고 work_logs에 기록 한 건이 생긴다.
CREATE TABLE IF NOT EXISTS running_timer (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  task_id    BIGINT NOT NULL REFERENCES tasks(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
