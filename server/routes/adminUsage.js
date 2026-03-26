'use strict';

/**
 * GET /api/admin/usage — org-scoped usage analytics for administrators.
 *
 * Protected by requireAuth + PermissionService.isOrgAdmin — fails closed
 * with 403 if the caller is not an org admin.
 *
 * Query params (all optional):
 *   from     ISO date string — defaults to 30 days ago
 *   to       ISO date string — defaults to now
 *   user_id  integer — filter to a single user within the org
 *
 * org_id is always sourced from req.user — never accepted as a query param.
 */

const express           = require('express');
const { pool }          = require('../db');
const { requireAuth }   = require('../middleware/requireAuth');
const PermissionService = require('../services/permissions');
const logger            = require('../utils/logger');

const router = express.Router();

router.get('/usage', requireAuth, async (req, res) => {
  // -- Admin gate — fail closed -------------------------------------------------
  let isAdmin = false;
  try {
    isAdmin = await PermissionService.isOrgAdmin(req.user.id);
  } catch (err) {
    logger.error('adminUsage: permission check failed', { error: err.message });
    return res.status(500).json({ error: 'Permission check failed' });
  }

  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // -- Date window -------------------------------------------------------------
  const now        = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  let fromDate, toDate;
  try {
    fromDate = req.query.from ? new Date(req.query.from) : defaultFrom;
    toDate   = req.query.to   ? new Date(req.query.to)   : now;

    if (isNaN(fromDate.getTime())) throw new Error('Invalid "from" date');
    if (isNaN(toDate.getTime()))   throw new Error('Invalid "to" date');
    if (fromDate > toDate)         throw new Error('"from" must be before "to"');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // -- Optional user filter ----------------------------------------------------
  let userIdFilter = null;
  if (req.query.user_id != null) {
    userIdFilter = Number(req.query.user_id);
    if (!Number.isFinite(userIdFilter)) {
      return res.status(400).json({ error: 'user_id must be a number' });
    }
  }

  const orgId = req.user.org_id;

  try {
    // Build the optional user_id predicate — parameterised to prevent injection.
    // $1 = orgId, $2 = fromDate, $3 = toDate, $4 = userIdFilter (or repeated)
    const userPredicate = userIdFilter != null ? 'AND user_id = $4' : '';
    const params = userIdFilter != null
      ? [orgId, fromDate.toISOString(), toDate.toISOString(), userIdFilter]
      : [orgId, fromDate.toISOString(), toDate.toISOString()];

    // -- Summary aggregates ----------------------------------------------------
    const summaryResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'file_upload')          AS total_uploads,
         COUNT(*) FILTER (WHERE event_type = 'file_search')          AS total_searches,
         COUNT(*) FILTER (WHERE event_type = 'embedding_generated')  AS total_embeddings,
         COALESCE(SUM(chunk_count)   FILTER (WHERE event_type = 'embedding_generated'), 0)
                                                                      AS total_chunks_embedded,
         COALESCE(AVG(duration_ms)   FILTER (WHERE event_type = 'file_search'), 0)
                                                                      AS avg_search_duration_ms,
         COALESCE(AVG(result_count)  FILTER (WHERE event_type = 'file_search'), 0)
                                                                      AS avg_results_per_search
       FROM usage_events
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at <= $3
         ${userPredicate}`,
      params
    );

    // -- Per-user breakdown ----------------------------------------------------
    const byUserResult = await pool.query(
      `SELECT
         user_id,
         COUNT(*) FILTER (WHERE event_type = 'file_upload')  AS upload_count,
         COUNT(*) FILTER (WHERE event_type = 'file_search')  AS search_count,
         COALESCE(AVG(duration_ms) FILTER (WHERE event_type = 'file_search'), 0)
                                                              AS avg_search_duration_ms
       FROM usage_events
       WHERE org_id = $1
         AND created_at >= $2
         AND created_at <= $3
         ${userPredicate}
       GROUP BY user_id
       ORDER BY upload_count DESC, search_count DESC`,
      params
    );

    const s = summaryResult.rows[0];

    return res.json({
      period: {
        from: fromDate.toISOString(),
        to:   toDate.toISOString(),
      },
      summary: {
        totalUploads:            Number(s.total_uploads),
        totalSearches:           Number(s.total_searches),
        totalEmbeddingsGenerated: Number(s.total_embeddings),
        totalChunksEmbedded:     Number(s.total_chunks_embedded),
        avgSearchDurationMs:     Math.round(Number(s.avg_search_duration_ms)),
        avgResultsPerSearch:     Number(Number(s.avg_results_per_search).toFixed(2)),
      },
      byUser: byUserResult.rows.map(r => ({
        userId:             r.user_id,
        uploadCount:        Number(r.upload_count),
        searchCount:        Number(r.search_count),
        avgSearchDurationMs: Math.round(Number(r.avg_search_duration_ms)),
      })),
    });

  } catch (err) {
    logger.error('adminUsage: query failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch usage data' });
  }
});

module.exports = router;
