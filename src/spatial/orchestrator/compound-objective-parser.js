/**
 * Compound spatial objective parser — bounded multi-capability plans.
 */
import { DATASET_IDS } from '../dataset-registry.js';

export const COMPOUND_OBJECTIVE_KIND = Object.freeze({
  GOVERNED_REFERENCE_PROXIMITY: 'GOVERNED_REFERENCE_PROXIMITY'
});

export const TEMPORAL_DIRECTION = Object.freeze({
  PAST: 'PAST',
  FUTURE: 'FUTURE'
});

const WORD_NUMBERS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
});

function classifyConceptId(text = '') {
  if (/\b(fires?|explosions?|hazmat|hazardous[-\s]?material)\b/i.test(text)) return 'fires';
  if (/\b(protests?|demonstrations?|demos?)\b/i.test(text)) return 'protests';
  return null;
}

function parseThresholdMeters(text = '') {
  const km = text.match(/\b(\d+(?:\.\d+)?)\s*km\b/i);
  if (km) return Math.round(Number(km[1]) * 1000);
  const wordKm = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+kilomet(er|re)s?\b/i);
  if (wordKm) return (WORD_NUMBERS[wordKm[1].toLowerCase()] || 1) * 1000;
  const m = text.match(/\b(\d+)\s*m(?:eters|etres)?\b/i);
  if (m) return Number(m[1]);
  const wordM = text.match(/\b(one|two|three|four|five)\s+met(er|re)s?\b/i);
  if (wordM) return WORD_NUMBERS[wordM[1].toLowerCase()] || 1;
  return null;
}

function parseTemporalWindow(text = '', now = new Date()) {
  const raw = String(text);
  const future = /\b(next|upcoming|planned|during the next|in the next)\b/i.test(raw)
    || /\bplanned\b/i.test(raw);
  let days = 30;
  const dayMatch = raw.match(/\b(?:next|last|past|during the next|in the next)\s+(\d+)\s+days?\b/i);
  if (dayMatch) days = Number(dayMatch[1]);
  else if (/\b30\s+days?\b/i.test(raw)) days = 30;
  else if (/\b7\s+days?\b/i.test(raw)) days = 7;
  else if (/\bnext week\b/i.test(raw)) days = 7;
  else if (/\b(?:past|last)\s+month\b/i.test(raw)) days = 30;
  else if (/\b24\s+hours?\b/i.test(raw)) days = 1;

  if (future) {
    return {
      direction: TEMPORAL_DIRECTION.FUTURE,
      days,
      from: now.toISOString(),
      to: new Date(now.getTime() + days * 86400000).toISOString(),
      temporalField: 'OCCURRED'
    };
  }
  return {
    direction: TEMPORAL_DIRECTION.PAST,
    days,
    from: new Date(now.getTime() - days * 86400000).toISOString(),
    to: now.toISOString(),
    temporalField: 'OCCURRED'
  };
}

function hasProximityClause(text = '') {
  return /\b(within|near|closest|proximity|fall within)\b/i.test(text)
    && /\b(\d+\s*km|km|kilomet(er|re)s?|(one|two|three|four|five)\s+kilomet(er|re)s?)\b/i.test(text);
}

function hasMontrealGeography(text = '') {
  return /\b(montr[eé]al|montreal|greater montreal)\b/i.test(text);
}

/**
 * @param {string} query
 */
export function parseCompoundSpatialObjective(query = '', now = new Date()) {
  const text = String(query).trim();
  if (!text || !hasMontrealGeography(text) || !hasProximityClause(text)) return null;

  const parsedThreshold = parseThresholdMeters(text);
  const temporal = parseTemporalWindow(text, now);
  const conceptId = classifyConceptId(text);

  if (/\b(hospital|hospitals|hôpital|hopital)\b/i.test(text)
    && /\b(fires?|explosions?|hazmat|hazardous[-\s]?material)\b/i.test(text)) {
    return {
      kind: COMPOUND_OBJECTIVE_KIND.GOVERNED_REFERENCE_PROXIMITY,
      query: text,
      conceptId: conceptId || 'fires',
      geography: 'Greater Montréal',
      referenceDatasetId: DATASET_IDS.HOSPITALS,
      referenceLayerId: 'iqai-analytical-hospitals',
      referenceLabel: 'hospitals',
      thresholdMeters: parsedThreshold ?? 2000,
      temporal
    };
  }

  if (/\b(protests?|demonstrations?|demos?)\b/i.test(text)
    && /\b(government buildings?|public buildings?|municipal buildings?|government facilities?)\b/i.test(text)) {
    return {
      kind: COMPOUND_OBJECTIVE_KIND.GOVERNED_REFERENCE_PROXIMITY,
      query: text,
      conceptId: conceptId || 'protests',
      geography: 'Greater Montréal',
      referenceDatasetId: DATASET_IDS.PUBLIC_BUILDINGS,
      referenceLayerId: 'iqai-analytical-public-buildings',
      referenceLabel: 'government buildings',
      thresholdMeters: parsedThreshold ?? 1000,
      temporal
    };
  }

  return null;
}

/**
 * @param {string} query
 */
export function isCompoundSpatialObjective(query = '') {
  return parseCompoundSpatialObjective(query) != null;
}
