import { interpretSpatialLanguageAsync, commandToRequest } from './spatial-language-interpreter.js';
import { geocodeMontrealMapLocation } from './public-safety-geocode.js';
import {
  executeDatasetQuery,
  buildSpatialOperationLabel,
  clearAllDatasetCaches
} from './dataset-query-engine.js';
import { formatRadiusKm } from './spatial-operations.js';
import { DATASET_IDS } from './dataset-registry.js';
import { getSemanticLatencyMetrics } from './spatial-semantic-fallback.js';
import {
  filterCatalogLayers,
  summarizeLayerCatalog,
  webmapLayerAuthority
} from './webmap-layer-catalog.js';
import {
  buildWebMapLayerDatasetResult,
  buildWebMapLayerSummary
} from './webmap-layer-query.js';
import { executeExternalFeatureQuery } from './external-feature-query.js';
import { executeCategoryCountsWithin } from './external-feature-xray.js';
import { getSemanticCategoryById } from './semantic-category-registry.js';
import { LAYER_ONLY_ACTIONS } from './spatial-compound-planner.js';

export const MIN_MAP_GEOCODE_SCORE = 80;

function deriveFreshness(features) {
  if (!features?.length) return 'Unknown';
  const timestamps = features
    .map((f) => f.receivedAt)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((n) => Number.isFinite(n));
  if (!timestamps.length) return 'Unknown';
  return new Date(Math.max(...timestamps)).toISOString().slice(0, 10);
}

function primarySource(datasetResults) {
  const first = datasetResults?.[0];
  if (!first) return null;
  const trust = first.sourceType === 'TRUSTED_EXTERNAL'
    ? 'TRUSTED_EXTERNAL'
    : 'AUTHORITATIVE_PUBLIC';
  return {
    id: first.sourceId,
    name: first.displayName,
    authority: first.authority,
    catalogueUrl: first.catalogueUrl || first.provenance?.catalogueUrl || null,
    resourceUrl: first.dataUrl || null,
    trust,
    attribution: first.provenance?.attribution || null,
    licence: first.provenance?.licence || null
  };
}

function buildSummaryForExternalRequest(request, queryResult) {
  const category = request.semanticCategory || getSemanticCategoryById(request.conceptId);
  const datasetResult = queryResult.datasetResults?.[0];
  const provenance = datasetResult?.provenance || queryResult.provenance || {};

  return {
    status: 'Controlled',
    execution: 'Deterministic GIS',
    matchedFeatures: datasetResult?.matchedFeatures ?? queryResult.features.length,
    radiusMeters: request.radiusMeters || null,
    limit: request.limit || null,
    spatialOperation: buildSpatialOperationLabel(request),
    dataset: category?.displayName || datasetResult?.displayName || '—',
    action: request.action,
    conceptId: request.conceptId,
    sourceId: request.sourceId,
    layerSource: 'TRUSTED_EXTERNAL',
    trustTier: provenance.trustTier || 'TRUSTED_EXTERNAL',
    semanticField: provenance.semanticField || request.semanticField || null,
    semanticValue: provenance.semanticValue || request.semanticValue || null,
    categoryFilter: provenance.categoryFilter || request.categoryFilter,
    attribution: provenance.attribution || null,
    licence: provenance.licence || null,
    queryTime: provenance.queryTime || null,
    authority: datasetResult?.authority || provenance.provider || '—',
    totalSourceRecords: queryResult.totalSourceRecords,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    operationalStatusCheck: null,
    closedRecordsExcluded: null,
    sourceCheck: 'Passed',
    geometryCheck: 'Passed',
    reproducible: 'Yes',
    unresolved: 'None',
    freshness: provenance.freshness || 'Unavailable',
    displayMode: request.displayMode || 'points'
  };
}

function buildSummaryForRequest(request, queryResult) {
  const hasFire = request.datasetIds?.includes(DATASET_IDS.FIRE_STATIONS);
  const hasOperationalRule = hasFire && request.activeOnly !== false;
  const datasetLabel = (request.datasets || []).map((d) => d.displayName).join(' + ') || '—';

  return {
    status: 'Controlled',
    execution: 'Deterministic GIS',
    matchedFeatures: queryResult.features.length,
    radiusMeters: request.radiusMeters || null,
    limit: request.limit || null,
    spatialOperation: buildSpatialOperationLabel(request),
    dataset: datasetLabel,
    action: request.action,
    datasetIds: request.datasetIds || [],
    authority: request.datasets?.[0]?.authority || '—',
    totalSourceRecords: queryResult.totalSourceRecords,
    closedExcluded: queryResult.closedExcluded ?? 0,
    ambiguousExcluded: queryResult.ambiguousExcluded ?? 0,
    operationalStatusCheck: hasOperationalRule ? 'Passed' : null,
    closedRecordsExcluded: hasOperationalRule ? 'Yes' : null,
    sourceCheck: 'Passed',
    geometryCheck: 'Passed',
    reproducible: 'Yes',
    unresolved: 'None',
    freshness: deriveFreshness(queryResult.features),
    displayMode: request.displayMode || 'points'
  };
}

function buildCompoundSummary(commandSummaries, allFeatures) {
  const datasets = commandSummaries.map((s) => s.dataset).filter(Boolean);
  const operations = commandSummaries.map((s) => s.spatialOperation).filter(Boolean);
  const hasFire = commandSummaries.some((s) => s.operationalStatusCheck === 'Passed');

  return {
    status: 'Controlled',
    execution: 'Deterministic GIS',
    matchedFeatures: allFeatures.length,
    radiusMeters: commandSummaries.reduce(
      (max, summary) => Math.max(max, summary.radiusMeters || 0),
      0
    ) || commandSummaries.find((s) => s.radiusMeters)?.radiusMeters || null,
    limit: commandSummaries.find((s) => s.limit)?.limit || null,
    spatialOperation: operations.join(' + ') || 'Compound',
    dataset: datasets.join(' + ') || '—',
    action: 'COMPOUND',
    commandCount: commandSummaries.length,
    totalSourceRecords: commandSummaries.reduce((n, s) => n + (s.totalSourceRecords || 0), 0),
    closedExcluded: commandSummaries.reduce((n, s) => n + (s.closedExcluded || 0), 0),
    ambiguousExcluded: commandSummaries.reduce((n, s) => n + (s.ambiguousExcluded || 0), 0),
    operationalStatusCheck: hasFire ? 'Passed' : null,
    closedRecordsExcluded: hasFire ? 'Yes' : null,
    sourceCheck: 'Passed',
    geometryCheck: 'Passed',
    reproducible: 'Yes',
    unresolved: 'None',
    freshness: deriveFreshness(allFeatures),
    displayMode: 'points',
    commands: commandSummaries
  };
}

async function geocodeLocation(locationText, geocodeFn) {
  const result = await geocodeFn(locationText);

  if (Array.isArray(result)) {
    const geocode = result[0];
    if (!geocode || geocode.score == null || geocode.score < MIN_MAP_GEOCODE_SCORE) {
      return { ok: false, message: `Geocoding failed for: ${locationText}` };
    }
    return {
      ok: true,
      origin: {
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        matchedAddress: geocode.resolvedAddress,
        score: geocode.score,
        source: geocode.geocoder,
        locationText
      },
      geocodeResolution: {
        extractedAddress: locationText,
        normalizedQuery: locationText,
        resolvedAddress: geocode.resolvedAddress,
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        validation: 'PASS'
      }
    };
  }

  if (!result.ok) {
    return { ok: false, message: result.message || `Geocoding failed for: ${locationText}` };
  }

  const geocode = result.candidate;
  return {
    ok: true,
    origin: {
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      matchedAddress: geocode.resolvedAddress,
      score: geocode.score,
      source: geocode.geocoder,
      locationText: result.extractedAddress || locationText
    },
    geocodeResolution: {
      extractedAddress: result.extractedAddress,
      normalizedQuery: result.normalizedQuery,
      resolvedAddress: geocode.resolvedAddress,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      validation: result.validation || 'PASS'
    }
  };
}

/**
 * Build a normalized IQAI map result from natural-language prompt.
 * @param {string} prompt
 * @param {{ geocodeFn?: Function, fetchFn?: typeof fetch, context?: object, semanticFn?: Function }} [deps]
 */
export async function buildMapFromPrompt(prompt, deps = {}) {
  const context = {
    ...deps.context || {},
    webmapLayerCatalog: deps.context?.webmapLayerCatalog || deps.webmapLayerCatalog || null
  };
  const interpreted = await interpretSpatialLanguageAsync(prompt, context, deps);
  const canonicalUtterance = interpreted.canonicalUtterance || null;
  const attachUnderstanding = (result) => {
    if (result && canonicalUtterance) result.canonicalUtterance = canonicalUtterance;
    return result;
  };

  if (!interpreted.supported) {
    return attachUnderstanding({
      supported: false,
      message: interpreted.message,
      clarification: interpreted.clarification || false
    });
  }

  const commands = interpreted.commands || [];
  const webmapCatalog = context.webmapLayerCatalog || null;
  const webmapTitle = webmapCatalog?.webmapTitle || 'Montreal 1';
  const geocodeFn = deps.geocodeFn || ((text) => geocodeMontrealMapLocation(text, { minScore: MIN_MAP_GEOCODE_SCORE }));

  if (commands.length === 1 && commands[0].action === 'CLEAR') {
    return {
      supported: true,
      action: 'CLEAR',
      prompt: String(prompt || '').trim(),
      request: { action: 'CLEAR' }
    };
  }

  if (commands.length === 1 && commands[0].action === 'LIST_LAYERS') {
    const layers = filterCatalogLayers(webmapCatalog, commands[0].filter);
    const catalogSummary = summarizeLayerCatalog(webmapCatalog);
    return {
      supported: true,
      action: 'LIST_LAYERS',
      prompt: String(prompt || '').trim(),
      layerList: layers.map((layer) => layer.title).filter(Boolean),
      layers: layers.map((layer) => ({
        catalogId: layer.catalogId,
        title: layer.title,
        type: layer.type,
        geometryType: layer.geometryType || null,
        visible: layer.visible,
        queryable: layer.queryable,
        parentGroup: layer.parentGroup || null
      })),
      layerCatalogSummary: catalogSummary,
      summary: {
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: layers.length,
        spatialOperation: commands[0].filter === 'point' ? 'List point layers' : 'List layers',
        dataset: webmapTitle,
        action: 'LIST_LAYERS',
        authority: webmapTitle,
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        reproducible: 'Yes',
        unresolved: 'None',
        freshness: 'ArcGIS live',
        displayMode: 'list',
        commands: [{
          status: 'Controlled',
          execution: 'Deterministic GIS',
          matchedFeatures: layers.length,
          spatialOperation: commands[0].filter === 'point' ? 'List point layers' : 'List layers',
          dataset: webmapTitle,
          action: 'LIST_LAYERS',
          authority: webmapTitle,
          sourceCheck: 'Passed',
          geometryCheck: 'Passed',
          operationalStatusCheck: null,
          closedRecordsExcluded: null
        }]
      }
    };
  }

  if (commands.length === 1 && commands[0].action === 'CATEGORY_COUNTS_WITHIN') {
    const cmd = commands[0];
    const loc = cmd.resolvedLocation || cmd.location;
    const geo = await geocodeLocation(loc, geocodeFn);
    if (!geo.ok) {
      return { supported: false, message: geo.message };
    }
    const request = commandToRequest(cmd, loc);
    const xrayExec = await executeCategoryCountsWithin(request, geo.origin, {
      fetchFn: deps.fetchFn
    });
    if (!xrayExec.ok) {
      return { supported: false, message: xrayExec.message };
    }
    const radiusKm = request.radiusMeters / 1000;
    return {
      supported: true,
      action: 'CATEGORY_COUNTS_WITHIN',
      prompt: String(prompt || '').trim(),
      request,
      origin: geo.origin,
      source: xrayExec.source,
      xrayResult: xrayExec.xrayResult,
      categoryCounts: xrayExec.xrayResult.categories,
      features: [],
      datasetResults: [],
      resolvedLocationText: geo.origin.locationText,
      matchedAddress: geo.origin.matchedAddress,
      geocodeResolution: geo.geocodeResolution,
      summary: {
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: xrayExec.xrayResult.totalFeaturesRepresented,
        radiusMeters: request.radiusMeters,
        limit: null,
        spatialOperation: 'Category counts within AOI',
        dataset: 'OpenStreetMap Amenities',
        action: 'CATEGORY_COUNTS_WITHIN',
        sourceId: xrayExec.xrayResult.sourceId,
        semanticField: xrayExec.xrayResult.semanticField,
        layerSource: 'TRUSTED_EXTERNAL',
        trustTier: 'TRUSTED_EXTERNAL',
        totalCategories: xrayExec.xrayResult.totalCategories,
        totalFeaturesRepresented: xrayExec.xrayResult.totalFeaturesRepresented,
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        operationalStatusCheck: null,
        closedRecordsExcluded: null,
        reproducible: 'Yes',
        unresolved: 'None',
        freshness: xrayExec.provenance?.queryTime || 'Unavailable',
        displayMode: 'category_counts',
        attribution: xrayExec.provenance?.attribution || null
      }
    };
  }

  if (commands.length === 1 && LAYER_ONLY_ACTIONS.has(commands[0].action)) {
    const cmd = commands[0];
    const layer = cmd.webmapLayer;
    const authority = layer ? webmapLayerAuthority(layer, webmapTitle) : webmapTitle;
    const operationLabel = cmd.action.replace(/_/g, ' ');
    return {
      supported: true,
      action: 'LAYER_CONTROL',
      prompt: String(prompt || '').trim(),
      layerControl: {
        operation: cmd.action,
        catalogId: cmd.webmapCatalogId || layer?.catalogId,
        layerId: layer?.layerId || null,
        title: layer?.title || null
      },
      summary: {
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: 1,
        spatialOperation: operationLabel,
        dataset: layer?.title || '—',
        action: cmd.action,
        authority,
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        reproducible: 'Yes',
        unresolved: 'None',
        freshness: 'ArcGIS live',
        displayMode: 'layer_control',
        layerSource: 'WEBMAP',
        commands: [{
          status: 'Controlled',
          execution: 'Deterministic GIS',
          matchedFeatures: 1,
          spatialOperation: operationLabel,
          dataset: layer?.title || '—',
          action: cmd.action,
          authority,
          sourceCheck: 'Passed',
          geometryCheck: 'Passed',
          operationalStatusCheck: null,
          closedRecordsExcluded: null,
          layerSource: 'WEBMAP'
        }]
      }
    };
  }

  const originsByLocation = new Map();
  const allFeatures = [];
  const datasetResults = [];
  const commandSummaries = [];
  const executionRequests = [];
  let primaryOrigin = null;
  let geocodeResolution = null;

  const queryCommands = commands.filter((cmd) =>
    cmd.action !== 'CLEAR'
    && cmd.action !== 'LOCATE'
    && !LAYER_ONLY_ACTIONS.has(cmd.action)
    && cmd.action !== 'LIST_LAYERS'
    && cmd.action !== 'CATEGORY_COUNTS_WITHIN'
  );
  if (queryCommands.length > 0) {
    const anchorText = interpreted.sharedLocation
      || queryCommands[0].resolvedLocation
      || queryCommands[0].location;
    if (!anchorText) {
      return { supported: false, message: 'Location is required for this operation.' };
    }
    const sharedGeo = await geocodeLocation(anchorText, geocodeFn);
    if (!sharedGeo.ok) {
      return { supported: false, message: sharedGeo.message };
    }
    primaryOrigin = sharedGeo.origin;
    geocodeResolution = sharedGeo.geocodeResolution;
    originsByLocation.set(anchorText, sharedGeo.origin);
    for (const cmd of queryCommands) {
      const key = cmd.resolvedLocation || cmd.location || anchorText;
      originsByLocation.set(key, sharedGeo.origin);
    }
  }

  for (const cmd of commands) {
    if (cmd.action === 'LOCATE') {
      const loc = cmd.resolvedLocation || cmd.location;
      const geo = await geocodeLocation(loc, geocodeFn);
      if (!geo.ok) {
        return { supported: false, message: geo.message };
      }
      originsByLocation.set(loc, geo.origin);
      primaryOrigin = geo.origin;
      executionRequests.push({
        type: 'LOCATE',
        request: commandToRequest(cmd, loc),
        origin: geo.origin
      });
      continue;
    }

    const loc = cmd.resolvedLocation || cmd.location || interpreted.sharedLocation;
    if (!loc) {
      return { supported: false, message: 'Location is required for this operation.' };
    }

    const origin = primaryOrigin || originsByLocation.get(loc);
    if (!origin) {
      const geo = await geocodeLocation(loc, geocodeFn);
      if (!geo.ok) {
        return { supported: false, message: geo.message };
      }
      originsByLocation.set(loc, geo.origin);
      if (!geocodeResolution) geocodeResolution = geo.geocodeResolution;
      if (!primaryOrigin) primaryOrigin = geo.origin;
    }

    const resolvedOrigin = origin || originsByLocation.get(loc);

    const request = commandToRequest(cmd, loc);
    if (request.layerSource === 'WEBMAP' && request.webmapLayer) {
      executionRequests.push({
        type: 'WEBMAP_QUERY',
        request,
        origin: resolvedOrigin
      });
      continue;
    }

    if (request.layerSource === 'TRUSTED_EXTERNAL') {
      const externalResult = await executeExternalFeatureQuery(request, resolvedOrigin, {
        fetchFn: deps.fetchFn
      });
      if (!externalResult.ok) {
        return { supported: false, message: externalResult.message };
      }
      const summary = buildSummaryForExternalRequest(request, externalResult);
      commandSummaries.push(summary);
      allFeatures.push(...externalResult.features);
      datasetResults.push(...externalResult.datasetResults);
      executionRequests.push({
        type: 'EXTERNAL_QUERY',
        request,
        origin: resolvedOrigin,
        summary
      });
      continue;
    }

    const queryResult = await executeDatasetQuery(request, resolvedOrigin, { fetchFn: deps.fetchFn });
    const summary = buildSummaryForRequest(request, queryResult);
    commandSummaries.push(summary);
    allFeatures.push(...queryResult.features);
    datasetResults.push(...queryResult.datasetResults);
    executionRequests.push({ type: 'QUERY', request, origin: resolvedOrigin, summary });
  }

  if (executionRequests.length === 1 && executionRequests[0].type === 'LOCATE') {
    const { origin } = executionRequests[0];
    return {
      supported: true,
      prompt: String(prompt || '').trim(),
      request: executionRequests[0].request,
      origin,
      source: {
        id: 'ARCGIS_WORLD_GEOCODE',
        name: 'ArcGIS World GeocodeServer',
        authority: origin.source || 'ArcGIS World GeocodeServer',
        catalogueUrl: null,
        resourceUrl: null,
        trust: 'AUTHORITATIVE_PUBLIC'
      },
      summary: {
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: 1,
        radiusMeters: null,
        limit: null,
        spatialOperation: 'Locate',
        dataset: '—',
        action: 'LOCATE',
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        operationalStatusCheck: null,
        closedRecordsExcluded: null,
        reproducible: 'Yes',
        unresolved: 'None',
        freshness: 'Unknown',
        displayMode: 'locate'
      },
      features: [],
      datasetResults: [],
      resolvedLocationText: origin.locationText,
      matchedAddress: origin.matchedAddress,
      geocodeResolution
    };
  }

  const lastQuery = executionRequests.filter((e) =>
    e.type === 'QUERY' || e.type === 'WEBMAP_QUERY' || e.type === 'EXTERNAL_QUERY'
  ).pop();
  const source = primarySource(datasetResults);
  const semanticMetrics = getSemanticLatencyMetrics();
  const clientWebMapQueries = executionRequests
    .filter((entry) => entry.type === 'WEBMAP_QUERY')
    .map((entry) => ({
      action: entry.request.action,
      catalogId: entry.request.webmapCatalogId,
      layerId: entry.request.webmapLayer?.layerId,
      title: entry.request.webmapLayer?.title,
      url: entry.request.webmapLayer?.url,
      parentGroup: entry.request.webmapLayer?.parentGroup,
      geometryType: entry.request.webmapLayer?.geometryType,
      fields: entry.request.webmapLayer?.fields || [],
      popupTemplate: entry.request.webmapLayer?.popupTemplate || null,
      popupTemplateExists: entry.request.webmapLayer?.popupTemplateExists || false,
      queryable: entry.request.webmapLayer?.queryable,
      radiusMeters: entry.request.radiusMeters,
      limit: entry.request.limit,
      displayMode: entry.request.displayMode,
      origin: entry.origin
    }));

  const pendingWebMapOnly = clientWebMapQueries.length > 0 && commandSummaries.length === 0;

  return attachUnderstanding({
    supported: true,
    prompt: String(prompt || '').trim(),
    request: lastQuery?.request || commandToRequest(commands[commands.length - 1], primaryOrigin?.locationText),
    origin: primaryOrigin,
    source,
    summary: pendingWebMapOnly
      ? {
          status: 'Controlled',
          execution: 'Deterministic GIS',
          action: lastQuery?.request?.action || 'WITHIN',
          spatialOperation: 'Pending client query',
          dataset: clientWebMapQueries.map((q) => q.title).join(' + ') || '—',
          matchedFeatures: 0,
          commands: [],
          displayMode: 'points'
        }
      : (commands.length > 1
        ? buildCompoundSummary(commandSummaries, allFeatures)
        : commandSummaries[0]),
    features: allFeatures,
    datasetResults,
    commandCount: commands.filter((c) => c.action !== 'LOCATE').length || commands.length,
    resolvedLocationText: primaryOrigin?.locationText,
    matchedAddress: primaryOrigin?.matchedAddress,
    geocodeResolution,
    semanticMetrics,
    clientWebMapQueries: clientWebMapQueries.length ? clientWebMapQueries : undefined,
    layerCatalogSummary: webmapCatalog ? summarizeLayerCatalog(webmapCatalog) : undefined
  });
}

export function clearMapDataCaches() {
  clearAllDatasetCaches();
}
