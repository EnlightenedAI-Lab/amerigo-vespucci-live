/**
 * Universal IQAI Spatial capability router — classification foundation.
 */
import {
  parseIntelligenceMapIntent,
  classifyIntelligenceConceptId,
  hasIntelligenceResearchSemantics
} from './intelligence-layer-intent.js';
import { isProgressiveVerticalSliceQuery } from './orchestrator/progressive-slice-intent.js';
import { isCrossAgentSpatialQuery } from './orchestrator/cross-agent-slice-intent.js';
import { isPlacePoiV1Enabled } from './place-poi-config.js';

export const SPATIAL_CAPABILITY = Object.freeze({
  DETERMINISTIC_GIS: 'DETERMINISTIC_GIS',
  INTELLIGENCE_RESEARCH: 'INTELLIGENCE_RESEARCH',
  CROSS_AGENT_SPATIAL: 'CROSS_AGENT_SPATIAL',
  ARCGIS_DATA_DISCOVERY: 'ARCGIS_DATA_DISCOVERY',
  PLACE_POI_SEARCH: 'PLACE_POI_SEARCH',
  POINT_INTELLIGENCE: 'POINT_INTELLIGENCE',
  ROUTING: 'ROUTING',
  PERIMETER_ANALYSIS: 'PERIMETER_ANALYSIS',
  STREET_LEVEL_CONTEXT: 'STREET_LEVEL_CONTEXT',
  GENERAL_SPATIAL_ANALYSIS: 'GENERAL_SPATIAL_ANALYSIS'
});

const DETERMINISTIC_CONTROL_PATTERNS = [
  /^clear\s+map$/i,
  /^clear(?:\s+the)?(?:\s+results?)?$/i,
  /^reset\s+map$/i,
  /^remove(?:\s+the)?\s+results?$/i
];

const PLACE_POI_ENTITY_PATTERNS = [
  /\bstarbucks\b/i,
  /\bcoffee shops?\b/i,
  /\brestaurants?\b/i,
  /\bpharmacies\b/i,
  /\bgas stations?\b/i,
  /\bshow all\b/i,
  /\bfind all\b/i,
  /\blist all\b/i
];

const PLACE_POI_LOCATION_PATTERNS = [
  /^(?:map|show|find)\b.+\b(near|around)\b/i,
  /\b(near|around)\s+\d+/i
];

const ROUTING_PATTERNS = [
  /\bfastest route\b/i,
  /\bdirections to\b/i,
  /\bnavigate to\b/i,
  /\broute to\b/i,
  /\bhow do i get to\b/i
];

const PERIMETER_PATTERNS = [
  /\bwithin\s+\d+\s*(m|meters|metres|km)\b/i,
  /\bperimeter\b/i,
  /\bbuffer\b/i,
  /\beverything within\b/i
];

const STREET_LEVEL_PATTERNS = [
  /\bstreet[- ]level\b/i,
  /\bstreet view\b/i,
  /\b360\b/i,
  /\bpanorama\b/i
];

const ARCGIS_DISCOVERY_PATTERNS = [
  /\bwildfire layer\b/i,
  /\bliving atlas\b/i,
  /\bauthoritative\s+arcgis\s+layer\b/i,
  /\bauthoritative\b.+\blayer\b/i,
  /\barcgis\s+layer\b/i,
  /\bborough\s+boundaries?\b/i,
  /\bfind\b.+\blayer\b.+\badd\b/i,
  /\bfind an?\b.+\blayer\b/i,
  /\badd\b.+\blayer\b/i,
  /\badd arcgis\b/i
];

const POINT_INTEL_PATTERNS = [
  /\bwhat(?:'s| is) happening at this\b/i,
  /\bselected location\b/i,
  /\bthis location\b/i,
  /\bwhat do we know about this point\b/i,
  /\bwhy\b.+\b(on the map|this event|this incident)\b/i,
  /\bwhy\b.+\bevent\b/i
];

const DETERMINISTIC_DATASET_PATTERNS = [
  /\b(fire stations?|police stations?|schools?|hospitals?|stations?)\b/i
];

/**
 * @param {string} text
 */
export function isDeterministicMapControl(text = '') {
  return DETERMINISTIC_CONTROL_PATTERNS.some((pattern) => pattern.test(String(text).trim()));
}

/**
 * @param {string} text
 */
export function isPlacePoiObjective(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (hasIntelligenceResearchSemantics(raw)) return false;
  if (isArcgisDataDiscoveryObjective(raw)) return false;
  if (DETERMINISTIC_DATASET_PATTERNS.some((pattern) => pattern.test(raw))
    && /\b(within|nearest)\b/i.test(raw)) {
    return false;
  }
  if (PLACE_POI_ENTITY_PATTERNS.some((pattern) => pattern.test(raw))) return true;
  if (PLACE_POI_LOCATION_PATTERNS.some((pattern) => pattern.test(raw))
    && !/\b(layer|arcgis|living atlas|authoritative)\b/i.test(raw)) {
    return true;
  }
  return false;
}

/**
 * @param {string} text
 */
export function isArcgisDataDiscoveryObjective(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return ARCGIS_DISCOVERY_PATTERNS.some((pattern) => pattern.test(raw))
    || (/\b(arcgis|living atlas)\b/i.test(raw) && /\blayer\b/i.test(raw))
    || (/\bauthoritative\b/i.test(raw) && /\blayer\b/i.test(raw));
}

/**
 * @param {string} userRequest
 * @param {object} [context]
 */
export function planSpatialCapability(userRequest, context = {}) {
  const text = String(userRequest || '').trim();
  if (!text) {
    return {
      capability: null,
      confidence: 0,
      parsedIntent: null,
      requiredInputs: [],
      executionAuthority: null,
      available: false,
      clarificationNeeded: 'EMPTY_REQUEST'
    };
  }

  if (isDeterministicMapControl(text)) {
    return {
      capability: SPATIAL_CAPABILITY.DETERMINISTIC_GIS,
      confidence: 0.98,
      parsedIntent: { sourceText: text, operation: 'CLEAR' },
      requiredInputs: ['prompt'],
      executionAuthority: 'MAP_COMMAND',
      available: true,
      clarificationNeeded: null
    };
  }

  if (isPlacePoiObjective(text)) {
    const enabled = isPlacePoiV1Enabled();
    return {
      capability: SPATIAL_CAPABILITY.PLACE_POI_SEARCH,
      confidence: 0.9,
      parsedIntent: { sourceText: text },
      requiredInputs: ['placeQuery', 'geography'],
      executionAuthority: enabled ? 'PLACE_POI_SERVICE' : null,
      available: enabled,
      clarificationNeeded: enabled ? null : 'CAPABILITY_NOT_YET_AVAILABLE',
      message: enabled
        ? null
        : 'Place / POI search is recognized but not yet available in IQAI Spatial V1.'
    };
  }

  if (isArcgisDataDiscoveryObjective(text)) {
    return {
      capability: SPATIAL_CAPABILITY.ARCGIS_DATA_DISCOVERY,
      confidence: 0.92,
      parsedIntent: { sourceText: text },
      requiredInputs: ['layerQuery'],
      executionAuthority: 'ARCGIS_DATA_ADD',
      available: true,
      clarificationNeeded: null
    };
  }

  if (POINT_INTEL_PATTERNS.some((pattern) => pattern.test(text)) || context.selectedLocation) {
    return {
      capability: SPATIAL_CAPABILITY.POINT_INTELLIGENCE,
      confidence: 0.86,
      parsedIntent: { sourceText: text },
      requiredInputs: ['geometry'],
      executionAuthority: 'POINT_INTELLIGENCE_SERVICE',
      available: true,
      clarificationNeeded: null
    };
  }

  if (isCrossAgentSpatialQuery(text)) {
    return {
      capability: SPATIAL_CAPABILITY.CROSS_AGENT_SPATIAL,
      confidence: 0.96,
      parsedIntent: { sourceText: text },
      requiredInputs: ['query', 'geography', 'proximityThreshold'],
      executionAuthority: 'CROSS_AGENT_SPATIAL_COORDINATOR',
      available: true,
      clarificationNeeded: null
    };
  }

  if (hasIntelligenceResearchSemantics(text) || isProgressiveVerticalSliceQuery(text)) {
    const intelligenceIntent = parseIntelligenceMapIntent(text);
    if (intelligenceIntent) {
      return {
        capability: SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH,
        confidence: 0.94,
        parsedIntent: intelligenceIntent,
        requiredInputs: ['query', 'geography', 'timeWindow'],
        executionAuthority: 'INTELLIGENCE_LAYER_SERVICE',
        available: true,
        clarificationNeeded: null
      };
    }
  }

  if (/^(map|show|display)\s+.+\bwithin\s+\d+\s*(km|m|meters|metres)\b/i.test(text)
    && DETERMINISTIC_DATASET_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      capability: SPATIAL_CAPABILITY.DETERMINISTIC_GIS,
      confidence: 0.9,
      parsedIntent: { sourceText: text },
      requiredInputs: ['prompt'],
      executionAuthority: 'MAP_COMMAND',
      available: true,
      clarificationNeeded: null
    };
  }

  if (ROUTING_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      capability: SPATIAL_CAPABILITY.ROUTING,
      confidence: 0.85,
      parsedIntent: { sourceText: text },
      requiredInputs: ['origin', 'destination'],
      executionAuthority: null,
      available: false,
      clarificationNeeded: 'CAPABILITY_NOT_YET_AVAILABLE',
      message: 'Routing is recognized but not yet available in IQAI Spatial V1.'
    };
  }

  if (PERIMETER_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      capability: SPATIAL_CAPABILITY.PERIMETER_ANALYSIS,
      confidence: 0.83,
      parsedIntent: { sourceText: text },
      requiredInputs: ['geometry', 'radiusMeters'],
      executionAuthority: null,
      available: false,
      clarificationNeeded: 'CAPABILITY_NOT_YET_AVAILABLE',
      message: 'Perimeter analysis is recognized but not yet available in IQAI Spatial V1.'
    };
  }

  if (STREET_LEVEL_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      capability: SPATIAL_CAPABILITY.STREET_LEVEL_CONTEXT,
      confidence: 0.82,
      parsedIntent: { sourceText: text },
      requiredInputs: ['geometry'],
      executionAuthority: null,
      available: false,
      clarificationNeeded: 'CAPABILITY_NOT_YET_AVAILABLE',
      message: 'Street-level context is recognized but not yet available in IQAI Spatial V1.'
    };
  }

  if (classifyIntelligenceConceptId(text)) {
    return {
      capability: SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH,
      confidence: 0.8,
      parsedIntent: parseIntelligenceMapIntent(text),
      requiredInputs: ['query', 'geography', 'timeWindow'],
      executionAuthority: 'INTELLIGENCE_LAYER_SERVICE',
      available: Boolean(parseIntelligenceMapIntent(text)),
      clarificationNeeded: parseIntelligenceMapIntent(text) ? null : 'MISSING_TEMPORAL_SCOPE',
      message: 'Intelligence research requires a time window or explicit event scope.'
    };
  }

  return {
    capability: SPATIAL_CAPABILITY.DETERMINISTIC_GIS,
    confidence: 0.7,
    parsedIntent: { sourceText: text },
    requiredInputs: ['prompt'],
    executionAuthority: 'MAP_COMMAND',
    available: true,
    clarificationNeeded: null
  };
}

/**
 * @param {object} plan
 */
export function formatCapabilityUnavailableMessage(plan) {
  return plan?.message || 'Requested capability is not yet available in IQAI Spatial V1.';
}
