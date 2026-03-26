-- agent_states: key-value memory scoped to org + agent tool + optional session.
-- session_id defaults to the null-sentinel UUID so the UNIQUE constraint works
-- correctly without NULL-equality edge cases.
CREATE TABLE IF NOT EXISTS agent_states (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      INTEGER      NOT NULL,
  tool_slug   VARCHAR(100) NOT NULL,
  session_id  UUID         NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  key         VARCHAR(255) NOT NULL,
  value       JSONB        NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_states_unique_key UNIQUE (org_id, tool_slug, session_id, key)
);

CREATE INDEX IF NOT EXISTS idx_agent_states_org_tool ON agent_states (org_id, tool_slug);

-- agent_conclusions: final outputs from completed agent runs.
CREATE TABLE IF NOT EXISTS agent_conclusions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      INTEGER      NOT NULL,
  tool_slug   VARCHAR(100) NOT NULL,
  session_id  UUID,
  run_id      UUID         NOT NULL UNIQUE,
  result      TEXT         NOT NULL,
  trace       JSONB,
  tokens_used JSONB,
  iterations  INTEGER,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_conclusions_org_tool ON agent_conclusions (org_id, tool_slug);
CREATE INDEX IF NOT EXISTS idx_agent_conclusions_session  ON agent_conclusions (session_id) WHERE session_id IS NOT NULL;

-- agent_schedules: one row per registered agent — cron expression + metadata.
-- org_id is nullable: null means the agent is intended to run for all orgs
-- (requires org_tools table, not yet built — see AgentScheduler.trigger() guard).
CREATE TABLE IF NOT EXISTS agent_schedules (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         VARCHAR(100) UNIQUE NOT NULL,
  tool_slug        VARCHAR(50)  NOT NULL,
  org_id           INT          REFERENCES organizations(id) ON DELETE CASCADE,
  schedule         VARCHAR(100),
  enabled          BOOLEAN      NOT NULL DEFAULT true,
  handler_module   VARCHAR(255),
  config           JSONB,
  last_run_at      TIMESTAMP,
  last_run_status  VARCHAR(50),
  next_run_at      TIMESTAMP,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_schedules_tool_slug ON agent_schedules (tool_slug);
CREATE INDEX IF NOT EXISTS idx_agent_schedules_org_id    ON agent_schedules (org_id) WHERE org_id IS NOT NULL;

-- agent_executions: one row per agent run — tracks status, result, and timing.
CREATE TABLE IF NOT EXISTS agent_executions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      VARCHAR(100) NOT NULL,
  org_id        INT          REFERENCES organizations(id) ON DELETE CASCADE,
  trigger_type  VARCHAR(50),
  triggered_by  INT          REFERENCES users(id),
  started_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMP,
  status        VARCHAR(50),
  result        JSONB,
  error         TEXT,
  tokens_used   INT,
  execution_log JSONB
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_started ON agent_executions (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_executions_org_started   ON agent_executions (org_id, started_at DESC);
