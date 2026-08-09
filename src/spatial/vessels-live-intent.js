import { VESSELS_LAYER_TITLE } from './aisstream-config.js';

function cleanText(text) {
  return String(text || '').trim().replace(/[.?!]+$/g, '').trim();
}

const SHOW_PATTERNS = [
  /^show\s+live\s+vessels$/i,
  /^show\s+live\s+ships$/i,
  /^show\s+ais\s+vessels$/i,
  /^show\s+vessels\s+on\s+the\s+st\.?\s*lawrence$/i,
  /^show\s+vessels\s+on\s+the\s+saint\s+lawrence$/i
];

/**
 * @param {string} normalized
 */
export function matchShowLiveVesselsIntent(normalized) {
  const text = cleanText(normalized);
  if (!text) return null;
  for (const pattern of SHOW_PATTERNS) {
    if (pattern.test(text)) {
      return { phrase: VESSELS_LAYER_TITLE, action: 'SHOW_LAYER' };
    }
  }
  return null;
}

/**
 * @param {string} normalized
 */
export function matchVesselsLiveIntent(normalized) {
  return matchShowLiveVesselsIntent(normalized);
}
