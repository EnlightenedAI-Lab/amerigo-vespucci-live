/**
 * Spatial V2 Imagery Time Engine.
 * IQAI owns imagery time. The MapView temporal filter is not the product clock.
 */

import { getMapView, getRuntimePlane, getWebMap } from '../map/map-foundation.js';
import { getImageryPlane, initGroundController } from './ground-controller.js';
import {
  AOI_MODE,
  DATE_KIND,
  ENTITLEMENT_STATE,
  MATCH_KIND,
  TIME_ENGINE_LAYER_ID,
  TIME_ENGINE_STATE,
  TIME_PROVIDER_FILTER,
  nearestByIsoDate
} from './imagery-contract.js';
import { esriWaybackProvider } from './providers/esri-wayback-provider.js';
import { nearmapProvider } from './providers/nearmap-provider.js';

const listeners = new Set();

let aoiMode = AOI_MODE.VIEWPORT;
let requestedDate = new Date().toISOString().slice(0, 10);
let providerFilter = TIME_PROVIDER_FILTER.ALL;
let engineState = TIME_ENGINE_STATE.IDLE;
let observations = [];
let selectedId = null;
let activeId = null;
let matchKind = MATCH_KIND.NONE;
let matchDeltaDays = null;
let entitlements = {
  wayback: ENTITLEMENT_STATE.READY,
  nearmap: ENTITLEMENT_STATE.ENTITLEMENT_MISSING
};
let lastError = null;
let lastLimitation = null;
let lastAoi = null;
let generation = 0;
let activeLayer = null;

function emit() {
  const snapshot = getTimeEngineSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI V2] time engine listener failed', error);
    }
  }
}

function selectedObservation() {
  return observations.find((item) => item.id === selectedId) || null;
}

function activeObservation() {
  return observations.find((item) => item.id === activeId) || null;
}

function sortObservations(list) {
  return [...list].sort((a, b) => String(a.matchDate || '').localeCompare(String(b.matchDate || '')));
}

function applyMatch(list, date) {
  const matched = nearestByIsoDate(list, date, 'matchDate');
  return {
    observations: list,
    selectedId: matched.record?.id || list[0]?.id || null,
    matchKind: matched.match,
    matchDeltaDays: matched.deltaDays
  };
}

export function readMapAoi(mode = aoiMode) {
  const view = getMapView();
  if (!view) throw new Error('Map foundation is not ready.');
  const center = view.center;
  const longitude = center?.longitude;
  const latitude = center?.latitude;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error('Map center is not a geographic point.');
  }
  const extent = view.extent;
  return {
    type: mode,
    longitude,
    latitude,
    scale: view.scale || null,
    zoom: view.zoom || null,
    xmin: extent?.xmin ?? null,
    ymin: extent?.ymin ?? null,
    xmax: extent?.xmax ?? null,
    ymax: extent?.ymax ?? null,
    wkid: extent?.spatialReference?.wkid || extent?.spatialReference?.latestWkid || null
  };
}

export function subscribeTimeEngine(listener) {
  listeners.add(listener);
  listener(getTimeEngineSnapshot());
  return () => listeners.delete(listener);
}

export function getTimeEngineSnapshot() {
  const selected = selectedObservation();
  const active = activeObservation();
  return {
    aoiMode,
    requestedDate,
    providerFilter,
    engineState,
    observations: observations.map((item) => ({ ...item })),
    selectedId,
    activeId,
    selected,
    active,
    matchKind,
    deltaDays: matchDeltaDays,
    entitlements: { ...entitlements },
    error: lastError,
    limitation: lastLimitation,
    aoi: lastAoi,
    layerId: TIME_ENGINE_LAYER_ID,
    dateKindSelected: selected?.dateKindUsed || DATE_KIND.UNRESOLVED
  };
}

export function setTimeEngineOptions(partial = {}) {
  if (partial.aoiMode === AOI_MODE.VIEWPORT || partial.aoiMode === AOI_MODE.POINT) {
    aoiMode = partial.aoiMode;
  }
  if (typeof partial.requestedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(partial.requestedDate)) {
    requestedDate = partial.requestedDate;
  }
  if (Object.values(TIME_PROVIDER_FILTER).includes(partial.providerFilter)) {
    providerFilter = partial.providerFilter;
  }
  if (observations.length && requestedDate) {
    const next = applyMatch(observations, requestedDate);
    selectedId = next.selectedId;
    matchKind = next.matchKind;
    matchDeltaDays = next.matchDeltaDays;
  }
  emit();
  return getTimeEngineSnapshot();
}

export async function initTimeEngine() {
  await initGroundController();
  try {
    entitlements.nearmap = await nearmapProvider.probeEntitlement();
  } catch {
    entitlements.nearmap = ENTITLEMENT_STATE.FAILED;
  }
  if (engineState === TIME_ENGINE_STATE.IDLE) {
    engineState = TIME_ENGINE_STATE.READY;
  }
  emit();
  return getTimeEngineSnapshot();
}

function planeCollection(plane) {
  return plane?.layers || null;
}

function findPlaneLayer(plane, layerId) {
  const layers = planeCollection(plane);
  if (!layers) return null;
  if (typeof layers.find === 'function') {
    return layers.find((item) => item?.id === layerId) || null;
  }
  const list = layers.toArray ? layers.toArray() : [...layers];
  return list.find((item) => item?.id === layerId) || null;
}

async function replaceTimeLayer(layer) {
  const plane = getImageryPlane();
  if (!plane) throw new Error('Imagery plane is not ready.');
  plane.visible = true;
  plane.opacity = 1;
  const layers = planeCollection(plane);
  if (!layers || typeof layers.add !== 'function') {
    throw new Error('Imagery plane has no layer collection.');
  }
  const existing = findPlaneLayer(plane, TIME_ENGINE_LAYER_ID)
    || (activeLayer && !activeLayer.destroyed ? activeLayer : null);
  if (existing) {
    if (typeof layers.remove === 'function') layers.remove(existing);
    if (existing !== layer && typeof existing.destroy === 'function') {
      try { existing.destroy(); } catch { /* session layer */ }
    }
  }
  if (layer) {
    layer.id = TIME_ENGINE_LAYER_ID;
    layer.visible = true;
    layer.opacity = 1;
    layer.popupEnabled = false;
    layer.listMode = 'hide';
    layers.add(layer);
    const webmap = getWebMap();
    const runtime = getRuntimePlane();
    if (webmap?.layers) {
      const runtimeIndex = webmap.layers.findIndex?.((item) => item === runtime || item?.id === runtime?.id);
      if (Number.isFinite(runtimeIndex) && runtimeIndex > 0) {
        webmap.layers.reorder(plane, runtimeIndex - 1);
      }
    }
  } else if (getWebMap()?.layers?.reorder) {
    getWebMap().layers.reorder(plane, 0);
  }
  activeLayer = layer || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function settleTimeLayer(layer) {
  const view = getMapView();
  const plane = getImageryPlane();
  if (!view || !layer) return;
  if (plane) {
    plane.visible = true;
    plane.opacity = 1;
  }
  layer.visible = true;
  layer.opacity = 1;
  if (typeof layer.load === 'function') {
    await withTimeout(layer.load(), 8000, 'Time observation load timed out').catch(() => {});
  }
  let layerView = null;
  try {
    layerView = await withTimeout(
      view.whenLayerView(layer),
      8000,
      'Time observation LayerView timed out'
    );
  } catch {
    const views = view.allLayerViews;
    const list = views?.toArray ? views.toArray() : (views ? [...views] : []);
    layerView = list.find((item) => item?.layer === layer) || null;
  }
  if (layerView) {
    const started = Date.now();
    while (Date.now() - started < 4000) {
      if (layerView.updating === false && layerView.suspended !== true) break;
      await sleep(40);
    }
  }
  const attached = findPlaneLayer(plane, TIME_ENGINE_LAYER_ID) === layer
    || activeLayer === layer;
  if (!attached) {
    throw new Error('Time observation was not attached to the imagery plane.');
  }
  // A busy authored WebMap can keep view.updating true forever. That is not
  // a failed observation. Timeout must not roll back an attached layer.
}

export async function discoverImageryTime(options = {}) {
  setTimeEngineOptions(options);
  await initTimeEngine();
  const token = ++generation;
  engineState = TIME_ENGINE_STATE.DISCOVERING;
  lastError = null;
  lastLimitation = null;
  emit();
  try {
    const aoi = readMapAoi(aoiMode);
    lastAoi = aoi;
    const collected = [];
    const limitations = [];
    if (providerFilter !== TIME_PROVIDER_FILTER.NEARMAP) {
      const wayback = await esriWaybackProvider.discover(aoi);
      entitlements.wayback = wayback.entitlement || ENTITLEMENT_STATE.FAILED;
      collected.push(...(wayback.observations || []));
      if (wayback.limitation) limitations.push(wayback.limitation);
    }
    if (providerFilter !== TIME_PROVIDER_FILTER.WAYBACK) {
      const nearmap = await nearmapProvider.discover(aoi);
      entitlements.nearmap = nearmap.entitlement || ENTITLEMENT_STATE.FAILED;
      collected.push(...(nearmap.observations || []));
      if (nearmap.limitation) limitations.push(nearmap.limitation);
      if (nearmap.error && nearmap.entitlement === ENTITLEMENT_STATE.FAILED) {
        throw new Error(nearmap.error);
      }
    }
    if (token !== generation) return getTimeEngineSnapshot();
    observations = sortObservations(collected).map((item) => ({
      ...item,
      requestedDate
    }));
    const matched = applyMatch(observations, requestedDate);
    selectedId = matched.selectedId;
    matchKind = matched.matchKind;
    matchDeltaDays = matched.matchDeltaDays;
    lastLimitation = limitations.filter(Boolean).join(' ') || null;
    engineState = TIME_ENGINE_STATE.READY;
    const selected = selectedObservation();
    if (selected?.providerId === 'esri-wayback') {
      const resolved = await esriWaybackProvider.resolveAcquisition(selected, aoi);
      observations = observations.map((item) => item.id === resolved.id ? { ...item, ...resolved } : item);
    }
    emit();
    return getTimeEngineSnapshot();
  } catch (error) {
    if (token !== generation) return getTimeEngineSnapshot();
    lastError = String(error?.message || error);
    engineState = TIME_ENGINE_STATE.ERROR;
    emit();
    throw error;
  }
}

export async function activateObservation(observationId = selectedId) {
  await initTimeEngine();
  const observation = observations.find((item) => item.id === observationId);
  if (!observation) throw new Error('No imagery observation is selected.');
  const previous = activeLayer;
  const previousId = activeId;
  const token = ++generation;
  engineState = TIME_ENGINE_STATE.APPLYING;
  lastError = null;
  emit();
  try {
    const provider = observation.providerId === 'nearmap' ? nearmapProvider : esriWaybackProvider;
    const layer = await provider.createLayer(observation);
    await replaceTimeLayer(layer);
    await settleTimeLayer(layer);
    if (token !== generation) return getTimeEngineSnapshot();
    selectedId = observation.id;
    activeId = observation.id;
    engineState = TIME_ENGINE_STATE.READY;
    emit();
    return getTimeEngineSnapshot();
  } catch (error) {
    if (token !== generation) return getTimeEngineSnapshot();
    lastError = String(error?.message || error);
    try {
      await replaceTimeLayer(previous);
      activeId = previousId;
    } catch {
      activeId = null;
      activeLayer = null;
    }
    engineState = TIME_ENGINE_STATE.ERROR;
    emit();
    throw error;
  }
}

export async function deactivateObservation() {
  await initTimeEngine();
  engineState = TIME_ENGINE_STATE.APPLYING;
  emit();
  await replaceTimeLayer(null);
  activeId = null;
  engineState = TIME_ENGINE_STATE.READY;
  emit();
  return getTimeEngineSnapshot();
}

export async function selectAdjacentObservation(step) {
  if (!observations.length) throw new Error('Discover imagery time before stepping.');
  const index = Math.max(0, observations.findIndex((item) => item.id === selectedId));
  const nextIndex = Math.min(observations.length - 1, Math.max(0, index + step));
  selectedId = observations[nextIndex].id;
  const selected = selectedObservation();
  if (selected?.matchDate && requestedDate) {
    const matched = nearestByIsoDate([selected], requestedDate, 'matchDate');
    matchKind = selected.matchDate === requestedDate ? MATCH_KIND.EXACT : MATCH_KIND.NEAREST;
    matchDeltaDays = matched.deltaDays;
  }
  emit();
  if (activeId) {
    return activateObservation(selectedId);
  }
  return getTimeEngineSnapshot();
}

export function previousObservation() {
  return selectAdjacentObservation(-1);
}

export function nextObservation() {
  return selectAdjacentObservation(1);
}

export async function selectObservation(observationId) {
  if (!observations.some((item) => item.id === observationId)) {
    throw new Error('Unknown imagery observation.');
  }
  selectedId = observationId;
  emit();
  return getTimeEngineSnapshot();
}
