/**
 * IQAI Spatial V2 ArcGIS map foundation.
 *
 * One long-lived 2D MapView. Authored WebMap plane vs empty runtime plane.
 * Does not save/update the Portal WebMap. Does not own V1 GIS chrome.
 *
 * Selection identity must never be ArcGIS OBJECTID alone — inspector wiring
 * is a later task. Default popups are suppressed.
 */

import {
  MONTREAL_OPERATIONAL_CENTER,
  MONTREAL_OPERATIONAL_SCALE,
  MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID,
  isGreaterMontrealLongitudeLatitude
} from '../../spatial/montreal-operational-config.js';
import { importArc, loadArcgisSdk } from './arcgis-sdk.js';
import { ensureImageryObservationSlot } from '../imagery/imagery-plane.js';
import {
  fetchOperationalMapOAuthConfig,
  getAgolSession,
  isAccessDeniedError,
  registerAgolOAuth,
  registerPreauthTokenIfPresent,
  signInToAgol
} from './agol-session.js';
import { mountMapNavControls } from './map-nav-controls.js';
import {
  ensureAuthoredNearmapGroundSlot,
  ensureNearmapWmsInterceptor
} from '../imagery/providers/nearmap-wms-ground-provider.js';

export const MAP_FOUNDATION_STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  ERROR: 'ERROR'
});

export const RUNTIME_PLANE_ID = 'iqai-v2-runtime-plane';
export const RUNTIME_PLANE_TITLE = 'IQAI V2 Runtime';

/** @type {import('@arcgis/core/views/MapView').default | null} */
let mapView = null;
/** @type {import('@arcgis/core/WebMap').default | null} */
let webMap = null;
/** @type {import('@arcgis/core/layers/GroupLayer').default | null} */
let runtimePlane = null;
/** @type {string[]} */
let authoredLayerIds = [];
let homeViewpoint = null;
let mapViewCreateCount = 0;
let webMapCreateCount = 0;
let state = MAP_FOUNDATION_STATES.INITIALIZING;
let lastError = null;
let lastDiagnostics = null;
/** @type {Promise<object> | null} */
let initPromise = null;
/** @type {Set<(snapshot: object) => void>} */
const listeners = new Set();

function sanitizeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/token=[^&\s]+/gi, 'token=[redacted]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function snapshot() {
  return {
    state,
    error: lastError,
    mapViewCreateCount,
    webMapCreateCount,
    webmapItemId: lastDiagnostics?.webmapItemId || null,
    webmapTitle: lastDiagnostics?.webmapTitle || null,
    portalUser: lastDiagnostics?.portalUser || null,
    authoredLayerCount: authoredLayerIds.length,
    runtimeLayerCount: runtimePlane?.layers?.length || 0,
    popupEnabled: mapView ? Boolean(mapView.popupEnabled) : false,
    hasView: Boolean(mapView),
    hasWebMap: Boolean(webMap)
  };
}

function emit() {
  const current = snapshot();
  for (const listener of listeners) {
    try {
      listener(current);
    } catch (error) {
      console.warn('[IQAI V2] map foundation listener failed', error);
    }
  }
  return current;
}

export function subscribeMapFoundation(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function getMapFoundationState() {
  return state;
}

export function getMapView() {
  return mapView;
}

export function getWebMap() {
  return webMap;
}

export function getRuntimePlane() {
  return runtimePlane;
}

export function getAuthoredLayerIds() {
  return [...authoredLayerIds];
}

export function getMapViewCreateCount() {
  return mapViewCreateCount;
}

export function getMapFoundationSnapshot() {
  return snapshot();
}

function disablePopups(layer) {
  if (!layer) return;
  if ('popupEnabled' in layer) layer.popupEnabled = false;
  const children = layer.layers || layer.allLayers;
  if (children?.forEach) children.forEach(disablePopups);
  else if (children?.toArray) children.toArray().forEach(disablePopups);
}

function collectAuthoredLayerIds(map, runtimeId) {
  const ids = [];
  const layers = map?.layers;
  if (!layers) return ids;
  const list = layers.toArray ? layers.toArray() : [...layers];
  for (const layer of list) {
    if (layer?.id === runtimeId) continue;
    ids.push(layer.id || layer.title || `authored-${ids.length}`);
  }
  return ids;
}

function applyOperationalHome(view) {
  if (!view) return;
  view.center = [MONTREAL_OPERATIONAL_CENTER.longitude, MONTREAL_OPERATIONAL_CENTER.latitude];
  view.scale = MONTREAL_OPERATIONAL_SCALE;
}

const MAP_HOST_SURFACE_STYLE_ID = 'iqai-v2-map-foundation-surface';

function preserveMapViewDrawingBuffer() {
  if (typeof HTMLCanvasElement === 'undefined') return;
  const original = HTMLCanvasElement.prototype.getContext;
  if (original.__iqaiMapViewPreserve) return;
  function patched(type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      const host = typeof this.closest === 'function' ? this.closest('.iqai-v2-map-host') : null;
      if (host) {
        attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
      }
    }
    return original.call(this, type, attrs);
  }
  patched.__iqaiMapViewPreserve = true;
  HTMLCanvasElement.prototype.getContext = patched;
}

function installMapViewHostCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(MAP_HOST_SURFACE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MAP_HOST_SURFACE_STYLE_ID;
  style.textContent = `
    /* Shell * { box-sizing: border-box } is more specific than Esri theme.
       Restore content-box on compositor nodes so the 2D renderer can present. */
    #iqai-spatial-v2 .iqai-v2-map-host .esri-view,
    #iqai-spatial-v2 .iqai-v2-map-host .esri-view-root,
    #iqai-spatial-v2 .iqai-v2-map-host .esri-view-surface,
    #iqai-spatial-v2 .iqai-v2-map-host .esri-view-surface canvas,
    #iqai-spatial-v2 .iqai-v2-map-host .esri-display-object,
    #iqai-spatial-v2 .iqai-v2-map-host .esri-overlay-surface {
      box-sizing: content-box !important;
    }
  `;
  document.head.appendChild(style);
}

function waitFrames() {
  return Promise.race([
    new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'function') {
        setTimeout(resolve, 16);
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }),
    new Promise((resolve) => setTimeout(resolve, 250))
  ]);
}

async function waitForMapHostLayout(container) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (container.clientWidth >= 64 && container.clientHeight >= 64) {
      await waitFrames();
      if (container.clientWidth >= 64 && container.clientHeight >= 64) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

export function suspendEmptyIqaiPlanes() {
  if (runtimePlane && !(runtimePlane.layers?.length)) {
    runtimePlane.visible = false;
  }
}

async function ensureMontrealViewpoint(view) {
  await Promise.race([
    view.when(),
    new Promise((resolve) => setTimeout(resolve, 8000))
  ]).catch(() => {});
  const longitude = view.center?.longitude;
  const latitude = view.center?.latitude;
  if (isGreaterMontrealLongitudeLatitude(longitude, latitude)) return;
  applyOperationalHome(view);
}

async function loadWebMapOrSignIn(map, session, timeoutMs) {
  try {
    await withTimeout(map.load(), timeoutMs, 'WebMap load');
    return;
  } catch (error) {
    const accessDenied = isAccessDeniedError(error);
    if (!accessDenied && !/timed out|timeout|unable to load|failed to load/i.test(String(error?.message || error))) {
      throw error;
    }

    let current = await getAgolSession(session.IdentityManager, session.sharingUrl);
    if (!current.authenticated) {
      await signInToAgol(session.IdentityManager, session.sharingUrl);
      current = await getAgolSession(session.IdentityManager, session.sharingUrl);
      if (!current.authenticated) {
        const err = new Error('ArcGIS sign-in was not completed.');
        err.code = 'AUTH_REQUIRED';
        throw err;
      }
    }

    await withTimeout(map.load(), timeoutMs, 'WebMap load');
  }
}

/**
 * @param {HTMLElement} container
 * @param {{ navHost?: HTMLElement }} [options]
 */
export function initMapFoundation(container, options = {}) {
  if (mapView) {
    return Promise.resolve(getMapFoundationController());
  }
  if (initPromise) return initPromise;
  initPromise = bootstrap(container, options).catch((error) => {
    initPromise = null;
    state = MAP_FOUNDATION_STATES.ERROR;
    lastError = sanitizeError(error);
    console.error('[IQAI V2] map foundation failed', lastError);
    emit();
    throw error;
  });
  return initPromise;
}

async function bootstrap(container, options) {
  if (!container) {
    throw new Error('Map stage container is missing.');
  }

  state = MAP_FOUNDATION_STATES.INITIALIZING;
  lastError = null;
  emit();

  await loadArcgisSdk();
  await ensureNearmapWmsInterceptor();
  installMapViewHostCss();
  const oauthConfig = await fetchOperationalMapOAuthConfig();
  if (!oauthConfig.oauthAppIdConfigured) {
    throw new Error('ArcGIS OAuth App ID is not configured.');
  }

  const session = await registerAgolOAuth(oauthConfig);
  registerPreauthTokenIfPresent(session.IdentityManager, session.sharingUrl);

  const webmapItemId = oauthConfig.webmapItemId || MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID;

  const [WebMap, MapView, Portal, GroupLayer] = await withTimeout(
    Promise.all([
      importArc('@arcgis/core/WebMap.js'),
      importArc('@arcgis/core/views/MapView.js'),
      importArc('@arcgis/core/portal/Portal.js'),
      importArc('@arcgis/core/layers/GroupLayer.js')
    ]),
    45000,
    'ArcGIS module import'
  );

  const portal = new Portal({ url: session.portalUrl });
  await withTimeout(portal.load(), 20000, 'Portal load').catch(() => {});

  const map = new WebMap({
    portalItem: {
      id: webmapItemId,
      portal
    }
  });

  await loadWebMapOrSignIn(map, session, 30000);
  await withTimeout(portal.load(), 20000, 'Portal load').catch(() => {});

  if (mapView) {
    return getMapFoundationController();
  }

  authoredLayerIds = collectAuthoredLayerIds(map, RUNTIME_PLANE_ID);

  if (!(container instanceof HTMLElement)) {
    throw new Error('Map stage container is not an HTMLElement.');
  }

  await waitForMapHostLayout(container);
  installMapViewHostCss();
  preserveMapViewDrawingBuffer();
  await ensureImageryObservationSlot(map);
  await ensureAuthoredNearmapGroundSlot(map);

  webMap = map;
  webMapCreateCount += 1;
  const view = new MapView({
    container,
    map: webMap,
    center: [MONTREAL_OPERATIONAL_CENTER.longitude, MONTREAL_OPERATIONAL_CENTER.latitude],
    scale: MONTREAL_OPERATIONAL_SCALE
  });
  mapView = view;
  mapViewCreateCount += 1;

  const hostSize = `${container.clientWidth}x${container.clientHeight}`;
  if (container.clientWidth < 8 || container.clientHeight < 8) {
    throw new Error(`Map stage container is too small (${hostSize}).`);
  }

  mapView.popupEnabled = false;
  if (mapView.popup) {
    mapView.popup.autoOpenEnabled = false;
    mapView.popup.visible = false;
  }

  runtimePlane = new GroupLayer({
    id: RUNTIME_PLANE_ID,
    title: RUNTIME_PLANE_TITLE,
    listMode: 'hide',
    visibilityMode: 'independent',
    layers: [],
    visible: false
  });
  webMap.add(runtimePlane);
  suspendEmptyIqaiPlanes();
  authoredLayerIds = collectAuthoredLayerIds(webMap, RUNTIME_PLANE_ID);
  disablePopups(webMap);

  if (options.navHost) {
    mountMapNavControls(options.navHost, getMapFoundationController());
  }

  const resizeObserver = new ResizeObserver(() => {
    if (typeof mapView.resize === 'function') mapView.resize();
  });
  resizeObserver.observe(container);

  await withTimeout(mapView.when(), 20000, 'MapView when').catch((error) => {
    console.warn('[IQAI V2] MapView when() did not settle', sanitizeError(error));
  });
  if (typeof mapView.resize === 'function') mapView.resize();
  await waitFrames();
  suspendEmptyIqaiPlanes();
  try {
    mapView.ui.components = ['attribution'];
  } catch {
    // CSS also hides leftover Esri chrome.
  }
  await ensureMontrealViewpoint(mapView);
  if (isGreaterMontrealLongitudeLatitude(mapView.center?.longitude, mapView.center?.latitude)) {
    homeViewpoint = mapView.viewpoint?.clone?.() || null;
  }

  lastDiagnostics = {
    webmapItemId,
    webmapTitle: webMap.portalItem?.title || oauthConfig.webmapName || 'Montreal 1',
    portalUser: portal.user?.username || null,
    portalUrl: session.portalUrl
  };
  state = MAP_FOUNDATION_STATES.READY;
  emit();

  return getMapFoundationController();
}

export function getMapFoundationController() {
  return {
    getState: getMapFoundationState,
    getSnapshot: getMapFoundationSnapshot,
    getView: getMapView,
    getWebMap,
    getRuntimePlane,
    getAuthoredLayerIds,
    getMapViewCreateCount,
    subscribe: subscribeMapFoundation,
    zoomIn: async () => {
      if (!mapView) return;
      await mapView.goTo({ zoom: (mapView.zoom || 0) + 1 }).catch(() => {});
    },
    zoomOut: async () => {
      if (!mapView) return;
      await mapView.goTo({ zoom: (mapView.zoom || 0) - 1 }).catch(() => {});
    },
    goHome: async () => {
      if (!mapView) return;
      applyOperationalHome(mapView);
    }
  };
}
