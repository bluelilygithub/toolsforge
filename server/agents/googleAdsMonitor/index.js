'use strict';

/**
 * Google Ads Monitor agent — entry point.
 *
 * Loads admin config (model, maxTokens, maxIterations) and agent config
 * (lookback_days, thresholds, max_suggestions) before running the ReAct loop.
 * The agent config also populates the dynamic system prompt so thresholds
 * set in Agent Settings are reflected in every run without redeployment.
 *
 * Context shape accepted:
 *   { userId, orgId, toolSlug, days?, model?, maxTokens?, maxIterations? }
 *
 * The toolSlug MUST be 'google-ads-monitor' — it is the security scope that
 * gates which tools the agent can access in the platform ToolRegistry.
 */

const crypto = require('crypto');

const { agentOrchestrator } = require('../../services/AgentOrchestrator');
const { toolRegistry }      = require('../../services/ToolRegistry');
const { stateManager }      = require('../../services/StateManager');
const { AgentConfigService } = require('../../services/AgentConfigService');
const logger                = require('../../utils/logger');

// Importing tools.js triggers the side-effect that registers all four tools
// into the singleton toolRegistry. Must happen before getAvailableTools() is called.
const { TOOL_SLUG }       = require('./tools');
const { buildSystemPrompt } = require('./prompt');

function buildUserMessage(days) {
  const d = days ?? 30;
  return `Analyse campaign performance for the last ${d} day${d === 1 ? '' : 's'} and provide ` +
    'optimisation recommendations focused on high-intent traffic within current budget.';
}

/**
 * Run the Google Ads Monitor agent.
 *
 * @param {{ userId, orgId, toolSlug, days?, model?, maxTokens?, maxIterations? }} context
 * @returns {Promise<{ result: string, trace: Array, tokensUsed: object }>}
 */
async function runAdsMonitor(context) {
  // Load agent (operator) config — thresholds, lookback, max_suggestions.
  // Falls back to defaults if the org has not saved custom settings.
  const agentConfig = await AgentConfigService.getAgentConfig(context.orgId, TOOL_SLUG);

  // Resolve date range: per-run UI selection > agent config default > 30 days.
  const days = context.days ?? agentConfig.lookback_days ?? 30;

  const tools = await toolRegistry.getAvailableTools({
    ...context,
    toolSlug: TOOL_SLUG,
  });

  const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  buildSystemPrompt(agentConfig),
    userMessage:   buildUserMessage(days),
    tools,
    maxIterations: context.maxIterations ?? agentConfig.max_iterations ?? 10,
    context:       { ...context, days, toolSlug: TOOL_SLUG },
    // Admin-configured model and token limit (passed through from createAgentRoute).
    ...(context.model     && { model:     context.model }),
    ...(context.maxTokens && { maxTokens: context.maxTokens }),
  });

  // Persist conclusion. Wrapped in try-catch so DB errors (e.g. non-integer test orgId)
  // do not discard a successfully completed run.
  const runId = crypto.randomUUID();
  try {
    await stateManager.saveConclusion(
      { ...context, toolSlug: TOOL_SLUG },
      { runId, result, trace, tokensUsed, iterations }
    );
  } catch (err) {
    logger.warn('googleAdsMonitor: conclusion persistence failed', {
      runId, error: err.message, orgId: context.orgId,
    });
  }

  return { result, trace, tokensUsed };
}

module.exports = { runAdsMonitor };
