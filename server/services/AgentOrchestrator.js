'use strict';

/**
 * AgentOrchestrator — platform-level ReAct loop engine.
 *
 * Tool-agnostic: nothing in this file knows about any specific domain.
 * It is a pure execution primitive shared by every agent module in ToolsForge.
 *
 * Usage:
 *   const { agentOrchestrator } = require('../services/AgentOrchestrator');
 *   const { result, trace, iterations, tokensUsed } = await agentOrchestrator.run({ ... });
 *
 * Or with a custom logger:
 *   const { AgentOrchestrator } = require('../services/AgentOrchestrator');
 *   const orchestrator = new AgentOrchestrator({ logger: myLogger });
 */

const Anthropic = require('@anthropic-ai/sdk');
const defaultLogger = require('../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_ITERATIONS_HARD_CAP = 20;

// ─── AgentError ───────────────────────────────────────────────────────────────

/**
 * Structured error thrown by AgentOrchestrator. Always includes the partial
 * trace and iteration count so callers can inspect what happened before failure.
 */
class AgentError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {number} [details.iterations]  - How many iterations completed before the error
   * @param {Array}  [details.trace]       - Trace steps collected before the error
   * @param {Error}  [details.cause]       - Underlying error, if any
   */
  constructor(message, { iterations, trace, cause } = {}) {
    super(message);
    this.name = 'AgentError';
    this.iterations = iterations ?? 0;
    this.trace = trace ?? [];
    if (cause !== undefined) this.cause = cause;
  }
}

// ─── AgentOrchestrator ────────────────────────────────────────────────────────

class AgentOrchestrator {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Winston-compatible logger. Defaults to the platform logger.
   */
  constructor({ logger } = {}) {
    this.logger = logger ?? defaultLogger;
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ── Static helpers ──────────────────────────────────────────────────────────

  /**
   * Returns a plain JSON-serialisable object from a trace step, safe to pass
   * directly to res.write() in an SSE route.
   *
   * @param {object} traceStep
   * @param {number}   traceStep.iteration
   * @param {string}   traceStep.timestamp
   * @param {string|null} traceStep.thinking
   * @param {string|null} traceStep.text
   * @param {Array}    traceStep.toolCalls   - [{ id, name, input }]
   * @param {Array}    traceStep.toolResults - [{ id, name, result, durationMs }]
   * @returns {object}
   */
  static formatForSSE(traceStep) {
    return {
      type: 'agent_step',
      iteration: traceStep.iteration,
      timestamp: traceStep.timestamp,
      thinking: traceStep.thinking ?? null,
      text: traceStep.text ?? null,
      toolCalls: (traceStep.toolCalls ?? []).map(tc => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
      toolResults: (traceStep.toolResults ?? []).map(tr => ({
        id: tr.id,
        name: tr.name,
        result: tr.result,
        durationMs: tr.durationMs,
      })),
    };
  }

  // ── Main entry point ────────────────────────────────────────────────────────

  /**
   * Execute a ReAct loop: call Claude → parse tool calls → execute tools →
   * feed results back → repeat until no tool calls or maxIterations reached.
   *
   * @param {object}   params
   * @param {string}   params.systemPrompt          - System prompt for the agent
   * @param {string}   params.userMessage           - Initial user message
   * @param {Array}    [params.tools=[]]            - Tool definitions: Anthropic schema fields
   *                                                  (name, description, input_schema) plus an
   *                                                  async execute(input, context) function.
   *                                                  The execute fn is stripped before sending to Claude.
   * @param {number}   [params.maxIterations=10]    - Max loop iterations. Silently clamped to 20.
   * @param {Function} [params.onStep]              - Optional async callback(traceStep) called after
   *                                                  each iteration completes (for SSE streaming).
   * @param {object}   params.context               - REQUIRED. { userId, orgId, toolSlug }.
   *                                                  Passed through to every tool.execute() call.
   * @param {string}   [params.model]               - Claude model ID. Defaults to claude-sonnet-4-6.
   * @param {number}   [params.maxTokens=8192]      - Max output tokens per Claude response.
   *                                                  Pass 65536 for complex multi-step agents that
   *                                                  produce long intermediate reasoning or output.
   * @param {object}   [params.thinking]            - Extended thinking configuration.
   * @param {boolean}  [params.thinking.enabled=false]
   * @param {number}   [params.thinking.budgetTokens=10000] - Must be less than maxTokens.
   *
   * @returns {Promise<{
   *   result:     string,  - Final text response from Claude
   *   trace:      Array,   - All trace steps (one per iteration)
   *   iterations: number,  - How many iterations ran
   *   tokensUsed: {
   *     input:      number,
   *     output:     number,
   *     cacheRead:  number,
   *     cacheWrite: number,
   *   }
   * }>}
   *
   * @throws {AgentError} If maxIterations exceeded, context.orgId is missing,
   *                      or the Claude API call fails. Always includes partial trace.
   */
  async run({
    systemPrompt,
    userMessage,
    tools = [],
    maxIterations = 10,
    onStep,
    context,
    model = DEFAULT_MODEL,
    maxTokens = 8192,
    thinking = { enabled: false, budgetTokens: 10000 },
  }) {
    // ── Guards ────────────────────────────────────────────────────────────────

    if (!context || !context.orgId) {
      throw new AgentError(
        'context.orgId is required — tool executions must always be org-scoped',
        { iterations: 0, trace: [] }
      );
    }

    const cappedIterations = Math.min(maxIterations, MAX_ITERATIONS_HARD_CAP);

    // ── Prepare tools ─────────────────────────────────────────────────────────

    // Strip execute functions before sending schemas to the Anthropic API.
    // Keep a name-keyed map for dispatch during tool execution.
    const anthropicTools = tools.length > 0
      ? tools.map(({ execute: _exec, requiredPermissions: _perms, toolSlug: _slug, ...schema }) => schema)
      : undefined;

    const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));

    // ── Initialise state ──────────────────────────────────────────────────────

    const messages = [{ role: 'user', content: userMessage }];
    const trace = [];
    const tokensUsed = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    // ── ReAct loop ────────────────────────────────────────────────────────────

    for (let iteration = 1; iteration <= cappedIterations; iteration++) {
      // Build Anthropic API request
      const apiParams = {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      };

      if (anthropicTools) {
        apiParams.tools = anthropicTools;
      }

      // Extended thinking — disabled by default; only pass when explicitly enabled.
      // Supported on Claude 4+ models (claude-opus-4-6, claude-sonnet-4-6) without betas.
      // budget_tokens must be less than max_tokens; the caller is responsible for sizing.
      if (thinking?.enabled) {
        apiParams.thinking = {
          type: 'enabled',
          budget_tokens: thinking.budgetTokens ?? 10000,
        };
      }

      // Call Claude
      let response;
      try {
        response = await this.anthropic.messages.create(apiParams);
      } catch (err) {
        this.logger.error('AgentOrchestrator: Anthropic API error', {
          error: err.message,
          iteration,
          model,
          userId: context.userId,
          orgId: context.orgId,
          toolSlug: context.toolSlug,
        });
        throw new AgentError(
          `Claude API error on iteration ${iteration}: ${err.message}`,
          { iterations: iteration, trace, cause: err }
        );
      }

      // Accumulate token usage across all iterations
      const usage = response.usage ?? {};
      tokensUsed.input      += usage.input_tokens                  ?? 0;
      tokensUsed.output     += usage.output_tokens                 ?? 0;
      tokensUsed.cacheRead  += usage.cache_read_input_tokens       ?? 0;
      tokensUsed.cacheWrite += usage.cache_creation_input_tokens   ?? 0;

      // Build this iteration's trace step
      const traceStep = {
        iteration,
        timestamp: new Date().toISOString(),
        thinking: null,
        text: null,
        toolCalls: [],
        toolResults: [],
      };

      // Parse response content blocks
      for (const block of response.content) {
        if (block.type === 'thinking') {
          // Extended thinking block — capture reasoning for the trace
          traceStep.thinking = block.thinking;
        } else if (block.type === 'text') {
          // Concatenate in the rare case of multiple text blocks
          traceStep.text = (traceStep.text ?? '') + block.text;
        } else if (block.type === 'tool_use') {
          traceStep.toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      // ── Terminal condition: no tool calls, or Claude signalled end_turn ───
      if (response.stop_reason !== 'tool_use' || traceStep.toolCalls.length === 0) {
        trace.push(traceStep);
        if (typeof onStep === 'function') await onStep(traceStep);
        return {
          result: traceStep.text ?? '',
          trace,
          iterations: iteration,
          tokensUsed,
        };
      }

      // ── Execute tool calls ────────────────────────────────────────────────

      const toolResultBlocks = [];

      for (const toolCall of traceStep.toolCalls) {
        const t0 = Date.now();
        let result;

        const tool = toolMap[toolCall.name];

        if (!tool) {
          // Unknown tool: return a structured error to Claude and let it recover
          result = { error: `Tool not found: ${toolCall.name}` };
          this.logger.warn('AgentOrchestrator: unknown tool called by Claude', {
            toolName: toolCall.name,
            iteration,
            userId: context.userId,
            orgId: context.orgId,
            toolSlug: context.toolSlug,
          });
        } else {
          try {
            // context is always passed — tools need orgId for data scoping
            result = await tool.execute(toolCall.input, context);
          } catch (err) {
            // Per-tool errors are caught here and returned as structured results.
            // Claude decides how to handle tool failure — we do not throw up the stack.
            result = { error: err.message ?? 'Tool execution failed' };
            this.logger.warn('AgentOrchestrator: tool execution error', {
              toolName: toolCall.name,
              error: err.message,
              iteration,
              userId: context.userId,
              orgId: context.orgId,
              toolSlug: context.toolSlug,
            });
          }
        }

        const durationMs = Date.now() - t0;
        traceStep.toolResults.push({ id: toolCall.id, name: toolCall.name, result, durationMs });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          // Anthropic expects tool results as strings; JSON.stringify handles objects/arrays/primitives
          content: JSON.stringify(result),
        });
      }

      // Feed the full assistant response (including any thinking blocks) and tool
      // results back into the conversation. Preserving thinking blocks in the
      // assistant message is required by the API when extended thinking is enabled.
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResultBlocks });

      trace.push(traceStep);
      if (typeof onStep === 'function') await onStep(traceStep);

      // Continue to next iteration
    }

    // ── Max iterations exceeded ───────────────────────────────────────────────

    throw new AgentError(
      `Agent exceeded maximum iterations (${cappedIterations})`,
      { iterations: cappedIterations, trace }
    );
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// Module-level singleton — Node's require cache ensures a single instance is
// shared across all importers. Callers needing a custom logger can instantiate
// directly via the named class export.
const agentOrchestrator = new AgentOrchestrator();

module.exports = { AgentOrchestrator, AgentError, agentOrchestrator };
