import { AIRCRAFT_LAYER_TITLE } from './adsb-lol-config.js';

function cleanText(text) {
  return String(text || '').trim().replace(/[.?!]+$/g, '').trim();
}

const SHOW_PATTERNS = [
  /^show\s+live\s+aircraft$/i,
  /^show\s+aircraft\s+over\s+montreal$/i,
  /^show\s+planes\s+over\s+montreal$/i,
  /^show\s+helicopters\s+over\s+montreal$/i,
  /^show\s+aircraft$/i
];

/**
 * @param {string} normalized
 */
export function matchShowLiveAircraftIntent(normalized) {
  const text = cleanText(normalized);
  if (!text) return null;
  for (const pattern of SHOW_PATTERNS) {
    if (pattern.test(text)) {
      return { phrase: AIRCRAFT_LAYER_TITLE, action: 'SHOW_LAYER' };
    }
  }
  return null;
}

/**
 * @param {string} normalized
 */
export function matchAircraftLiveIntent(normalized) {
  return matchShowLiveAircraftIntent(normalized);
}
