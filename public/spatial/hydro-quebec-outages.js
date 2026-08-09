/**
 * Hydro-Québec current outages — client polls IQAI server; official open data only.
 */
import {
  importArc,
  getWebMap,
  getMapView
} from './spatial-arcgis-runtime.js';
import { findLayerByIdRecursive, attachLayerToGroup } from './runtime-layer-groups.js';
import {
  HYDRO_GROUP_ID,
  HYDRO_GROUP_TITLE,
  HYDRO_LAYER_ID,
  HYDRO_LAYER_TITLE,
  HYDRO_AREAS_LAYER_ID,
  HYDRO_LEGACY_GROUP_ID,
  HYDRO_CLIENT_REFRESH_MS,
  HYDRO_SOURCE_NAME
} from './hydro-quebec-outages-config.js';
import {
  ensureHydroAreasLayer,
  applyHydroAreaEdits,
  getHydroOutageAreasLayer,
  __resetHydroAreaTrackingForTests
} from './hydro-quebec-area-layer.js';

/** @type {import('@arcgis/core/layers/GroupLayer').default | null} */
let hydroOutagesGroup = null;
/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let hydroOutageLayer = null;
/** @type {number | null} */
let refreshTimer = null;
/** @type {boolean} */
let refreshInFlight = false;
/** @type {Set<string>} */
let trackedOutageIds = new Set();
/** @type {object | null} */
let lastSuccessfulFeedMeta = null;

export function objectIdFromOutageId(outageId, fallback) {
  let hash = 0;
  const text = String(outageId || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  const value = Math.abs(hash);
  return value || fallback;
}

export function stableOutageObjectId(outageId, fallback = 1) {
  return objectIdFromOutageId(outageId, fallback);
}

/**
 * @param {Array<{ outageId?: string }>} outages
 * @param {Set<string>} knownOutageIds
 */
export function planHydroOutageEdits(outages, knownOutageIds) {
  const currentIds = new Set();
  const toAdd = [];
  const toUpdate = [];

  for (const outage of outages || []) {
    const outageId = String(outage?.outageId || '').trim();
    if (!outageId) continue;
    if (currentIds.has(outageId)) continue;
    currentIds.add(outageId);
    if (knownOutageIds.has(outageId)) {
      toUpdate.push(outageId);
    } else {
      toAdd.push(outageId);
    }
  }

  const toDelete = [];
  for (const outageId of knownOutageIds) {
    if (!currentIds.has(outageId)) {
      toDelete.push(outageId);
    }
  }

  return { toAdd, toUpdate, toDelete, currentIds };
}

export function captureHydroFeedMeta(payload = {}) {
  return {
    status: payload.status,
    source: payload.source,
    version: payload.version,
    feedTimestamp: payload.feedTimestamp,
    receivedAt: payload.receivedAt,
    outageCount: payload.outageCount,
    polygonCount: payload.polygonCount,
    polygonStatus: payload.polygonStatus,
    polygonError: payload.polygonError,
    stale: payload.stale,
    error: payload.error
  };
}

export function buildHydroStaleStatus(fetchMeta, errorMessage, outageCount = trackedOutageIds.size) {
  const meta = fetchMeta || lastSuccessfulFeedMeta || {};
  return {
    stale: true,
    status: meta.polygonStatus === 'ERROR' && !meta.outageCount ? 'ERROR' : 'STALE',
    error: errorMessage || 'Hydro refresh failed',
    outageCount: outageCount ?? meta.outageCount ?? trackedOutageIds.size,
    polygonCount: meta.polygonCount ?? 0,
    polygonStatus: meta.polygonStatus || 'STALE',
    polygonError: meta.polygonError || errorMessage,
    source: meta.source || HYDRO_SOURCE_NAME,
    version: meta.version,
    feedTimestamp: meta.feedTimestamp,
    receivedAt: meta.receivedAt,
    refreshTargetMinutes: 15,
    spatialPrecision: 'Approximate outage location',
    areaSpatialPrecision: 'Approximate outage area',
    aiCost: '$0.00'
  };
}

export function isHydroOutageLayer(layer) {
  const id = layer?.id;
  return id === HYDRO_GROUP_ID || id === HYDRO_LAYER_ID || id === HYDRO_AREAS_LAYER_ID;
}

/** @type {boolean} */
let hydroVisibilitySyncing = false;

function syncHydroChildVisibility(visible) {
  if (getHydroOutageAreasLayer()) getHydroOutageAreasLayer().visible = visible;
  if (hydroOutageLayer) hydroOutageLayer.visible = visible;
}

export function syncHydroOutageVisibility(visible) {
  if (hydroVisibilitySyncing) return;
  hydroVisibilitySyncing = true;
  if (hydroOutagesGroup) hydroOutagesGroup.visible = visible;
  syncHydroChildVisibility(visible);
  hydroVisibilitySyncing = false;
}

function attachHydroVisibilityWatchers() {
  if (!hydroOutagesGroup || hydroOutagesGroup.__hydroParentVisibilityWatchAttached) return;
  hydroOutagesGroup.__hydroParentVisibilityWatchAttached = true;
  hydroOutagesGroup.watch('visible', (visible) => {
    if (hydroVisibilitySyncing) return;
    hydroVisibilitySyncing = true;
    syncHydroChildVisibility(visible);
    hydroVisibilitySyncing = false;
  });
}

export function getHydroOutagesGroup() {
  return hydroOutagesGroup;
}

export function buildOutageAttributes(outage, objectId) {
  return {
    OBJECTID: objectId,
    outageId: String(outage.outageId || ''),
    customersAffected: outage.customersAffected ?? null,
    outageStart: outage.outageStart || '',
    estimatedRestoration: outage.estimatedRestoration || '',
    crewStatusCode: outage.crewStatusCode || '',
    crewStatusLabel: outage.crewStatusLabel || 'Unknown',
    causeCode: outage.causeCode || '',
    causeCategory: outage.causeCategory || 'Unknown',
    municipalityId: outage.municipalityId || '',
    messageId: outage.messageId || '',
    feedTimestamp: outage.feedTimestamp || '',
    sourceVersion: outage.sourceVersion || '',
    sourceName: outage.sourceName || HYDRO_SOURCE_NAME,
    iqaiType: 'hydro_quebec_outage'
  };
}

export function applyOutageDataToGraphic(graphic, outage, objectId, PointCtor) {
  graphic.geometry = new PointCtor({
    longitude: outage.longitude,
    latitude: outage.latitude,
    spatialReference: { wkid: 4326 }
  });
  Object.assign(graphic.attributes, buildOutageAttributes(outage, objectId));
  return graphic;
}

function buildOutageGraphic(outage, objectId, Graphic, Point) {
  return new Graphic({
    geometry: new Point({
      longitude: outage.longitude,
      latitude: outage.latitude,
      spatialReference: { wkid: 4326 }
    }),
    attributes: buildOutageAttributes(outage, objectId)
  });
}

function editResultFailed(results = []) {
  return results.some((result) => result?.error != null);
}

function outageMapFromPayload(outages = []) {
  const outageById = new Map();
  for (const outage of outages) {
    const outageId = String(outage?.outageId || '').trim();
    if (!outageId || outageById.has(outageId)) continue;
    outageById.set(outageId, outage);
  }
  return outageById;
}

async function queryExistingOutageMaps(layer) {
  const featureByOutageId = new Map();
  const result = await layer.queryFeatures({
    where: '1=1',
    outFields: ['*'],
    returnGeometry: true
  });
  for (const feature of result.features || []) {
    const outageId = String(feature.attributes?.outageId || '').trim();
    if (outageId) featureByOutageId.set(outageId, feature);
  }
  return {
    featureByOutageId,
    queriedCount: result.features?.length ?? 0
  };
}

export async function prepareHydroOutageEditBundle(layer, payload, knownOutageIds, modules) {
  const { Graphic, Point } = modules;
  const outages = payload.outages || [];
  const plan = planHydroOutageEdits(outages, knownOutageIds);
  const outageById = outageMapFromPayload(outages);
  const { featureByOutageId, queriedCount } = await queryExistingOutageMaps(layer);

  const addFeatures = [];
  const updateFeatures = [];
  let fallbackId = 1;

  for (const outageId of plan.toAdd) {
    const outage = outageById.get(outageId);
    if (!outage) continue;
    const objectId = stableOutageObjectId(outageId, fallbackId);
    fallbackId += 1;
    addFeatures.push(buildOutageGraphic(outage, objectId, Graphic, Point));
  }

  for (const outageId of plan.toUpdate) {
    const outage = outageById.get(outageId);
    if (!outage) continue;
    const existingGraphic = featureByOutageId.get(outageId);
    if (!existingGraphic) continue;
    const objectId = existingGraphic.attributes?.OBJECTID ?? stableOutageObjectId(outageId, fallbackId);
    fallbackId += 1;
    applyOutageDataToGraphic(existingGraphic, outage, objectId, Point);
    updateFeatures.push(existingGraphic);
  }

  const deleteFeatures = plan.toDelete.map((outageId) => ({
    objectId: stableOutageObjectId(outageId, 1)
  }));

  return {
    plan,
    addFeatures,
    updateFeatures,
    deleteFeatures,
    queriedCount
  };
}

async function fetchHydroOutages() {
  const response = await fetch('/api/spatial/hydro-quebec/outages', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const contentType = String(response.headers.get('content-type') || '');
  const text = await response.text();
  const looksHtml = text.trim().toLowerCase().startsWith('<!doctype')
    || text.trim().toLowerCase().startsWith('<html')
    || contentType.includes('text/html');

  let body = null;
  if (!looksHtml) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(`Hydro outages response was not valid JSON (${error?.message || 'parse failed'})`);
    }
  }

  if (!body) {
    const snippet = text.trim().slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      looksHtml
        ? `Hydro outages API returned HTML (HTTP ${response.status}). Restart the local server if the route is missing.`
        : `Hydro outages API returned an unreadable response (HTTP ${response.status}): ${snippet}`
    );
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || body?.error || `Hydro outages HTTP ${response.status}`);
  }
  return body;
}

async function removeLegacyRuntimeGroup(webMap, groupId) {
  const entry = findLayerByIdRecursive(webMap, groupId);
  if (!entry?.layer) return;
  const group = entry.layer;
  if (group.type !== 'group') return;
  if (group.layers?.length > 0) return;
  webMap.remove(group);
}

async function migrateLegacyHydroGroups(webMap, hydroGroup) {
  const legacyEntry = findLayerByIdRecursive(webMap, HYDRO_LEGACY_GROUP_ID);
  if (legacyEntry?.layer && legacyEntry.layer !== hydroGroup) {
    const legacy = legacyEntry.layer;
    const children = legacy.layers?.toArray?.() || [];
    for (const child of children) {
      await attachLayerToGroup(child, hydroGroup);
    }
    if (!legacy.layers?.length) {
      webMap.remove(legacy);
    }
  }

  const criticalEntry = findLayerByIdRecursive(webMap, 'critical-infrastructure');
  if (criticalEntry?.layer?.id === 'critical-infrastructure') {
    const critical = criticalEntry.layer;
    if (critical.layers?.includes?.(hydroGroup)) {
      critical.remove(hydroGroup);
      if (!webMap.layers.includes(hydroGroup)) {
        webMap.add(hydroGroup);
      }
    }
    if (!critical.layers?.length) {
      webMap.remove(critical);
    }
  }
}

async function ensureHydroOutagesGroup(modules) {
  const webMap = getWebMap();
  if (!webMap) return null;

  const existingEntry = findLayerByIdRecursive(webMap, HYDRO_GROUP_ID);
  if (existingEntry?.layer) {
    hydroOutagesGroup = existingEntry.layer;
    if (!webMap.layers.includes(hydroOutagesGroup)) {
      webMap.add(hydroOutagesGroup);
    }
    await migrateLegacyHydroGroups(webMap, hydroOutagesGroup);
    return hydroOutagesGroup;
  }

  const { GroupLayer } = modules;
  const group = new GroupLayer({
    id: HYDRO_GROUP_ID,
    title: HYDRO_GROUP_TITLE,
    listMode: 'show',
    visible: false,
    layers: []
  });
  await group.load();
  webMap.add(group);
  hydroOutagesGroup = group;
  await migrateLegacyHydroGroups(webMap, hydroOutagesGroup);
  await removeLegacyRuntimeGroup(webMap, HYDRO_LEGACY_GROUP_ID);
  return group;
}

async function ensureHydroPointLayer(modules, hydroGroup) {
  const webMap = getWebMap();
  if (!webMap || !hydroGroup) return null;

  const existing = hydroGroup.layers?.find?.((layer) => layer.id === HYDRO_LAYER_ID);
  if (existing) {
    hydroOutageLayer = existing;
    return hydroOutageLayer;
  }

  const { FeatureLayer } = modules;

  const layer = new FeatureLayer({
    id: HYDRO_LAYER_ID,
    title: HYDRO_LAYER_TITLE,
    source: [],
    objectIdField: 'OBJECTID',
    fields: [
      { name: 'OBJECTID', type: 'oid' },
      { name: 'outageId', type: 'string' },
      { name: 'customersAffected', type: 'integer', nullable: true },
      { name: 'outageStart', type: 'string' },
      { name: 'estimatedRestoration', type: 'string' },
      { name: 'crewStatusCode', type: 'string' },
      { name: 'crewStatusLabel', type: 'string' },
      { name: 'causeCode', type: 'string' },
      { name: 'causeCategory', type: 'string' },
      { name: 'municipalityId', type: 'string' },
      { name: 'messageId', type: 'string' },
      { name: 'feedTimestamp', type: 'string' },
      { name: 'sourceVersion', type: 'string' },
      { name: 'sourceName', type: 'string' },
      { name: 'iqaiType', type: 'string' }
    ],
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-marker',
        style: 'triangle',
        color: [220, 38, 38, 0.92],
        size: 10,
        outline: { color: [255, 255, 255, 1], width: 1.5 }
      },
      visualVariables: [{
        type: 'size',
        field: 'customersAffected',
        minDataValue: 1,
        maxDataValue: 500,
        minSize: 7,
        maxSize: 14
      }]
    },
    popupEnabled: true,
    popupTemplate: {
      title: 'Hydro-Québec outage',
      outFields: ['*'],
      content: [{
        type: 'text',
        text: '<div class="hydro-outage-popup"><strong>HYDRO-QUÉBEC OUTAGE</strong></div>'
      }, {
        type: 'fields',
        fieldInfos: [
          { fieldName: 'customersAffected', label: 'Customers affected' },
          { fieldName: 'outageStart', label: 'Started' },
          { fieldName: 'estimatedRestoration', label: 'Estimated restoration' },
          { fieldName: 'crewStatusLabel', label: 'Crew status' },
          { fieldName: 'causeCategory', label: 'Cause' },
          { fieldName: 'sourceName', label: 'Source' },
          { fieldName: 'feedTimestamp', label: 'Feed timestamp' },
          { fieldName: 'municipalityId', label: 'Municipality ID' }
        ]
      }]
    },
    listMode: 'show',
    visible: false
  });

  await layer.load();
  hydroGroup.add(layer);
  hydroOutageLayer = layer;
  return layer;
}

async function ensureHydroLayer(modules) {
  const webMap = getWebMap();
  if (!webMap) return null;

  const hydroGroup = await ensureHydroOutagesGroup(modules);
  if (!hydroGroup) return null;

  const existingPoint = findLayerByIdRecursive(webMap, HYDRO_LAYER_ID);
  if (existingPoint?.layer && existingPoint.layer.parent !== hydroGroup) {
    await attachLayerToGroup(existingPoint.layer, hydroGroup);
    hydroOutageLayer = existingPoint.layer;
  }

  await ensureHydroAreasLayer(modules, hydroGroup);
  await ensureHydroPointLayer(modules, hydroGroup);
  attachHydroVisibilityWatchers();
  return hydroOutageLayer;
}

function outageLookupFromPayload(payload) {
  const lookup = new Map();
  for (const outage of payload.outages || []) {
    if (outage.outageId) lookup.set(outage.outageId, outage);
  }
  return lookup;
}

async function updateAreaGraphics(payload, modules) {
  const hydroGroup = hydroOutagesGroup || await ensureHydroLayer(modules);
  if (!hydroGroup) return null;
  const areasLayer = await ensureHydroAreasLayer(modules, hydroGroup);
  if (!areasLayer) return null;
  try {
    return await applyHydroAreaEdits(areasLayer, payload, modules, outageLookupFromPayload(payload));
  } catch (error) {
    console.warn('[IQAI] Hydro area applyEdits failed', error?.message || error);
    return {
      polygonCount: payload.polygonCount ?? 0,
      polygonStatus: payload.polygonStatus,
      polygonError: error?.message || 'Hydro area update failed'
    };
  }
}

async function applyOutageEdits(layer, payload, modules) {
  const bundle = await prepareHydroOutageEditBundle(layer, payload, trackedOutageIds, modules);
  const {
    plan,
    addFeatures,
    updateFeatures,
    deleteFeatures,
    queriedCount
  } = bundle;

  if (!addFeatures.length && !updateFeatures.length && !deleteFeatures.length) {
    const rendered = await layer.queryFeatureCount();
    return {
      added: 0,
      updated: 0,
      deleted: 0,
      rendered,
      queriedCount,
      outageCount: payload.outageCount ?? rendered,
      polygonCount: payload.polygonCount ?? 0,
      polygonStatus: payload.polygonStatus,
      ...captureHydroFeedMeta(payload),
      refreshTargetMinutes: 15,
      spatialPrecision: 'Approximate outage location',
      areaSpatialPrecision: 'Approximate outage area',
      aiCost: '$0.00'
    };
  }

  const editResult = await layer.applyEdits({
    addFeatures,
    updateFeatures,
    deleteFeatures
  });

  if (
    editResultFailed(editResult?.addFeatureResults)
    || editResultFailed(editResult?.updateFeatureResults)
    || editResultFailed(editResult?.deleteFeatureResults)
  ) {
    throw new Error('Hydro applyEdits returned errors');
  }

  trackedOutageIds = plan.currentIds;

  const rendered = await layer.queryFeatureCount();
  const view = getMapView();
  if (view && rendered > 0) {
    try {
      await view.whenLayerView(layer);
    } catch {
      // layer view may still initialize asynchronously
    }
  }

  return {
    added: addFeatures.length,
    updated: updateFeatures.length,
    deleted: deleteFeatures.length,
    rendered,
    queriedCount,
    outageCount: payload.outageCount ?? rendered,
    polygonCount: payload.polygonCount ?? 0,
    polygonStatus: payload.polygonStatus,
    ...captureHydroFeedMeta(payload),
    refreshTargetMinutes: 15,
    spatialPrecision: 'Approximate outage location',
    areaSpatialPrecision: 'Approximate outage area',
    aiCost: '$0.00'
  };
}

async function updateLayerGraphics(payload, modules) {
  const layer = await ensureHydroLayer(modules);
  if (!layer) return null;
  return applyOutageEdits(layer, payload, modules);
}

async function refreshHydroOutages(onStatus, onError) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  let fetchMeta = null;
  try {
    const modules = {
      FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
      Graphic: await importArc('@arcgis/core/Graphic.js'),
      Point: await importArc('@arcgis/core/geometry/Point.js'),
      Polygon: await importArc('@arcgis/core/geometry/Polygon.js'),
      GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
    };
    await ensureHydroLayer(modules);
    const payload = await fetchHydroOutages();
    fetchMeta = captureHydroFeedMeta(payload);
    const status = await updateLayerGraphics(payload, modules);
    const areaStatus = await updateAreaGraphics(payload, modules);
    lastSuccessfulFeedMeta = fetchMeta;
    if (status && onStatus) {
      onStatus({
        ...status,
        polygonCount: areaStatus?.polygonCount ?? payload.polygonCount ?? status.polygonCount,
        polygonStatus: payload.polygonStatus ?? status.polygonStatus,
        polygonError: payload.polygonError ?? areaStatus?.polygonError,
        areaSpatialPrecision: 'Approximate outage area'
      });
    }
  } catch (error) {
    if (onError) onError(error);
    if (onStatus) {
      onStatus(buildHydroStaleStatus(fetchMeta, error?.message || 'Hydro refresh failed'));
    }
    console.warn('[IQAI] Hydro outages refresh failed', error?.message || error);
  } finally {
    refreshInFlight = false;
  }
}

/**
 * @param {{ onStatus?: (status: object) => void, onError?: (error: Error) => void }} [options]
 */
export function startHydroQuebecOutagesLayer(options = {}) {
  if (refreshTimer != null) {
    return { stop: stopHydroQuebecOutagesLayer };
  }

  const boot = async () => {
    try {
      const modules = {
        FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
        Graphic: await importArc('@arcgis/core/Graphic.js'),
        Point: await importArc('@arcgis/core/geometry/Point.js'),
        Polygon: await importArc('@arcgis/core/geometry/Polygon.js'),
        GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
      };
      await ensureHydroLayer(modules);
      if (options.onRegistered) options.onRegistered();
    } catch (error) {
      console.warn('[IQAI] Hydro outages layer registration failed', error?.message || error);
      if (options.onStatus) {
        options.onStatus(buildHydroStaleStatus(null, error?.message || 'Hydro layer registration failed'));
      }
    }
    const tick = () => refreshHydroOutages(options.onStatus, options.onError);
    void tick();
    refreshTimer = window.setInterval(tick, HYDRO_CLIENT_REFRESH_MS);
  };

  void boot();
  return { stop: stopHydroQuebecOutagesLayer };
}

export function stopHydroQuebecOutagesLayer() {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getHydroOutageLayer() {
  return hydroOutageLayer;
}

export function isMapReadyForHydroOutages() {
  return Boolean(getWebMap() && getMapView());
}

/** @param {Set<string>} ids */
export function __resetHydroOutageTrackingForTests(ids = new Set()) {
  trackedOutageIds = new Set(ids);
  lastSuccessfulFeedMeta = null;
  hydroOutagesGroup = null;
  hydroOutageLayer = null;
  __resetHydroAreaTrackingForTests();
}
