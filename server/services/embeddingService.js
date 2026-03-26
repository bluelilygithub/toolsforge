'use strict';

/**
 * embeddingService — wraps Google text-embedding-004 (768 dimensions).
 *
 * Environment variables:
 *   GOOGLE_GENERATIVE_AI_API_KEY  — required
 *
 * Sprint 3 note: logAndCheck cost telemetry hook should wrap embedText()
 * calls once per-character pricing is confirmed.  The function signature
 * (text: string) → number[] won't change.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL_NAME = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;

let _client = null;

function getClient() {
  if (!_client) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set');
    _client = new GoogleGenerativeAI(apiKey);
  }
  return _client;
}

/**
 * Embed a single text string.
 *
 * @param {string} text  Plain text to embed (will be truncated at 2048 tokens
 *                       by the API if longer — callers should chunk first).
 * @returns {Promise<number[]>}  768-dimensional embedding vector.
 */
async function embedText(text) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL_NAME });

  const result = await model.embedContent(text);
  const values = result.embedding?.values;

  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding dimension: expected ${EMBEDDING_DIMENSIONS}, got ${values?.length}`
    );
  }

  return values;
}

/**
 * Embed multiple texts in sequence (no batching — Gemini embedding API is
 * low-latency enough for chunk-level calls; batch endpoint arrives in Sprint 2).
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}

module.exports = { embedText, embedBatch, EMBEDDING_DIMENSIONS };
