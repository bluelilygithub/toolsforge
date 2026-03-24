require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('Database connected:', res.rows[0].now);
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

    await client.query('COMMIT');
    console.log('Core schema initialized');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Schema initialization failed:', error.message);
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
      console.log('Default organization created');
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
    console.log('System roles seeded');

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
      console.log(`Admin user created: ${adminEmail}`);
    } else {
      adminId = userCheck.rows[0].id;
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, adminId]
      );
      console.log(`Admin user password updated: ${adminEmail}`);
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
      console.log('Admin role assigned');
    }

  } catch (error) {
    console.error('Seeding failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  try {
    await initializeSchema();
    await seedDefaults();
    console.log('All migrations complete');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

module.exports = { pool, runMigrations };
