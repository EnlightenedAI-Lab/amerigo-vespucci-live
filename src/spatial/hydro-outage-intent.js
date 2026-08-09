import { HYDRO_GROUP_TITLE } from './hydro-quebec-outages-config.js';

function cleanText(text) {
  return String(text || '').trim().replace(/[.?!]+$/g, '').trim();
}

const SHOW_PATTERNS = [
  /^show\s+hydro(?:-|\s)?qu[eé]bec\s+outages?$/i,
  /^show\s+hydro\s+outages?$/i,
  /^show\s+current\s+power\s+outages?$/i,
  /^show\s+power\s+outages?$/i
];

const WITHIN_PATTERN = /^show\s+power\s+outages?\s+within\s+(\d+(?:\.\d+)?)\s*km\s+of\s+(.+)$/i;

/**
 * @param {string} normalized
 */
export function matchShowHydroOutagesIntent(normalized) {
  const text = cleanText(normalized);
  if (!text) return null;
  for (const pattern of SHOW_PATTERNS) {
    if (pattern.test(text)) {
      return { phrase: HYDRO_GROUP_TITLE, action: 'SHOW_LAYER' };
    }
  }
  return null;
}

/**
 * @param {string} normalized
 */
export function matchHydroOutagesWithinIntent(normalized) {
  const text = cleanText(normalized);
  const match = text.match(WITHIN_PATTERN);
  if (!match) return null;
  const radiusKm = Number(match[1]);
  const locationText = String(match[2] || '').trim();
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || !locationText) return null;
  return {
    phrase: HYDRO_GROUP_TITLE,
    action: 'SHOW_LAYER',
    locationText,
    radiusKm,
    radiusMeters: Math.round(radiusKm * 1000)
  };
}

/**
 * @param {string} normalized
 */
export function matchHydroOutageIntent(normalized) {
  return matchHydroOutagesWithinIntent(normalized) || matchShowHydroOutagesIntent(normalized);
}
