/**
 * Single-clause trailing visibility syntax — normalize into leading verb paths.
 * Mixed trailing clauses (turn Traffic on and Cameras off) are intentionally excluded.
 */

const PRONOUN_PHRASE = /^(?:them|those(?:\s+layers)?|both|it)$/i;
const ALL_LAYER_PHRASE = /^(?:all layers|layers|everything|all)$/i;

/**
 * Detect mixed trailing ON/OFF clauses that must not be whole-string normalized.
 * @param {string} text
 */
export function isMixedTrailingVisibilityClause(text) {
  const normalized = String(text || '').trim();
  if (!/(?:,\s*|\s+and\s+)/i.test(normalized)) return false;

  const parts = normalized.split(/(?:,\s*|\s+and\s+)/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;

  let trailingOn = 0;
  let trailingOff = 0;
  for (const part of parts) {
    if (/\bback\s+on$/i.test(part)) continue;
    if (/\s+on$/i.test(part)) trailingOn += 1;
    if (/\s+off$/i.test(part)) trailingOff += 1;
  }
  return trailingOn > 0 && trailingOff > 0;
}

/**
 * Whether trailing phrase is a reference or all-layer token — not a source layer name.
 * @param {string} phrase
 */
export function isExcludedTrailingVisibilityPhrase(phrase) {
  const text = String(phrase || '').trim();
  if (!text) return true;
  if (PRONOUN_PHRASE.test(text)) return true;
  if (ALL_LAYER_PHRASE.test(text)) return true;
  return false;
}

/**
 * Extract trailing turn <layer phrase> on/off for single-clause visibility routing.
 * @param {string} normalized
 * @returns {null | { operation: 'SHOW' | 'HIDE', phrase: string }}
 */
export function extractTrailingVisibilityPhrase(normalized) {
  const text = String(normalized || '').trim();
  if (!text) return null;

  if (/^turn\s+.+\s+back\s+on$/i.test(text)) return null;
  if (isMixedTrailingVisibilityClause(text)) return null;

  let match = text.match(/^turn\s+(.+?)\s+off$/i);
  if (match) {
    const phrase = match[1].trim();
    if (isExcludedTrailingVisibilityPhrase(phrase)) return null;
    return { operation: 'HIDE', phrase };
  }

  match = text.match(/^turn\s+(.+?)\s+on$/i);
  if (match) {
    const phrase = match[1].trim();
    if (isExcludedTrailingVisibilityPhrase(phrase)) return null;
    return { operation: 'SHOW', phrase };
  }

  return null;
}

/**
 * Parse trailing visibility from a single clause segment (leading or bare trailing).
 * @param {string} clause
 * @returns {null | { operation: 'SHOW_LAYERS' | 'HIDE_LAYERS', layerPhrase: string }}
 */
export function parseTrailingVisibilityClause(clause) {
  const text = String(clause || '').trim();
  if (!text) return null;
  if (/^turn\s+.+\s+back\s+on$/i.test(text)) return null;

  let match = text.match(/^turn\s+(.+?)\s+off$/i);
  if (match) {
    const phrase = match[1].trim();
    if (isExcludedTrailingVisibilityPhrase(phrase)) return null;
    return { operation: 'HIDE_LAYERS', layerPhrase: phrase };
  }

  match = text.match(/^turn\s+(.+?)\s+on$/i);
  if (match) {
    const phrase = match[1].trim();
    if (isExcludedTrailingVisibilityPhrase(phrase)) return null;
    return { operation: 'SHOW_LAYERS', layerPhrase: phrase };
  }

  match = text.match(/^(.+?)\s+off$/i);
  if (match) {
    const phrase = match[1].trim();
    if (isExcludedTrailingVisibilityPhrase(phrase)) return null;
    if (/^(?:hide|turn|show|display|enable|disable|switch|remove)\b/i.test(phrase)) return null;
    return { operation: 'HIDE_LAYERS', layerPhrase: phrase };
  }

  match = text.match(/^(.+?)\s+on$/i);
  if (match) {
    const phrase = match[1].trim();
    if (isExcludedTrailingVisibilityPhrase(phrase)) return null;
    if (/^(?:hide|turn|show|display|enable|disable|switch|remove)\b/i.test(phrase)) return null;
    return { operation: 'SHOW_LAYERS', layerPhrase: phrase };
  }

  return null;
}

/**
 * Rewrite trailing visibility to leading form for reuse of existing matchers.
 * @param {string} normalized
 */
export function normalizeTrailingVisibilityToLeading(normalized) {
  const trailing = extractTrailingVisibilityPhrase(normalized);
  if (!trailing) return null;
  if (trailing.operation === 'HIDE') return `turn off ${trailing.phrase}`;
  return `turn on ${trailing.phrase}`;
}
