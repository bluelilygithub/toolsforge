const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { authLimiter } = require('../middleware/rateLimit');
const EmailService = require('../services/email');
const logger = require('../utils/logger');

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
    logger.error('Register error', { error: error.message });
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
      'SELECT id, email, password_hash, is_active, first_name, last_name, phone FROM users WHERE email = $1',
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

    logger.info('User logged in', { userId: user.id, email: user.email });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        roles: rolesResult.rows,
      }
    });

  } catch (error) {
    logger.error('Login error', { error: error.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM auth_sessions WHERE token = $1', [req.token]);
    logger.info('User logged out', { userId: req.user.id, email: req.user.email });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error', { error: error.message });
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [userResult, rolesResult] = await Promise.all([
      pool.query(
        'SELECT first_name, last_name, phone FROM users WHERE id = $1',
        [req.user.id]
      ),
      pool.query(
        `SELECT r.name, ur.scope_type, ur.scope_id
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [req.user.id]
      ),
    ]);

    const profile = userResult.rows[0];
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        org_id: req.user.org_id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
        roles: rolesResult.rows,
      }
    });

  } catch (error) {
    logger.error('Get user error', { error: error.message });
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update profile
router.put('/profile', requireAuth, async (req, res) => {
  const { firstName, lastName, phone } = req.body;
  try {
    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, updated_at = NOW() WHERE id = $4`,
      [firstName || null, lastName || null, phone || null, req.user.id]
    );
    res.json({
      user: {
        first_name: firstName || null,
        last_name:  lastName  || null,
        phone:      phone     || null,
      }
    });
  } catch (error) {
    logger.error('Profile update error', { error: error.message });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── Password history helpers ──────────────────────────────────────────────────

const PASSWORD_HISTORY_LIMIT = 5;

async function isPasswordReused(userId, newPassword) {
  const result = await pool.query(
    `SELECT password_hash FROM password_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, PASSWORD_HISTORY_LIMIT]
  );
  for (const row of result.rows) {
    if (await bcrypt.compare(newPassword, row.password_hash)) return true;
  }
  return false;
}

async function recordPasswordHistory(userId, passwordHash) {
  await pool.query(
    `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
    [userId, passwordHash]
  );
}

// ── Change password (authenticated) ──────────────────────────────────────────

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    if (await isPasswordReused(req.user.id, newPassword)) {
      return res.status(400).json({ error: `Cannot reuse any of your last ${PASSWORD_HISTORY_LIMIT} passwords` });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, req.user.id]
    );
    await recordPasswordHistory(req.user.id, passwordHash);
    logger.info('Password changed', { userId: req.user.id, email: req.user.email });
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change password error', { error: error.message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Forgot password — generate token and send reset email
// Always returns 200 to avoid revealing whether the email exists
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];

      // Invalidate any existing unused reset tokens
      await pool.query(
        'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
        [user.id]
      );

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, token, expiresAt]
      );

      const appUrl = process.env.APP_URL || 'http://localhost:5173';
      EmailService.sendPasswordReset(user.email, `${appUrl}/reset/${token}`)
        .catch(err => logger.error('Failed to send password reset email', { error: err.message }));
    }

    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (error) {
    logger.error('Forgot password error', { error: error.message });
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Validate a password reset token
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const result = await pool.query(
      `SELECT prt.user_id, u.email
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token = $1
         AND prt.used = false
         AND prt.expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired reset link' });
    }
    res.json({ email: result.rows[0].email });
  } catch (error) {
    logger.error('Reset token validation error', { error: error.message });
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

// Reset password — consume token and update password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const result = await pool.query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       WHERE prt.token = $1
         AND prt.used = false
         AND prt.expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const { id: tokenId, user_id: userId } = result.rows[0];

    if (await isPasswordReused(userId, password)) {
      return res.status(400).json({ error: `Cannot reuse any of your last ${PASSWORD_HISTORY_LIMIT} passwords` });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, userId]
    );
    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
      [tokenId]
    );
    await recordPasswordHistory(userId, passwordHash);

    // Invalidate all active sessions so old password can't be reused
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    logger.info('Password reset completed', { userId });
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    logger.error('Reset password error', { error: error.message });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
