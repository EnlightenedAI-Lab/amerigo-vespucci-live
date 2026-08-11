/**
 * Browser-safe progressive vertical slice intent matcher.
 */
export const PROGRESSIVE_VERTICAL_SLICE_QUERY =
  'Map significant fires, explosions, or hazardous-material incidents reported in Greater Montréal during the last 30 days.';

/**
 * @param {string} query
 */
export function isProgressiveVerticalSliceQuery(query = '') {
  const text = String(query).toLowerCase();
  return /\b(fires?|explosions?|hazardous[-\s]?material|hazmat)\b/.test(text)
    && /\b(montr[eé]al|greater montreal)\b/i.test(text)
    && /\b(last\s+30\s+days|30\s+days|past\s+month)\b/i.test(text);
}
