/**
 * Shared SHOW verb family for layer visibility routing.
 */

export const SHOW_CLAUSE_PATTERN = /^(?:turn on|show|display|enable|let me see)\s+(.+)$/i;

export const VISIBILITY_CLAUSE_BOUNDARY = /(?:,\s*|\s+and\s+)(?=\s*(?:show|turn on|display|enable|let me see|hide|turn off|disable|switch off|remove)\s)/i;

/**
 * Extract layer phrase from a leading SHOW-family verb command.
 * @param {string} normalized
 */
export function matchShowLayerPhrase(normalized) {
  const match = String(normalized || '').trim().match(SHOW_CLAUSE_PATTERN);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Whether text begins with a SHOW-family visibility verb.
 * @param {string} text
 */
export function startsWithShowVerb(text) {
  return SHOW_CLAUSE_PATTERN.test(String(text || '').trim());
}
