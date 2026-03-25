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
