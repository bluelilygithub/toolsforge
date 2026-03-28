const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const InvitationService = require('../services/invitations');
const PermissionService = require('../services/permissions');
const EmailTemplateService = require('../services/emailTemplates');
const { MODEL_CATALOGUE } = require('../utils/modelCatalogue');
const { updateRateLimitConfig } = require('../middleware/rateLimit');
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

// ── Security settings ─────────────────────────────────────────────────────────

const SECURITY_KEYS = ['security_login_max_attempts', 'security_lockout_minutes', 'security_login_rate_limit'];
const SECURITY_DEFAULTS = { security_login_max_attempts: 5, security_lockout_minutes: 15, security_login_rate_limit: 5 };

router.get('/security-settings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
      [SECURITY_KEYS]
    );
    const settings = { ...SECURITY_DEFAULTS };
    for (const row of result.rows) settings[row.key] = Number(row.value);
    res.json(settings);
  } catch (err) {
    logger.error('Fetch security-settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch security settings' });
  }
});

router.put('/security-settings', async (req, res) => {
  const { security_login_max_attempts, security_lockout_minutes, security_login_rate_limit } = req.body;

  const updates = {};
  if (security_login_max_attempts !== undefined) updates.security_login_max_attempts = Math.max(1, Math.min(20, parseInt(security_login_max_attempts, 10)));
  if (security_lockout_minutes    !== undefined) updates.security_lockout_minutes    = Math.max(1, Math.min(1440, parseInt(security_lockout_minutes, 10)));
  if (security_login_rate_limit   !== undefined) updates.security_login_rate_limit   = Math.max(1, Math.min(20, parseInt(security_login_rate_limit, 10)));

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, JSON.stringify(value), req.user.id]
      );
    }

    // Apply rate limit change immediately (in-process, no restart needed)
    if (updates.security_login_rate_limit !== undefined) {
      updateRateLimitConfig({ loginMax: updates.security_login_rate_limit });
    }

    logger.info('Security settings updated', { updates, updatedBy: req.user.email });
    res.json({ message: 'Security settings saved', settings: updates });
  } catch (err) {
    logger.error('Save security-settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to save security settings' });
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

// ── Tool access — per-user, per-tool structured access management ──────────────

// GET /api/admin/users/:userId/tool-access
// Returns each enabled tool with its grantable roles and the user's current role
router.get('/users/:userId/tool-access', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  try {
    const [toolsResult, rolesResult] = await Promise.all([
      pool.query(`SELECT slug, name, config FROM tools WHERE enabled = true ORDER BY name`),
      pool.query(
        `SELECT r.name FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND ur.scope_type = 'tool'`,
        [userId]
      ),
    ]);

    const userToolRoleNames = new Set(rolesResult.rows.map(r => r.name));

    const tools = toolsResult.rows.map(tool => {
      const config = tool.config || {};
      const configRoles = config.roles ?? [];
      const roleModelAccess = config.roleModelAccess ?? {};

      // If org_member is in roleModelAccess, every member gets that tier by default
      const floorTier = roleModelAccess['org_member'] ?? null;
      const defaultLabel = floorTier
        ? `${floorTier.charAt(0).toUpperCase() + floorTier.slice(1)} (all members)`
        : 'No access';

      // User's current explicit role for this tool (take first match if multiple)
      const currentRole = configRoles.find(r => userToolRoleNames.has(r.name))?.name ?? null;

      return {
        slug: tool.slug,
        name: tool.name,
        defaultLabel,
        roles: configRoles,
        currentRole,
      };
    });

    res.json({ tools });
  } catch (err) {
    logger.error('Fetch tool-access error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch tool access' });
  }
});

// PUT /api/admin/users/:userId/tool-access
// Accepts { access: { toolSlug: roleName | null } } — applies diffs per tool
router.put('/users/:userId/tool-access', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const { access } = req.body;
  if (!access || typeof access !== 'object' || Array.isArray(access)) {
    return res.status(400).json({ error: 'access object is required' });
  }

  try {
    const toolSlugs = Object.keys(access);
    const toolsResult = await pool.query(
      `SELECT slug, config FROM tools WHERE enabled = true AND slug = ANY($1)`,
      [toolSlugs]
    );

    for (const tool of toolsResult.rows) {
      const configRoles = tool.config?.roles ?? [];
      const roleNames = configRoles.map(r => r.name);
      const targetRoleName = access[tool.slug] ?? null;

      // Revoke all existing explicit roles for this tool
      for (const roleName of roleNames) {
        await PermissionService.revokeRole(userId, roleName, { type: 'tool', id: tool.slug });
      }

      // Grant the selected role if specified and valid
      if (targetRoleName && roleNames.includes(targetRoleName)) {
        const roleConfig = configRoles.find(r => r.name === targetRoleName);
        await PermissionService.grantRole(
          userId,
          targetRoleName,
          { type: 'tool', id: roleConfig.scopeId },
          req.user.id
        );
      }
    }

    logger.info('Tool access updated', { userId, access, updatedBy: req.user.email });
    res.json({ message: 'Access updated' });
  } catch (err) {
    logger.error('Update tool-access error', { error: err.message });
    res.status(500).json({ error: 'Failed to update tool access' });
  }
});

// ── Tool roles — dynamic list for the Grant Access dropdown ───────────────────

// GET /api/admin/tool-roles — all assignable roles across every enabled tool
router.get('/tool-roles', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT slug, name, config FROM tools WHERE enabled = true ORDER BY name`
    );
    const roles = [];
    for (const tool of result.rows) {
      const toolRoles = tool.config?.roles ?? [];
      for (const role of toolRoles) {
        roles.push({
          name:     role.name,
          label:    role.label,
          scopeId:  role.scopeId,
          toolName: tool.name,
          toolSlug: tool.slug,
        });
      }
    }
    res.json(roles);
  } catch (err) {
    logger.error('Fetch tool-roles error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch tool roles' });
  }
});

// ── AI Models ─────────────────────────────────────────────────────────────────

// GET /api/admin/ai-models — return live model list from system_settings
router.get('/ai-models', async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM system_settings WHERE key = 'ai_models'`);
    const models = result.rows[0]?.value ?? [];
    res.json({ models: Array.isArray(models) ? models : [] });
  } catch (err) {
    logger.error('Fetch ai-models error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch AI models' });
  }
});

// PUT /api/admin/ai-models — save full model array
router.put('/ai-models', async (req, res) => {
  const { models } = req.body;
  if (!Array.isArray(models)) return res.status(400).json({ error: 'models must be an array' });

  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ('ai_models', $1::jsonb, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(models), req.user.id]
    );
    logger.info('AI models updated', { count: models.length, updatedBy: req.user.email });
    res.json({ message: 'AI models saved', count: models.length });
  } catch (err) {
    logger.error('Save ai-models error', { error: err.message });
    res.status(500).json({ error: 'Failed to save AI models' });
  }
});

// POST /api/admin/ai-models/reset — restore default catalogue
router.post('/ai-models/reset', async (req, res) => {
  try {
    const defaults = Object.entries(MODEL_CATALOGUE).map(([id, m]) => ({ id, ...m }));
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ('ai_models', $1::jsonb, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(defaults), req.user.id]
    );
    logger.info('AI models reset to defaults', { resetBy: req.user.email });
    res.json({ message: 'Reset to defaults', models: defaults });
  } catch (err) {
    logger.error('Reset ai-models error', { error: err.message });
    res.status(500).json({ error: 'Failed to reset AI models' });
  }
});

// GET /api/admin/model-status — whether ANTHROPIC_API_KEY is configured
router.get('/model-status', (req, res) => {
  res.json({ anthropic: !!process.env.ANTHROPIC_API_KEY });
});

// POST /api/admin/test-model — send a minimal probe to Anthropic
router.post('/test-model', async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) return res.status(400).json({ ok: false, error: 'modelId required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ ok: false, error: 'ANTHROPIC_API_KEY is not set on the server.' });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with just: ok' }],
    });
    const text = response.content?.[0]?.text?.trim() ?? '(no text)';
    logger.info('Model test ok', { modelId, testedBy: req.user.email });
    res.json({ ok: true, response: text });
  } catch (err) {
    const msg = err.message ?? 'Unknown error';
    let hint = '';
    if (/auth|api.?key|credential/i.test(msg))          hint = 'Check ANTHROPIC_API_KEY is valid.';
    else if (/billing|credit|payment/i.test(msg))       hint = 'Account billing issue — check Anthropic console.';
    else if (/not.found|invalid.model|unknown.model/i.test(msg)) hint = 'Model ID not recognised by the API.';
    else if (/rate.limit/i.test(msg))                   hint = 'Rate limit hit — try again shortly.';
    logger.warn('Model test failed', { modelId, error: msg });
    res.json({ ok: false, error: msg, hint });
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

// ── App Settings — file types & default timezone ──────────────────────────────

const APP_SETTINGS_KEYS = ['chat_allowed_file_types', 'default_timezone'];
const APP_SETTINGS_DEFAULTS = {
  chat_allowed_file_types: '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,image/*',
  default_timezone: 'UTC',
};

router.get('/app-settings', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
      [APP_SETTINGS_KEYS]
    );
    const settings = { ...APP_SETTINGS_DEFAULTS };
    for (const row of result.rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    logger.error('Fetch app-settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch app settings' });
  }
});

router.put('/app-settings', async (req, res) => {
  const updates = {};
  const { chat_allowed_file_types, default_timezone } = req.body;

  if (chat_allowed_file_types !== undefined) {
    updates.chat_allowed_file_types = String(chat_allowed_file_types).slice(0, 1000);
  }
  if (default_timezone !== undefined) {
    // Validate it's a recognised IANA timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: String(default_timezone) });
      updates.default_timezone = String(default_timezone);
    } catch {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields provided' });

  try {
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, JSON.stringify(value), req.user.id]
      );
    }
    res.json({ message: 'App settings saved', settings: updates });
  } catch (err) {
    logger.error('Save app-settings error', { error: err.message });
    res.status(500).json({ error: 'Failed to save app settings' });
  }
});

// POST /api/admin/diagnostics — run all credential and service checks
router.post('/diagnostics', async (req, res) => {
  const { google } = require('googleapis');
  const Anthropic   = require('@anthropic-ai/sdk');
  const { pool }    = require('../db');
  const results     = [];

  // ── Helper ──────────────────────────────────────────────────────────────────
  async function check(name, fn) {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
    } catch (err) {
      results.push({ name, ok: false, detail: err.message });
    }
  }

  // ── 1. Database ──────────────────────────────────────────────────────────────
  await check('Database', async () => {
    const { rows } = await pool.query('SELECT NOW() AS ts');
    return `Connected — server time ${rows[0].ts.toISOString()}`;
  });

  // ── 2. Anthropic API ─────────────────────────────────────────────────────────
  await check('Anthropic API', async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with just: ok' }],
    });
    return 'API key valid — test message sent';
  });

  // ── 3. Google OAuth token refresh ────────────────────────────────────────────
  let accessToken = null;
  await check('Google OAuth', async () => {
    if (!process.env.GOOGLE_CLIENT_ID)     throw new Error('GOOGLE_CLIENT_ID is not set');
    if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is not set');
    if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error('GOOGLE_REFRESH_TOKEN is not set');
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const { token } = await oauth2.getAccessToken();
    accessToken = token;
    return `Token refreshed — ${token.slice(0, 10)}…`;
  });

  // ── 4. Google Ads API ────────────────────────────────────────────────────────
  await check('Google Ads API', async () => {
    if (!accessToken) throw new Error('Skipped — Google OAuth check failed');
    const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
    const managerId  = (process.env.GOOGLE_ADS_MANAGER_ID  ?? '').replace(/-/g, '');
    const devToken   = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
    if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID is not set');
    if (!managerId)  throw new Error('GOOGLE_ADS_MANAGER_ID is not set');
    if (!devToken)   throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is not set');
    const res = await fetch(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${accessToken}`,
          'developer-token':   devToken,
          'login-customer-id': managerId,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({ query: 'SELECT customer.id FROM customer LIMIT 1' }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const inner = body?.error?.details?.[0]?.errors?.[0];
      const msg = inner?.message ?? body?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const data = await res.json();
    const id = data.results?.[0]?.customer?.id ?? '(no result)';
    return `Customer ${id} accessible`;
  });

  // ── 5. Google Analytics (GA4) ────────────────────────────────────────────────
  await check('Google Analytics (GA4)', async () => {
    if (!accessToken) throw new Error('Skipped — Google OAuth check failed');
    const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID ?? '';
    if (!propertyId) throw new Error('GOOGLE_GA4_PROPERTY_ID is not set');
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics:    [{ name: 'sessions' }],
          limit:      1,
        }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    return `Property ${propertyId} accessible — ${data.rowCount ?? 0} rows`;
  });

  logger.info('Diagnostics run', { testedBy: req.user.email, passed: results.filter(r => r.ok).length, total: results.length });
  res.json({ results });
});

module.exports = router;
