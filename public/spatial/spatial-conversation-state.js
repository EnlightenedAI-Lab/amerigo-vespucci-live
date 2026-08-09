/**
 * Explicit deterministic session state for MAP conversation — no LLM memory.
 */

/** @type {object} */
let conversationState = createEmptyState();

function createEmptyState() {
  return {
    lastResolvedLocation: null,
    lastLocationText: null,
    lastMatchedAddress: null,
    lastReferencedSourceLayers: [],
    lastVisibleLayerSet: [],
    lastScopedDatasets: [],
    lastScopedResultLayerIds: [],
    lastScopedLocation: null,
    lastScopedRadiusKm: null,
    lastSpatialOperation: null,
    lastRadiusKm: null,
    lastOperationScope: null,
    lastSelectedFeature: null,
    lastPrompt: null,
    lastExecutablePrompt: null,
    lastMapResultSnapshot: null,
    lastXraySourceId: null,
    lastXraySemanticField: null,
    lastXrayRadiusKm: null,
    lastXrayLocation: null,
    lastXrayCategories: [],
    lastXraySelectedCategories: [],
    // Legacy aliases used by expansion helpers
    lastReferencedLayers: [],
    lastQueryLayers: [],
    lastResultLayerIds: []
  };
}

export function getConversationState() {
  const state = JSON.parse(JSON.stringify(conversationState));
  state.lastReferencedLayers = state.lastReferencedSourceLayers;
  state.lastQueryLayers = state.lastScopedDatasets;
  state.lastResultLayerIds = state.lastScopedResultLayerIds;
  return state;
}

/**
 * Minimal conversation payload for POST /api/spatial/map.
 * @param {object | null | undefined} [state]
 */
export function buildCompactMapConversationState(state = conversationState) {
  if (!state) return {};
  const compact = {};
  if (state.lastLocationText) compact.lastLocationText = state.lastLocationText;
  if (state.lastMatchedAddress) compact.lastMatchedAddress = state.lastMatchedAddress;
  return compact;
}

export function getConversationDiagnostics() {
  return {
    lastPrompt: conversationState.lastPrompt,
    lastLocationText: conversationState.lastLocationText,
    lastMatchedAddress: conversationState.lastMatchedAddress,
    lastReferencedSourceLayerCount: conversationState.lastReferencedSourceLayers.length,
    lastReferencedSourceLayerTitles: conversationState.lastReferencedSourceLayers.map((l) => l.title),
    lastScopedDatasetCount: conversationState.lastScopedDatasets.length,
    lastScopedDatasetTitles: conversationState.lastScopedDatasets.map((l) => l.title),
    lastScopedResultLayerIds: [...conversationState.lastScopedResultLayerIds],
    lastScopedLocation: conversationState.lastScopedLocation,
    lastScopedRadiusKm: conversationState.lastScopedRadiusKm,
    lastOperationScope: conversationState.lastOperationScope,
    lastSpatialOperation: conversationState.lastSpatialOperation,
    hasMapResult: Boolean(conversationState.lastMapResultSnapshot)
  };
}

export function resetConversationState() {
  conversationState = createEmptyState();
  if (typeof window !== 'undefined') {
    window.__IQAI_CONVERSATION_STATE__ = getConversationState();
  }
  return getConversationState();
}

export function patchConversationState(patch) {
  const normalized = { ...patch };
  if (normalized.lastReferencedLayers && !normalized.lastReferencedSourceLayers) {
    normalized.lastReferencedSourceLayers = normalized.lastReferencedLayers;
  }
  if (normalized.lastQueryLayers && !normalized.lastScopedDatasets) {
    normalized.lastScopedDatasets = normalized.lastQueryLayers;
  }
  if (normalized.lastResultLayerIds && !normalized.lastScopedResultLayerIds) {
    normalized.lastScopedResultLayerIds = normalized.lastResultLayerIds;
  }

  conversationState = {
    ...conversationState,
    ...normalized
  };
  conversationState.lastReferencedLayers = conversationState.lastReferencedSourceLayers;
  conversationState.lastQueryLayers = conversationState.lastScopedDatasets;
  conversationState.lastResultLayerIds = conversationState.lastScopedResultLayerIds;
  if (typeof window !== 'undefined') {
    window.__IQAI_CONVERSATION_STATE__ = getConversationState();
  }
  return getConversationState();
}

function layerRef(entry) {
  if (!entry) return null;
  return {
    catalogId: entry.catalogId || entry.webmapCatalogId || null,
    layerId: entry.layerId || entry.webmapLayerId || null,
    title: entry.title || entry.displayName || null,
    parentGroup: entry.parentGroup || null,
    datasetId: entry.datasetId || null
  };
}

/**
 * @param {object[]} catalogLayers
 */
export function snapshotVisibleLayers(catalogLayers = []) {
  return catalogLayers
    .filter((entry) => entry.visible)
    .map((entry) => layerRef(entry))
    .filter(Boolean);
}

/**
 * @param {string} prompt
 * @param {object} result
 * @param {object} [catalog]
 */
export function recordConversationFromList(prompt, result, catalog) {
  patchConversationState({
    lastPrompt: prompt,
    lastExecutablePrompt: prompt,
    lastOperationScope: 'catalog',
    lastMapResultSnapshot: { action: 'LIST_LAYERS', count: result.layers?.length || 0 },
    lastVisibleLayerSet: snapshotVisibleLayers(catalog?.layers || result.layers || [])
  });
}

/**
 * @param {string} prompt
 * @param {string} operation
 * @param {object[]} layers
 * @param {object} [catalog]
 */
export function recordConversationFromLayerControls(prompt, operation, layers, catalog) {
  const refs = layers.map((layer) => layerRef(layer)).filter(Boolean);
  patchConversationState({
    lastPrompt: prompt,
    lastExecutablePrompt: prompt,
    lastReferencedSourceLayers: refs,
    lastVisibleLayerSet: snapshotVisibleLayers(catalog?.layers || []),
    lastOperationScope: 'source',
    lastMapResultSnapshot: { action: operation, scope: 'source', layers: refs.map((l) => l.title) }
  });
}

/**
 * @param {string} prompt
 * @param {object} mapResult
 */
export function recordConversationFromXrayResult(prompt, mapResult) {
  const xray = mapResult.xrayResult || {};
  const radiusKm = xray.radiusKm
    ?? (mapResult.summary?.radiusMeters ? mapResult.summary.radiusMeters / 1000 : null);

  patchConversationState({
    lastPrompt: prompt,
    lastExecutablePrompt: prompt,
    lastLocationText: mapResult.resolvedLocationText || mapResult.origin?.locationText || null,
    lastMatchedAddress: mapResult.matchedAddress || mapResult.origin?.matchedAddress || null,
    lastXraySourceId: xray.sourceId || mapResult.summary?.sourceId || null,
    lastXraySemanticField: xray.semanticField || mapResult.summary?.semanticField || null,
    lastXrayRadiusKm: radiusKm,
    lastXrayLocation: mapResult.resolvedLocationText || mapResult.origin?.locationText || null,
    lastXrayCategories: Array.isArray(xray.categories) ? xray.categories : [],
    lastXraySelectedCategories: [],
    lastScopedLocation: mapResult.resolvedLocationText || mapResult.origin?.locationText || null,
    lastScopedRadiusKm: radiusKm,
    lastSpatialOperation: 'CATEGORY_COUNTS_WITHIN',
    lastRadiusKm: radiusKm,
    lastOperationScope: 'xray',
    lastMapResultSnapshot: {
      action: 'CATEGORY_COUNTS_WITHIN',
      totalCategories: xray.totalCategories,
      totalFeaturesRepresented: xray.totalFeaturesRepresented
    }
  });

  return getConversationState();
}

/**
 * @param {string} prompt
 * @param {object} mapResult
 */
export function recordConversationFromMapResult(prompt, mapResult) {
  if (mapResult?.action === 'CATEGORY_COUNTS_WITHIN' || mapResult?.summary?.displayMode === 'category_counts') {
    return recordConversationFromXrayResult(prompt, mapResult);
  }
  if (!mapResult) return getConversationState();

  const scopedDatasets = (mapResult.datasetResults || []).map((result) => ({
    catalogId: result.webmapLayer?.catalogId || result.sourceId || result.datasetId,
    layerId: result.webmapLayer?.layerId || null,
    title: result.displayName || result.webmapLayer?.title,
    parentGroup: result.webmapLayer?.parentGroup || null,
    datasetId: result.datasetId
  }));

  const radiusKm = mapResult.summary?.radiusMeters
    ? mapResult.summary.radiusMeters / 1000
    : (mapResult.request?.radiusMeters ? mapResult.request.radiusMeters / 1000 : null);

  const scopedLayerIds = [];
  for (const result of mapResult.datasetResults || []) {
    if (result.webmapLayer?.catalogId) {
      scopedLayerIds.push(`iqai-webmap-${result.webmapLayer.catalogId}`);
    } else if (result.datasetId) {
      scopedLayerIds.push(`iqai-${String(result.datasetId).toLowerCase().replace(/^webmap:/, 'webmap-')}`);
    }
  }
  if (mapResult.iqaiResultLayerIds?.length) {
    scopedLayerIds.push(...mapResult.iqaiResultLayerIds);
  }
  if (scopedLayerIds.length) {
    scopedLayerIds.push('iqai-map-result');
  }

  const scopedLocation = mapResult.resolvedLocationText
    || mapResult.origin?.locationText
    || mapResult.request?.locationText
    || conversationState.lastScopedLocation;

  patchConversationState({
    lastPrompt: prompt,
    lastExecutablePrompt: prompt,
    lastResolvedLocation: mapResult.origin || null,
    lastLocationText: scopedLocation || conversationState.lastLocationText,
    lastMatchedAddress: mapResult.matchedAddress
      || mapResult.origin?.matchedAddress
      || conversationState.lastMatchedAddress,
    lastScopedDatasets: scopedDatasets,
    lastScopedResultLayerIds: [...new Set(scopedLayerIds)],
    lastScopedLocation: scopedLocation,
    lastScopedRadiusKm: radiusKm ?? conversationState.lastScopedRadiusKm,
    lastSpatialOperation: mapResult.request?.action || mapResult.summary?.action || null,
    lastRadiusKm: radiusKm ?? conversationState.lastRadiusKm,
    lastOperationScope: 'scoped',
    lastMapResultSnapshot: {
      action: mapResult.summary?.action || mapResult.action,
      scope: 'scoped',
      prompt: mapResult.prompt,
      matchedFeatures: mapResult.summary?.matchedFeatures
    }
  });

  return getConversationState();
}

export function recordSelectedFeature(feature) {
  if (!feature) return;
  patchConversationState({
    lastSelectedFeature: {
      title: feature.title || feature.layerTitle || null,
      objectId: feature.objectId ?? feature.OBJECTID ?? null,
      datasetId: feature.datasetId || null
    }
  });
}
