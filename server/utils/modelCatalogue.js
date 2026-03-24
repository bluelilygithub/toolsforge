/**
 * Model Catalogue — definition of every AI model available in ToolsForge.
 *
 * Source of truth at runtime is the `ai_models` key in `system_settings` (DB).
 * The static MODEL_CATALOGUE below serves two purposes:
 *   1. Seed defaults — written to DB on first startup (ON CONFLICT DO NOTHING)
 *   2. Fallback — used when DB is unavailable or returns no models
 *
 * Tiers (ascending cost):
 *   standard  — fast, cheap (Haiku-class)
 *   advanced  — balanced capability and cost (Sonnet-class)
 *   premium   — maximum capability (Opus-class)
 *
 * Pricing is per 1,000,000 tokens (USD).
 */

const TIER_ORDER = ['standard', 'advanced', 'premium'];

const MODEL_CATALOGUE = {
  'claude-haiku-4-5-20251001': {
    name:             'Claude Haiku 4.5',
    tier:             'standard',
    provider:         'anthropic',
    emoji:            '⚡',
    label:            'Economy',
    tagline:          'Fast & affordable',
    desc:             'Best for quick tasks, simple queries, and background automation',
    inputPricePer1M:  0.80,
    outputPricePer1M: 4.00,
    contextWindow:    200000,
  },
  'claude-sonnet-4-6': {
    name:             'Claude Sonnet 4.6',
    tier:             'advanced',
    provider:         'anthropic',
    emoji:            '⚖️',
    label:            'Standard',
    tagline:          'Smart & balanced',
    desc:             'Best for most work — writing, analysis, and tool workloads',
    inputPricePer1M:  3.00,
    outputPricePer1M: 15.00,
    contextWindow:    200000,
  },
  'claude-opus-4-6': {
    name:             'Claude Opus 4.6',
    tier:             'premium',
    provider:         'anthropic',
    emoji:            '🧠',
    label:            'Premium',
    tagline:          'Most capable',
    desc:             'Best for complex reasoning, deep analysis, and large-context tasks',
    inputPricePer1M:  15.00,
    outputPricePer1M: 75.00,
    contextWindow:    200000,
  },
};

// ─── Sync helpers (use static catalogue) ─────────────────────────────────────

function getModelsForTier(maxTier) {
  const maxIndex = TIER_ORDER.indexOf(maxTier);
  if (maxIndex === -1) return [];
  return Object.entries(MODEL_CATALOGUE)
    .filter(([, m]) => TIER_ORDER.indexOf(m.tier) <= maxIndex)
    .sort(([, a], [, b]) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    .map(([id, m]) => ({ id, ...m }));
}

function getModel(modelId) {
  const m = MODEL_CATALOGUE[modelId];
  return m ? { id: modelId, ...m } : null;
}

function getEscalationModel(modelId) {
  const current = MODEL_CATALOGUE[modelId];
  if (!current) return null;
  const currentIndex = TIER_ORDER.indexOf(current.tier);
  const nextTier = TIER_ORDER[currentIndex + 1];
  if (!nextTier) return null;
  const entry = Object.entries(MODEL_CATALOGUE).find(([, m]) => m.tier === nextTier);
  return entry ? { id: entry[0], ...entry[1] } : null;
}

// ─── Async DB-backed helpers ──────────────────────────────────────────────────

/**
 * Load the live model list from system_settings.
 * Falls back to static MODEL_CATALOGUE if DB is unavailable or empty.
 * @returns {Promise<Array<{ id, name, tier, provider, inputPricePer1M, outputPricePer1M, ... }>>}
 */
async function getModelsFromDB() {
  try {
    const { pool } = require('../db');
    const result = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'ai_models'`
    );
    if (result.rows.length && result.rows[0].value) {
      const models = result.rows[0].value;
      if (Array.isArray(models) && models.length > 0) return models;
    }
  } catch { /* fall through */ }

  // Fallback to static catalogue
  return Object.entries(MODEL_CATALOGUE).map(([id, m]) => ({ id, ...m }));
}

/**
 * Return models at or below maxTier from the DB, sorted standard → premium.
 * @param {string} maxTier
 * @returns {Promise<Array>}
 */
async function getModelsForTierFromDB(maxTier) {
  const maxIndex = TIER_ORDER.indexOf(maxTier);
  if (maxIndex === -1) return [];
  const all = await getModelsFromDB();
  return all
    .filter(m => TIER_ORDER.indexOf(m.tier) <= maxIndex)
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

/**
 * Look up a single model by ID from the DB.
 * @param {string} modelId
 * @returns {Promise<object|null>}
 */
async function getModelFromDB(modelId) {
  const all = await getModelsFromDB();
  return all.find(m => m.id === modelId) || null;
}

module.exports = {
  MODEL_CATALOGUE,
  TIER_ORDER,
  // Sync (static fallback)
  getModelsForTier,
  getModel,
  getEscalationModel,
  // Async (DB-backed)
  getModelsFromDB,
  getModelsForTierFromDB,
  getModelFromDB,
};
