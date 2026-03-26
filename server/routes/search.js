'use strict';

const express           = require('express');
const rateLimit         = require('express-rate-limit');
const { requireAuth }   = require('../middleware/requireAuth');
const PermissionService = require('../services/permissions');
const searchService     = require('../services/searchService');
const logger            = require('../utils/logger');

const router = express.Router();

// TODO: replace in-memory store with Redis at scale
const searchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  keyGenerator: req => String(req.user.id),
  message: { error: 'search_rate_limit_exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', requireAuth, searchLimiter, async (req, res) => {
  const { query, toolScopes, limit: limitRaw } = req.body;

  // Validation
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'query is required and must be a non-empty string' });
  }
  if (query.length > 500) {
    return res.status(400).json({ error: 'query must be 500 characters or fewer' });
  }
  if (toolScopes !== undefined && (
    !Array.isArray(toolScopes) ||
    toolScopes.some(s => typeof s !== 'string')
  )) {
    return res.status(400).json({ error: 'toolScopes must be an array of strings' });
  }

  const limit = Math.min(Number.isInteger(limitRaw) ? limitRaw : 10, 20);

  try {
    const isAdmin  = await PermissionService.isOrgAdmin(req.user.id);
    const userRole = isAdmin ? 'org_admin' : 'member';

    const queryEmbedding = await searchService.embedQuery(query.trim());

    const results = await searchService.globalSearch(
      req.user.org_id,
      req.user.id,
      userRole,
      queryEmbedding,
      { limit, toolScopes: toolScopes ?? null }
    );

    res.json({ results, count: results.length, query: query.trim() });
  } catch (err) {
    logger.error('POST /search', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
