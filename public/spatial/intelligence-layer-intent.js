/**
 * Natural-language intelligence map intent — shared by AI MAP and layer panel.
 */
import {
  DEFAULT_GEOGRAPHY,
  TIME_WINDOWS,
  resolveTimeWindowDates,
  getConceptById,
  INTELLIGENCE_LAYER_CONCEPTS
} from './intelligence-layer-config.js';
import { isProgressiveVerticalSliceQuery } from './orchestrator/progressive-slice-intent.js';

const GEO_ALIASES = Object.freeze({
  montreal: 'Greater Montréal',
  montréal: 'Greater Montréal',
  'greater montreal': 'Greater Montréal',
  'greater montréal': 'Greater Montréal',
  quebec: 'Québec',
  québec: 'Québec',
  canada: 'Canada'
});

const TIME_PATTERNS = [
  { re: /last\s+24\s+hours?/i, window: TIME_WINDOWS.HOURS_24 },
  { re: /last\s+48\s+hours?/i, window: TIME_WINDOWS.HOURS_24 },
  { re: /last\s+7\s+days?/i, window: TIME_WINDOWS.DAYS_7 },
  { re: /last\s+30\s+days?/i, window: TIME_WINDOWS.DAYS_30 },
  { re: /this\s+week/i, window: TIME_WINDOWS.DAYS_7 },
  { re: /past\s+week/i, window: TIME_WINDOWS.DAYS_7 }
];

/** Tokens too generic to classify a concept on their own. */
const GENERIC_CONCEPT_TOKENS = new Set(['incidents', 'incident', 'reported', 'disruptions']);

/**
 * Specific signals in priority order — explicit NL objective beats generic tokens.
 * @type {ReadonlyArray<{ id: string, patterns: RegExp[] }>}
 */
const CONCEPT_SIGNALS = Object.freeze([
  {
    id: 'fires',
    patterns: [
      /\bfires?\b/i,
      /\bexplosions?\b/i,
      /\bhazmat\b/i,
      /\bhazardous[-\s]?materials?\b/i,
      /\bwildfires?\b/i,
      /\bstructure\s+fires?\b/i
    ]
  },
  {
    id: 'shootings',
    patterns: [/\bshootings?\b/i, /\bfirearms?\b/i, /\bfusillades?\b/i, /\bgunshots?\b/i]
  },
  {
    id: 'kidnappings',
    patterns: [/\bkidnappings?\b/i, /\babductions?\b/i]
  },
  {
    id: 'protests',
    patterns: [/\bprotests?\b/i, /\bdemonstrations?\b/i]
  },
  {
    id: 'traffic',
    patterns: [/\btraffic\b/i, /\baccidents?\b/i, /\bcollisions?\b/i]
  },
  {
    id: 'infrastructure',
    patterns: [/\binfrastructure\b/i, /\boutages?\b/i]
  },
  {
    id: 'severe-weather',
    patterns: [/\bsevere\s+weather\b/i, /\bstorms?\b/i, /\bflooding\b/i]
  },
  {
    id: 'crime',
    patterns: [/\bcrime\b/i, /\brobberies\b/i]
  }
]);

/**
 * @param {string} token
 * @param {string} text
 */
function tokenMatchesConcept(text, token) {
  if (!token || GENERIC_CONCEPT_TOKENS.has(token)) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * @param {string} text
 */
export function classifyIntelligenceConceptId(text = '') {
  const raw = String(text).trim();
  if (!raw) return null;

  if (/\bfire\s+stations?\b/i.test(raw)
    && !/\b(reported|incidents?|explosions?|hazmat|wildfires?|structure\s+fires?)\b/i.test(raw)) {
    return null;
  }

  for (const entry of CONCEPT_SIGNALS) {
    if (entry.patterns.some((pattern) => pattern.test(raw))) {
      return entry.id;
    }
  }

  const lower = raw.toLowerCase();
  for (const concept of INTELLIGENCE_LAYER_CONCEPTS) {
    const labelPart = concept.label.toLowerCase().split('/')[0].trim();
    if (labelPart.length > 3 && lower.includes(labelPart)) {
      return concept.id;
    }
    const tokens = concept.query.split(/\s+/);
    if (tokens.some((token) => tokenMatchesConcept(raw, token))) {
      return concept.id;
    }
  }

  return null;
}

/**
 * @param {string} raw
 * @param {string|null} conceptId
 */
function resolveQueryForConcept(raw, conceptId) {
  const concept = conceptId ? getConceptById(conceptId) : null;
  const topical = raw
    .replace(/^(?:find|map|show|display|research)\s+/i, '')
    .replace(/\s+(?:in|around|near|across|throughout|during|over)\s+.+$/i, '')
    .replace(/\s+and\s+map\s+them\.?$/i, '')
    .replace(/\s+in\s+the\s+last\s+\d+\s+days?.*$/i, '')
    .trim();

  if (topical.length >= 8) return topical;
  return concept?.query || topical || null;
}

/**
 * @param {string} text
 */
export function hasIntelligenceResearchSemantics(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (isProgressiveVerticalSliceQuery(raw)) return true;
  if (classifyIntelligenceConceptId(raw)) return true;

  const hasTemporal = TIME_PATTERNS.some((pattern) => pattern.re.test(raw));
  const hasEventLanguage = /\b(reported|incidents?|significant|explosions?|hazmat)\b/i.test(raw);
  if (hasTemporal && hasEventLanguage) return true;

  if (hasTemporal && /\b(map|show|find)\b/i.test(raw)
    && /\b(fires?|shootings?|protests?|kidnappings?|crime|robberies|traffic|hazmat)\b/i.test(raw)) {
    return true;
  }

  return false;
}

/**
 * @param {string} text
 */
export function parseIntelligenceMapIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (/\bwithin\s+\d+\s*(km|m|meters|metres)\b/i.test(raw)) return null;
  if (/\b(fire stations?|police stations?|schools?|hospitals?|nearest)\b/i.test(raw)
    && !/\b(reported|incidents?|shootings?|kidnappings?|protests?)\b/i.test(raw)) {
    return null;
  }

  const looksLikeIntel = /^(map|show|display|research|find)\s+/i.test(raw)
    || /\b(reported|incidents?|shootings?|fires?|protests?|kidnappings?|robberies|explosions?|hazmat)\b/i.test(raw);
  if (!looksLikeIntel) return null;

  const conceptId = classifyIntelligenceConceptId(raw);
  let query = conceptId ? resolveQueryForConcept(raw, conceptId) : null;

  const freeMatch = raw.match(/^(?:map|show|display|research|find)\s+(.+?)(?:\s+(?:reported|in|around|near|across|throughout)\s+)/i);
  if (!query && freeMatch) {
    query = freeMatch[1].replace(/\b(in|around|near|during|over)\b.*$/i, '').trim();
  }
  if (!query) {
    const generic = raw.match(/^(?:map|show|display|research|find)\s+(.+)/i);
    query = generic?.[1]?.trim() || null;
  }
  if (!query) return null;
  if (!hasIntelligenceResearchSemantics(raw)) return null;

  let geography = DEFAULT_GEOGRAPHY;
  for (const [alias, label] of Object.entries(GEO_ALIASES)) {
    if (lower.includes(alias)) {
      geography = label;
      break;
    }
  }

  let timeWindow = TIME_WINDOWS.DAYS_7;
  for (const pattern of TIME_PATTERNS) {
    if (pattern.re.test(raw)) {
      timeWindow = pattern.window;
      break;
    }
  }

  const dates = resolveTimeWindowDates(timeWindow);
  return {
    action: 'CREATE_INTELLIGENCE_LAYER',
    query,
    conceptId,
    geography,
    from: dates.from,
    to: dates.to,
    timeWindow,
    timeLabel: dates.label,
    temporalField: 'OCCURRED',
    includeLive: true,
    sourceText: raw
  };
}

/**
 * @param {object} input
 */
export function buildIntelligenceRequestFromIntent(input = {}) {
  const dates = input.from && input.to
    ? { from: input.from, to: input.to, label: input.timeLabel || 'Custom range' }
    : resolveTimeWindowDates(input.timeWindow || TIME_WINDOWS.DAYS_7);

  const concept = input.conceptId ? getConceptById(input.conceptId) : null;
  const query = input.query || concept?.query;
  if (!query) throw new Error('Intelligence query is required.');

  return {
    action: 'CREATE_INTELLIGENCE_LAYER',
    query,
    conceptId: input.conceptId || concept?.id || null,
    conceptLabel: concept?.label || input.conceptLabel || query,
    geography: input.geography || DEFAULT_GEOGRAPHY,
    from: dates.from,
    to: dates.to,
    timeWindow: input.timeWindow || TIME_WINDOWS.DAYS_7,
    timeLabel: input.timeLabel || dates.label,
    temporalField: input.temporalField || 'OCCURRED',
    includeLive: input.includeLive !== false,
    sourceText: input.sourceText || null
  };
}
