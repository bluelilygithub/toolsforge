'use strict';

/**
 * telemetryService — fire-and-forget usage event recording.
 *
 * Contract:
 *   - recordEvent() NEVER throws and NEVER rejects.
 *   - A DB failure is logged silently; the caller is unaffected.
 *   - All calls are void / unawaited from the caller's perspective.
 *
 * Supported event_type values (Sprint 3):
 *   'file_upload'           — a file was accepted for processing
 *   'embedding_generated'   — a worker completed extraction + embedding
 *   'file_search'           — a similarity search was executed
 *
 * Future sprints may add new event_type values without changing this
 * function's signature: recordEvent(orgId, userId, eventType, metadata).
 */

const { pool } = require('../db');
const logger   = require('../utils/logger');

/**
 * Record a usage event asynchronously.
 *
 * @param {number}  orgId      From req.user.org_id
 * @param {number}  userId     From req.user.id
 * @param {string}  eventType  'file_upload' | 'embedding_generated' | 'file_search'
 * @param {object}  [metadata] Optional — any subset of usage_events columns:
 *   {
 *     fileType?:       string,
 *     chunkCount?:     number,
 *     queryTokens?:    number,
 *     resultCount?:    number,
 *     embeddingModel?: string,
 *     durationMs?:     number,
 *   }
 * @returns {Promise<void>}  Always resolves — never rejects.
 */
async function recordEvent(orgId, userId, eventType, metadata = {}) {
  try {
    const {
      fileType       = null,
      chunkCount     = null,
      queryTokens    = null,
      resultCount    = null,
      embeddingModel = null,
      durationMs     = null,
    } = metadata ?? {};

    await pool.query(
      `INSERT INTO usage_events
         (org_id, user_id, event_type, file_type, chunk_count,
          query_tokens, result_count, embedding_model, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orgId,
        userId,
        String(eventType),
        fileType       != null ? String(fileType)        : null,
        chunkCount     != null ? Math.trunc(chunkCount)  : null,
        queryTokens    != null ? Math.trunc(queryTokens) : null,
        resultCount    != null ? Math.trunc(resultCount) : null,
        embeddingModel != null ? String(embeddingModel)  : null,
        durationMs     != null ? Math.trunc(durationMs)  : null,
      ]
    );
  } catch (err) {
    // Telemetry failures must never surface to the user.
    // Log at warn level (not error) — this is a non-critical background write.
    logger.warn('telemetry: recordEvent failed', {
      eventType,
      orgId,
      userId,
      error: err.message,
    });
  }
}

module.exports = { recordEvent };
