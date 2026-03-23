require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// Initialize core schema
async function initializeSchema() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Organizations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Auth sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Index on sessions token
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_token 
      ON auth_sessions(token)
    `);

    // Tool registry table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tool_registry (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        enabled BOOLEAN DEFAULT false,
        config JSONB DEFAULT '{}',
        installed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('✅ Core schema initialized');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Schema initialization failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Seed default organization and admin user (IDEMPOTENT)
async function seedDefaults() {
  const bcrypt = require('bcrypt');
  const client = await pool.connect();

  try {
    // Ensure default organization exists
    let orgId;
    const orgCheck = await client.query('SELECT id FROM organizations LIMIT 1');
    
    if (orgCheck.rows.length === 0) {
      const orgResult = await client.query(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
        ['Default Organization']
      );
      orgId = orgResult.rows[0].id;
      console.log('✅ Default organization created');
    } else {
      orgId = orgCheck.rows[0].id;
      console.log('ℹ️  Organization already exists');
    }

    // Get admin credentials from environment
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';

    // Check if THIS specific admin user exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [adminEmail]
    );

    if (userCheck.rows.length === 0) {
      // Admin doesn't exist - create it
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `INSERT INTO users (org_id, email, password_hash, role) 
         VALUES ($1, $2, $3, $4)`,
        [orgId, adminEmail, passwordHash, 'admin']
      );
      console.log(`✅ Admin user created: ${adminEmail}`);

    } else {
      // Admin exists - update password to match current env
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2`,
        [passwordHash, adminEmail]
      );
      console.log(`✅ Admin user password updated: ${adminEmail}`);
    }

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Run migrations on startup
async function runMigrations() {
  try {
    await initializeSchema();
    await seedDefaults();
    console.log('✅ All migrations complete');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Export pool and migration function
module.exports = { pool, runMigrations };