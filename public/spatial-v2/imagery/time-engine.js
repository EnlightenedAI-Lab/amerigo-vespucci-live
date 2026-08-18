/**
 * Spatial V2 Imagery Time Engine.
 * IQAI owns imagery time. The MapView temporal filter is not the product clock.
 *
 * SELECTED != ACTIVATED != LAYER_ATTACHED != LAYER_LOADED != DISPLAY_CONFIRMED.
 * engineState READY and layer.loaded do not prove pixels painted.
 */

import { getMapView, getRuntimePlane, getWebMap, suspendEmptyIqaiPlanes } from '../map/map-foundation.js';
import {
  getGroundSnapshot,
  getImageryPlane,
  initGroundController,
  setGroundMode
} from './ground-controller.js';
import { getImageryObservationLayer } from './imagery-plane.js';
import {
  ensureImageryTileReceiptInterceptor,
  observationTileReceipt
} from './imagery-tile-receipt.js';
import {
  AOI_MODE,
  DATE_KIND,
  DISPLAY_STATE,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  DROP_PIN_THEN_LATEST,
  IMAGERY_POOL,
  MATCH_KIND,
  PROVIDER_READINESS_STATE,
  TIME_ENGINE_LAYER_ID,
  TIME_ENGINE_STATE,
  TIME_PROVIDER_FILTER,
  captureClock,
  deltaDays,
  isCaptureClassObservation,
  isWaybackObservation,
  rankBestForDate,
  sortHistoryObservations
} from './imagery-contract.js';
import { getActiveSpatialFocus, isDropPinFocus } from '../map/spatial-focus.js';
import { probeNearmapGetMapAt } from './providers/nearmap-wms-ground-provider.js';
import { esriWaybackProvider } from './providers/esri-wayback-provider.js';
import { nearmapProvider } from './providers/nearmap-provider.js';

const BEST_FOR_DATE_WAYBACK_PROBE_LIMIT = 16;

const listeners = new Set();

let aoiMode = AOI_MODE.VIEWPORT;
let requestedDate = null;
let pool = null;
let latestApplied = null;
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
let providerReadiness = {
  wayback: PROVIDER_READINESS_STATE.READY,
  nearmap: PROVIDER_READINESS_STATE.NOT_CONFIGURED
};
let lastError = null;
let lastLimitation = null;
let lastAoi = null;
let generation = 0;
let activeLayer = null;
let layerAttached = false;
let layerLoaded = false;
let layerViewReady = false;
let networkConfirmed = false;
let displayConfirmed = false;
let displayEvidence = null;

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
  return sortHistoryObservations(list);
}

function applyMatch(list, date) {
  const matched = rankBestForDate(list, date);
  return {
    observations: list,
    selectedId: matched.record?.id || null,
    matchKind: matched.match,
    matchDeltaDays: matched.deltaDays
  };
}

function emptyLatestApplied() {
  return {
    selectedProvider: null,
    attempted: [],
    nearmapGetMap: null,
    nearmapDisplayConfirmed: null,
    googleError: null,
    esriApplied: false
  };
}

async function resolveWaybackCaptureForBestDate(aoi, date) {
  const unresolved = observations.filter((item) => (
    isWaybackObservation(item) && !isCaptureClassObservation(item)
  ));
  const ranked = [...unresolved].sort((a, b) => {
    const deltaA = Math.abs(deltaDays(date, a.releaseDate) ?? Number.POSITIVE_INFINITY);
    const deltaB = Math.abs(deltaDays(date, b.releaseDate) ?? Number.POSITIVE_INFINITY);
    return deltaA - deltaB;
  }).slice(0, BEST_FOR_DATE_WAYBACK_PROBE_LIMIT);
  if (!ranked.length) return;
  const resolved = await Promise.all(
    ranked.map((item) => esriWaybackProvider.resolveAcquisition(item, aoi))
  );
  const byId = new Map(resolved.map((item) => [item.id, item]));
  observations = observations.map((item) => byId.get(item.id) || item);
}

function providerFor(observation) {
  return observation?.providerId === 'nearmap' ? nearmapProvider : esriWaybackProvider;
}

function deriveDisplayState() {
  if (displayConfirmed) return DISPLAY_STATE.DISPLAY_CONFIRMED;
  if (activeId && (layerAttached || layerLoaded || layerViewReady)) {
    return DISPLAY_STATE.DISPLAY_NOT_CONFIRMED;
  }
  if (layerLoaded) return DISPLAY_STATE.LAYER_LOADED;
  if (layerAttached) return DISPLAY_STATE.LAYER_ATTACHED;
  if (activeId) return DISPLAY_STATE.ACTIVATED;
  if (selectedId) return DISPLAY_STATE.SELECTED;
  return DISPLAY_STATE.NONE;
}

function resetDisplayTruth() {
  layerAttached = false;
  layerLoaded = false;
  layerViewReady = false;
  networkConfirmed = false;
  displayConfirmed = false;
  displayEvidence = null;
}

export function readMapAoi(mode = aoiMode) {
  const view = getMapView();
  if (!view) throw new Error('Map foundation is not ready.');
  const focus = getActiveSpatialFocus();
  const pin = isDropPinFocus(focus);
  const longitude = pin ? Number(focus.longitude) : view.center?.longitude;
  const latitude = pin ? Number(focus.latitude) : view.center?.latitude;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(pin
      ? 'ACTIVE SPATIAL FOCUS is not a geographic point.'
      : 'Map center is not a geographic point.');
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
  const activated = activeObservation();
  const displayed = displayConfirmed ? activated : null;
  return {
    aoiMode,
    requestedDate,
    pool,
    latestApplied: latestApplied ? { ...latestApplied, attempted: [...(latestApplied.attempted || [])] } : null,
    providerFilter,
    engineState,
    observations: observations.map((item) => ({ ...item })),
    selectedId,
    activatedId: activeId,
    activeId,
    displayedId: displayed?.id || null,
    selected,
    activated,
    active: activated,
    displayed,
    matchKind,
    deltaDays: matchDeltaDays,
    entitlements: { ...entitlements },
    providerReadiness: { ...providerReadiness },
    error: lastError,
    limitation: lastLimitation,
    aoi: lastAoi,
    layerId: TIME_ENGINE_LAYER_ID,
    dateKindSelected: selected?.dateKindUsed || DATE_KIND.UNRESOLVED,
    layerAttached,
    layerLoaded,
    layerViewReady,
    networkConfirmed,
    displayConfirmed,
    displayState: deriveDisplayState(),
    displayEvidence: displayEvidence ? { ...displayEvidence } : null
  };
}

export function setTimeEngineOptions(partial = {}) {
  if (partial.aoiMode === AOI_MODE.VIEWPORT || partial.aoiMode === AOI_MODE.POINT) {
    aoiMode = partial.aoiMode;
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'requestedDate')) {
    if (partial.requestedDate == null || partial.requestedDate === '') {
      requestedDate = null;
    } else if (typeof partial.requestedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(partial.requestedDate)) {
      requestedDate = partial.requestedDate;
    }
  }
  if (Object.values(IMAGERY_POOL).includes(partial.pool)) {
    pool = partial.pool;
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
  await ensureImageryTileReceiptInterceptor();
  await initGroundController();
  try {
    const status = await nearmapProvider.probeStatus();
    entitlements.nearmap = status.entitlement;
    providerReadiness.nearmap = status.readinessState;
  } catch {
    entitlements.nearmap = ENTITLEMENT_STATE.FAILED;
    providerReadiness.nearmap = PROVIDER_READINESS_STATE.UNAVAILABLE;
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

function raiseImageryPlane() {
  const webmap = getWebMap();
  const runtime = getRuntimePlane();
  const plane = getImageryPlane();
  const observation = getImageryObservationLayer();
  if (!webmap?.layers) return;
  if (plane && !(plane.layers?.length)) plane.visible = false;
  suspendEmptyIqaiPlanes();
  const runtimeIndex = webmap.layers.findIndex?.((item) => item === runtime || item?.id === runtime?.id);
  const target = Number.isFinite(runtimeIndex) && runtimeIndex > 0
    ? runtimeIndex - 1
    : Math.max(0, webmap.layers.length - 1);
  const observationIndex = webmap.layers.findIndex?.((item) => item === observation || item?.id === observation?.id);
  if (observation && Number.isFinite(observationIndex) && observationIndex >= 0) {
    webmap.layers.reorder(observation, target);
    observation.visible = true;
    observation.opacity = 1;
  } else if (plane && plane.layers?.length) {
    webmap.layers.reorder(plane, target);
    plane.visible = true;
  }
}

async function replaceTimeLayer(layer) {
  const plane = getImageryPlane();
  if (!plane) throw new Error('Imagery plane is not ready.');
  if (plane.layers?.length) {
    plane.visible = true;
    plane.opacity = 1;
  } else {
    plane.visible = false;
  }
  suspendEmptyIqaiPlanes();
  const layers = planeCollection(plane);
  if (!layers || typeof layers.add !== 'function') {
    throw new Error('Imagery plane has no layer collection.');
  }
  const existing = findPlaneLayer(plane, TIME_ENGINE_LAYER_ID)
    || getImageryObservationLayer()
    || (activeLayer && !activeLayer.destroyed ? activeLayer : null);
  if (layer && existing && existing === layer) {
    layer.visible = true;
    layer.opacity = 1;
    layer.popupEnabled = false;
    layer.listMode = 'hide';
    raiseImageryPlane();
    activeLayer = layer;
    return;
  }
  if (existing && layer && existing !== layer) {
    // Keep the pre-view slot. Bind over it instead of destroying the LayerView.
    if (typeof layer.destroy === 'function') {
      try { layer.destroy(); } catch { /* unused constructed layer */ }
    }
    existing.visible = true;
    existing.opacity = 1;
    raiseImageryPlane();
    activeLayer = existing;
    return;
  }
  if (existing && !layer) {
    existing.visible = false;
    if (getWebMap()?.layers?.reorder) getWebMap().layers.reorder(plane, 0);
    activeLayer = existing;
    return;
  }
  if (layer) {
    layer.id = TIME_ENGINE_LAYER_ID;
    layer.visible = true;
    layer.opacity = 1;
    layer.popupEnabled = false;
    layer.listMode = 'hide';
    layers.add(layer);
    raiseImageryPlane();
  }
  activeLayer = layer || existing || null;
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

function waitRenderFrames() {
  return Promise.race([
    new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'function') {
        setTimeout(resolve, 32);
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }),
    new Promise((resolve) => setTimeout(resolve, 250))
  ]);
}

export function summarizeScreenshotImageData(imageData) {
  const pixels = imageData?.data;
  if (!pixels || !Number.isFinite(imageData?.width) || !Number.isFinite(imageData?.height)) {
    return { error: 'no screenshot ImageData' };
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  let sampledPixelCount = 0;
  let opaquePixelCount = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    sampledPixelCount += 1;
    if (pixels[i + 3] <= 8) continue;
    const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
    alpha += pixels[i + 3];
    min = Math.min(min, lum);
    max = Math.max(max, lum);
    opaquePixelCount += 1;
  }
  return {
    width: imageData.width,
    height: imageData.height,
    sampledPixelCount,
    opaquePixelCount,
    opaqueShare: sampledPixelCount ? opaquePixelCount / sampledPixelCount : 0,
    mean: opaquePixelCount
      ? [
          Math.round(r / opaquePixelCount),
          Math.round(g / opaquePixelCount),
          Math.round(b / opaquePixelCount),
          Math.round(alpha / opaquePixelCount)
        ]
      : [0, 0, 0, 0],
    lumMin: opaquePixelCount ? Math.round(min) : 0,
    lumMax: opaquePixelCount ? Math.round(max) : 0,
    contrast: opaquePixelCount ? Math.round(max - min) : 0
  };
}

async function inspectViewPixels(view, layer) {
  if (!view?.takeScreenshot) return { error: 'no takeScreenshot' };
  const captured = await withTimeout(
    view.takeScreenshot({ format: 'png', layers: [layer] }),
    8000,
    'takeScreenshot timed out'
  );
  if (captured?.data?.data) {
    return summarizeScreenshotImageData(captured.data);
  }
  const dataUrl = captured?.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    return { error: 'no screenshot dataUrl' };
  }
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('screenshot image failed'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return summarizeScreenshotImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function parentChainVisible(layer) {
  let parent = layer?.parent || null;
  while (parent) {
    if ('visible' in parent && parent.visible === false) return false;
    parent = parent.parent || null;
  }
  return true;
}

function layerAttachedToWebMap(layer) {
  const webmap = getWebMap();
  if (!webmap || !layer) return false;
  return webmap.layers?.find?.((item) => item === layer || item?.id === layer.id) === layer
    || webmap.allLayers?.find?.((item) => item === layer || item?.id === layer.id) === layer;
}

export function isObservationDisplayEvidenceConfirmed(evidence) {
  return Boolean(
    evidence?.observationActive
    && evidence?.layerAttached
    && evidence?.layer?.visible
    && evidence?.layer?.opacity > 0
    && evidence?.layer?.parentChainVisible
    && evidence?.layer?.urlMatchesObservation
    && evidence?.layerView?.ready
    && evidence?.layerView?.visible
    && evidence?.layerView?.visibleAtCurrentScale
    && evidence?.layerView?.suspended === false
    && evidence?.view?.ready
    && evidence?.view?.stationary
    && evidence?.network?.resourceTimingEntryCount > 0
    && evidence?.screenshot?.opaquePixelCount >= 256
    && evidence?.screenshot?.opaqueShare >= 0.05
    && evidence?.screenshot?.contrast >= 16
  );
}

async function confirmObservationDisplay(layer, observation, resourceStartTime) {
  const view = getMapView();
  const evidence = {
    method: 'mapview-layer-isolated-screenshot-v1',
    observationId: observation?.id || null,
    providerId: observation?.providerId || null,
    layerId: layer?.id || null,
    startedAt: new Date().toISOString(),
    capturedAt: null,
    observationActive: false,
    layerAttached: false,
    layer: {
      visible: false,
      opacity: 0,
      parentChainVisible: false,
      urlMatchesObservation: false
    },
    layerView: {
      ready: false,
      suspended: null,
      updating: null,
      visible: false,
      visibleAtCurrentScale: false
    },
    view: {
      ready: false,
      stationary: false
    },
    network: observationTileReceipt(observation, { sinceStartTime: resourceStartTime }),
    screenshot: {
      opaquePixelCount: 0,
      opaqueShare: 0,
      contrast: 0
    },
    criteria: {
      isolatedToLayer: true,
      minimumOpaquePixelCount: 256,
      minimumOpaqueShare: 0.05,
      minimumContrast: 16,
      requiresReleaseSpecificResourceTiming: true,
      requiresRenderableLayerView: true
    },
    attempts: 0,
    confirmed: false,
    error: null
  };
  if (!view || !layer) {
    evidence.error = 'MapView or observation layer is unavailable.';
    return { confirmed: false, evidence };
  }
  let layerView = null;
  try {
    await withTimeout(view.when(), 10000, 'MapView display proof timed out');
    const views = view.allLayerViews;
    const list = views?.toArray ? views.toArray() : (views ? [...views] : []);
    layerView = list.find((item) => item?.layer === layer || item?.layer?.id === TIME_ENGINE_LAYER_ID) || null;
    if (!layerView) {
      layerView = await withTimeout(view.whenLayerView(layer), 8000, 'Time observation LayerView timed out');
    }
  } catch (error) {
    const views = view.allLayerViews;
    const list = views?.toArray ? views.toArray() : (views ? [...views] : []);
    layerView = list.find((item) => item?.layer === layer || item?.layer?.id === TIME_ENGINE_LAYER_ID) || null;
    evidence.error = String(error?.message || error);
  }
  if (!layerView) {
    evidence.error = evidence.error || 'Observation LayerView is unavailable.';
    return { confirmed: false, evidence };
  }
  const expectedUrl = providerFor(observation).urlTemplateFor?.(observation)
    || observation?.sourceIdentity?.itemURL
    || observation?.assets?.[0]?.urlTemplate
    || null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    evidence.attempts += 1;
    suspendEmptyIqaiPlanes();
    if (typeof view.resize === 'function') view.resize();
    if (typeof view.requestRender === 'function') view.requestRender();
    await waitRenderFrames();

    evidence.observationActive = activeId === observation?.id;
    evidence.layerAttached = layerAttachedToWebMap(layer);
    evidence.layer = {
      visible: layer.visible !== false,
      opacity: Number(layer.opacity ?? 1),
      parentChainVisible: parentChainVisible(layer),
      urlMatchesObservation: Boolean(expectedUrl)
        && String(layer.urlTemplate || layer.url || '').toLowerCase() === String(expectedUrl).toLowerCase()
    };
    evidence.layerView = {
      ready: true,
      suspended: layerView.suspended === true,
      updating: layerView.updating === true,
      visible: layerView.visible !== false,
      visibleAtCurrentScale: layerView.visibleAtCurrentScale !== false
    };
    evidence.view = {
      ready: view.ready === true,
      stationary: view.stationary !== false
    };
    evidence.network = observationTileReceipt(observation, {
      sinceStartTime: resourceStartTime
    });
    if (
      evidence.layerView.suspended === false
      && evidence.layerView.visible
      && evidence.network.resourceTimingEntryCount > 0
    ) {
      try {
        evidence.screenshot = await inspectViewPixels(view, layer);
        evidence.capturedAt = new Date().toISOString();
        if (evidence.screenshot.error) evidence.error = evidence.screenshot.error;
      } catch (error) {
        evidence.error = String(error?.message || error);
      }
    }
    evidence.confirmed = isObservationDisplayEvidenceConfirmed(evidence);
    if (evidence.confirmed) {
      evidence.error = null;
      return { confirmed: true, evidence };
    }
    await sleep(750);
  }
  evidence.error = evidence.error || 'Wayback pixel display was not confirmed before timeout.';
  return { confirmed: false, evidence };
}

async function settleTimeLayer(layer) {
  const view = getMapView();
  const plane = getImageryPlane();
  if (!view || !layer) return;
  if (plane) {
    if (plane.layers?.length) {
      plane.visible = true;
      plane.opacity = 1;
    } else {
      plane.visible = false;
    }
  }
  suspendEmptyIqaiPlanes();
  layer.visible = true;
  layer.opacity = 1;
  if (typeof layer.load === 'function') {
    await withTimeout(layer.load(), 8000, 'Time observation load timed out').catch(() => {});
  }
  layerLoaded = Boolean(layer.loaded);
  const attached = getImageryObservationLayer() === layer
    || activeLayer === layer
    || findPlaneLayer(plane, TIME_ENGINE_LAYER_ID) === layer
    || getWebMap()?.layers?.find?.((item) => item === layer || item?.id === TIME_ENGINE_LAYER_ID) === layer
    || getWebMap()?.allLayers?.find?.((item) => item === layer || item?.id === TIME_ENGINE_LAYER_ID) === layer;
  layerAttached = Boolean(attached);
  if (!attached) {
    throw new Error('Time observation was not attached to the imagery plane.');
  }
}

export async function applyLatestCurrentImagery() {
  await initTimeEngine();
  const token = ++generation;
  requestedDate = null;
  pool = IMAGERY_POOL.LATEST;
  selectedId = null;
  matchKind = MATCH_KIND.NONE;
  matchDeltaDays = null;
  lastError = null;
  lastLimitation = null;
  latestApplied = emptyLatestApplied();
  if (!isDropPinFocus(getActiveSpatialFocus())) {
    latestApplied.blocked = 'DROP_PIN_REQUIRED';
    lastLimitation = DROP_PIN_THEN_LATEST;
    engineState = TIME_ENGINE_STATE.READY;
    emit();
    return getTimeEngineSnapshot();
  }
  engineState = TIME_ENGINE_STATE.APPLYING;
  emit();
  try {
    await replaceTimeLayer(null);
    activeId = null;
    resetDisplayTruth();
    if (token !== generation) return getTimeEngineSnapshot();
    const aoi = readMapAoi(aoiMode);
    lastAoi = aoi;
    latestApplied.attempted.push('NEARMAP');
    const getMap = await probeNearmapGetMapAt(aoi.longitude, aoi.latitude);
    latestApplied.nearmapGetMap = getMap;
    if (getMap.ok) {
      try {
        const ground = await setGroundMode(GROUND_MODE.NEARMAP);
        if (token !== generation) return getTimeEngineSnapshot();
        if (ground.currentMode === GROUND_MODE.NEARMAP) {
          latestApplied.selectedProvider = 'NEARMAP';
          latestApplied.nearmapDisplayConfirmed = ground.displayConfirmed === true;
          engineState = TIME_ENGINE_STATE.READY;
          emit();
          return getTimeEngineSnapshot();
        }
      } catch (error) {
        latestApplied.nearmapDisplayConfirmed = false;
        latestApplied.nearmapError = String(error?.message || error);
      }
    }

    latestApplied.attempted.push('GOOGLE_SATELLITE');
    try {
      const ground = await setGroundMode(GROUND_MODE.GOOGLE_SATELLITE);
      if (token !== generation) return getTimeEngineSnapshot();
      if (ground.currentMode === GROUND_MODE.GOOGLE_SATELLITE) {
        latestApplied.selectedProvider = 'GOOGLE_SATELLITE';
        engineState = TIME_ENGINE_STATE.READY;
        emit();
        return getTimeEngineSnapshot();
      }
    } catch (error) {
      latestApplied.googleError = String(error?.message || error);
    }

    latestApplied.attempted.push('ESRI_WORLD_IMAGERY');
    await setGroundMode(GROUND_MODE.ESRI_WORLD_IMAGERY);
    if (token !== generation) return getTimeEngineSnapshot();
    latestApplied.selectedProvider = 'ESRI_WORLD_IMAGERY';
    latestApplied.esriApplied = true;
    engineState = TIME_ENGINE_STATE.READY;
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

export async function discoverImageryTime(options = {}) {
  if (options.pool === IMAGERY_POOL.LATEST) {
    return applyLatestCurrentImagery();
  }
  setTimeEngineOptions(options);
  await initTimeEngine();
  const token = ++generation;
  pool = options.pool
    || (requestedDate ? IMAGERY_POOL.BEST_FOR_DATE : IMAGERY_POOL.HISTORY);
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
      providerReadiness.wayback = wayback.entitlement === ENTITLEMENT_STATE.READY
        ? PROVIDER_READINESS_STATE.READY
        : PROVIDER_READINESS_STATE.UNAVAILABLE;
      collected.push(...(wayback.observations || []));
      if (wayback.limitation) limitations.push(wayback.limitation);
    }
    if (providerFilter !== TIME_PROVIDER_FILTER.WAYBACK) {
      const nearmap = await nearmapProvider.discover(aoi);
      entitlements.nearmap = nearmap.entitlement || ENTITLEMENT_STATE.FAILED;
      providerReadiness.nearmap = nearmap.readinessState || PROVIDER_READINESS_STATE.UNAVAILABLE;
      collected.push(...(nearmap.observations || []));
      if (nearmap.limitation) limitations.push(nearmap.limitation);
      if (nearmap.error && nearmap.entitlement === ENTITLEMENT_STATE.FAILED) {
        throw new Error(nearmap.error);
      }
    }
    if (token !== generation) return getTimeEngineSnapshot();
    const retrievedDate = new Date().toISOString();
    observations = sortObservations(collected).map((item) => ({
      ...item,
      requestedDate,
      retrievedDate
    }));
    // Archive list success is the HISTORY product. Optional Nearmap survey
    // entitlement must not overwrite operator chrome with env-var copy.
    if (pool === IMAGERY_POOL.HISTORY && collected.length > 0 && !requestedDate) {
      lastLimitation = null;
    } else {
      lastLimitation = limitations.filter(Boolean).join(' ') || null;
    }
    const shouldRank = Boolean(requestedDate) && pool === IMAGERY_POOL.BEST_FOR_DATE;
    if (shouldRank) {
      await resolveWaybackCaptureForBestDate(aoi, requestedDate);
      if (token !== generation) return getTimeEngineSnapshot();
      const matched = applyMatch(observations, requestedDate);
      selectedId = matched.selectedId;
      matchKind = matched.matchKind;
      matchDeltaDays = matched.matchDeltaDays;
      engineState = TIME_ENGINE_STATE.READY;
      emit();
      if (selectedId) return activateObservation(selectedId);
      return getTimeEngineSnapshot();
    }
    selectedId = null;
    matchKind = MATCH_KIND.NONE;
    matchDeltaDays = null;
    engineState = TIME_ENGINE_STATE.READY;
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
  const previousDisplay = {
    layerAttached,
    layerLoaded,
    layerViewReady,
    networkConfirmed,
    displayConfirmed,
    displayEvidence
  };
  const token = ++generation;
  engineState = TIME_ENGINE_STATE.APPLYING;
  lastError = null;
  resetDisplayTruth();
  const resourceStartTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;
  emit();
  try {
    const aoi = lastAoi || readMapAoi(aoiMode);
    let resolved = observation;
    if (isWaybackObservation(observation) && !observation.acquisitionDate) {
      resolved = await esriWaybackProvider.resolveAcquisition(observation, aoi);
      observations = observations.map((item) => (
        item.id === resolved.id ? { ...item, ...resolved } : item
      ));
    }
    const provider = providerFor(resolved);
    const groundNow = getGroundSnapshot();
    if (
      groundNow.currentMode === GROUND_MODE.NEARMAP
      || groundNow.currentMode === GROUND_MODE.GOOGLE_SATELLITE
    ) {
      await setGroundMode(GROUND_MODE.AUTHORED_WEBMAP);
      if (token !== generation) return getTimeEngineSnapshot();
    }
    const slot = getImageryObservationLayer();
    let layer = slot && !slot.destroyed ? slot : null;
    if (layer && typeof provider.bindLayer === 'function') {
      provider.bindLayer(layer, resolved);
    } else {
      layer = await provider.createLayer(resolved);
    }
    await replaceTimeLayer(layer);
    layer = activeLayer || layer;
    suspendEmptyIqaiPlanes();
    const view = getMapView();
    if (typeof view?.resize === 'function') view.resize();
    if (typeof view?.requestRender === 'function') view.requestRender();
    await settleTimeLayer(layer);
    if (token !== generation) return getTimeEngineSnapshot();
    selectedId = resolved.id;
    activeId = resolved.id;
    engineState = TIME_ENGINE_STATE.READY;
    emit();
    const confirmToken = token;
    const confirmLayer = layer;
    const confirmObservation = resolved;
    const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : setTimeout;
    schedule(() => {
      void confirmObservationDisplay(
        confirmLayer,
        confirmObservation,
        resourceStartTime
      ).then((result) => {
        if (confirmToken !== generation) return;
        layerViewReady = Boolean(result.evidence?.layerView?.ready)
          && result.evidence?.layerView?.suspended === false;
        networkConfirmed = Number(result.evidence?.network?.resourceTimingEntryCount) > 0;
        displayEvidence = result.evidence || null;
        displayConfirmed = result.confirmed === true;
        emit();
      }).catch((error) => {
        if (confirmToken !== generation) return;
        displayEvidence = {
          ...(displayEvidence || {}),
          error: String(error?.message || error)
        };
        emit();
      });
    }, 0);
    return getTimeEngineSnapshot();
  } catch (error) {
    if (token !== generation) return getTimeEngineSnapshot();
    lastError = String(error?.message || error);
    try {
      await replaceTimeLayer(previous);
      activeId = previousId;
      layerAttached = previousDisplay.layerAttached;
      layerLoaded = previousDisplay.layerLoaded;
      layerViewReady = previousDisplay.layerViewReady;
      networkConfirmed = previousDisplay.networkConfirmed;
      displayConfirmed = previousDisplay.displayConfirmed;
      displayEvidence = previousDisplay.displayEvidence;
    } catch {
      activeId = null;
      activeLayer = null;
      resetDisplayTruth();
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
  resetDisplayTruth();
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
  const clock = captureClock(selected);
  if (clock.date && requestedDate) {
    matchKind = clock.date === requestedDate ? MATCH_KIND.EXACT : MATCH_KIND.NEAREST;
    matchDeltaDays = deltaDays(requestedDate, clock.date);
  } else {
    matchKind = MATCH_KIND.NONE;
    matchDeltaDays = null;
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
