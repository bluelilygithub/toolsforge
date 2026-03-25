/**
 * Generic SSE streaming endpoint for all AI tools.
 *
 * POST /api/tools/:toolSlug/stream
 *
 * Request body:
 *   {
 *     model:    string,          // model ID from MODEL_CATALOGUE
 *     messages: Array<{ role: 'user'|'assistant', content: string }>,
 *     system?:  string,          // optional system prompt override
 *     maxTokens?: number         // default 4096
 *   }
 *
 * SSE event stream (text/event-stream):
 *   data: {"type":"status","status":"connecting"}
 *   data: {"type":"text","text":"...incremental chunk..."}
 *   data: {"type":"usage","inputTokens":N,"outputTokens":N,"cacheReadTokens":N,"cacheWriteTokens":N,"costUsd":N}
 *   data: {"type":"error","error":"message"}
 *   data: [DONE]
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('../middleware/requireAuth');
const PermissionService = require('../services/permissions');
const { logAndCheck } = require('../services/usageLogger');
const logger = require('../utils/logger');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Write a single SSE event to the response.
 * @param {Response} res
 * @param {object|string} data
 */
function sendEvent(res, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
}

/**
 * GET /api/tools/:toolSlug/permitted-models
 * Returns the list of models the authenticated user may use for this tool.
 */
router.get('/:toolSlug/permitted-models', requireAuth, async (req, res) => {
  try {
    const models = await PermissionService.getPermittedModels(req.user.id, req.params.toolSlug);
    res.json({ models });
  } catch (err) {
    logger.error('permitted-models error', { error: err.message });
    res.status(500).json({ error: 'Failed to load permitted models' });
  }
});

/**
 * POST /api/tools/:toolSlug/analyse-prompt
 * Classifies prompt complexity and suggests a better model if the current one is a mismatch.
 * suggestedModels is always filtered to the user's permitted models — never escalates beyond access.
 */
router.post('/:toolSlug/analyse-prompt', requireAuth, async (req, res) => {
  const { toolSlug } = req.params;
  const { prompt, currentModelId } = req.body;

  if (!prompt) return res.json({ mismatch: false });
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ mismatch: false });

  try {
    const permittedModels = await PermissionService.getPermittedModels(req.user.id, toolSlug);
    if (!permittedModels.length) return res.json({ mismatch: false });

    // Use the lightest permitted model for classification (cheapest possible call)
    const classifierModel = (
      permittedModels.find(m => m.tier === 'standard') ||
      permittedModels.find(m => m.tier === 'advanced') ||
      permittedModels[0]
    ).id;

    const msg = await anthropic.messages.create({
      model: classifierModel,
      max_tokens: 128,
      system: `You are a prompt complexity classifier. Return ONLY valid JSON with no preamble or markdown.

{
  "complexity": "simple" | "moderate" | "complex",
  "reason": "one sentence plain-English explanation",
  "suggestedTier": "standard" | "advanced" | "premium"
}

Rules:
- "simple": casual questions, quick lookups, short rewrites, greetings, single-sentence tasks
- "moderate": multi-step explanations, summaries, short code, structured output
- "complex": architecture decisions, deep analysis, debugging complex systems, long-form content
- suggestedTier: "standard" for simple, "advanced" for moderate, "premium" for complex`,
      messages: [{ role: 'user', content: String(prompt).slice(0, 2000) }],
    });

    const raw = msg.content[0]?.text?.trim() ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const { complexity, reason, suggestedTier } = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

    // No mismatch if the current model is already the right tier
    const currentModel = permittedModels.find(m => m.id === currentModelId);
    if (currentModel?.tier === suggestedTier) return res.json({ mismatch: false });

    // Only suggest models the user is actually permitted to use
    const suggestedModels = permittedModels
      .filter(m => m.tier === suggestedTier)
      .map(m => ({ id: m.id, name: m.name, emoji: m.emoji || '' }));

    if (!suggestedModels.length) return res.json({ mismatch: false });

    logger.info('Model advisor mismatch', {
      userId: req.user.id, toolSlug, currentModelId, suggestedTier, complexity,
    });

    return res.json({ mismatch: true, complexity, reason, suggestedTier, suggestedModels });
  } catch (err) {
    // Always fall through silently — never block the user from sending
    logger.warn('analyse-prompt failed', { error: err.message, toolSlug });
    return res.json({ mismatch: false });
  }
});

router.post('/:toolSlug/stream', requireAuth, async (req, res) => {
  const { toolSlug } = req.params;
  const { model, messages, system, maxTokens = 4096 } = req.body;

  // -- Validate input -------------------------------------------------------
  if (!model) {
    return res.status(400).json({ error: 'model is required' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  // -- Permission check: can this user use the requested model? -------------
  try {
    const allowed = await PermissionService.canUseModel(req.user.id, toolSlug, model);
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to use this model' });
    }
  } catch (err) {
    logger.error('stream: permission check failed', { error: err.message, toolSlug });
    return res.status(500).json({ error: 'Permission check failed' });
  }

  // -- Set SSE headers -------------------------------------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  sendEvent(res, { type: 'status', status: 'connecting' });

  // -- Stream from Anthropic -------------------------------------------------
  try {
    const streamParams = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (system) streamParams.system = system;

    const stream = await anthropic.messages.stream(streamParams);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        sendEvent(res, { type: 'text', text: event.delta.text });
      }
    }

    // finalMessage fires once the full response is complete
    const finalMessage = await stream.finalMessage();
    const usage = finalMessage.usage ?? {};

    const { costUsd, sessionTotal, dailyTotal, warnings } = await logAndCheck({
      userId:           req.user.id,
      email:            req.user.email,
      toolSlug,
      modelId:          model,
      inputTokens:      usage.input_tokens        ?? 0,
      outputTokens:     usage.output_tokens       ?? 0,
      cacheReadTokens:  usage.cache_read_input_tokens  ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      sessionCostUsd:   0,
    });

    sendEvent(res, {
      type:             'usage',
      inputTokens:      usage.input_tokens        ?? 0,
      outputTokens:     usage.output_tokens       ?? 0,
      cacheReadTokens:  usage.cache_read_input_tokens  ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd,
      sessionTotal,
      dailyTotal,
      warnings,
    });

    sendEvent(res, '[DONE]');
    res.end();

  } catch (err) {
    logger.error('stream: Anthropic error', { error: err.message, toolSlug, model });
    sendEvent(res, { type: 'error', error: err.message ?? 'Streaming failed' });
    sendEvent(res, '[DONE]');
    res.end();
  }
});

module.exports = router;
