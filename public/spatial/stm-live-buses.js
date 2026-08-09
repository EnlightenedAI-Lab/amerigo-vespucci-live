/**
 * STM live bus positions — client polls IQAI server; STM API key stays server-side.
 */
import {
  importArc,
  getWebMap,
  getMapView
} from './spatial-arcgis-runtime.js';
import { ensureTransportationAccessGroup, findLayerByIdRecursive, attachLayerToGroup } from './runtime-layer-groups.js';

const STM_LAYER_ID = 'stm-live-buses';
const STM_LAYER_TITLE = 'STM — Live Buses';
const STM_CLIENT_REFRESH_MS = 20_000;
const STM_SOURCE_LABEL = 'STM GTFS-Realtime';

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let stmLiveLayer = null;
/** @type {number | null} */
let refreshTimer = null;
/** @type {boolean} */
let refreshInFlight = false;
/** @type {Set<string>} */
let trackedVehicleIds = new Set();
/** @type {{ retrievedAt?: string, feedTimestampIso?: string, vehicleCount?: number } | null} */
let lastSuccessfulFeedMeta = null;

export function objectIdFromVehicleId(vehicleId, fallback) {
  const numeric = Number(vehicleId);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  let hash = 0;
  const text = String(vehicleId || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || fallback;
}

export function stableObjectId(vehicleId, fallback = 1) {
  return objectIdFromVehicleId(vehicleId, fallback);
}

function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return '—';
  }
}

/**
 * Plan add/update/delete vehicle IDs for the next applyEdits call.
 * @param {Array<{ vehicleId?: string }>} vehicles
 * @param {Set<string>} knownVehicleIds
 */
export function planStmVehicleEdits(vehicles, knownVehicleIds) {
  const currentIds = new Set();
  const toAdd = [];
  const toUpdate = [];

  for (const vehicle of vehicles || []) {
    const vehicleId = String(vehicle?.vehicleId || '').trim();
    if (!vehicleId) continue;
    if (currentIds.has(vehicleId)) continue;
    currentIds.add(vehicleId);
    if (knownVehicleIds.has(vehicleId)) {
      toUpdate.push(vehicleId);
    } else {
      toAdd.push(vehicleId);
    }
  }

  const toDelete = [];
  for (const vehicleId of knownVehicleIds) {
    if (!currentIds.has(vehicleId)) {
      toDelete.push(vehicleId);
    }
  }

  return { toAdd, toUpdate, toDelete, currentIds };
}

export function captureFeedMeta(payload = {}) {
  return {
    retrievedAt: payload.retrievedAt,
    feedTimestampIso: payload.feedTimestampIso,
    vehicleCount: payload.vehicleCount
  };
}

/**
 * @param {object} fetchMeta
 * @param {string} [errorMessage]
 * @param {number} [vehicleCount]
 */
export function buildStaleStatus(fetchMeta, errorMessage, vehicleCount = trackedVehicleIds.size) {
  const meta = fetchMeta || lastSuccessfulFeedMeta || {};
  return {
    stale: true,
    error: errorMessage || 'STM refresh failed',
    vehicleCount: vehicleCount ?? meta.vehicleCount ?? trackedVehicleIds.size,
    retrievedAt: meta.retrievedAt,
    feedTimestampIso: meta.feedTimestampIso,
    source: STM_SOURCE_LABEL
  };
}

export function buildVehicleAttributes(vehicle, objectId) {
  return {
    OBJECTID: objectId,
    vehicleId: String(vehicle.vehicleId || ''),
    routeId: vehicle.routeId || '',
    tripId: vehicle.tripId || '',
    bearing: vehicle.bearing ?? null,
    speed: vehicle.speed ?? null,
    vehicleTimestamp: vehicle.timestamp ?? null,
    vehicleTimestampIso: formatTimestamp(vehicle.timestamp),
    sourceName: STM_SOURCE_LABEL,
    iqaiType: 'stm_live_bus'
  };
}

/**
 * Modify an existing queried Graphic in place for applyEdits updateFeatures.
 */
export function applyVehicleDataToGraphic(graphic, vehicle, objectId, PointCtor) {
  graphic.geometry = new PointCtor({
    longitude: vehicle.longitude,
    latitude: vehicle.latitude,
    spatialReference: { wkid: 4326 }
  });
  Object.assign(graphic.attributes, buildVehicleAttributes(vehicle, objectId));
  return graphic;
}

function buildVehicleGraphic(vehicle, objectId, Graphic, Point) {
  return new Graphic({
    geometry: new Point({
      longitude: vehicle.longitude,
      latitude: vehicle.latitude,
      spatialReference: { wkid: 4326 }
    }),
    attributes: buildVehicleAttributes(vehicle, objectId)
  });
}

function editResultFailed(results = []) {
  return results.some((result) => result?.error != null);
}

function vehicleMapFromPayload(vehicles = []) {
  const vehicleById = new Map();
  for (const vehicle of vehicles) {
    const vehicleId = String(vehicle?.vehicleId || '').trim();
    if (!vehicleId || vehicleById.has(vehicleId)) continue;
    vehicleById.set(vehicleId, vehicle);
  }
  return vehicleById;
}

async function queryExistingFeatureMaps(layer, knownVehicleIds) {
  const featureByVehicleId = new Map();

  if (!knownVehicleIds?.size) {
    return { featureByVehicleId, queriedCount: 0 };
  }

  const result = await layer.queryFeatures({
    where: '1=1',
    outFields: ['*'],
    returnGeometry: true
  });

  for (const feature of result.features || []) {
    const vehicleId = String(feature.attributes?.vehicleId || '').trim();
    if (vehicleId) {
      featureByVehicleId.set(vehicleId, feature);
    }
  }

  return {
    featureByVehicleId,
    queriedCount: result.features?.length ?? 0
  };
}

/**
 * Build applyEdits bundles. Updates use queried layer Graphics, not fresh replacements.
 */
export async function prepareStmVehicleEditBundle(layer, payload, knownVehicleIds, modules) {
  const { Graphic, Point } = modules;
  const vehicles = payload.vehicles || [];
  const plan = planStmVehicleEdits(vehicles, knownVehicleIds);
  const vehicleById = vehicleMapFromPayload(vehicles);
  const { featureByVehicleId, queriedCount } = await queryExistingFeatureMaps(layer, knownVehicleIds);

  const addFeatures = [];
  const updateFeatures = [];
  let fallbackId = 1;

  for (const vehicleId of plan.toAdd) {
    const vehicle = vehicleById.get(vehicleId);
    if (!vehicle) continue;
    const objectId = stableObjectId(vehicleId, fallbackId);
    fallbackId += 1;
    addFeatures.push(buildVehicleGraphic(vehicle, objectId, Graphic, Point));
  }

  for (const vehicleId of plan.toUpdate) {
    const vehicle = vehicleById.get(vehicleId);
    if (!vehicle) continue;
    const existingGraphic = featureByVehicleId.get(vehicleId);
    if (!existingGraphic) continue;
    const objectId = existingGraphic.attributes?.OBJECTID ?? stableObjectId(vehicleId, fallbackId);
    fallbackId += 1;
    applyVehicleDataToGraphic(existingGraphic, vehicle, objectId, Point);
    updateFeatures.push(existingGraphic);
  }

  const deleteFeatures = plan.toDelete.map((vehicleId) => ({
    objectId: stableObjectId(vehicleId, 1)
  }));

  return {
    plan,
    addFeatures,
    updateFeatures,
    deleteFeatures,
    queriedCount
  };
}

async function fetchLiveBuses() {
  const response = await fetch('/api/spatial/stm/live-buses', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  const body = await response.json();
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || `STM live buses HTTP ${response.status}`);
  }
  return body;
}

async function ensureStmLayer(modules) {
  const webMap = getWebMap();
  if (!webMap) return null;

  const group = await ensureTransportationAccessGroup(modules);
  const existingEntry = findLayerByIdRecursive(webMap, STM_LAYER_ID);
  if (existingEntry?.layer) {
    stmLiveLayer = existingEntry.layer;
    if (group) await attachLayerToGroup(stmLiveLayer, group);
    return stmLiveLayer;
  }

  const { FeatureLayer } = modules;

  const layer = new FeatureLayer({
    id: STM_LAYER_ID,
    title: STM_LAYER_TITLE,
    source: [],
    objectIdField: 'OBJECTID',
    fields: [
      { name: 'OBJECTID', type: 'oid' },
      { name: 'vehicleId', type: 'string' },
      { name: 'routeId', type: 'string' },
      { name: 'tripId', type: 'string' },
      { name: 'bearing', type: 'double' },
      { name: 'speed', type: 'double' },
      { name: 'vehicleTimestamp', type: 'integer' },
      { name: 'vehicleTimestampIso', type: 'string' },
      { name: 'sourceName', type: 'string' },
      { name: 'iqaiType', type: 'string' }
    ],
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-marker',
        style: 'square',
        color: [234, 88, 12, 0.95],
        size: 9,
        outline: { color: [255, 255, 255, 1], width: 1.5 }
      }
    },
    popupEnabled: true,
    popupTemplate: {
      title: 'STM bus {routeId}',
      outFields: ['*'],
      content: [{
        type: 'fields',
        fieldInfos: [
          { fieldName: 'vehicleId', label: 'Vehicle ID' },
          { fieldName: 'routeId', label: 'Route ID' },
          { fieldName: 'tripId', label: 'Trip ID' },
          { fieldName: 'bearing', label: 'Bearing' },
          { fieldName: 'speed', label: 'Speed (m/s)' },
          { fieldName: 'vehicleTimestampIso', label: 'Timestamp' },
          { fieldName: 'sourceName', label: 'Source' }
        ]
      }]
    },
    listMode: 'show',
    visible: false
  });

  await layer.load();
  if (group) {
    group.add(layer);
  } else {
    webMap.add(layer);
  }
  stmLiveLayer = layer;
  return layer;
}

async function applyVehicleEdits(layer, payload, modules) {
  const bundle = await prepareStmVehicleEditBundle(layer, payload, trackedVehicleIds, modules);
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
      vehicleCount: payload.vehicleCount ?? rendered,
      retrievedAt: payload.retrievedAt,
      feedTimestampIso: payload.feedTimestampIso,
      source: payload.source || STM_SOURCE_LABEL
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
    throw new Error('STM applyEdits returned errors');
  }

  trackedVehicleIds = plan.currentIds;

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
    vehicleCount: payload.vehicleCount ?? rendered,
    retrievedAt: payload.retrievedAt,
    feedTimestampIso: payload.feedTimestampIso,
    source: payload.source || STM_SOURCE_LABEL
  };
}

async function updateLayerGraphics(payload, modules) {
  const layer = await ensureStmLayer(modules);
  if (!layer) return null;
  return applyVehicleEdits(layer, payload, modules);
}

async function refreshStmLiveBuses(onStatus, onError) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  let fetchMeta = null;
  try {
    const modules = {
      FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
      Graphic: await importArc('@arcgis/core/Graphic.js'),
      Point: await importArc('@arcgis/core/geometry/Point.js'),
      GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
    };
    const payload = await fetchLiveBuses();
    fetchMeta = captureFeedMeta(payload);
    const status = await updateLayerGraphics(payload, modules);
    lastSuccessfulFeedMeta = fetchMeta;
    if (status && onStatus) onStatus(status);
  } catch (error) {
    if (onError) onError(error);
    if (onStatus) {
      onStatus(buildStaleStatus(fetchMeta, error?.message || 'STM refresh failed'));
    }
    console.warn('[IQAI] STM live buses refresh failed', error?.message || error);
  } finally {
    refreshInFlight = false;
  }
}

/**
 * Start polling STM live buses and maintain a single runtime layer.
 * @param {{ onStatus?: (status: object) => void, onError?: (error: Error) => void }} [options]
 */
export function startStmLiveBusesLayer(options = {}) {
  if (refreshTimer != null) {
    return { stop: stopStmLiveBusesLayer };
  }

  const boot = async () => {
    try {
      const modules = {
        FeatureLayer: await importArc('@arcgis/core/layers/FeatureLayer.js'),
        Graphic: await importArc('@arcgis/core/Graphic.js'),
        Point: await importArc('@arcgis/core/geometry/Point.js'),
        GroupLayer: await importArc('@arcgis/core/layers/GroupLayer.js')
      };
      await ensureStmLayer(modules);
    } catch (error) {
      console.warn('[IQAI] STM live layer registration failed', error?.message || error);
    }
    const tick = () => refreshStmLiveBuses(options.onStatus, options.onError);
    if (options.onRegistered) options.onRegistered();
    void tick();
    refreshTimer = window.setInterval(tick, STM_CLIENT_REFRESH_MS);
  };

  void boot();
  return { stop: stopStmLiveBusesLayer };
}

export function stopStmLiveBusesLayer() {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getStmLiveLayer() {
  return stmLiveLayer;
}

export function isMapReadyForStmLive() {
  return Boolean(getWebMap() && getMapView());
}

/** @param {Set<string>} ids */
export function __resetStmLiveBusTrackingForTests(ids = new Set()) {
  trackedVehicleIds = new Set(ids);
  lastSuccessfulFeedMeta = null;
}
