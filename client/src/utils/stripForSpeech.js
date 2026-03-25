import removeMd from 'remove-markdown';

/**
 * Strip markdown and other formatting that reads badly aloud.
 * Ported from Vault's useVoice.js — kept as a standalone utility so any
 * future tool can import it independently of the read-aloud hook.
 *
 * Processing order matters:
 *   1. Fenced code blocks — replace with a short spoken marker
 *   2. Inline code — strip backticks, keep inner text
 *   3. URLs — remove entirely (they are unreadable aloud)
 *   4. HTML tags — strip completely
 *   5. remove-markdown — handles headings, bold, italic, blockquotes, lists
 *   6. Collapse excess whitespace left by the removals above
 *
 * @param {string} text
 * @returns {string}
 */
export function stripForSpeech(text) {
  if (!text) return '';
  let out = text.replace(/```[\s\S]*?```/g, ' code block. ');
  out = out.replace(/`([^`]*)`/g, '$1');
  out = out.replace(/https?:\/\/\S+/gi, '');
  out = out.replace(/ftp:\/\/\S+/gi, '');
  out = out.replace(/www\.\S+/gi, '');
  out = out.replace(/<[^>]+>/g, '');
  out = removeMd(out);
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}
