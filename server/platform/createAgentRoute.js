'use strict';

/**
 * createAgentRoute — platform-level factory for agent HTTP routes.
 *
 * Returns an Express router with two endpoints:
 *   POST /run     — SSE, runs the agent, persists result to agent_runs
 *   GET  /history — returns last 20 runs for this slug + org
 *
 * Usage:
 *   const router = createAgentRoute({ slug, runFn, requiredPermission });
 *   app.use('/api/agents/my-agent', router);
 *
 * runFn signature:
 *   async (context: { userId, orgId, toolSlug }) =>
 *     { result: string, trace: Array, tokensUsed: { input, output, ... } }
 *
 * This file contains zero agent-specific code. Any agent is registerable
 * by supplying slug, runFn, and a permission string.
 */

const express                      = require('express');
const { pool }                     = require('../db');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { AgentConfigService }       = require('../services/AgentConfigService');
const logger                       = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendEvent(res, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
}

function extractToolData(trace) {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const data = {};
  for (const step of trace) {
    for (const tr of step.toolResults ?? []) {
      data[tr.name] = tr.result;
    }
  }
  return Object.keys(data).length > 0 ? data : null;
}

function extractSuggestions(text) {
  if (!text) return null;
  const section = text.match(/###\s*Recommendations?\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (!section) return null;
  const items = [];
  for (const line of section[1].split('\n')) {
    const m = line.match(/^\s*\d+\.\s+(.+)/);
    if (m) items.push(m[1].trim());
  }
  if (items.length === 0) return null;
  return items.map((text, i) => ({
    text,
    priority: i < 2 ? 'high' : i < 5 ? 'medium' : 'low',
  }));
}

// ─── Shared persistence ───────────────────────────────────────────────────────

async function persistRun({ slug, orgId, status, summary, trace, tokensUsed, startTime }) {
  const data        = extractToolData(trace);
  const suggestions = extractSuggestions(summary);
  const durationMs  = Date.now() - startTime;
  const tokenCount  = (tokensUsed?.input ?? 0) + (tokensUsed?.output ?? 0);

  const result = await pool.query(
    `INSERT INTO agent_runs
       (org_id, slug, status, summary, data, suggestions, duration_ms, token_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      orgId,
      slug,
      status,
      summary ?? null,
      data        ? JSON.stringify(data)        : null,
      suggestions ? JSON.stringify(suggestions) : null,
      durationMs,
      tokenCount,
    ]
  );
  return result.rows[0].id;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createAgentRoute({ slug, runFn, requiredPermission }) {
  const router = express.Router();

  const allowedRoles = ['org_admin'];
  if (requiredPermission) allowedRoles.push(requiredPermission);

  router.post(
    '/run',
    requireAuth,
    requireRole(allowedRoles),
    async (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const startTime = Date.now();
      const { id: userId, org_id: orgId } = req.user;

      const rawDays = req.body?.days;
      const days = Number.isFinite(Number(rawDays)) && Number(rawDays) > 0
        ? Math.min(Math.round(Number(rawDays)), 365)
        : undefined;

      // Load admin config — enabled flag, model, token + iteration limits.
      const adminConfig = await AgentConfigService.getAdminConfig(slug);

      if (!adminConfig.enabled) {
        sendEvent(res, { type: 'error', error: 'This agent is currently disabled by an administrator.' });
        sendEvent(res, '[DONE]');
        return res.end();
      }

      sendEvent(res, { type: 'progress', text: 'Agent starting…' });

      try {
        const { result, trace, tokensUsed } = await runFn({
          userId,
          orgId,
          toolSlug:      slug,
          model:         adminConfig.model,
          maxTokens:     adminConfig.max_tokens,
          maxIterations: adminConfig.max_iterations,
          ...(days !== undefined && { days }),
        });

        await persistRun({ slug, orgId, status: 'complete', summary: result, trace, tokensUsed, startTime });

        sendEvent(res, { type: 'result', data: { summary: result, toolData: extractToolData(trace) } });
        sendEvent(res, '[DONE]');
        res.end();

      } catch (err) {
        logger.error('createAgentRoute: run failed', { slug, error: err.message });

        try {
          await persistRun({ slug, orgId, status: 'error', summary: err.message, trace: [], tokensUsed: {}, startTime });
        } catch (dbErr) {
          logger.warn('createAgentRoute: failed to persist error run', { slug, error: dbErr.message });
        }

        sendEvent(res, { type: 'error', error: err.message ?? 'Agent run failed' });
        sendEvent(res, '[DONE]');
        res.end();
      }
    }
  );

  router.get('/history', requireAuth, async (req, res) => {
    try {
      const { org_id: orgId } = req.user;
      const result = await pool.query(
        `SELECT id, slug, status, summary, data, suggestions, run_at, duration_ms, token_count
         FROM agent_runs
         WHERE org_id = $1 AND slug = $2
         ORDER BY run_at DESC
         LIMIT 20`,
        [orgId, slug]
      );
      res.json(result.rows);
    } catch (err) {
      logger.error('createAgentRoute: history failed', { slug, error: err.message });
      res.status(500).json({ error: 'Failed to fetch run history' });
    }
  });

  return router;
}

module.exports = { createAgentRoute, persistRun, extractToolData };
