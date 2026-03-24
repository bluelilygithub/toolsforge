/**
 * usageLogger — records AI usage to usage_logs and checks spend thresholds.
 *
 * Called at the end of every SSE stream once Anthropic's finalMessage fires.
 * Threshold warnings are written to app_logs (existing Winston DB transport)
 * so they appear in Admin → Logs without any new infrastructure.
 */

const { calculateCost } = require('./costCalculator');
const logger = require('../utils/logger');

/**
 * Write one row to usage_logs and return the USD cost.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.toolSlug
 * @param {string} params.modelId
 * @param {number} params.inputTokens
 * @param {number} params.outputTokens
 * @param {number} [params.cacheReadTokens=0]
 * @param {number} [params.cacheWriteTokens=0]
 * @returns {Promise<number>} costUsd
 */
async function logUsage({ userId, toolSlug, modelId, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 }) {
  const { pool } = require('../db');

  const costUsd = await calculateCost({ modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

  await pool.query(
    `INSERT INTO usage_logs
       (user_id, tool_slug, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, toolSlug, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd]
  );

  logger.info('AI usage logged', { userId, toolSlug, modelId, inputTokens, outputTokens, cacheReadTokens, costUsd });

  return costUsd;
}

/**
 * Check session and daily spend against thresholds from system_settings.
 * Fires logger.warn (→ app_logs) when a threshold is crossed — admin sees it
 * in Admin → Logs without any new infrastructure.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.email
 * @param {string} params.toolSlug
 * @param {number} params.sessionCostUsd  accumulated cost for the current session
 * @returns {Promise<{ sessionCostUsd: number, dailyTotal: number, warnings: Array }>}
 */
async function checkSpendThresholds({ userId, email, toolSlug, sessionCostUsd }) {
  const { pool } = require('../db');

  // Read global thresholds — fall back to sensible defaults if not yet set
  const settingsResult = await pool.query(
    `SELECT key, value FROM system_settings WHERE key IN ('spend_warn_session_usd', 'spend_warn_daily_usd')`
  );
  const settings = Object.fromEntries(settingsResult.rows.map(r => [r.key, parseFloat(r.value)]));
  const sessionWarn = settings['spend_warn_session_usd'] ?? 0.50;
  const dailyWarn   = settings['spend_warn_daily_usd']   ?? 5.00;

  // Today's total spend for this user across all tools
  const dailyResult = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total
     FROM usage_logs
     WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
    [userId]
  );
  const dailyTotal = parseFloat(dailyResult.rows[0].total);

  const warnings = [];

  if (sessionCostUsd >= sessionWarn) {
    logger.warn('Session spend threshold reached', {
      userId, email, toolSlug,
      sessionCostUsd: sessionCostUsd.toFixed(4),
      threshold: sessionWarn,
    });
    warnings.push({ type: 'session', amount: sessionCostUsd, threshold: sessionWarn });
  }

  if (dailyTotal >= dailyWarn) {
    logger.warn('Daily spend threshold reached', {
      userId, email, toolSlug,
      dailyTotal: dailyTotal.toFixed(4),
      threshold: dailyWarn,
    });
    warnings.push({ type: 'daily', amount: dailyTotal, threshold: dailyWarn });
  }

  return { sessionCostUsd, dailyTotal, warnings };
}

/**
 * Convenience: log usage then immediately check thresholds.
 * This is the single call most SSE endpoints will make in their finalMessage handler.
 *
 * @returns {Promise<{ costUsd: number, dailyTotal: number, warnings: Array }>}
 */
async function logAndCheck({ userId, email, toolSlug, modelId, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0, sessionCostUsd = 0 }) {
  const costUsd = await logUsage({ userId, toolSlug, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });
  const sessionTotal = sessionCostUsd + costUsd;
  const { dailyTotal, warnings } = await checkSpendThresholds({ userId, email, toolSlug, sessionCostUsd: sessionTotal });
  return { costUsd, sessionTotal, dailyTotal, warnings };
}

module.exports = { logUsage, checkSpendThresholds, logAndCheck };
