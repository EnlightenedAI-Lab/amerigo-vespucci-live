/**
 * Live vessel positions — AISStream via IQAI server proxy.
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
import { buildLiveVesselsTableModel } from './results-table-model.js';
import { buildVesselLayerRenderer } from './vessels-live-symbols.js';
import { queueAircraftMotion as queueVesselMotion, stopAircraftMotion as stopVesselMotion } from './aircraft-live-motion.js';
import {
  VESSELS_LAYER_ID,
  VESSELS_LAYER_TITLE,
  MARINE_GROUP_TITLE,
  VESSELS_CLIENT_REFRESH_MS,
  AISSTREAM_SOURCE_NAME,
  AISSTREAM_SOURCE_LICENSE
} from './vessels-live-config.js';

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let vesselsLayer = null;
/** @type {import('@arcgis/core/layers/GroupLayer').default | null} */
let marineGroup = null;
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
let vesselsVisibilitySyncing = false;

export function objectIdFromLiveObjectId(liveObjectId, fallback) {
  let hash = 0;
  const text = String(liveObjectId || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || fallback;
}

export function stableVesselObjectId(liveObjectId, fallback = 1) {
  return objectIdFromLiveObjectId(liveObjectId, fallback);
}

export function isVesselsLiveLayer(layer) {
  return layer?.id === VESSELS_LAYER_ID;
}

export function syncVesselsVisibility(visible) {
  if (vesselsVisibilitySyncing) return;
  vesselsVisibilitySyncing = true;
  if (vesselsLayer) vesselsLayer.visible = visible;
  if (visible) ensureMarineParentVisible();
  if (!visible) stopVesselMotion();
  vesselsVisibilitySyncing = false;
}

function ensureMarineParentVisible() {
  const parent = vesselsLayer?.parent;
  if (parent?.type === 'group' && !parent.visible) {
    parent.visible = true;
  }
}

function attachVesselsVisibilityWatchers() {
  if (!vesselsLayer || vesselsLayer.__vesselsVisibilityWatchAttached) return;
  vesselsLayer.__vesselsVisibilityWatchAttached = true;
  vesselsLayer.watch('visible', (visible) => {
    if (vesselsVisibilitySyncing) return;
    if (!visible) stopVesselMotion();
    else if (isLayerPollingActive()) void refreshVesselsLive();
  });
}

function isLayerPollingActive() {
  if (!vesselsLayer?.visible) return false;
  const parent = vesselsLayer.parent;
  if (parent?.type === 'group' && !parent.visible) return false;
  return true;
}

export function buildVesselAttributes(object, objectId) {
  return {
    OBJECTID: objectId,
    liveObjectId: String(object.liveObjectId || ''),
    sourceObjectId: object.sourceObjectId || '',
    displayName: object.displayName || '',
    callsign: object.callsign || '',
    mmsi: object.mmsi || object.sourceObjectId || '',
    imo: object.imo || '',
    vesselClass: object.vesselClass || '',
    vesselClassLabel: object.vesselClassLabel || '',
    shipTypeCode: object.shipTypeCode || '',
    speed: object.speed ?? null,
    headingDegrees: object.headingDegrees ?? null,
    courseOverGround: object.courseOverGround ?? null,
    navigationStatusLabel: object.navigationStatusLabel || object.status || '',
    destination: object.destination || '',
    eta: object.eta || '',
    draught: object.draught ?? null,
    ageSeconds: object.ageSeconds ?? null,
    observedAt: object.observedAt || '',
    feedTimestamp: object.observedAt || '',
    sourceName: object.sourceName || AISSTREAM_SOURCE_NAME,
    sourceLicense: object.sourceLicense || AISSTREAM_SOURCE_LICENSE,
    spatialPrecision: object.spatialPrecision || 'AIS reported position',
    iqaiType: 'live_vessel'
  };
}

function buildVesselGraphic(object, objectId, Graphic, Point) {
  return new Graphic({
    geometry: new Point({
      longitude: object.longitude,
      latitude: object.latitude,
      spatialReference: { wkid: 4326 }
    }),
    attributes: buildVesselAttributes(object, objectId)
  });
}

function applyVesselDataToGraphic(graphic, object, objectId, PointCtor, updateGeometry = true) {
  if (updateGeometry) {
    graphic.geometry = new PointCtor({
      longitude: object.longitude,
      latitude: object.latitude,
      spatialReference: { wkid: 4326 }
    });
  }
  Object.assign(graphic.attributes, buildVesselAttributes(object, objectId));
  return graphic;
}

function editResultFailed(results = []) {
  return results.some((result) => result?.error != null);
}

async function queryExistingVesselMaps(layer) {
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

export async function prepareVesselEditBundle(layer, objects, knownIds, modules) {
  const { Graphic, Point } = modules;
  const plan = planLiveObjectEdits(objects, knownIds, 'liveObjectId');
  const objectById = new Map();
  for (const object of objects || []) {
    const id = String(object?.liveObjectId || '').trim();
    if (id && !objectById.has(id)) objectById.set(id, object);
  }

  const { featureById, queriedCount } = await queryExistingVesselMaps(layer);
  const addFeatures = [];
  const updateFeatures = [];
  let fallbackId = 1;

  for (const id of plan.toAdd) {
    const object = objectById.get(id);
    if (!object) continue;
    const objectId = stableVesselObjectId(id, fallbackId);
    fallbackId += 1;
    addFeatures.push(buildVesselGraphic(object, objectId, Graphic, Point));
  }

  for (const id of plan.toUpdate) {
    const object = objectById.get(id);
    if (!object) continue;
    const existingGraphic = featureById.get(id);
    if (!existingGraphic) continue;
    const objectId = existingGraphic.attributes?.OBJECTID ?? stableVesselObjectId(id, fallbackId);
    fallbackId += 1;
    applyVesselDataToGraphic(existingGraphic, object, objectId, Point, false);
    updateFeatures.push(existingGraphic);
  }

  const deleteFeatures = plan.toDelete.map((id) => ({
    objectId: stableVesselObjectId(id, 1)
  }));

  return {
    plan,
    addFeatures,
    updateFeatures,
    deleteFeatures,
    queriedCount
  };
}

async function fetchLiveVesselsPayload() {
  const response = await fetch('/api/spatial/live/vessels', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Live vessels response was not valid JSON (HTTP ${response.status})`);
  }
  if (!body?.ok) {
    throw new Error(body?.message || body?.error || `Live vessels HTTP ${response.status}`);
  }
  return body;
}

async function resolveMarineGroup(webMap) {
  const byTitle = findGroupLayerByTitle(webMap, MARINE_GROUP_TITLE);
  if (byTitle) return byTitle;
  console.warn('[IQAI] Marine group unavailable — vessels will attach to WebMap root');
  return null;
}

async function ensureVesselsLayer(modules) {
  const webMap = getWebMap();
  if (!webMap) return null;

  marineGroup = await resolveMarineGroup(webMap);

  const existing = findLayerByIdRecursive(webMap, VESSELS_LAYER_ID)?.layer;
  if (existing) {
    if (marineGroup && existing.parent !== marineGroup) {
      await attachLayerToGroup(existing, marineGroup);
    }
    vesselsLayer = existing;
    attachVesselsVisibilityWatchers();
    return vesselsLayer;
  }

  const { FeatureLayer } = modules;
  const renderer = await buildVesselLayerRenderer(importArc);
  const layer = new FeatureLayer({
    id: VESSELS_LAYER_ID,
    title: VESSELS_LAYER_TITLE,
    source: [],
    objectIdField: 'OBJECTID',
    fields: [
      { name: 'OBJECTID', type: 'oid' },
      { name: 'liveObjectId', type: 'string' },
      { name: 'sourceObjectId', type: 'string' },
      { name: 'displayName', type: 'string' },
      { name: 'callsign', type: 'string' },
      { name: 'mmsi', type: 'string' },
      { name: 'imo', type: 'string' },
      { name: 'vesselClass', type: 'string' },
      { name: 'vesselClassLabel', type: 'string' },
      { name: 'shipTypeCode', type: 'string' },
      { name: 'speed', type: 'double', nullable: true },
      { name: 'headingDegrees', type: 'double', nullable: true },
      { name: 'courseOverGround', type: 'double', nullable: true },
      { name: 'navigationStatusLabel', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'eta', type: 'string' },
      { name: 'draught', type: 'double', nullable: true },
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
    renderer,
    popupEnabled: true,
    popupTemplate: {
      title: '{displayName}',
      content: 'Live vessel from AISStream.io'
    },
    listMode: 'show',
    visible: false
  });

  await layer.load();
  if (marineGroup) {
    marineGroup.add(layer);
  } else {
    webMap.add(layer);
  }
  vesselsLayer = layer;
  attachVesselsVisibilityWatchers();
  return layer;
}

export function buildVesselsStatus(payload = {}, stale = false, error = null) {
  return {
    status: payload.status || (stale ? 'STALE' : 'CURRENT'),
    stale,
    error,
    keyRequired: Boolean(payload.keyRequired),
    keyConfigured: Boolean(payload.keyConfigured),
    streamConnected: Boolean(payload.streamConnected),
    vesselCount: payload.vesselCount ?? lastSnapshotObjects.length,
    feedTimestamp: payload.feedTimestamp || null,
    receivedAt: payload.receivedAt || null,
    source: payload.source || AISSTREAM_SOURCE_NAME,
    sourceLicense: payload.sourceLicense || AISSTREAM_SOURCE_LICENSE,
    sourceClass: payload.sourceClass || 'OPEN_COMMUNITY_LIVE',
    refreshSeconds: VESSELS_CLIENT_REFRESH_MS / 1000,
    spatialPrecision: 'AIS reported position',
    aiCost: '$0.00'
  };
}

async function applyVesselEdits(layer, objects, modules) {
  const bundle = await prepareVesselEditBundle(layer, objects, trackedObjectIds, modules);
  const { plan, addFeatures, updateFeatures, deleteFeatures } = bundle;

  if (!addFeatures.length && !updateFeatures.length && !deleteFeatures.length) {
    queueVesselMotion(layer, objects, modules.Point);
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
    throw new Error('Vessel applyEdits returned errors');
  }

  trackedObjectIds = plan.currentIds;
  queueVesselMotion(layer, objects, modules.Point);

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

async function refreshVesselsLive(onStatus, onTableUpdate, onError) {
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
    const layer = await ensureVesselsLayer(modules);
    if (!layer) return;

    const payload = await fetchLiveVesselsPayload();
    fetchMeta = payload;
    const objects = payload.objects || [];
    lastSnapshotObjects = objects;
    lastSuccessfulFeedMeta = {
      feedTimestamp: payload.feedTimestamp,
      receivedAt: payload.receivedAt,
      vesselCount: payload.vesselCount
    };

    await applyVesselEdits(layer, objects, modules);

    const status = buildVesselsStatus(payload);
    if (onStatus) onStatus(status);
    if (onTableUpdate) {
      onTableUpdate(buildLiveVesselsTableModel(objects, stableVesselObjectId));
    }
  } catch (error) {
    const message = error?.message || 'Vessel refresh failed';
    if (onError) onError(error);
    if (onStatus) {
      onStatus(buildVesselsStatus(
        fetchMeta || lastSuccessfulFeedMeta || {},
        true,
        message
      ));
    }
    console.warn('[IQAI] Vessels live refresh failed', message);
  } finally {
    refreshInFlight = false;
  }
}

/**
 * @param {{ onStatus?: Function, onError?: Function, onRegistered?: Function, onTableUpdate?: Function }} [options]
 */
export function startVesselsLiveLayer(options = {}) {
  if (refreshTimer != null) {
    return { stop: stopVesselsLiveLayer };
  }

  const boot = async () => {
    try {
      const modules = {
        FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
        Graphic: await importArc('@arcgis/core/Graphic.js'),
        Point: await importArc('@arcgis/core/geometry/Point.js'),
        GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
      };
      await ensureVesselsLayer(modules);
      if (options.onRegistered) options.onRegistered();
    } catch (error) {
      console.warn('[IQAI] Vessels layer registration failed', error?.message || error);
      if (options.onStatus) {
        options.onStatus(buildVesselsStatus({}, true, error?.message || 'Vessels layer registration failed'));
      }
    }

    const tick = () => refreshVesselsLive(options.onStatus, options.onTableUpdate, options.onError);
    if (vesselsLayer) {
      vesselsLayer.watch('visible', (visible) => {
        if (visible) void tick();
      });
    }
    refreshTimer = window.setInterval(() => {
      if (isLayerPollingActive()) void tick();
    }, VESSELS_CLIENT_REFRESH_MS);
  };

  void boot();
  return { stop: stopVesselsLiveLayer };
}

export function stopVesselsLiveLayer() {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  stopVesselMotion();
}

export function getVesselsLiveLayer() {
  return vesselsLayer;
}

export function getMarineGroup() {
  return marineGroup;
}

export function getLastVesselSnapshot() {
  return lastSnapshotObjects;
}

/** @param {Set<string>} ids */
export function __resetVesselTrackingForTests(ids = new Set()) {
  trackedObjectIds = new Set(ids);
  lastSuccessfulFeedMeta = null;
  lastSnapshotObjects = [];
  vesselsLayer = null;
  marineGroup = null;
  stopVesselMotion();
}
