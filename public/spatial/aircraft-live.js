/**
 * Live aircraft positions — ADSB.lol via IQAI server proxy.
 */
import {
  importArc,
  getWebMap,
  getMapView
} from './spatial-arcgis-runtime.js';
import {
  findLayerByIdRecursive,
  findGroupLayerByTitle,
  attachLayerToGroup
} from './runtime-layer-groups.js';
import { planLiveObjectEdits } from './live-object-engine.js';
import { buildLiveAircraftTableModel } from './results-table-model.js';
import { buildAircraftLayerRenderer } from './aircraft-live-symbols.js';
import { queueAircraftMotion, stopAircraftMotion } from './aircraft-live-motion.js';
import {
  AIRCRAFT_LAYER_ID,
  AIRCRAFT_LAYER_TITLE,
  AVIATION_GROUP_TITLE,
  LIVE_MOBILITY_GROUP_ID,
  AIRCRAFT_CLIENT_REFRESH_MS,
  ADSB_SOURCE_NAME,
  ADSB_SOURCE_LICENSE
} from './aircraft-live-config.js';

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let aircraftLayer = null;
/** @type {import('@arcgis/core/layers/GroupLayer').default | null} */
let aviationGroup = null;
/** @type {number | null} */
let refreshTimer = null;
/** @type {boolean} */
let refreshInFlight = false;
/** @type {Set<string>} */
let trackedObjectIds = new Set();
/** @type {object | null} */
let lastSuccessfulFeedMeta = null;
/** @type {object[]} */
let lastSnapshotObjects = [];
/** @type {boolean} */
let aircraftVisibilitySyncing = false;

export function objectIdFromLiveObjectId(liveObjectId, fallback) {
  let hash = 0;
  const text = String(liveObjectId || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || fallback;
}

export function stableAircraftObjectId(liveObjectId, fallback = 1) {
  return objectIdFromLiveObjectId(liveObjectId, fallback);
}

export function isAircraftLiveLayer(layer) {
  return layer?.id === AIRCRAFT_LAYER_ID;
}

export function syncAircraftVisibility(visible) {
  if (aircraftVisibilitySyncing) return;
  aircraftVisibilitySyncing = true;
  if (aircraftLayer) aircraftLayer.visible = visible;
  if (visible) ensureAviationParentVisible();
  if (!visible) stopAircraftMotion();
  aircraftVisibilitySyncing = false;
}

function ensureAviationParentVisible() {
  const parent = aircraftLayer?.parent;
  if (parent?.type === 'group' && !parent.visible) {
    parent.visible = true;
  }
}

function attachAircraftVisibilityWatchers() {
  if (!aircraftLayer || aircraftLayer.__aircraftVisibilityWatchAttached) return;
  aircraftLayer.__aircraftVisibilityWatchAttached = true;
  aircraftLayer.watch('visible', (visible) => {
    if (aircraftVisibilitySyncing) return;
    if (!visible) stopAircraftMotion();
    else if (isLayerPollingActive()) void refreshAircraftLive();
  });
}

function isLayerPollingActive() {
  if (!aircraftLayer?.visible) return false;
  const parent = aircraftLayer.parent;
  if (parent?.type === 'group' && !parent.visible) return false;
  return true;
}

export function buildAircraftAttributes(object, objectId) {
  return {
    OBJECTID: objectId,
    liveObjectId: String(object.liveObjectId || ''),
    sourceObjectId: object.sourceObjectId || '',
    callsign: object.callsign || '',
    registration: object.registration || '',
    typeCode: object.typeCode || '',
    aircraftClass: object.aircraftClass || '',
    aircraftClassLabel: object.aircraftClassLabel || '',
    altitude: object.altitude ?? null,
    speed: object.speed ?? null,
    headingDegrees: object.headingDegrees ?? null,
    verticalRate: object.verticalRate ?? null,
    squawk: object.squawk || '',
    ageSeconds: object.ageSeconds ?? null,
    observedAt: object.observedAt || '',
    feedTimestamp: object.observedAt || '',
    sourceName: object.sourceName || ADSB_SOURCE_NAME,
    sourceLicense: object.sourceLicense || ADSB_SOURCE_LICENSE,
    spatialPrecision: object.spatialPrecision || 'Live reported aircraft position',
    iqaiType: 'live_aircraft'
  };
}

function buildAircraftGraphic(object, objectId, Graphic, Point) {
  return new Graphic({
    geometry: new Point({
      longitude: object.longitude,
      latitude: object.latitude,
      spatialReference: { wkid: 4326 }
    }),
    attributes: buildAircraftAttributes(object, objectId)
  });
}

function applyAircraftDataToGraphic(graphic, object, objectId, PointCtor, updateGeometry = true) {
  if (updateGeometry) {
    graphic.geometry = new PointCtor({
      longitude: object.longitude,
      latitude: object.latitude,
      spatialReference: { wkid: 4326 }
    });
  }
  Object.assign(graphic.attributes, buildAircraftAttributes(object, objectId));
  return graphic;
}

function editResultFailed(results = []) {
  return results.some((result) => result?.error != null);
}

async function queryExistingAircraftMaps(layer) {
  const featureById = new Map();
  const result = await layer.queryFeatures({
    where: '1=1',
    outFields: ['*'],
    returnGeometry: true
  });
  for (const feature of result.features || []) {
    const liveObjectId = String(feature.attributes?.liveObjectId || '').trim();
    if (liveObjectId) featureById.set(liveObjectId, feature);
  }
  return {
    featureById,
    queriedCount: result.features?.length ?? 0
  };
}

export async function prepareAircraftEditBundle(layer, objects, knownIds, modules) {
  const { Graphic, Point } = modules;
  const plan = planLiveObjectEdits(objects, knownIds, 'liveObjectId');
  const objectById = new Map();
  for (const object of objects || []) {
    const id = String(object?.liveObjectId || '').trim();
    if (id && !objectById.has(id)) objectById.set(id, object);
  }

  const { featureById, queriedCount } = await queryExistingAircraftMaps(layer);
  const addFeatures = [];
  const updateFeatures = [];
  let fallbackId = 1;

  for (const id of plan.toAdd) {
    const object = objectById.get(id);
    if (!object) continue;
    const objectId = stableAircraftObjectId(id, fallbackId);
    fallbackId += 1;
    addFeatures.push(buildAircraftGraphic(object, objectId, Graphic, Point));
  }

  for (const id of plan.toUpdate) {
    const object = objectById.get(id);
    if (!object) continue;
    const existingGraphic = featureById.get(id);
    if (!existingGraphic) continue;
    const objectId = existingGraphic.attributes?.OBJECTID ?? stableAircraftObjectId(id, fallbackId);
    fallbackId += 1;
    applyAircraftDataToGraphic(existingGraphic, object, objectId, Point, false);
    updateFeatures.push(existingGraphic);
  }

  const deleteFeatures = plan.toDelete.map((id) => ({
    objectId: stableAircraftObjectId(id, 1)
  }));

  return {
    plan,
    addFeatures,
    updateFeatures,
    deleteFeatures,
    queriedCount
  };
}

async function fetchLiveAircraftPayload() {
  const response = await fetch('/api/spatial/live/aircraft', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Live aircraft response was not valid JSON (HTTP ${response.status})`);
  }
  if (!body?.ok) {
    throw new Error(body?.message || body?.error || `Live aircraft HTTP ${response.status}`);
  }
  return body;
}

async function removeEmptyLiveMobilityGroup(webMap) {
  const entry = findLayerByIdRecursive(webMap, LIVE_MOBILITY_GROUP_ID);
  const group = entry?.layer;
  if (!group || group.type !== 'group') return;
  const childCount = group.layers?.length ?? 0;
  if (childCount === 0) {
    webMap.remove(group);
  }
}

async function resolveAviationGroup(webMap, modules) {
  const byTitle = findGroupLayerByTitle(webMap, AVIATION_GROUP_TITLE);
  if (byTitle) return byTitle;

  console.warn('[IQAI] Aviation group unavailable — aircraft will attach to WebMap root');
  return null;
}

async function ensureAircraftLayer(modules) {
  const webMap = getWebMap();
  if (!webMap) return null;

  aviationGroup = await resolveAviationGroup(webMap, modules);

  const existing = findLayerByIdRecursive(webMap, AIRCRAFT_LAYER_ID)?.layer;
  if (existing) {
    if (aviationGroup && existing.parent !== aviationGroup) {
      await attachLayerToGroup(existing, aviationGroup);
    }
    aircraftLayer = existing;
    attachAircraftVisibilityWatchers();
    await removeEmptyLiveMobilityGroup(webMap);
    return aircraftLayer;
  }

  const { FeatureLayer } = modules;
  const layer = new FeatureLayer({
    id: AIRCRAFT_LAYER_ID,
    title: AIRCRAFT_LAYER_TITLE,
    source: [],
    objectIdField: 'OBJECTID',
    fields: [
      { name: 'OBJECTID', type: 'oid' },
      { name: 'liveObjectId', type: 'string' },
      { name: 'sourceObjectId', type: 'string' },
      { name: 'callsign', type: 'string' },
      { name: 'registration', type: 'string' },
      { name: 'typeCode', type: 'string' },
      { name: 'aircraftClass', type: 'string' },
      { name: 'aircraftClassLabel', type: 'string' },
      { name: 'altitude', type: 'double', nullable: true },
      { name: 'speed', type: 'double', nullable: true },
      { name: 'headingDegrees', type: 'double', nullable: true },
      { name: 'verticalRate', type: 'double', nullable: true },
      { name: 'squawk', type: 'string' },
      { name: 'ageSeconds', type: 'double', nullable: true },
      { name: 'observedAt', type: 'string' },
      { name: 'feedTimestamp', type: 'string' },
      { name: 'sourceName', type: 'string' },
      { name: 'sourceLicense', type: 'string' },
      { name: 'spatialPrecision', type: 'string' },
      { name: 'iqaiType', type: 'string' }
    ],
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: buildAircraftLayerRenderer(),
    popupEnabled: true,
    popupTemplate: {
      title: '{callsign}',
      content: 'Live aircraft from ADSB.lol'
    },
    listMode: 'show',
    visible: false
  });

  await layer.load();
  if (aviationGroup) {
    aviationGroup.add(layer);
  } else {
    webMap.add(layer);
  }
  aircraftLayer = layer;
  attachAircraftVisibilityWatchers();
  await removeEmptyLiveMobilityGroup(webMap);
  return layer;
}

export function buildAircraftStatus(payload = {}, stale = false, error = null) {
  return {
    status: payload.status || (stale ? 'STALE' : 'CURRENT'),
    stale,
    error,
    aircraftCount: payload.aircraftCount ?? lastSnapshotObjects.length,
    feedTimestamp: payload.feedTimestamp || null,
    receivedAt: payload.receivedAt || null,
    source: payload.source || ADSB_SOURCE_NAME,
    sourceLicense: payload.sourceLicense || ADSB_SOURCE_LICENSE,
    sourceClass: payload.sourceClass || 'OPEN_COMMUNITY_LIVE',
    refreshSeconds: AIRCRAFT_CLIENT_REFRESH_MS / 1000,
    spatialPrecision: 'Live reported aircraft position',
    aiCost: '$0.00'
  };
}

async function applyAircraftEdits(layer, objects, modules) {
  const bundle = await prepareAircraftEditBundle(layer, objects, trackedObjectIds, modules);
  const { plan, addFeatures, updateFeatures, deleteFeatures } = bundle;

  if (!addFeatures.length && !updateFeatures.length && !deleteFeatures.length) {
    queueAircraftMotion(layer, objects, modules.Point);
    return { added: 0, updated: 0, deleted: 0, rendered: await layer.queryFeatureCount() };
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
    throw new Error('Aircraft applyEdits returned errors');
  }

  trackedObjectIds = plan.currentIds;
  queueAircraftMotion(layer, objects, modules.Point);

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
    rendered
  };
}

async function refreshAircraftLive(onStatus, onTableUpdate, onError) {
  if (refreshInFlight || !isLayerPollingActive()) return;
  refreshInFlight = true;
  let fetchMeta = null;
  try {
    const modules = {
      FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
      Graphic: await importArc('@arcgis/core/Graphic.js'),
      Point: await importArc('@arcgis/core/geometry/Point.js'),
      GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
    };
    const layer = await ensureAircraftLayer(modules);
    if (!layer) return;

    const payload = await fetchLiveAircraftPayload();
    fetchMeta = payload;
    const objects = payload.objects || [];
    lastSnapshotObjects = objects;
    lastSuccessfulFeedMeta = {
      feedTimestamp: payload.feedTimestamp,
      receivedAt: payload.receivedAt,
      aircraftCount: payload.aircraftCount
    };

    await applyAircraftEdits(layer, objects, modules);

    const status = buildAircraftStatus(payload);
    if (onStatus) onStatus(status);
    if (onTableUpdate) {
      onTableUpdate(buildLiveAircraftTableModel(objects, stableAircraftObjectId));
    }
  } catch (error) {
    const message = error?.message || 'Aircraft refresh failed';
    if (onError) onError(error);
    if (onStatus) {
      onStatus(buildAircraftStatus(
        fetchMeta || lastSuccessfulFeedMeta || {},
        true,
        message
      ));
    }
    console.warn('[IQAI] Aircraft live refresh failed', message);
  } finally {
    refreshInFlight = false;
  }
}

/**
 * @param {{ onStatus?: Function, onError?: Function, onRegistered?: Function, onTableUpdate?: Function }} [options]
 */
export function startAircraftLiveLayer(options = {}) {
  if (refreshTimer != null) {
    return { stop: stopAircraftLiveLayer };
  }

  const boot = async () => {
    try {
      const modules = {
        FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
        Graphic: await importArc('@arcgis/core/Graphic.js'),
        Point: await importArc('@arcgis/core/geometry/Point.js'),
        GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
      };
      await ensureAircraftLayer(modules);
      if (options.onRegistered) options.onRegistered();
    } catch (error) {
      console.warn('[IQAI] Aircraft layer registration failed', error?.message || error);
      if (options.onStatus) {
        options.onStatus(buildAircraftStatus({}, true, error?.message || 'Aircraft layer registration failed'));
      }
    }

    const tick = () => refreshAircraftLive(options.onStatus, options.onTableUpdate, options.onError);
    if (aircraftLayer) {
      aircraftLayer.watch('visible', (visible) => {
        if (visible) void tick();
      });
    }
    refreshTimer = window.setInterval(() => {
      if (isLayerPollingActive()) void tick();
    }, AIRCRAFT_CLIENT_REFRESH_MS);
  };

  void boot();
  return { stop: stopAircraftLiveLayer };
}

export function stopAircraftLiveLayer() {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  stopAircraftMotion();
}

export function getAircraftLiveLayer() {
  return aircraftLayer;
}

export function getAviationGroup() {
  return aviationGroup;
}

export function getLastAircraftSnapshot() {
  return lastSnapshotObjects;
}

/** Legacy alias for layer command sync */
export function syncLiveMobilityVisibility(visible) {
  syncAircraftVisibility(visible);
  if (visible) ensureAviationParentVisible();
}

/** @param {Set<string>} ids */
export function __resetAircraftTrackingForTests(ids = new Set()) {
  trackedObjectIds = new Set(ids);
  lastSuccessfulFeedMeta = null;
  lastSnapshotObjects = [];
  aircraftLayer = null;
  aviationGroup = null;
  stopAircraftMotion();
}
