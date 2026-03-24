const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const InvitationService = require('../services/invitations');
const PermissionService = require('../services/permissions');

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

// Resend invitation for a pending user — invalidates old token, issues a fresh one
router.post('/users/:userId/resend-invite', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  try {
    const { email, token, expiresAt } = await InvitationService.resendInvitation(userId, req.user.id);
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    res.json({
      message: 'Invitation resent',
      email,
      activationUrl: `${appUrl}/invite/${token}`,
      expiresAt,
    });
  } catch (error) {
    console.error('Resend invite error:', error);
    const status = error.message === 'User not found or already active' ? 400 : 500;
    res.status(status).json({ error: error.message || 'Failed to resend invitation' });
  }
});

// All roles for a specific user (global + tool-scoped)
router.get('/users/:userId/roles', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  try {
    const roles = await PermissionService.getUserRoles(userId);
    res.json(roles);
  } catch (error) {
    console.error('Get user roles error:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Grant a role to a user
router.post('/users/:userId/grant-role', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const { roleName, scopeType = 'global', scopeId = null } = req.body;
  if (!roleName) return res.status(400).json({ error: 'roleName is required' });

  try {
    const scope = scopeType !== 'global' ? { type: scopeType, id: scopeId } : null;
    await PermissionService.grantRole(userId, roleName, scope, req.user.id);
    res.json({ message: 'Role granted' });
  } catch (error) {
    console.error('Grant role error:', error);
    res.status(500).json({ error: 'Failed to grant role' });
  }
});

// Revoke a role from a user
router.post('/users/:userId/revoke-role', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const { roleName, scopeType = 'global', scopeId = null } = req.body;
  if (!roleName) return res.status(400).json({ error: 'roleName is required' });

  try {
    const scope = scopeType !== 'global' ? { type: scopeType, id: scopeId } : null;
    await PermissionService.revokeRole(userId, roleName, scope);
    res.json({ message: 'Role revoked' });
  } catch (error) {
    console.error('Revoke role error:', error);
    res.status(500).json({ error: 'Failed to revoke role' });
  }
});

module.exports = router;
