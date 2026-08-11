import { getDatasetById, resolveDatasetsFromPhrase, DATASET_IDS } from './dataset-registry.js';
import { matchAmenitiesXrayIntent, buildAmenitiesXrayRequest } from './amenity-xray-intent.js';
import { resolveSemanticCategoriesFromPhrase } from './semantic-category-registry.js';
import { resolveDynamicSemanticFromVocabulary } from './dynamic-semantic-resolver.js';

export const UNSUPPORTED_OPERATION_MESSAGE = 'Unsupported deterministic MAP operation';
export const AMBIGUOUS_DATASET_MESSAGE = 'Request requires a specific verified dataset';

export function unconfiguredDatasetMessage(label) {
  return `Verified GIS source not configured: ${label}`;
}

function cleanText(text) {
  return String(text || '')
    .trim()
    .replace(/[.?!]+$/g, '')
    .trim();
}

function normalizePrompt(prompt) {
  return String(prompt || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function toRadiusMeters(value) {
  const km = parseFloat(value);
  if (!Number.isFinite(km) || km <= 0) return null;
  return Math.round(km * 1000);
}

function hasActiveFilter(text) {
  return /\b(active only|only active|active)\b/i.test(text);
}

function stripActiveFilter(text) {
  return String(text || '')
    .replace(/\b(active only|only active|active)\s+/gi, '')
    .replace(/\b(active only|only active|active)\b/gi, '')
    .trim();
}

const CLEAR_PATTERN = /^(?:clear(?:\s+the)?(?:\s+map)?|clear\s+(?:the\s+)?results?|remove(?:\s+the)?\s+results?|remove previous results|effacer|supprimer les résultats)$/i;

const LOCATE_PATTERN = /^(?:locate|map this address|put a point at|place a point at|mark|localiser|placer un point(?:\s+à)?)\s+(.+)$/i;

const COUNT_WITHIN_PATTERN = /^(?:count|how many|number of|combien|nombre de)\s+(.+?)\s+(?:within|inside|in)\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)\s+(?:of|from|de|à)\s+(.+)$/i;

const COUNT_FR_RADIUS_PATTERN = /^combien\s+(?:de\s+)?(.+?)\s+(?:dans un rayon de|à moins de|dans)\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)\s+(?:de|du|d')\s*(.+)$/i;

const NEAREST_PATTERN = /^(?:(?:show|map|display|afficher|montrer)\s+)?(?:the\s+)?(\d+)\s+(?:nearest|closest|plus proches?|les\s+\d+\s+plus proches?)\s+(.+?)\s+(?:to|near|à|de|of)\s+(.+)$/i;

const NEAREST_FR_PATTERN = /^(?:(?:afficher|montrer|map|show)\s+)?(?:les\s+)?(\d+)\s+(?:postes?|stations?|écoles?|ecoles?|hôpitaux?|hopitaux?|arrêts?|arrets?)?\s*(?:les\s+)?(\d+)\s+plus proches?\s+(?:de\s+)?(.+)$/i;

const WITHIN_PATTERN = /^(?:(?:show|map|display|afficher|montrer)\s+)?(.+?)\s+(?:within|inside|in)\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)\s+(?:of|from|de|à)\s+(.+)$/i;

const WITHIN_NEAR_PATTERN = /^(?:(?:show|map|display|afficher|montrer)\s+)?(.+?)\s+near\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)$/i;

const FR_RADIUS_PATTERN = /^(?:(?:afficher|montrer|map|show)\s+)?(.+?)\s+(?:dans un rayon de|à moins de)\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)\s+(?:de|du|d'|à)\s*(.+)$/i;

const MAP_WITHIN_PATTERN = /^map\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?)\s+(?:of|from)\s+(.+)$/i;

const SHOW_IN_MONTREAL_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(.+?)\s+in\s+montreal$/i;

const SHOW_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(.+)$/i;

const INSIDE_PATTERN = /^(?:inside|in|within boundary|à l'intérieur de|à l'intérieur|dans)\s+(.+?)\s+(?:show|map|display|afficher|montrer)?\s*(.+)$/i;

/**
 * Deterministic spatial intent parser — no LLM.
 * @param {string} prompt
 * @param {{ vocabularyContext?: object[] }} [options]
 */
export function parseSpatialIntent(prompt, options = {}) {
  const raw = String(prompt || '').trim();
  if (!raw) {
    return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
  }

  const normalized = normalizePrompt(raw);

  if (CLEAR_PATTERN.test(normalized)) {
    return {
      supported: true,
      request: {
        action: 'CLEAR'
      }
    };
  }

  const locateMatch = normalized.match(LOCATE_PATTERN);
  if (locateMatch) {
    return {
      supported: true,
      request: {
        action: 'LOCATE',
        locationText: cleanText(locateMatch[1]),
        datasetIds: []
      }
    };
  }

  const insideMatch = normalized.match(INSIDE_PATTERN);
  if (insideMatch) {
    return {
      supported: false,
      message: 'Boundary dataset not configured for INSIDE operations.'
    };
  }

  if (/predict|tomorrow|crime will happen|important places nearby/i.test(normalized)) {
    return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
  }

  if (/important places|nearby$/i.test(normalized) && !resolveDatasetsFromPhrase(normalized).datasets.length) {
    return { supported: false, message: AMBIGUOUS_DATASET_MESSAGE };
  }

  const amenitiesMatch = matchAmenitiesXrayIntent(normalized);
  if (amenitiesMatch) {
    const xray = buildAmenitiesXrayRequest(amenitiesMatch);
    if (xray) return xray;
  }

  let action = null;
  let datasetPhrase = null;
  let locationText = null;
  let radiusMeters = null;
  let limit = null;
  let activeOnly = hasActiveFilter(normalized);

  const countMatch = normalized.match(COUNT_WITHIN_PATTERN)
    || normalized.match(COUNT_FR_RADIUS_PATTERN);
  if (countMatch) {
    action = 'COUNT';
    datasetPhrase = stripActiveFilter(countMatch[1]);
    radiusMeters = toRadiusMeters(countMatch[2]);
    locationText = cleanText(countMatch[4] || countMatch[3]);
  }

  if (!action) {
    const nearestMatch = normalized.match(NEAREST_PATTERN);
    if (nearestMatch) {
      action = 'NEAREST';
      limit = parseInt(nearestMatch[1], 10);
      datasetPhrase = stripActiveFilter(nearestMatch[2]);
      locationText = cleanText(nearestMatch[3]);
    }
  }

  if (!action) {
    const withinNear = normalized.match(WITHIN_NEAR_PATTERN);
    if (withinNear) {
      action = 'WITHIN';
      datasetPhrase = stripActiveFilter(withinNear[1]);
      locationText = cleanText(withinNear[2]);
      radiusMeters = toRadiusMeters(withinNear[3]);
    }
  }

  if (!action) {
    const mapWithin = normalized.match(MAP_WITHIN_PATTERN);
    if (mapWithin) {
      action = 'WITHIN';
      datasetPhrase = stripActiveFilter(mapWithin[1]);
      radiusMeters = toRadiusMeters(mapWithin[2]);
      locationText = cleanText(mapWithin[4]);
    }
  }

  if (!action) {
    const withinMatch = normalized.match(WITHIN_PATTERN)
      || normalized.match(FR_RADIUS_PATTERN);
    if (withinMatch) {
      action = 'WITHIN';
      datasetPhrase = stripActiveFilter(withinMatch[1]);
      radiusMeters = toRadiusMeters(withinMatch[2]);
      locationText = cleanText(withinMatch[4] || withinMatch[3]);
    }
  }

  if (!action) {
    const montrealShow = normalized.match(SHOW_IN_MONTREAL_PATTERN);
    if (montrealShow) {
      action = 'SHOW';
      datasetPhrase = stripActiveFilter(montrealShow[1]);
      locationText = 'Montreal';
    }
  }

  if (!action) {
    const showMatch = normalized.match(SHOW_PATTERN);
    if (showMatch) {
      const phrase = stripActiveFilter(showMatch[1]);
      if (/^transit\s+near\s+/i.test(phrase)) {
        return {
          supported: false,
          message: '"Near" requires a distance. Example: Show transit within 2 km of 997 de la Commune.'
        };
      }
      if (/\bnear\b/i.test(phrase) && !/\bwithin\b/i.test(phrase)) {
        return {
          supported: false,
          message: '"Near" requires a distance. Example: Show police stations within 3 km of 997 de la Commune.'
        };
      }
      action = 'SHOW';
      datasetPhrase = phrase;
    }
  }

  if (!action) {
    const nuclear = normalized.match(/(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*km\s+(?:of|from)\s+(.+)/i);
    if (nuclear) {
      const unresolved = resolveDatasetsFromPhrase(stripActiveFilter(nuclear[1]));
      if (!unresolved.datasets.length) {
        return {
          supported: false,
          message: unconfiguredDatasetMessage(stripActiveFilter(nuclear[1]))
        };
      }
    }
    return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
  }

  const resolved = resolveDatasetsFromPhrase(datasetPhrase);
  if (!resolved.datasets.length) {
    const semantic = resolveSemanticCategoriesFromPhrase(datasetPhrase);
    if (semantic.categories.length) {
      const category = semantic.categories[0];
      if (action === 'NEAREST' && (!Number.isFinite(limit) || limit <= 0)) {
        return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
      }
      if ((action === 'WITHIN' || action === 'COUNT') && (!locationText || radiusMeters == null)) {
        return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
      }
      if (action === 'NEAREST' && !locationText) {
        return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
      }
      return {
        supported: true,
        request: {
          action,
          layerSource: 'TRUSTED_EXTERNAL',
          conceptId: category.conceptId,
          sourceId: category.sourceId,
          categoryFilter: category.filter,
          semanticCategory: category,
          semanticField: category.filter?.field || category.semanticField || null,
          semanticValue: category.filter?.value || category.semanticValue || null,
          datasetIds: [],
          datasets: [],
          locationText,
          radiusMeters,
          limit,
          activeOnly,
          displayMode: action === 'COUNT' ? 'count' : 'points'
        }
      };
    }

    if (options.vocabularyContext?.length) {
      const dynamic = resolveDynamicSemanticFromVocabulary(datasetPhrase, options.vocabularyContext);
      if (dynamic?.ambiguous) {
        return {
          supported: false,
          message: `Multiple categories match: ${dynamic.candidates.join(', ')}. Please clarify.`
        };
      }
      if (dynamic?.conceptId) {
        if (action === 'NEAREST' && (!Number.isFinite(limit) || limit <= 0)) {
          return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
        }
        if ((action === 'WITHIN' || action === 'COUNT') && (!locationText || radiusMeters == null)) {
          return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
        }
        if (action === 'NEAREST' && !locationText) {
          return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
        }
        return {
          supported: true,
          request: {
            action,
            layerSource: 'TRUSTED_EXTERNAL',
            conceptId: dynamic.conceptId,
            sourceId: dynamic.sourceId,
            categoryFilter: dynamic.filter,
            semanticCategory: dynamic,
            semanticField: dynamic.semanticField,
            semanticValue: dynamic.semanticValue,
            datasetIds: [],
            datasets: [],
            locationText,
            radiusMeters,
            limit,
            activeOnly,
            displayMode: action === 'COUNT' ? 'count' : 'points'
          }
        };
      }
    }

    return {
      supported: false,
      message: unconfiguredDatasetMessage(datasetPhrase || 'unknown dataset')
    };
  }

  if (action === 'NEAREST' && (!Number.isFinite(limit) || limit <= 0)) {
    return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
  }

  if ((action === 'WITHIN' || action === 'COUNT') && (!locationText || radiusMeters == null)) {
    return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
  }

  if (action === 'NEAREST' && !locationText) {
    return { supported: false, message: UNSUPPORTED_OPERATION_MESSAGE };
  }

  return {
    supported: true,
    request: {
      action,
      datasetIds: resolved.datasets.map((d) => d.id),
      datasets: resolved.datasets,
      locationText,
      radiusMeters,
      limit,
      activeOnly,
      displayMode: action === 'COUNT' ? 'count' : 'points'
    }
  };
}

export function getDatasetMeta(datasetIds) {
  return datasetIds.map((id) => getDatasetById(id)).filter(Boolean);
}
