'use strict';

/**
 * Agent config routes — operator-level settings per agent.
 *
 * Mounted at /api/agent-configs
 *   GET  /:slug         — read agent config (any authenticated user)
 *   PUT  /:slug         — update agent config (org_admin)
 *   GET  /:slug/admin   — read admin config (org_admin)
 *   PUT  /:slug/admin   — update admin config (org_admin)
 *
 * Schedule hot-reload: when a PUT to /:slug includes a changed 'schedule' field,
 * the AgentScheduler is updated immediately without a server restart.
 */

const express                    = require('express');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { AgentConfigService }     = require('../services/AgentConfigService');
const { AgentScheduler }         = require('../platform/AgentScheduler');
const logger                     = require('../utils/logger');

const router = express.Router();

// ── Agent (operator) config ───────────────────────────────────────────────────

router.get('/:slug', requireAuth, async (req, res) => {
  try {
    const config = await AgentConfigService.getAgentConfig(req.user.org_id, req.params.slug);
    res.json(config);
  } catch (err) {
    logger.error('agentConfigs GET: error', { slug: req.params.slug, error: err.message });
    res.status(500).json({ error: 'Failed to load agent config' });
  }
});

router.put('/:slug', requireAuth, requireRole(['org_admin']), async (req, res) => {
  const { slug } = req.params;
  try {
    const updated = await AgentConfigService.updateAgentConfig(
      req.user.org_id, slug, req.body, req.user.id
    );

    // Hot-reload schedule if it changed and the agent is registered.
    if (req.body.schedule) {
      try {
        AgentScheduler.updateSchedule(slug, req.body.schedule);
      } catch (schedErr) {
        // Not fatal — config is saved; log the scheduling error.
        logger.warn('agentConfigs PUT: schedule hot-reload failed', {
          slug, schedule: req.body.schedule, error: schedErr.message,
        });
      }
    }

    res.json(updated);
  } catch (err) {
    logger.error('agentConfigs PUT: error', { slug, error: err.message });
    res.status(500).json({ error: 'Failed to save agent config' });
  }
});

// ── Admin config ──────────────────────────────────────────────────────────────

router.get('/:slug/admin', requireAuth, requireRole(['org_admin']), async (req, res) => {
  try {
    const config = await AgentConfigService.getAdminConfig(req.params.slug);
    res.json(config);
  } catch (err) {
    logger.error('agentConfigs admin GET: error', { slug: req.params.slug, error: err.message });
    res.status(500).json({ error: 'Failed to load admin config' });
  }
});

router.put('/:slug/admin', requireAuth, requireRole(['org_admin']), async (req, res) => {
  const { slug } = req.params;
  try {
    const updated = await AgentConfigService.updateAdminConfig(slug, req.body, req.user.id);
    res.json(updated);
  } catch (err) {
    logger.error('agentConfigs admin PUT: error', { slug, error: err.message });
    res.status(500).json({ error: 'Failed to save admin config' });
  }
});

module.exports = router;
