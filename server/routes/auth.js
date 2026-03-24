const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Register new user
router.post('/register', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const orgResult = await pool.query('SELECT id FROM organizations LIMIT 1');
    const orgId = orgResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (org_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, created_at`,
      [orgId, email.toLowerCase(), passwordHash]
    );

    // Assign default org_member role
    const memberRole = await pool.query(
      'SELECT id FROM roles WHERE name = $1',
      ['org_member']
    );

    if (memberRole.rows.length > 0) {
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id, scope_type)
         VALUES ($1, $2, 'global')
         ON CONFLICT DO NOTHING`,
        [result.rows[0].id, memberRole.rows[0].id]
      );
    }

    const user = result.rows[0];
    res.status(201).json({
      message: 'User created successfully',
      user: { id: user.id, email: user.email, created_at: user.created_at }
    });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash, is_active FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active || !user.password_hash) {
      return res.status(401).json({ error: 'Account pending activation — check your invitation email' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Fetch user roles for the response
    const rolesResult = await pool.query(
      `SELECT r.name, ur.scope_type, ur.scope_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [user.id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        roles: rolesResult.rows
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM auth_sessions WHERE token = $1', [req.token]);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const rolesResult = await pool.query(
      `SELECT r.name, ur.scope_type, ur.scope_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [req.user.id]
    );

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        org_id: req.user.org_id,
        roles: rolesResult.rows
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
