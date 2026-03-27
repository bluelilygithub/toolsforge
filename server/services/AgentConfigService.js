'use strict';

/**
 * AgentConfigService — reads and writes agent configuration from two storage locations.
 *
 * Admin config  → system_settings table, key = agent_<slug_underscored>
 *   Covers: enabled, model, max_tokens, max_iterations
 *   Writable by: org_admin only
 *   Implication: cost guardrails and kill switch live here
 *
 * Agent config  → agent_configs table, keyed by (org_id, slug)
 *   Covers: schedule, lookback_days, analytical thresholds, output preferences
 *   Writable by: org_admin (extendable to agent_manager role)
 *   Implication: a knowledgeable operator tunes these without touching platform settings
 *
 * Both return defaults merged with stored values so callers always get a complete object.
 */

const { pool } = require('../db');
const logger   = require('../utils/logger');

// ─── Defaults ─────────────────────────────────────────────────────────────────

const AGENT_DEFAULTS = {
  'google-ads-monitor': {
    schedule:                  '0 6,18 * * *',
    lookback_days:             30,
    ctr_low_threshold:         0.03,   // fraction: 0.03 = 3%
    wasted_clicks_threshold:   5,      // clicks with 0 conversions → flag
    impressions_ctr_threshold: 100,    // impressions with low CTR → ad copy opportunity
    max_suggestions:           8,
  },
};

const ADMIN_DEFAULTS = {
  'google-ads-monitor': {
    enabled:        true,
    model:          'claude-sonnet-4-6',
    max_tokens:     8192,
    max_iterations: 10,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a slug like 'google-ads-monitor' to a system_settings key. */
function adminKey(slug) {
  return `agent_${slug.replace(/-/g, '_')}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const AgentConfigService = {

  /**
   * Get agent (operator) config for an org + slug.
   * Returns defaults merged with any stored config.
   *
   * @param {number} orgId
   * @param {string} slug
   * @returns {Promise<object>}
   */
  async getAgentConfig(orgId, slug) {
    const defaults = AGENT_DEFAULTS[slug] ?? {};
    try {
      const res = await pool.query(
        'SELECT config FROM agent_configs WHERE org_id = $1 AND slug = $2',
        [orgId, slug]
      );
      const stored = res.rows[0]?.config ?? {};
      return { ...defaults, ...stored };
    } catch (err) {
      logger.warn('AgentConfigService.getAgentConfig: DB error, returning defaults', {
        slug, orgId, error: err.message,
      });
      return { ...defaults };
    }
  },

  /**
   * Update agent config for an org + slug.
   * Merges patch over the current stored config.
   *
   * @param {number} orgId
   * @param {string} slug
   * @param {object} patch
   * @param {number} updatedBy - user id
   * @returns {Promise<object>} merged config (defaults + stored + patch)
   */
  async updateAgentConfig(orgId, slug, patch, updatedBy) {
    const current = await this.getAgentConfig(orgId, slug);
    const merged  = { ...current, ...patch };
    await pool.query(
      `INSERT INTO agent_configs (org_id, slug, config, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (org_id, slug) DO UPDATE
         SET config = $3::jsonb, updated_by = $4, updated_at = NOW()`,
      [orgId, slug, JSON.stringify(merged), updatedBy]
    );
    return merged;
  },

  /**
   * Get admin-level config for a slug (from system_settings).
   * Returns defaults merged with stored values.
   *
   * @param {string} slug
   * @returns {Promise<object>}
   */
  async getAdminConfig(slug) {
    const defaults = ADMIN_DEFAULTS[slug] ?? {};
    try {
      const res = await pool.query(
        'SELECT value FROM system_settings WHERE key = $1',
        [adminKey(slug)]
      );
      const stored = res.rows[0]?.value ?? {};
      return { ...defaults, ...stored };
    } catch (err) {
      logger.warn('AgentConfigService.getAdminConfig: DB error, returning defaults', {
        slug, error: err.message,
      });
      return { ...defaults };
    }
  },

  /**
   * Update admin-level config for a slug (in system_settings).
   *
   * @param {string} slug
   * @param {object} patch
   * @param {number} updatedBy - user id
   * @returns {Promise<object>} merged config
   */
  async updateAdminConfig(slug, patch, updatedBy) {
    const current = await this.getAdminConfig(slug);
    const merged  = { ...current, ...patch };
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = $2::jsonb, updated_by = $3, updated_at = NOW()`,
      [adminKey(slug), JSON.stringify(merged), updatedBy]
    );
    return merged;
  },

  AGENT_DEFAULTS,
  ADMIN_DEFAULTS,
};

module.exports = { AgentConfigService };
