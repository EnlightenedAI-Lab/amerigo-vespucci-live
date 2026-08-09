import { parseSpatialIntent, UNSUPPORTED_OPERATION_MESSAGE } from './mapper-intent.js';
import { loadVocabularyContextForPlanning } from './external-feature-vocabulary.js';
import { getDatasetById } from './dataset-registry.js';
import { getSemanticCategoryById } from './semantic-category-registry.js';
import {
  planCompoundPrompt,
  commandToSpatialCommand,
  resolveDatasetIdFromPhrase,
  LAYER_ONLY_ACTIONS
} from './spatial-compound-planner.js';
import { LAYER_NOT_AVAILABLE_MESSAGE } from './webmap-layer-catalog.js';
import {
  loadLanguagePack,
  normalizePrompt,
  stripFillerWords,
  CLARIFICATION,
  getLanguageExampleCount
} from './spatial-language-pack.js';
import { resolveLocationText } from './spatial-context.js';
import { proposeSemanticCandidates, isSemanticFallbackAvailable } from './spatial-semantic-fallback.js';
import {
  normalizeSpatialUtterance,
  formatCanonicalUtterance
} from './spatial-language-gateway.js';

function hasCompoundConnectors(text) {
  const pack = loadLanguagePack();
  const connectors = pack.filler?.connectors || [];
  const normalized = normalizePrompt(text).toLowerCase();
  return connectors.some((connector) => normalized.includes(connector.trim().toLowerCase()));
}

/**
 * Convert legacy single request to a spatial plan command.
 * @param {object} request
 */
function requestToCommand(request) {
  return {
    action: request.action,
    datasetIds: request.datasetIds || [],
    layerSource: request.layerSource || null,
    sourceId: request.sourceId || null,
    semanticField: request.semanticField || null,
    semanticValue: request.semanticValue || null,
    conceptId: request.conceptId || null,
    semanticCategory: request.semanticCategory || null,
    categoryFilter: request.categoryFilter || null,
    limit: request.limit || null,
    radiusMeters: request.radiusMeters || null,
    distanceKm: request.radiusMeters ? request.radiusMeters / 1000 : null,
    location: request.locationText || null,
    activeOnly: request.activeOnly || false,
    displayMode: request.displayMode || null
  };
}

/**
 * Convert spatial plan command to execution request.
 * @param {object} cmd
 * @param {string} resolvedLocation
 */
export function commandToRequest(cmd, resolvedLocation) {
  if (cmd.webmapLayer || cmd.webmapCatalogId) {
    return {
      action: cmd.action,
      layerSource: 'WEBMAP',
      webmapLayer: cmd.webmapLayer,
      webmapCatalogId: cmd.webmapCatalogId || cmd.webmapLayer?.catalogId,
      datasetIds: [],
      datasets: [],
      locationText: resolvedLocation,
      radiusMeters: cmd.radiusMeters || null,
      limit: cmd.limit || null,
      activeOnly: cmd.activeOnly || false,
      displayMode: cmd.action === 'COUNT' ? 'count' : 'points'
    };
  }

  if (cmd.layerSource === 'TRUSTED_EXTERNAL' || cmd.conceptId) {
    const category = cmd.semanticCategory || getSemanticCategoryById(cmd.conceptId);
    return {
      action: cmd.action,
      layerSource: 'TRUSTED_EXTERNAL',
      conceptId: cmd.conceptId,
      sourceId: cmd.sourceId || category?.sourceId || null,
      categoryFilter: cmd.categoryFilter || category?.filter || null,
      semanticCategory: category,
      semanticField: cmd.semanticField || category?.semanticField || category?.filter?.field || null,
      semanticValue: cmd.semanticValue || category?.semanticValue || category?.filter?.value || null,
      datasetIds: [],
      datasets: [],
      locationText: resolvedLocation,
      radiusMeters: cmd.radiusMeters || null,
      limit: cmd.limit || null,
      activeOnly: cmd.activeOnly || false,
      displayMode: cmd.displayMode || (cmd.action === 'COUNT' ? 'count' : 'points')
    };
  }

  if (cmd.action === 'CATEGORY_COUNTS_WITHIN') {
    return {
      action: 'CATEGORY_COUNTS_WITHIN',
      layerSource: 'TRUSTED_EXTERNAL',
      sourceId: cmd.sourceId,
      semanticField: cmd.semanticField || 'amenity',
      datasetIds: [],
      datasets: [],
      locationText: resolvedLocation,
      radiusMeters: cmd.radiusMeters || null,
      displayMode: 'category_counts'
    };
  }

  const datasets = (cmd.datasetIds || []).map((id) => getDatasetById(id)).filter(Boolean);
  return {
    action: cmd.action,
    datasetIds: cmd.datasetIds || [],
    datasets,
    locationText: resolvedLocation,
    radiusMeters: cmd.radiusMeters || null,
    limit: cmd.limit || null,
    activeOnly: cmd.activeOnly || false,
    displayMode: cmd.action === 'COUNT' ? 'count' : 'points'
  };
}

/**
 * Rule-based spatial language interpretation.
 * @param {string} prompt
 * @param {{ previousLocationText?: string, previousMatchedAddress?: string }} context
 */
export function interpretSpatialLanguage(prompt, context = {}) {
  const gateway = normalizeSpatialUtterance(prompt);
  if (!gateway.normalized) {
    return { supported: false, message: CLARIFICATION.specifyWhat, clarification: true };
  }
  if (gateway.ambiguity) {
    return {
      supported: false,
      message: gateway.ambiguity,
      clarification: true,
      gatewayNormalized: gateway.normalized,
      gatewayRewritten: gateway.wasRewritten,
      canonicalUtterance: gateway.ambiguity
    };
  }

  const raw = gateway.normalized;
  const stripped = stripFillerWords(raw);
  const normalized = stripped || raw;

  const plannerOptions = {
    webmapLayerCatalog: context.webmapLayerCatalog || null,
    vocabularyContext: context.vocabularyContext || null
  };

  const xrayIntent = parseSpatialIntent(raw, {
    vocabularyContext: plannerOptions.vocabularyContext || null
  });
  if (xrayIntent.supported && xrayIntent.request?.action === 'CATEGORY_COUNTS_WITHIN') {
    const cmd = requestToCommand(xrayIntent.request);
    return attachGatewayMeta(validateAndFinalizePlan({
      supported: true,
      commands: [cmd],
      sharedLocation: cmd.location
    }, context), gateway);
  }

  const planned = planCompoundPrompt(raw, plannerOptions);
  if (planned.supported) {
    return attachGatewayMeta(validateAndFinalizePlan(planned, context), gateway);
  }

  if (planned.clarification) {
    return {
      supported: false,
      message: planned.clarification,
      clarification: true,
      gatewayNormalized: gateway.normalized,
      gatewayRewritten: gateway.wasRewritten,
      canonicalUtterance: planned.clarification
    };
  }

  if (planned.message && planned.message !== UNSUPPORTED_OPERATION_MESSAGE
    && planned.message !== LAYER_NOT_AVAILABLE_MESSAGE) {
    return {
      supported: false,
      message: planned.message,
      gatewayNormalized: gateway.normalized,
      gatewayRewritten: gateway.wasRewritten
    };
  }

  if (hasCompoundConnectors(raw)) {
    return {
      supported: false,
      message: UNSUPPORTED_OPERATION_MESSAGE,
      gatewayNormalized: gateway.normalized,
      gatewayRewritten: gateway.wasRewritten
    };
  }

  const legacy = parseSpatialIntent(raw, {
    vocabularyContext: plannerOptions.vocabularyContext || null
  });
  if (legacy.supported) {
    const cmd = requestToCommand(legacy.request);
    return attachGatewayMeta(validateAndFinalizePlan({
      supported: true,
      commands: [cmd],
      sharedLocation: cmd.location
    }, context), gateway);
  }

  if (legacy.message && legacy.message !== UNSUPPORTED_OPERATION_MESSAGE) {
    return {
      supported: false,
      message: legacy.message,
      gatewayNormalized: gateway.normalized,
      gatewayRewritten: gateway.wasRewritten
    };
  }

  return {
    supported: false,
    message: UNSUPPORTED_OPERATION_MESSAGE,
    needsSemantic: true,
    normalized,
    gatewayNormalized: gateway.normalized,
    gatewayRewritten: gateway.wasRewritten
  };
}

function attachGatewayMeta(result, gateway) {
  if (!result) return result;
  const out = {
    ...result,
    gatewayNormalized: gateway.normalized,
    gatewayRewritten: gateway.wasRewritten
  };
  out.canonicalUtterance = formatCanonicalUtterance(result);
  return out;
}

/**
 * Async interpretation with optional semantic fallback.
 * @param {string} prompt
 * @param {{ previousLocationText?: string, previousMatchedAddress?: string }} context
 * @param {{ semanticFn?: Function }} [deps]
 */
export async function interpretSpatialLanguageAsync(prompt, context = {}, deps = {}) {
  const vocabularyContext = context.vocabularyContext
    || await loadVocabularyContextForPlanning({
      fetchFn: deps.fetchFn,
      forceRefresh: deps.forceRefreshVocabulary,
      ttlMs: deps.vocabularyTtlMs
    });
  const enrichedContext = {
    ...context,
    vocabularyContext
  };

  const initial = interpretSpatialLanguage(prompt, enrichedContext);
  if (initial.supported) {
    return initial;
  }
  if (!initial.needsSemantic) {
    if (initial.clarification && initial.message) {
      initial.canonicalUtterance = initial.message;
    }
    return initial;
  }

  const semanticFn = deps.semanticFn || proposeSemanticCandidates;
  const available = deps.semanticAvailable ?? await isSemanticFallbackAvailable();
  if (!available) {
    return { supported: false, message: initial.message || UNSUPPORTED_OPERATION_MESSAGE };
  }

  const semantic = await semanticFn(initial.normalized || prompt);
  if (!semantic?.supported) {
    if (semantic?.clarification) {
      return {
        supported: false,
        message: semantic.clarification,
        clarification: true,
        canonicalUtterance: semantic.clarification
      };
    }
    return { supported: false, message: initial.message || UNSUPPORTED_OPERATION_MESSAGE };
  }

  const replanned = planCompoundPrompt(semantic.reconstructedPrompt || initial.gatewayNormalized || prompt, {
    webmapLayerCatalog: enrichedContext.webmapLayerCatalog || null,
    vocabularyContext
  });
  if (replanned.supported) {
    return attachGatewayMeta(
      validateAndFinalizePlan(replanned, enrichedContext),
      { normalized: initial.gatewayNormalized || initial.normalized, wasRewritten: true }
    );
  }

  if (semantic.clarification) {
    return {
      supported: false,
      message: semantic.clarification,
      clarification: true,
      canonicalUtterance: semantic.clarification
    };
  }

  return { supported: false, message: initial.message || UNSUPPORTED_OPERATION_MESSAGE };
}

function validateAndFinalizePlan(planned, context) {
  let anchorLocation = planned.sharedLocation || context.previousLocationText || context.previousMatchedAddress || null;

  const commands = (planned.commands || []).map((cmd) => {
    if (cmd.action === 'CLEAR' || cmd.action === 'LOCATE') return cmd;
    const loc = cmd.location || planned.sharedLocation;
    const resolved = resolveLocationText(loc, context);
    if (resolved?.error) {
      return { error: resolved.error };
    }
    return { ...cmd, resolvedLocation: resolved || loc };
  });

  for (const cmd of commands) {
    if (cmd.error) {
      return { supported: false, message: cmd.error };
    }
  }

  // Propagate location from LOCATE or first resolved command
  for (const cmd of commands) {
    if (cmd.action === 'LOCATE' && cmd.location) {
      anchorLocation = cmd.location;
      break;
    }
    if (cmd.resolvedLocation) {
      anchorLocation = cmd.resolvedLocation;
      break;
    }
  }

  if (!anchorLocation) {
    anchorLocation = context.previousLocationText || context.previousMatchedAddress || null;
  }

  const finalized = commands.map((cmd) => {
    if (cmd.action === 'CLEAR') return cmd;
    if (cmd.action === 'LOCATE') {
      const resolved = resolveLocationText(cmd.location, context);
      if (resolved?.error) return { ...cmd, error: resolved.error };
      return { ...cmd, resolvedLocation: resolved || cmd.location };
    }
    const loc = cmd.resolvedLocation || resolveLocationText(cmd.location || anchorLocation, context);
    if (loc?.error) return { ...cmd, error: loc.error };
    return { ...cmd, resolvedLocation: loc || anchorLocation };
  });

  for (const cmd of finalized) {
    if (cmd.error) {
      return { supported: false, message: cmd.error };
    }
    if (LAYER_ONLY_ACTIONS.has(cmd.action) || cmd.action === 'LIST_LAYERS') {
      continue;
    }
    if (cmd.action !== 'CLEAR' && cmd.action !== 'LOCATE' && !cmd.resolvedLocation && !anchorLocation) {
      return { supported: false, message: 'Location is required for this operation.' };
    }
  }

  return {
    supported: true,
    plan: {
      commands: finalized.map((c) => commandToSpatialCommand({
        ...c,
        location: c.resolvedLocation || c.location
      })),
      sharedLocation: anchorLocation
    },
    commands: finalized,
    sharedLocation: anchorLocation
  };
}

export function getSpatialLanguagePackStats() {
  const pack = loadLanguagePack();
  return {
    exampleCount: getLanguageExampleCount(),
    testCount: pack.tests?.length || 0
  };
}
