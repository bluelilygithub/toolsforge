'use strict';

/**
 * Google Ads Monitor agent — entry point.
 *
 * Wires GoogleAdsService + GoogleAnalyticsService into the platform ReAct loop.
 * Fetches live data via registered tools, runs Claude's analysis, persists the
 * conclusion to agent_conclusions, and returns the structured result.
 *
 * Usage:
 *   const { runAdsMonitor } = require('./server/agents/googleAdsMonitor');
 *   const { result, trace, tokensUsed } = await runAdsMonitor(context);
 *
 * Context shape:
 *   { userId: string|number, orgId: string|number, toolSlug: 'google-ads-monitor' }
 *
 * The toolSlug MUST be 'google-ads-monitor' — it is the security scope that
 * gates which tools the agent can access in the platform ToolRegistry.
 */

const crypto = require('crypto');

const { agentOrchestrator } = require('../../services/AgentOrchestrator');
const { toolRegistry }      = require('../../services/ToolRegistry');
const { stateManager }      = require('../../services/StateManager');

// Importing tools.js triggers the side-effect that registers all four tools
// into the singleton toolRegistry. Must happen before getAvailableTools() is called.
const { TOOL_SLUG } = require('./tools');
const { SYSTEM_PROMPT } = require('./prompt');

const USER_MESSAGE =
  'Analyse campaign performance for the last 30 days and provide optimisation ' +
  'recommendations focused on high-intent traffic within current budget.';

/**
 * Run the Google Ads Monitor agent.
 *
 * @param {{ userId: string|number, orgId: string|number, toolSlug: string }} context
 * @returns {Promise<{ result: string, trace: Array, tokensUsed: object }>}
 * @throws {AgentError} If AgentOrchestrator exceeds maxIterations or the Claude API fails.
 */
async function runAdsMonitor(context) {
  // Load tools scoped to this agent via the platform registry.
  // toolSlug filtering ensures only google-ads-monitor tools are included —
  // platform tools (web_search, send_email) are intentionally excluded.
  const tools = await toolRegistry.getAvailableTools({
    ...context,
    toolSlug: TOOL_SLUG,
  });

  // Run the ReAct loop: Claude gathers data via tools then produces the analysis.
  const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({
    systemPrompt:  SYSTEM_PROMPT,
    userMessage:   USER_MESSAGE,
    tools,
    maxIterations: 10,
    context:       { ...context, toolSlug: TOOL_SLUG },
  });

  // Persist the conclusion. Wrapped in try-catch so a DB error (e.g. test context
  // with a non-integer orgId) does not discard a successfully completed run.
  const runId = crypto.randomUUID();
  try {
    await stateManager.saveConclusion(
      { ...context, toolSlug: TOOL_SLUG },
      { runId, result, trace, tokensUsed, iterations }
    );
  } catch (err) {
    // Log but do not rethrow — the analysis is complete regardless of persistence.
    const logger = require('../../utils/logger');
    logger.warn('googleAdsMonitor: conclusion persistence failed', {
      runId,
      error: err.message,
      orgId: context.orgId,
    });
  }

  return { result, trace, tokensUsed };
}

module.exports = { runAdsMonitor };
