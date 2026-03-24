/**
 * costCalculator — converts Anthropic token counts into USD cost.
 *
 * Pricing is read from the live model catalogue in system_settings (DB).
 * Falls back to a static pricing map if the model is not found in DB.
 *
 * Token sources (from Anthropic finalMessage.usage):
 *   inputTokens       — standard input tokens billed at full price
 *   outputTokens      — generated output tokens
 *   cacheReadTokens   — tokens served from prompt cache (billed at 10% of input price)
 *   cacheWriteTokens  — tokens written to prompt cache (billed at 125% of input price)
 */

const { getModelFromDB, getModel } = require('../utils/modelCatalogue');

// Static fallback pricing — substring match for unknown model IDs
const FALLBACK_PRICING = {
  'claude-haiku-4-5-20251001': { inputPricePer1M: 0.80,  outputPricePer1M: 4.00  },
  'claude-sonnet-4-6':         { inputPricePer1M: 3.00,  outputPricePer1M: 15.00 },
  'claude-opus-4-6':           { inputPricePer1M: 15.00, outputPricePer1M: 75.00 },
};

function fallbackRates(modelId) {
  if (FALLBACK_PRICING[modelId]) return FALLBACK_PRICING[modelId];
  const id = modelId.toLowerCase();
  if (id.includes('opus'))   return { inputPricePer1M: 15.00, outputPricePer1M: 75.00 };
  if (id.includes('sonnet')) return { inputPricePer1M: 3.00,  outputPricePer1M: 15.00 };
  if (id.includes('haiku'))  return { inputPricePer1M: 0.80,  outputPricePer1M: 4.00  };
  return { inputPricePer1M: 1.00, outputPricePer1M: 5.00 };
}

/**
 * Calculate the USD cost of a single AI response.
 * Reads live pricing from DB; falls back to static map.
 *
 * @param {object} params
 * @param {string} params.modelId
 * @param {number} params.inputTokens
 * @param {number} params.outputTokens
 * @param {number} [params.cacheReadTokens=0]
 * @param {number} [params.cacheWriteTokens=0]
 * @returns {Promise<number>} cost in USD
 */
async function calculateCost({ modelId, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 }) {
  // Try DB first, then static catalogue, then substring fallback
  let model = await getModelFromDB(modelId);
  if (!model) model = getModel(modelId);

  const rates = model
    ? { inputPricePer1M: model.inputPricePer1M, outputPricePer1M: model.outputPricePer1M }
    : fallbackRates(modelId);

  const inputCost      = (inputTokens      / 1_000_000) * rates.inputPricePer1M;
  const outputCost     = (outputTokens     / 1_000_000) * rates.outputPricePer1M;
  const cacheReadCost  = (cacheReadTokens  / 1_000_000) * (rates.inputPricePer1M * 0.10);
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (rates.inputPricePer1M * 1.25);

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Format a USD cost for display.
 * @param {number} usd
 * @returns {string} e.g. "$0.0012" or "$1.24"
 */
function formatCost(usd) {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

module.exports = { calculateCost, formatCost };
