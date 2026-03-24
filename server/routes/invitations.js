const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const InvitationService = require('../services/invitations');

const router = express.Router();

// Validate an invitation token (public — called when user lands on the accept page)
router.get('/:token', async (req, res) => {
  try {
    const invite = await InvitationService.getInvitation(req.params.token);
    if (!invite) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }
    res.json({ email: invite.email });
  } catch (error) {
    console.error('Invitation lookup error:', error);
    res.status(500).json({ error: 'Failed to validate invitation' });
  }
});

// Accept an invitation — set password and activate account
router.post('/accept', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const { userId, email } = await InvitationService.acceptInvitation(token, passwordHash);

    // Create a session so the user is logged in immediately after activation
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO auth_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, sessionToken, expiresAt]
    );

    // Fetch roles for the response
    const rolesResult = await pool.query(
      `SELECT r.name, ur.scope_type, ur.scope_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId]
    );

    res.json({
      message: 'Account activated successfully',
      token: sessionToken,
      user: { id: userId, email, roles: rolesResult.rows },
    });

  } catch (error) {
    if (error.message === 'Invalid or expired invitation') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Failed to activate account' });
  }
});

module.exports = router;
