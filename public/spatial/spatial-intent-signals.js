/**
 * Shared spatial-signal detection for layer-vs-spatial routing precedence.
 * When true, generic layer visibility routing must defer to spatial parsing.
 * @param {string} normalized
 */
export function hasExplicitSpatialIntent(normalized) {
  const text = String(normalized || '');
  if (!text) return false;

  if (/\b(within|inside|around|nearest|closest|how many|count|number of)\b/i.test(text)) {
    return true;
  }

  if (/\b(?:in a radius of|within a radius of|radius(?:\s+of)?)\b/i.test(text)) {
    return true;
  }

  if (/\b(?:autour de|dans un rayon de|à moins de)\b/i.test(text)) {
    return true;
  }

  if (/\d+(?:\.\d+)?\s*(?:km|kilometres?|kilometers?|m|meters?|metres?)\b/i.test(text)) {
    if (/\b(?:of|à|de|from|near|to)\b/i.test(text)) {
      return true;
    }
  }

  return false;
}
