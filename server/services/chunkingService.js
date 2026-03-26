'use strict';

/**
 * chunkingService — split extracted text into overlapping chunks.
 *
 * Token approximation: 1 token ≈ 4 characters (GPT/Gemini rule of thumb).
 *   targetTokens = 500  → targetChars = 2000
 *   overlapTokens = 50  → overlapChars = 200
 *
 * The chunker splits on whitespace boundaries so chunks never cut a word in
 * half, which keeps embedding quality high and reduces noise at chunk edges.
 *
 * Sprint 2 note: replace the char estimator with a real tokeniser (e.g.
 * @dqbd/tiktoken or google's tokenizer) without changing the public API —
 * chunkText(text, chunkSize, overlapSize) signature stays stable.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Split text into overlapping chunks.
 *
 * @param {string} text
 * @param {number} [targetTokens=500]  Approximate tokens per chunk.
 * @param {number} [overlapTokens=50]  Approximate token overlap between chunks.
 * @returns {string[]}  Array of chunk strings; empty array for blank input.
 */
function chunkText(text, targetTokens = 500, overlapTokens = 50) {
  if (!text || !text.trim()) return [];

  const targetChars = targetTokens * CHARS_PER_TOKEN;   // 2000
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;  // 200

  // Split into word-like tokens (preserves newlines / whitespace structure)
  const words = text.split(/(\s+)/);

  const chunks = [];
  let current = '';
  let currentLen = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current += word;
    currentLen += word.length;

    if (currentLen >= targetChars) {
      chunks.push(current.trim());

      // Roll back by overlapChars to create the overlap window
      let rollback = 0;
      let j = i;
      while (j >= 0 && rollback < overlapChars) {
        rollback += words[j].length;
        j--;
      }

      // Rebuild 'current' from the overlap window position
      current = words.slice(j + 1, i + 1).join('');
      currentLen = current.length;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

module.exports = { chunkText };
