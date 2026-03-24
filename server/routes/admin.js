const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const InvitationService = require('../services/invitations');
const PermissionService = require('../services/permissions');
const EmailTemplateService = require('../services/emailTemplates');
const logger = require('../utils/logger');

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
    logger.error('Admin users error', { error: error.message });
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

    logger.info('Invitation created', { email, invitedBy: req.user.email });
    res.status(201).json({
      message: 'Invitation created',
      email,
      activationUrl: `${appUrl}/invite/${token}`,
      expiresAt,
    });
  } catch (error) {
    logger.error('Invite error', { error: error.message });
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
    logger.error('Resend invite error', { error: error.message });
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
    logger.error('Get user roles error', { error: error.message });
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
    logger.info('Role granted', { userId, roleName, scopeType, scopeId, grantedBy: req.user.email });
    res.json({ message: 'Role granted' });
  } catch (error) {
    logger.error('Grant role error', { error: error.message });
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
    logger.info('Role revoked', { userId, roleName, scopeType, scopeId, revokedBy: req.user.email });
    res.json({ message: 'Role revoked' });
  } catch (error) {
    logger.error('Revoke role error', { error: error.message });
    res.status(500).json({ error: 'Failed to revoke role' });
  }
});

// Application logs — warn and error entries
router.get('/logs', async (req, res) => {
  const level  = req.query.level  || null;
  const search = req.query.search || null;
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);

  try {
    const conditions = [];
    const params = [];

    if (level && level !== 'all') {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`message ILIKE $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT id, level, message, meta, created_at
         FROM app_logs ${where}
         ORDER BY created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      pool.query(`SELECT COUNT(*) FROM app_logs ${where}`, params),
    ]);

    res.json({
      logs:  rows.rows,
      total: parseInt(count.rows[0].count, 10),
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Fetch logs error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Email templates
router.get('/email-templates', async (req, res) => {
  try {
    const templates = await EmailTemplateService.list();
    res.json(templates);
  } catch (error) {
    logger.error('Fetch email templates error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch email templates' });
  }
});

router.get('/email-templates/:slug', async (req, res) => {
  try {
    const template = await EmailTemplateService.get(req.params.slug);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (error) {
    logger.error('Fetch email template error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch email template' });
  }
});

router.put('/email-templates/:slug', async (req, res) => {
  const { subject, body_html, body_text } = req.body;
  if (!subject || !body_html || !body_text) {
    return res.status(400).json({ error: 'subject, body_html, and body_text are required' });
  }
  try {
    logger.info('Email template PUT received', {
      slug: req.params.slug,
      subject,
      body_html_len: body_html?.length,
      body_text_len: body_text?.length,
    });
    await EmailTemplateService.upsert(req.params.slug, { subject, body_html, body_text }, req.user.id);
    logger.info('Email template updated', { slug: req.params.slug, updatedBy: req.user.email });
    res.json({ message: 'Template updated' });
  } catch (error) {
    logger.error('Update email template error', { error: error.message });
    res.status(500).json({ error: 'Failed to update email template' });
  }
});

router.post('/email-templates/:slug/reset', async (req, res) => {
  try {
    await EmailTemplateService.reset(req.params.slug, req.user.id);
    logger.info('Email template reset to default', { slug: req.params.slug, resetBy: req.user.email });
    res.json({ message: 'Template reset to default' });
  } catch (error) {
    logger.error('Reset email template error', { error: error.message });
    const status = error.message.startsWith('No default') ? 404 : 500;
    res.status(status).json({ error: error.message || 'Failed to reset email template' });
  }
});

module.exports = router;
