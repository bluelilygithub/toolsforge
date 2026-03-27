require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');
const logger = require('./utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Database connection failed', { error: err.message });
    process.exit(1);
  } else {
    logger.info('Database connected', { timestamp: res.rows[0].now });
  }
});

async function initializeSchema() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Organizations
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Users — no role column; roles live in user_roles
    // password_hash is nullable — invited users have no password until they activate
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Auth sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token)
    `);

    // Password reset tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Roles — system-defined + tool-defined
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_system BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // User role assignments with contextual scoping
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL DEFAULT 'global',
        scope_id TEXT,
        granted_by INTEGER REFERENCES users(id),
        granted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Unique index handles NULL scope_id correctly (COALESCE not allowed in table constraints)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique
      ON user_roles(user_id, role_id, scope_type, COALESCE(scope_id, ''))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)
    `);

    // User settings — JSONB key/value per user
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, key)
      )
    `);

    // System settings — admin-managed global config
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value JSONB,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Invitation tokens — admin-created, one-time use, 48h expiry
    await client.query(`
      CREATE TABLE IF NOT EXISTS invitation_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        invited_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Email templates — admin-editable subject + body for platform and tool emails
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        tool_slug TEXT,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        body_text TEXT NOT NULL,
        description TEXT,
        variables TEXT[] DEFAULT '{}',
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Application logs — warn and error entries from Winston
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id SERIAL PRIMARY KEY,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        meta JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC)
    `);

    // Password history — last N hashes to prevent reuse
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id)
    `);

    // AI usage logs — one row per response, used for cost tracking and spend alerts
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool_slug TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, created_at DESC)
    `);

    // Tool registry
    await client.query(`
      CREATE TABLE IF NOT EXISTS tools (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        enabled BOOLEAN DEFAULT false,
        schema_name TEXT,
        config JSONB DEFAULT '{}',
        installed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Idempotent column additions for existing databases
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
    `);
    await client.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ
    `);

    // -----------------------------------------------------------------------
    // File ingestion pipeline — Sprint 1
    // pgvector must be enabled before the vector column can be created.
    // CREATE EXTENSION is idempotent with IF NOT EXISTS.
    // -----------------------------------------------------------------------
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // document_extractions — one row per uploaded file
    // org_id / project_id are INTEGER to match the SERIAL PKs on organizations.
    // project_id is nullable (projects table arrives in Sprint 2).
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_extractions (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id            INTEGER     NOT NULL REFERENCES organizations(id),
        project_id        INTEGER,
        file_name         TEXT        NOT NULL,
        file_type         TEXT        NOT NULL,
        file_path         TEXT        NOT NULL,
        extracted_text    TEXT,
        extraction_status TEXT        NOT NULL DEFAULT 'pending'
          CHECK (extraction_status IN ('pending','complete','failed')),
        error_message     TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_extractions_org_id
        ON document_extractions(org_id)
    `);
    // Composite index — Sprint 2 will build on this for scoped vector retrieval
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_extractions_org_project
        ON document_extractions(org_id, project_id)
    `);

    // document_embeddings — one row per text chunk
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_embeddings (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        extraction_id  UUID        NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
        org_id         INTEGER     NOT NULL,
        project_id     INTEGER,
        chunk_index    INTEGER     NOT NULL,
        chunk_text     TEXT        NOT NULL,
        embedding      vector(768),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_embeddings_extraction_id
        ON document_embeddings(extraction_id)
    `);
    // Composite index — heavily used by scoped similarity search
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_embeddings_org_project
        ON document_embeddings(org_id, project_id)
    `);
    // Sprint 2: HNSW index replaces the Sprint 1 IVFFlat index.
    // HNSW offers better recall at query time and does not require a training
    // pass (no minimum row count), making it more robust at small dataset sizes.
    // m=16 / ef_construction=64 are pgvector defaults and a safe starting point;
    // Sprint 3 can tune ef_search at query time without rebuilding the index.
    //
    // pgvector HNSW does not support multi-column (scalar + vector) indices, so
    // the B-tree composite index idx_doc_embeddings_org_project (org_id, project_id)
    // handles pre-filtering while HNSW handles ANN distance scoring.
    //
    // The DO block is idempotent: it drops the old IVFFlat index if present and
    // creates the HNSW index only when it doesn't already exist.
    await client.query(`
      DO $$
      BEGIN
        -- Remove Sprint 1 IVFFlat index if it still exists
        IF EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_doc_embeddings_vector'
            AND n.nspname = 'public'
        ) THEN
          DROP INDEX idx_doc_embeddings_vector;
        END IF;

        -- Create HNSW index when it doesn't already exist
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_doc_embeddings_hnsw'
            AND n.nspname = 'public'
        ) THEN
          CREATE INDEX idx_doc_embeddings_hnsw
            ON document_embeddings USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);
        END IF;
      END
      $$
    `);

    // -----------------------------------------------------------------------
    // Usage telemetry — Sprint 3
    // org_id / user_id are INTEGER to match SERIAL PKs on organizations/users.
    // The spec describes them as uuid but the existing schema uses SERIAL;
    // using INTEGER keeps FK types consistent across the whole codebase.
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id           INTEGER     NOT NULL,
        user_id          INTEGER     NOT NULL,
        event_type       TEXT        NOT NULL,
        file_type        TEXT,
        chunk_count      INTEGER,
        query_tokens     INTEGER,
        result_count     INTEGER,
        embedding_model  TEXT,
        duration_ms      INTEGER,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // B-tree composite on (org_id, created_at) — supports time-windowed admin
    // queries with an org filter, which is the primary access pattern.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_events_org_created_at
        ON usage_events(org_id, created_at DESC)
    `);

    // -----------------------------------------------------------------------
    // Projects module
    // org_id / user_id FKs are INTEGER to match SERIAL PKs on organizations/users.
    // project_id FKs are UUID to match the projects.id PK defined here.
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      INTEGER     NOT NULL REFERENCES organizations(id),
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        status      VARCHAR(50) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','archived')),
        created_by  INTEGER     REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_members (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id     INTEGER     NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        org_id      INTEGER     NOT NULL,
        role        VARCHAR(50) NOT NULL DEFAULT 'member'
          CHECK (role IN ('owner','member','viewer')),
        added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, user_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        org_id      INTEGER     NOT NULL,
        title       VARCHAR(255) NOT NULL,
        description TEXT,
        status      VARCHAR(50) NOT NULL DEFAULT 'todo'
          CHECK (status IN ('todo','in_progress','done')),
        assigned_to INTEGER     REFERENCES users(id),
        due_date    DATE,
        created_by  INTEGER     REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS milestones (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        org_id      INTEGER     NOT NULL,
        title       VARCHAR(255) NOT NULL,
        description TEXT,
        due_date    DATE,
        status      VARCHAR(50) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','reached')),
        created_by  INTEGER     REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_pinned_files (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id  UUID        NOT NULL REFERENCES projects(id)             ON DELETE CASCADE,
        org_id      INTEGER     NOT NULL,
        file_id     UUID        NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
        pinned_by   INTEGER     REFERENCES users(id),
        pinned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, file_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_project_pinned_files_project_id ON project_pinned_files(project_id)
    `);

    // document_embeddings — add tool_scope and resource_id for per-project RAG scoping
    await client.query(`
      ALTER TABLE document_embeddings
        ADD COLUMN IF NOT EXISTS tool_scope  VARCHAR(50) NOT NULL DEFAULT 'general',
        ADD COLUMN IF NOT EXISTS resource_id UUID
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_embeddings_tool_scope  ON document_embeddings(tool_scope)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_embeddings_resource_id ON document_embeddings(resource_id)
    `);

    // agent_states — key-value memory scoped to org + agent tool + optional session.
    // session_id defaults to null-sentinel UUID so the UNIQUE constraint works
    // correctly without NULL-equality edge cases (NULL != NULL in SQL).
    await client.query(`
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
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_states_org_tool ON agent_states (org_id, tool_slug)
    `);

    // agent_conclusions — final outputs from completed agent runs.
    await client.query(`
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
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_conclusions_org_tool ON agent_conclusions (org_id, tool_slug)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_conclusions_session ON agent_conclusions (session_id)
        WHERE session_id IS NOT NULL
    `);

    // agent_schedules — one row per registered agent: cron expression + metadata.
    // org_id is nullable: null means the agent is intended to run for all orgs
    // (requires org_tools table, not yet built — see AgentScheduler.trigger() guard).
    await client.query(`
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
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_schedules_tool_slug ON agent_schedules (tool_slug)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_schedules_org_id ON agent_schedules (org_id)
        WHERE org_id IS NOT NULL
    `);

    // agent_executions — one row per agent run: status, result, and timing.
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_executions (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
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
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_started
        ON agent_executions (agent_id, started_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_executions_org_started
        ON agent_executions (org_id, started_at DESC)
    `);

    // agent_runs — one row per completed agent run, shared across all agents.
    // This is the single source of truth for run history, structured output,
    // and AI suggestions. The data field stores tool results keyed by tool name;
    // suggestions stores a priority-ordered array of recommendation objects.
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      INTEGER     NOT NULL REFERENCES organizations(id),
        slug        TEXT        NOT NULL,
        status      TEXT        NOT NULL DEFAULT 'running'
          CHECK (status IN ('running','complete','error')),
        summary     TEXT,
        data        JSONB,
        suggestions JSONB,
        run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        duration_ms INTEGER,
        token_count INTEGER
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_runs_org_slug_run_at
        ON agent_runs (org_id, slug, run_at DESC)
    `);

    // agent_configs — operator-level settings per org per agent slug.
    // Readable by any authenticated user; writable by org_admin.
    // Covers schedule, lookback window, analytical thresholds, output preferences.
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_configs (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id     INTEGER     NOT NULL REFERENCES organizations(id),
        slug       TEXT        NOT NULL,
        config     JSONB       NOT NULL DEFAULT '{}',
        updated_by INTEGER     REFERENCES users(id),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, slug)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_configs_org_slug
        ON agent_configs (org_id, slug)
    `);

    await client.query('COMMIT');
    logger.info('Core schema initialized');

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Schema initialization failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

async function seedDefaults() {
  const bcrypt = require('bcryptjs');
  const client = await pool.connect();

  try {
    // Default organization
    let orgId;
    const orgCheck = await client.query('SELECT id FROM organizations LIMIT 1');

    if (orgCheck.rows.length === 0) {
      const orgResult = await client.query(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
        ['Default Organization']
      );
      orgId = orgResult.rows[0].id;
      logger.info('Default organization created');
    } else {
      orgId = orgCheck.rows[0].id;
    }

    // System roles
    const systemRoles = [
      { name: 'org_admin', description: 'Full organization administrator' },
      { name: 'org_member', description: 'Standard organization member' },
    ];

    for (const role of systemRoles) {
      await client.query(
        `INSERT INTO roles (name, description, is_system)
         VALUES ($1, $2, true)
         ON CONFLICT (name) DO NOTHING`,
        [role.name, role.description]
      );
    }
    logger.info('System roles seeded');

    // Admin user
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';

    const userCheck = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [adminEmail]
    );

    let adminId;

    if (userCheck.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const userResult = await client.query(
        `INSERT INTO users (org_id, email, password_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        [orgId, adminEmail, passwordHash]
      );
      adminId = userResult.rows[0].id;
      logger.info(`Admin user created`, { email: adminEmail });
    } else {
      adminId = userCheck.rows[0].id;
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, adminId]
      );
      logger.info('Admin user password updated', { email: adminEmail });
    }

    // Assign org_admin role to admin user (global scope)
    const adminRole = await client.query(
      'SELECT id FROM roles WHERE name = $1',
      ['org_admin']
    );

    if (adminRole.rows.length > 0) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, scope_type, granted_by)
         VALUES ($1, $2, 'global', $1)
         ON CONFLICT (user_id, role_id, scope_type, COALESCE(scope_id, '')) DO NOTHING`,
        [adminId, adminRole.rows[0].id]
      );
      logger.info('Admin role assigned');
    }

    // Register datetime tool
    await client.query(`
      INSERT INTO tools (slug, name, version, enabled, config)
      VALUES ('datetime', 'Date & Time', '1.0.0', true, $1::jsonb)
      ON CONFLICT (slug) DO UPDATE SET enabled = true, config = EXCLUDED.config
    `, [JSON.stringify({
      roles: [
        { name: 'datetime_viewer',   label: 'Date & Time — Basic',    scopeId: 'datetime' },
        { name: 'datetime_extended', label: 'Date & Time — Extended', scopeId: 'datetime' },
      ],
    })]);

    // Register chat tool
    await client.query(`
      INSERT INTO tools (slug, name, version, enabled, config)
      VALUES ('chat', 'AI Chat', '1.0.0', true, $1::jsonb)
      ON CONFLICT (slug) DO UPDATE SET enabled = true, config = EXCLUDED.config
    `, [JSON.stringify({
      // org_member is the floor — all members can use standard (Haiku) by default.
      // Admins grant chat_advanced or chat_premium to specific users as needed.
      roleModelAccess: {
        org_member:    'standard',
        chat_advanced: 'advanced',
        chat_premium:  'premium',
      },
      roles: [
        { name: 'chat_advanced', label: 'AI Chat — Advanced (Sonnet)', scopeId: 'chat' },
        { name: 'chat_premium',  label: 'AI Chat — Premium (Opus)',    scopeId: 'chat' },
      ],
    })]);

    // Datetime tool roles
    for (const role of [
      { name: 'datetime_viewer',   description: 'View date and time' },
      { name: 'datetime_extended', description: 'View date, time, and server location' },
      { name: 'chat_advanced',     description: 'AI Chat — Advanced model tier (Sonnet)' },
      { name: 'chat_premium',      description: 'AI Chat — Premium model tier (Opus)' },
    ]) {
      await client.query(
        `INSERT INTO roles (name, description, is_system)
         VALUES ($1, $2, false)
         ON CONFLICT (name) DO NOTHING`,
        [role.name, role.description]
      );
    }
    logger.info('Datetime tool registered');

    // Seed default email templates (do not overwrite admin edits)
    const TEMPLATE_DEFAULTS = require('./utils/emailDefaults');
    for (const tmpl of Object.values(TEMPLATE_DEFAULTS)) {
      await client.query(
        `INSERT INTO email_templates (slug, tool_slug, subject, body_html, body_text, description, variables)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO NOTHING`,
        [tmpl.slug, tmpl.tool_slug, tmpl.subject, tmpl.body_html, tmpl.body_text,
         tmpl.description, tmpl.variables]
      );
    }
    logger.info('Email templates seeded');

    // Seed default security thresholds (do not overwrite admin edits)
    for (const [key, value] of [
      ['security_login_max_attempts', 5],
      ['security_lockout_minutes',    15],
      ['security_login_rate_limit',   5],
    ]) {
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)]
      );
    }
    logger.info('Security thresholds seeded');

    // Seed app settings defaults (do not overwrite admin edits)
    for (const [key, value] of [
      ['chat_allowed_file_types', '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,image/*'],
      ['default_timezone', 'UTC'],
    ]) {
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)]
      );
    }
    logger.info('App settings seeded');

    // Seed default spend alert thresholds (do not overwrite admin edits)
    for (const [key, value] of [
      ['spend_warn_session_usd', 0.50],
      ['spend_warn_daily_usd',   5.00],
    ]) {
      await client.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)]
      );
    }
    logger.info('Spend alert thresholds seeded');

    // Seed default AI model catalogue (do not overwrite admin edits)
    const defaultModels = [
      {
        id:                'claude-haiku-4-5-20251001',
        name:              'Claude Haiku 4.5',
        tier:              'standard',
        provider:          'anthropic',
        emoji:             '⚡',
        label:             'Economy',
        tagline:           'Fast & affordable',
        desc:              'Best for quick tasks, simple queries, and background automation',
        inputPricePer1M:   0.80,
        outputPricePer1M:  4.00,
        contextWindow:     200000,
      },
      {
        id:                'claude-sonnet-4-6',
        name:              'Claude Sonnet 4.6',
        tier:              'advanced',
        provider:          'anthropic',
        emoji:             '⚖️',
        label:             'Standard',
        tagline:           'Smart & balanced',
        desc:              'Best for most work — writing, analysis, and tool workloads',
        inputPricePer1M:   3.00,
        outputPricePer1M:  15.00,
        contextWindow:     200000,
      },
      {
        id:                'claude-opus-4-6',
        name:              'Claude Opus 4.6',
        tier:              'premium',
        provider:          'anthropic',
        emoji:             '🧠',
        label:             'Premium',
        tagline:           'Most capable',
        desc:              'Best for complex reasoning, deep analysis, and large-context tasks',
        inputPricePer1M:   15.00,
        outputPricePer1M:  75.00,
        contextWindow:     200000,
      },
    ];
    await client.query(
      `INSERT INTO system_settings (key, value) VALUES ('ai_models', $1::jsonb) ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(defaultModels)]
    );
    logger.info('AI model catalogue seeded');

  } catch (error) {
    logger.error('Seeding failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  try {
    await initializeSchema();
    await seedDefaults();
    logger.info('All migrations complete');
  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

module.exports = { pool, runMigrations };
