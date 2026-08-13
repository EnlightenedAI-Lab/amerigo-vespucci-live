/**
 * Deterministic language gateway — normalizes imperfect utterances before GIS parsing.
 * Does not execute GIS; produces canonical text for interpreters and readouts.
 */

import {
  loadLanguagePack,
  normalizePrompt,
  normalizeForMatch,
  normalizeNumerals,
  stripFillerWords,
  CLARIFICATION
} from './spatial-language-pack.js';
import { getDatasetById } from './dataset-registry.js';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FRENCH_RAYON_PLACEHOLDER = '__DANS_UN_RAYON_DE__';

const AMENITY_PLURAL_READOUT = {
  pharmacy: 'pharmacies',
  hospital: 'hospitals',
  school: 'schools',
  fire_station: 'fire stations',
  police: 'police stations'
};

/**
 * Protect French radius phrase from numeral normalization (un rayon → 1 rayon).
 * @param {string} text
 */
function protectFrenchRadiusPhrase(text) {
  return String(text || '').replace(/\bdans un rayon de\b/gi, FRENCH_RAYON_PLACEHOLDER);
}

function restoreFrenchRadiusPhrase(text) {
  return String(text || '').replace(new RegExp(FRENCH_RAYON_PLACEHOLDER, 'gi'), 'dans un rayon de');
}

/**
 * Normalize French location articles before spatial parsing (du 997 → de 997).
 * @param {string} text
 */
export function normalizeFrenchLocationArticles(text) {
  return String(text || '')
    .replace(/\bdu\s+(?=\d)/gi, 'de ')
    .replace(/\bprès du\s+(?=\d)/gi, 'près de ');
}

/**
 * Normalize unit spacing and synonyms: 1km → 1 km, 3 kilometres → 3 km.
 * @param {string} text
 */
export function normalizeSpatialUnits(text) {
  let result = String(text || '');
  result = result.replace(
    /\b(\d+(?:\.\d+)?)\s*(kms?|kilometres?|kilometers?)\b/gi,
    '$1 km'
  );
  result = result.replace(/\b(\d+(?:\.\d+)?)km\b/gi, '$1 km');
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Strip leading conversational command prefixes (phrase classes from filler pack).
 * @param {string} text
 */
export function stripLeadingCommandPhrases(text) {
  const pack = loadLanguagePack();
  const prefixes = [
    ...(pack.filler?.en || []),
    ...(pack.filler?.fr || []),
    'can you',
    'could you',
    'please',
    'i want to',
    'i need to',
    'i would like to',
    'would you',
    'help me',
    'help me to',
    'tell me',
    'tell us',
    'just'
  ].sort((a, b) => b.length - a.length);

  let result = String(text || '').trim();
  for (const prefix of prefixes) {
    const re = new RegExp(`^${escapeRegex(prefix)}\\s+`, 'i');
    if (re.test(result)) {
      result = result.replace(re, '').trim();
      break;
    }
  }
  result = result.replace(/^les\s+/i, '').trim();
  result = result.replace(/^la\s+/i, '').trim();
  return result;
}

/**
 * Remove natural grammatical noise before spatial relation tokens.
 * @param {string} text
 */
export function removeGrammaticalNoiseBeforeSpatial(text) {
  let result = String(text || '').trim();
  const spatialTokens = [
    'within',
    'inside',
    'in',
    'near',
    'around',
    'autour de',
    'près de',
    'dans un rayon de',
    'à moins de'
  ].join('|');
  const noisePattern = new RegExp(
    `\\b(?:are|that are|which are|who are|that is|which is)\\s+(?=${spatialTokens})`,
    'gi'
  );
  result = result.replace(noisePattern, '');
  result = result.replace(/\b(?:are|that are|which are)\s+(near|around|près de|autour de)\b/gi, '$1');
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize metre-based radius phrasing to canonical km within form.
 * @param {string} text
 */
export function normalizeMeterRadiusPhrases(text) {
  let result = String(text || '').trim();

  result = result.replace(
    /\b(show|map|display|find|locate)\s+(.+?)\s+less than\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:around|near|of)\s+(.+)$/i,
    (_, verb, dataset, meters, location) => {
      const km = parseFloat(meters) / 1000;
      return `${verb} ${dataset.trim()} within ${km} km of ${location.trim()}`;
    }
  );

  result = result.replace(
    /\bwithin\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:of|from)\s+/gi,
    (_, meters) => `within ${parseFloat(meters) / 1000} km of `
  );

  result = result.replace(
    /\bless than\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:around|near|of)\s+(.+)$/i,
    (_, meters, location) => `within ${parseFloat(meters) / 1000} km of ${location.trim()}`
  );

  result = result.replace(
    /\b(show|map|display|find|locate)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:from|of|around|near)\s+(.+)$/i,
    (_, verb, dataset, meters, location) => {
      const km = parseFloat(meters) / 1000;
      return `${verb} ${dataset.trim()} within ${km} km of ${location.trim()}`;
    }
  );

  result = result.replace(
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:from|of)\s+(.+)$/i,
    (_, dataset, meters, location) => {
      const km = parseFloat(meters) / 1000;
      return `${dataset.trim()} within ${km} km of ${location.trim()}`;
    }
  );

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Default an uncounted nearest/closest request to limit 1.
 * @param {string} text
 */
export function normalizeNearestWithoutCount(text) {
  return String(text || '')
    .replace(
      /^(?:(show|map|display|find|locate)\s+)?(?:the\s+)?(?:nearest|closest)\s+(.+?)\s+(?:to|of|near)\s+(.+)$/i,
      (_, verb, dataset, location) => {
        const prefix = verb ? `${verb} ` : '';
        return `${prefix}1 nearest ${dataset.trim()} to ${location.trim()}`;
      }
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize broad amenity discovery phrasing to CATEGORY_COUNTS_WITHIN canonical form.
 * @param {string} text
 */
export function normalizeBroadAmenityDiscovery(text) {
  let result = String(text || '').trim();

  const kindsWithin = result.match(
    /^what kinds? of amenities(?: are)? within (\d+(?:\.\d+)?)\s*km (?:of|from) (.+)$/i
  );
  if (kindsWithin) {
    return `what amenities exist within ${kindsWithin[1]} km of ${kindsWithin[2].trim()}`;
  }

  const nearWithin = result.match(
    /^what(?: kinds? of)? amenities (?:are )?(?:near|around) (.+?) within (\d+(?:\.\d+)?)\s*km$/i
  );
  if (nearWithin) {
    return `what amenities exist within ${nearWithin[2]} km of ${nearWithin[1].trim()}`;
  }

  return result;
}

/**
 * Reorder common malformed spatial clause orderings to canonical within form.
 * @param {string} text
 */
export function reorderSpatialClauses(text) {
  let result = String(text || '').trim();

  const aroundBeforeWithin = result.match(
    /^(.+?)\s+(?:around|near|près de|autour de)\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*km$/i
  );
  if (aroundBeforeWithin) {
    return `${aroundBeforeWithin[1].trim()} within ${aroundBeforeWithin[3]} km of ${aroundBeforeWithin[2].trim()}`;
  }

  const whereAreNear = result.match(
    /^where\s+are\s+(.+?)\s+(?:near|around|près de)\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*km$/i
  );
  if (whereAreNear) {
    return `${whereAreNear[1].trim()} within ${whereAreNear[3]} km of ${whereAreNear[2].trim()}`;
  }

  const whatAreWithin = result.match(
    /^what\s+are\s+(.+?)\s+(?:near|around|within)\s+(\d+(?:\.\d+)?)\s*km\s+(?:of|from|de)\s+(.+)$/i
  );
  if (whatAreWithin) {
    return `${whatAreWithin[1].trim()} within ${whatAreWithin[2]} km of ${whatAreWithin[3].trim()}`;
  }

  return result;
}

/**
 * Detect materially ambiguous utterances that must not execute confidently.
 * @param {string} normalized
 */
export function detectMaterialAmbiguity(normalized) {
  const text = String(normalized || '').trim();
  if (!text) return null;

  if (/\b(?:those things|these things|that stuff|those ones)\b/i.test(text)) {
    return 'Please specify a verified dataset or layer, for example pharmacies or fire stations.';
  }

  const multiEntity = text.match(
    /^(?:show|map|display|find|locate|where are|what are)\s+(.+)$/i
  );
  if (multiEntity) {
    const body = multiEntity[1];
    const verifiedPairs = [
      ['hospital', 'pharmacy'],
      ['hospitals', 'pharmacy'],
      ['hospital', 'pharmacies'],
      ['hospitals', 'pharmacies'],
      ['police', 'fire'],
      ['school', 'hospital']
    ];
    const norm = normalizeForMatch(body);
    for (const [a, b] of verifiedPairs) {
      if (norm.includes(a) && norm.includes(b) && !/\band\b|\bet\b|,/.test(norm)) {
        const pluralize = (word) => {
          if (word === 'pharmacy') return 'pharmacies';
          if (word.endsWith('s')) return word;
          return `${word}s`;
        };
        return `Did you mean: Show ${pluralize(a)} and ${pluralize(b)} with a distance and location? Please clarify.`;
      }
    }
    if (/\baround\s+commune\s+\d\b/i.test(body) || /\bcommune\s+\d\b/i.test(body) && !/\bkm\b/i.test(body)) {
      return 'Please specify a distance in km, for example: Show pharmacies within 3 km of 997 de la Commune.';
    }
  }

  return null;
}

/**
 * Full gateway normalization pipeline.
 * @param {string} prompt
 */
export function normalizeSpatialUtterance(prompt) {
  const raw = normalizePrompt(prompt);
  if (!raw) {
    return {
      raw: '',
      normalized: '',
      wasRewritten: false,
      ambiguity: CLARIFICATION.specifyWhat
    };
  }

  let normalized = normalizeSpatialUnits(raw);
  normalized = stripFillerWords(normalized) || normalized;
  normalized = stripLeadingCommandPhrases(normalized);
  normalized = removeGrammaticalNoiseBeforeSpatial(normalized);
  normalized = reorderSpatialClauses(normalized);
  normalized = normalizeMeterRadiusPhrases(normalized);
  normalized = normalizeNearestWithoutCount(normalized);
  normalized = normalizeBroadAmenityDiscovery(normalized);
  normalized = protectFrenchRadiusPhrase(normalized);
  normalized = normalizeNumerals(normalized);
  normalized = restoreFrenchRadiusPhrase(normalized);
  normalized = normalizeFrenchLocationArticles(normalized);
  normalized = normalizeSpatialUnits(normalized);

  const ambiguity = detectMaterialAmbiguity(normalized);
  const wasRewritten = normalizeForMatch(normalized) !== normalizeForMatch(raw);

  return {
    raw,
    normalized,
    wasRewritten,
    ambiguity
  };
}

/**
 * Build concise UNDERSTOOD readout from interpreted plan.
 * @param {object} result
 */
export function formatCanonicalUtterance(result) {
  if (!result?.supported) {
    if (result?.clarification && result?.message) return result.message;
    return null;
  }

  const commands = result.commands || result.plan?.commands || [];
  if (!commands.length) return null;

  const cmd = commands[0];
  const loc = cmd.resolvedLocation || cmd.location || result.sharedLocation || null;

  const datasetLabel = (() => {
    const amenityValue = cmd.semanticCategory?.semanticValue || cmd.semanticValue;
    if (amenityValue && AMENITY_PLURAL_READOUT[amenityValue]) {
      return AMENITY_PLURAL_READOUT[amenityValue];
    }
    if (cmd.semanticCategory?.pluralLabel) return cmd.semanticCategory.pluralLabel;
    if (cmd.semanticCategory?.displayName) return cmd.semanticCategory.displayName;
    if (cmd.webmapLayer?.title) return cmd.webmapLayer.title;
    if (cmd.datasetIds?.length) {
      const labels = cmd.datasetIds
        .map((id) => getDatasetById(id)?.pluralLabel || getDatasetById(id)?.displayName)
        .filter(Boolean);
      if (labels.length) return labels.join(' and ');
    }
    return null;
  })();

  if (cmd.action === 'WITHIN' && datasetLabel && loc) {
    const km = cmd.distanceKm ?? (cmd.radiusMeters ? cmd.radiusMeters / 1000 : null);
    if (km != null) return `Show ${datasetLabel} within ${km} km of ${loc}`;
  }

  if (cmd.action === 'NEAREST' && datasetLabel && loc && cmd.limit) {
    return `Show the ${cmd.limit} nearest ${datasetLabel} to ${loc}`;
  }

  if (cmd.action === 'COUNT' && datasetLabel && loc) {
    const km = cmd.distanceKm ?? (cmd.radiusMeters ? cmd.radiusMeters / 1000 : null);
    if (km != null) return `Count ${datasetLabel} within ${km} km of ${loc}`;
  }

  if (cmd.action === 'LOCATE' && loc) {
    return `Locate ${loc}`;
  }

  if (cmd.action === 'CATEGORY_COUNTS_WITHIN' && loc) {
    const km = cmd.distanceKm ?? (cmd.radiusMeters ? cmd.radiusMeters / 1000 : null);
    if (km != null) return `What amenities exist within ${km} km of ${loc}`;
  }

  return null;
}
