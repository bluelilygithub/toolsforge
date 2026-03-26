'use strict';

/**
 * StateManager — agent memory primitive.
 *
 * Provides key-value state storage and run-conclusion persistence, both scoped
 * to (orgId, toolSlug, sessionId). orgId is always sourced from context —
 * callers cannot inject a different org's scope through input fields.
 *
 * Usage:
 *   const { stateManager } = require('../services/StateManager');
 *   await stateManager.setState(context, 'myKey', { data: 'value' });
 *   const entry = await stateManager.getState(context, 'myKey');
 *
 * Or with injected dependencies (tests):
 *   const { StateManager } = require('../services/StateManager');
 *   const sm = new StateManager({ logger: mockLogger, pool: mockPool });
 */

const defaultLogger    = require('../utils/logger');
const { pool: defaultPool } = require('../db');

// Sentinel UUID used in place of a missing sessionId.
// Enables a standard UNIQUE(org_id, tool_slug, session_id, key) constraint
// without NULL-equality edge cases (NULL != NULL in SQL).
const NULL_SESSION = '00000000-0000-0000-0000-000000000000';

// ─── StateManager ─────────────────────────────────────────────────────────────

class StateManager {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Winston-compatible logger. Defaults to the platform logger.
   * @param {object} [options.pool]   - pg Pool instance. Defaults to the platform pool.
   */
  constructor({ logger: customLogger, pool: customPool } = {}) {
    this.logger = customLogger ?? defaultLogger;
    this.pool   = customPool   ?? defaultPool;
  }

  // ── setState ──────────────────────────────────────────────────────────────

  /**
   * Upsert a key-value state entry scoped to (orgId, toolSlug, sessionId, key).
   * orgId is always sourced from context — never from caller-supplied input.
   * This is the hard isolation guarantee: an agent cannot write to another org's
   * state by passing a different orgId in the tool input.
   *
   * @param {{ orgId: number, toolSlug: string, sessionId?: string }} context
   * @param {string} key
   * @param {*}      value  JSON-serialisable
   * @returns {Promise<{ id, org_id, tool_slug, session_id, key, value, updated_at }>}
   */
  async setState(context, key, value) {
    // orgId sourced exclusively from context — security assertion, not documentation.
    const { orgId, toolSlug } = context;
    const sid = context.sessionId ?? NULL_SESSION;

    const result = await this.pool.query(
      `INSERT INTO agent_states (org_id, tool_slug, session_id, key, value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT agent_states_unique_key
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING id, org_id, tool_slug, session_id, key, value, updated_at`,
      [orgId, toolSlug, sid, key, JSON.stringify(value)]
    );

    this.logger.debug('StateManager: setState', { orgId, toolSlug, key });
    return result.rows[0];
  }

  // ── getState ──────────────────────────────────────────────────────────────

  /**
   * Retrieve a single state entry by key.
   * Returns null if not found.
   *
   * @param {{ orgId: number, toolSlug: string, sessionId?: string }} context
   * @param {string} key
   * @returns {Promise<object|null>}
   */
  async getState(context, key) {
    const { orgId, toolSlug } = context;
    const sid = context.sessionId ?? NULL_SESSION;

    const result = await this.pool.query(
      `SELECT id, org_id, tool_slug, session_id, key, value, updated_at
       FROM agent_states
       WHERE org_id    = $1
         AND tool_slug = $2
         AND session_id = $3
         AND key        = $4`,
      [orgId, toolSlug, sid, key]
    );

    return result.rows[0] ?? null;
  }

  // ── getStates ─────────────────────────────────────────────────────────────

  /**
   * Retrieve all state entries for the caller's (orgId, toolSlug, sessionId) scope,
   * most-recently updated first.
   *
   * @param {{ orgId: number, toolSlug: string, sessionId?: string }} context
   * @param {object} [options]
   * @param {number} [options.limit=100] - Max entries (capped at 500).
   * @returns {Promise<Array>}
   */
  async getStates(context, { limit = 100 } = {}) {
    const { orgId, toolSlug } = context;
    const sid = context.sessionId ?? NULL_SESSION;
    const cap = Math.min(Math.max(1, limit), 500);

    const result = await this.pool.query(
      `SELECT id, org_id, tool_slug, session_id, key, value, updated_at
       FROM agent_states
       WHERE org_id     = $1
         AND tool_slug  = $2
         AND session_id = $3
       ORDER BY updated_at DESC
       LIMIT $4`,
      [orgId, toolSlug, sid, cap]
    );

    return result.rows;
  }

  // ── deleteState ───────────────────────────────────────────────────────────

  /**
   * Delete a state entry by key.
   *
   * @param {{ orgId: number, toolSlug: string, sessionId?: string }} context
   * @param {string} key
   * @returns {Promise<boolean>} true if a row was deleted
   */
  async deleteState(context, key) {
    const { orgId, toolSlug } = context;
    const sid = context.sessionId ?? NULL_SESSION;

    const result = await this.pool.query(
      `DELETE FROM agent_states
       WHERE org_id     = $1
         AND tool_slug  = $2
         AND session_id = $3
         AND key        = $4`,
      [orgId, toolSlug, sid, key]
    );

    return (result.rowCount ?? 0) > 0;
  }

  // ── saveConclusion ────────────────────────────────────────────────────────

  /**
   * Persist the final result of a completed agent run.
   * orgId is always sourced from context — never from caller-supplied input.
   *
   * @param {{ orgId: number, toolSlug: string, sessionId?: string }} context
   * @param {object} params
   * @param {string}  params.runId       - Unique run identifier (UUID)
   * @param {string}  params.result      - Final text response from the agent
   * @param {Array}   [params.trace]     - Full trace from AgentOrchestrator
   * @param {object}  [params.tokensUsed] - { input, output, cacheRead, cacheWrite }
   * @param {number}  [params.iterations]
   * @returns {Promise<{ id, org_id, tool_slug, run_id, created_at }>}
   */
  async saveConclusion(context, {
    runId,
    result,
    trace      = null,
    tokensUsed = null,
    iterations = null,
  }) {
    // orgId sourced exclusively from context — security assertion, not documentation.
    const { orgId, toolSlug, sessionId = null } = context;

    const row = await this.pool.query(
      `INSERT INTO agent_conclusions
         (org_id, tool_slug, session_id, run_id, result, trace, tokens_used, iterations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, org_id, tool_slug, run_id, created_at`,
      [
        orgId,
        toolSlug,
        sessionId,
        runId,
        result,
        trace      != null ? JSON.stringify(trace)      : null,
        tokensUsed != null ? JSON.stringify(tokensUsed) : null,
        iterations,
      ]
    );

    this.logger.info('StateManager: conclusion saved', { orgId, toolSlug, runId, iterations });
    return row.rows[0];
  }

  // ── getConclusions ────────────────────────────────────────────────────────

  /**
   * Retrieve past conclusions for a tool scope, most-recent first.
   * If context.sessionId is set, results are further scoped to that session.
   *
   * @param {{ orgId: number, toolSlug: string, sessionId?: string }} context
   * @param {object} [options]
   * @param {number} [options.limit=10] - Max entries (capped at 100).
   * @returns {Promise<Array>}
   */
  async getConclusions(context, { limit = 10 } = {}) {
    const { orgId, toolSlug, sessionId = null } = context;
    const cap = Math.min(Math.max(1, limit), 100);

    if (sessionId != null) {
      const result = await this.pool.query(
        `SELECT id, org_id, tool_slug, session_id, run_id, result,
                tokens_used, iterations, created_at
         FROM agent_conclusions
         WHERE org_id     = $1
           AND tool_slug  = $2
           AND session_id = $3
         ORDER BY created_at DESC
         LIMIT $4`,
        [orgId, toolSlug, sessionId, cap]
      );
      return result.rows;
    }

    const result = await this.pool.query(
      `SELECT id, org_id, tool_slug, session_id, run_id, result,
              tokens_used, iterations, created_at
       FROM agent_conclusions
       WHERE org_id    = $1
         AND tool_slug = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [orgId, toolSlug, cap]
    );
    return result.rows;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

// Module-level singleton — Node's require cache ensures a single instance is
// shared across all importers. Callers needing a custom pool or logger can
// instantiate directly via the named class export.
const stateManager = new StateManager();

module.exports = { StateManager, stateManager };
