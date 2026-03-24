const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const InvitationService = require('../services/invitations');

const router = express.Router();

// All admin routes require authentication + org_admin role
router.use(requireAuth);
router.use(requireRole(['org_admin']));

// List all users in the organisation with their roles
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.email,
         u.is_active,
         u.created_at,
         COALESCE(
           json_agg(
             json_build_object('name', r.name, 'scope_type', ur.scope_type)
           ) FILTER (WHERE r.id IS NOT NULL),
           '[]'
         ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.scope_type = 'global'
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.org_id = $1
       GROUP BY u.id
       ORDER BY u.created_at`,
      [req.user.org_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Invite a new user to the organisation
router.post('/invite', async (req, res) => {
  const { email, roleName = 'org_member' } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Check email not already in use
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }

  try {
    const { token, expiresAt } = await InvitationService.createInvitation(
      email,
      req.user.org_id,
      roleName,
      req.user.id
    );

    const appUrl = process.env.APP_URL || 'http://localhost:5173';

    res.status(201).json({
      message: 'Invitation created',
      email,
      activationUrl: `${appUrl}/invite/${token}`,
      expiresAt,
    });
  } catch (error) {
    console.error('Invite error:', error);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

module.exports = router;
