/**
 * Browser-safe compound spatial objective intent matcher.
 */
export function isCrossAgentSpatialQuery(query = '') {
  const text = String(query).toLowerCase();
  if (!/\b(montr[eé]al|montreal|greater montreal)\b/i.test(text)) return false;
  if (!/\b(within|near|closest|proximity|fall within)\b/i.test(text)) return false;
  if (!/\b(\d+\s*km|km|kilomet(er|re)s?|(one|two|three|four|five)\s+kilomet(er|re)s?)\b/i.test(text)) return false;

  if (/\b(hospital|hospitals|hôpital|hopital)\b/i.test(text)
    && /\b(fires?|explosions?|hazmat|hazardous[-\s]?material)\b/i.test(text)) {
    return true;
  }

  if (/\b(protests?|demonstrations?|demos?)\b/i.test(text)
    && /\b(government buildings?|public buildings?|municipal buildings?|government facilities?)\b/i.test(text)) {
    return true;
  }

  return false;
}
