import { CLARIFICATION } from './spatial-language-pack.js';

const CONTEXT_PATTERNS = [
  /^this address$/i,
  /^same address$/i,
  /^there$/i,
  /^same location$/i,
  /^previous location$/i,
  /^cette adresse$/i,
  /^même adresse$/i,
  /^meme adresse$/i,
  /^même lieu$/i,
  /^meme lieu$/i,
  /^cet endroit$/i,
  /^ici$/i
];

const NOW_PREFIX = /^(?:now|then|maintenant|puis)\s+/i;

/**
 * @param {string} locationText
 * @param {{ previousLocationText?: string, previousMatchedAddress?: string }} context
 */
export function resolveLocationText(locationText, context = {}) {
  const text = String(locationText || '').trim();
  if (!text) return null;

  const stripped = text.replace(NOW_PREFIX, '').trim();
  const isContextRef = CONTEXT_PATTERNS.some((p) => p.test(stripped))
    || CONTEXT_PATTERNS.some((p) => p.test(text));

  if (isContextRef) {
    if (context.previousLocationText) return context.previousLocationText;
    if (context.previousMatchedAddress) return context.previousMatchedAddress;
    return { error: CLARIFICATION.noPreviousLocation };
  }

  return stripped || text;
}

export function extractContextLocation(origin) {
  if (!origin) return null;
  return origin.locationText || origin.matchedAddress || null;
}
