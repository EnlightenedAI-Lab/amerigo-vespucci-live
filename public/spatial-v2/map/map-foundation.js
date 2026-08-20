/**
 * IQAI Spatial V2 ArcGIS map foundation.
 *
 * One long-lived 2D MapView on an IQAI-owned Map. Runtime overlays are
 * session-only. Does not boot from a Portal WebMap. Does not save/update
 * Portal items. Does not own V1 GIS chrome.
 *
 * Selection identity must never be ArcGIS OBJECTID alone — inspector wiring
 * is a later task. Default popups are suppressed.
 */

import {
  MONTREAL_OPERATIONAL_CENTER,
  isGreaterMontrealLongitudeLatitude
} from '../../spatial/montreal-operational-config.js';
import { importArc, loadArcgisSdk } from './arcgis-sdk.js';
import { ensureImageryObservationSlot, getImageryObservationLayer } from '../imagery/imagery-plane.js';
import {
  fetchOperationalMapOAuthConfig,
  getLocalDemoApiKey
} from './agol-session.js';
import { mountMapNavControls } from './map-nav-controls.js';
import {
  IQAI_AERIAL_MAX_ZOOM,
  IQAI_MAP_BASEMAP_ID,
  IQAI_MAP_MAX_ZOOM,
  createIqaiAerialBasemap,
  createIqaiMapBasemap
} from './iqai-public-basemap.js';
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
export const MAP_READY_TIMEOUT_MS = 60000;

/** Downtown Montréal neighbourhood view. Zoom 15, not metro-wide 1:36112. */
export const SPATIAL_V2_MAP_ZOOM = 15;
export const SPATIAL_V2_MAP_SCALE = 18056;
export const IQAI_RASTER_MAX_ZOOM = 19;

/** Session MAP cartography. AERIAL stays Nearmap; these replace only the MAP surface. */
export const IQAI_SESSION_BASEMAPS = Object.freeze([
  { id: IQAI_MAP_BASEMAP_ID, title: 'Streets Vector', group: 'vector', source: 'iqai' },
  { id: 'streets-navigation-vector', title: 'Navigation', group: 'vector', esriIds: ['streets-navigation-vector'], styleId: 'arcgis/navigation' },
  { id: 'streets-night-vector', title: 'Streets Night', group: 'vector', esriIds: ['streets-night-vector'], styleId: 'arcgis/streets-night' },
  { id: 'gray-vector', title: 'Light Gray', group: 'vector', esriIds: ['gray-vector', 'gray'], styleId: 'arcgis/light-gray' },
  { id: 'dark-gray-vector', title: 'Dark Gray', group: 'vector', esriIds: ['dark-gray-vector', 'dark-gray'], styleId: 'arcgis/dark-gray' },
  { id: 'topo-vector', title: 'Topographic', group: 'vector', esriIds: ['topo-vector', 'topo'], styleId: 'arcgis/topographic' },
  { id: 'satellite', title: 'Imagery', group: 'imagery', esriIds: ['satellite'], styleId: 'arcgis/imagery' },
  { id: 'hybrid', title: 'Imagery Hybrid', group: 'imagery', esriIds: ['hybrid'], styleId: 'arcgis/imagery/standard' },
  { id: 'streets', title: 'Streets Raster', group: 'raster', esriIds: ['streets'], styleId: 'arcgis/streets' },
  { id: 'oceans', title: 'Oceans', group: 'raster', esriIds: ['oceans'], styleId: 'arcgis/oceans' },
  { id: 'osm', title: 'OpenStreetMap', group: 'vector', esriIds: ['osm'], styleId: 'osm/standard' }
]);

/** @type {import('@arcgis/core/views/MapView').default | null} */
let mapView = null;
/** @type {import('@arcgis/core/Map').default | null} */
let webMap = null;
/** @type {import('@arcgis/core/layers/GroupLayer').default | null} */
let runtimePlane = null;
/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let opsGraphicsLayer = null;
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
let cartoBaseLayer = null;
let aerialBaseLayer = null;
let mapBasemap = null;
let aerialBasemap = null;
let groundSurface = 'map';
let sessionEsriBasemapId = IQAI_MAP_BASEMAP_ID;
/** @type {Map<string, import('@arcgis/core/Basemap').default>} */
const sessionBasemapCache = new Map();
/** @type {Promise<import('@arcgis/core/Basemap').default | null> | null} */
let aerialPreparePromise = null;
/** @type {Set<(snapshot: object) => void>} */
const listeners = new Set();

function sanitizeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/token=[^&\s]+/gi, 'token=[redacted]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/apiKey=[^&\s]+/gi, 'apiKey=[redacted]')
    .replace(/AAPT[A-Za-z0-9._-]{8,}/g, 'AAPT[redacted]');
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
    portalIndependent: lastDiagnostics?.portalIndependent === true,
    portalUser: lastDiagnostics?.portalUser || null,
    authoredLayerCount: authoredLayerIds.length,
    runtimeLayerCount: runtimePlane?.layers?.length || 0,
    popupEnabled: mapView ? Boolean(mapView.popupEnabled) : false,
    hasView: Boolean(mapView),
    hasWebMap: Boolean(webMap),
    groundSurface,
    sessionBasemapId: sessionEsriBasemapId
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

export function getIqaiGroundSurface() {
  return groundSurface;
}

export function getSessionEsriBasemapId() {
  return sessionEsriBasemapId;
}

export function listSessionBasemaps() {
  return IQAI_SESSION_BASEMAPS.map((spec) => ({ ...spec }));
}

function sessionBasemapSpec(id = sessionEsriBasemapId) {
  return IQAI_SESSION_BASEMAPS.find((spec) => spec.id === id) || IQAI_SESSION_BASEMAPS[0];
}

function firstBasemapLayer(basemap) {
  const layers = basemap?.baseLayers;
  if (!layers) return null;
  const getter = layers.getItemAt || layers.at;
  if (typeof getter === 'function') return getter.call(layers, 0);
  const items = typeof layers.toArray === 'function' ? layers.toArray() : layers.items;
  return items?.[0] || null;
}

function applyGroundZoomLimit(kind) {
  if (!mapView?.constraints) return;
  const aerial = kind === 'aerial';
  const spec = sessionBasemapSpec();
  const maxZoom = aerial
    ? IQAI_AERIAL_MAX_ZOOM
    : spec?.group === 'imagery'
      ? IQAI_AERIAL_MAX_ZOOM
      : spec?.group === 'raster'
        ? IQAI_RASTER_MAX_ZOOM
        : IQAI_MAP_MAX_ZOOM;
  const layer = aerial ? aerialBaseLayer : cartoBaseLayer;
  mapView.constraints.minZoom = 2;
  mapView.constraints.maxZoom = maxZoom;
  const lods = layer?.tileInfo?.lods;
  if (Array.isArray(lods) && lods.length) {
    mapView.constraints.lods = lods;
  } else {
    mapView.constraints.lods = undefined;
  }
  const zoom = Number(mapView.zoom);
  if (Number.isFinite(zoom) && zoom > maxZoom) mapView.zoom = maxZoom;
}

async function loadSessionBasemap(spec) {
  if (!spec) return null;
  const cached = sessionBasemapCache.get(spec.id);
  if (cached) return cached;
  if (spec.source === 'iqai') {
    const created = mapBasemap || await createIqaiMapBasemap();
    sessionBasemapCache.set(spec.id, created);
    return created;
  }
  const Basemap = await importArc('@arcgis/core/Basemap.js');
  for (const esriId of spec.esriIds || []) {
    try {
      const loaded = await Basemap.fromId(esriId);
      if (!loaded) continue;
      if (typeof loaded.load === 'function') await loaded.load();
      loaded.id = spec.id;
      loaded.title = spec.title;
      sessionBasemapCache.set(spec.id, loaded);
      return loaded;
    } catch {
      // try next well-known Esri id, then style
    }
  }
  if (!spec.styleId) return null;
  try {
    const styled = new Basemap({
      style: { id: spec.styleId },
      title: spec.title,
      id: spec.id
    });
    if (typeof styled.load === 'function') await styled.load();
    sessionBasemapCache.set(spec.id, styled);
    return styled;
  } catch {
    return null;
  }
}

export async function setSessionEsriBasemap(basemapId) {
  const wanted = String(basemapId || '').trim();
  const spec = IQAI_SESSION_BASEMAPS.find((item) => item.id === wanted);
  if (!spec) return sessionEsriBasemapId;
  const next = await loadSessionBasemap(spec);
  if (!next) return sessionEsriBasemapId;
  mapBasemap = next;
  cartoBaseLayer = firstBasemapLayer(next);
  if (cartoBaseLayer) cartoBaseLayer.listMode = 'hide';
  sessionEsriBasemapId = spec.id;
  if (groundSurface !== 'aerial') await setIqaiGroundSurface('map');
  else emit();
  return sessionEsriBasemapId;
}

async function prepareAerialBasemap() {
  if (aerialBasemap) return aerialBasemap;
  if (aerialPreparePromise) return aerialPreparePromise;
  aerialPreparePromise = (async () => {
    await ensureNearmapWmsInterceptor();
    aerialBasemap = await createIqaiAerialBasemap();
    aerialBaseLayer = firstBasemapLayer(aerialBasemap);
    if (aerialBaseLayer) {
      aerialBaseLayer.listMode = 'hide';
      aerialBaseLayer.visible = false;
    }
    return aerialBasemap;
  })().catch((error) => {
    aerialPreparePromise = null;
    throw error;
  });
  return aerialPreparePromise;
}

export async function setIqaiGroundSurface(which) {
  const aerial = which === 'aerial';
  if (aerial) await prepareAerialBasemap();
  groundSurface = aerial ? 'aerial' : 'map';
  if (!webMap) return groundSurface;
  const nextBasemap = aerial ? aerialBasemap : mapBasemap;
  const nextLayer = aerial ? aerialBaseLayer : cartoBaseLayer;
  if (nextBasemap && webMap.basemap !== nextBasemap) {
    webMap.basemap = nextBasemap;
  }
  if (cartoBaseLayer) cartoBaseLayer.visible = !aerial;
  if (aerialBaseLayer) aerialBaseLayer.visible = aerial;
  if (nextLayer) nextLayer.visible = true;
  applyGroundZoomLimit(aerial ? 'aerial' : 'map');
  if (mapView && nextLayer && typeof mapView.whenLayerView === 'function') {
    await withTimeout(mapView.whenLayerView(nextLayer), 2500, 'whenLayerView').catch(() => {});
  }
  if (typeof mapView?.resize === 'function') mapView.resize();
  if (typeof mapView?.requestRender === 'function') mapView.requestRender();
  return groundSurface;
}

export function getRuntimePlane() {
  return runtimePlane;
}

export function getOpsGraphicsLayer() {
  return opsGraphicsLayer;
}

export function wakeIqaiMapSurface() {
  if (!mapView) return;
  if (opsGraphicsLayer) opsGraphicsLayer.visible = true;
  const cartoWas = cartoBaseLayer?.visible;
  const aerialWas = aerialBaseLayer?.visible;
  if (cartoBaseLayer && cartoWas === true) {
    cartoBaseLayer.visible = false;
    cartoBaseLayer.visible = true;
  }
  if (aerialBaseLayer && aerialWas === true) {
    aerialBaseLayer.visible = false;
    aerialBaseLayer.visible = true;
  }
  if (typeof mapView.resize === 'function') mapView.resize();
  if (typeof mapView.requestRender === 'function') mapView.requestRender();
}

function unlockMapHostSize(container) {
  if (!(container instanceof HTMLElement) || !container.style) return;
  container.style.removeProperty('width');
  container.style.removeProperty('height');
}

function sampleMapHostLuma(container) {
  const src = container?.querySelector?.('canvas');
  if (!src || src.width < 8 || src.height < 8) return 0;
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 8;
  const ctx = probe.getContext('2d');
  if (!ctx) return 0;
  try {
    ctx.drawImage(src, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (8 * 8 * 3);
  } catch {
    return 0;
  }
}

async function applyDockSizedHost(container, view) {
  if (!(container instanceof HTMLElement) || !view) return;
  unlockMapHostSize(container);
  container.style.left = '22rem';
  container.style.right = '0px';
  if (typeof view.resize === 'function') view.resize();
  if (typeof view.requestRender === 'function') view.requestRender();
  void container.getBoundingClientRect();
  await waitFrames();
}

async function restoreFullHost(container, view) {
  if (!(container instanceof HTMLElement) || !view) return;
  unlockMapHostSize(container);
  container.style.left = '';
  container.style.right = '';
  if (typeof view.resize === 'function') view.resize();
  if (typeof view.requestRender === 'function') view.requestRender();
  await waitFrames();
}

let presentGate = Promise.resolve();

export async function presentIqaiMapSurface() {
  const run = presentGate.then(async () => {
    if (!mapView) return;
    if (groundSurface !== 'aerial') await setIqaiGroundSurface('map');
    wakeIqaiMapSurface();
  });
  presentGate = run.catch(() => {});
  return run;
}

export function getAuthoredLayerIds() {
  return [...authoredLayerIds];
}

function layerLegendLabels(layer) {
  const renderer = layer?.renderer;
  const infos = renderer?.uniqueValueInfos || renderer?.classBreakInfos || [];
  return infos.map((info) => String(info.label || info.value || '').trim()).filter(Boolean);
}

function layerCollection(collection) {
  if (!collection) return [];
  if (typeof collection.toArray === 'function') return collection.toArray();
  return [...collection];
}

function walkOperationalLayers(collection, groupTitle = null, depth = 0, out = []) {
  for (const layer of layerCollection(collection)) {
    if (!layer) continue;
    if (layer.id === RUNTIME_PLANE_ID) {
      walkOperationalLayers(layer.layers, 'Session overlay', depth, out);
      continue;
    }
    if (layer.listMode === 'hide') continue;
    out.push({
      id: String(layer.id || layer.title || `layer-${out.length}`),
      title: String(layer.title || layer.id || 'Untitled layer'),
      visible: layer.visible !== false,
      opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1,
      group: groupTitle,
      depth,
      type: String(layer.type || ''),
      source: String(layer.portalItem?.title || groupTitle || 'Authored operational map'),
      session: String(layer.id || '').startsWith('session-'),
      legend: layerLegendLabels(layer)
    });
    if (layer.layers) walkOperationalLayers(layer.layers, layer.title || groupTitle, depth + 1, out);
  }
  return out;
}

export function listOperationalLayers() {
  if (!webMap) return [];
  return walkOperationalLayers(webMap.layers);
}

function findOperationalLayer(layerId) {
  if (!webMap || !layerId) return null;
  const all = webMap.allLayers ? layerCollection(webMap.allLayers) : layerCollection(webMap.layers);
  return all.find((layer) => layer && String(layer.id) === String(layerId)) || null;
}

export function setOperationalLayerVisibility(layerId, visible) {
  const layer = findOperationalLayer(layerId);
  if (!layer) return false;
  layer.visible = visible === true;
  return true;
}

export function setOperationalLayerOpacity(layerId, opacity) {
  const layer = findOperationalLayer(layerId);
  if (!layer || !('opacity' in layer)) return false;
  const value = Number(opacity);
  if (!Number.isFinite(value)) return false;
  layer.opacity = Math.min(1, Math.max(0, value));
  return true;
}

async function postArcGisForm(url, params, timeoutMs = 10000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(timeoutMs)
  });
  return response.json().catch(() => ({}));
}

function demoApiKeyFrom(oauth = {}) {
  return getLocalDemoApiKey() || (typeof oauth.apiKey === 'string' ? oauth.apiKey.trim() : '');
}

export async function searchPortalItems(query) {
  const text = String(query || '').trim();
  if (!text) return { ok: false, results: [], status: 'Enter a search.', portalWrite: false };
  const oauth = await fetchOperationalMapOAuthConfig().catch(() => ({}));
  const portalUrl = String(oauth.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '');
  const params = new URLSearchParams({
    f: 'json',
    num: '8',
    q: `(type:"Feature Service" OR type:"Map Service" OR type:"Image Service" OR type:"Web Map") AND (${text})`
  });
  const apiKey = demoApiKeyFrom(oauth);
  if (apiKey) params.set('token', apiKey);
  try {
    const data = await postArcGisForm(`${portalUrl}/sharing/rest/search`, params);
    const results = (data.results || []).map((item) => {
      const type = String(item.type || '');
      const addable = /feature service|map service|image service/i.test(type);
      return {
        id: item.id,
        title: item.title,
        type,
        addable
      };
    });
    return { ok: true, results, status: results.length ? null : 'No items found.', portalWrite: false };
  } catch {
    return { ok: false, results: [], status: 'ArcGIS Online search is unavailable.', portalWrite: false };
  }
}

export async function addSessionPortalItem({ id, type, title }) {
  if (!runtimePlane || !webMap) return { ok: false, reason: 'MAP_NOT_READY', portalWrite: false };
  if (/web map/i.test(String(type || ''))) {
    return { ok: false, reason: 'WEBMAP_NOT_SESSION_OVERLAY', portalWrite: false };
  }
  const itemId = String(id || '').trim();
  if (!itemId) return { ok: false, reason: 'MISSING_ITEM', portalWrite: false };
  const layerId = `session-${itemId}`;
  if (findOperationalLayer(layerId)) {
    return { ok: true, layerId, already: true, portalWrite: false };
  }
  const kind = String(type || '').toLowerCase();
  const moduleId = /image/.test(kind)
    ? '@arcgis/core/layers/ImageryLayer.js'
    : /map service/.test(kind)
      ? '@arcgis/core/layers/MapImageLayer.js'
      : '@arcgis/core/layers/FeatureLayer.js';
  const LayerClass = await importArc(moduleId);
  const layer = new LayerClass({
    id: layerId,
    title: title || itemId,
    portalItem: { id: itemId },
    popupEnabled: false
  });
  runtimePlane.add(layer);
  runtimePlane.visible = true;
  return { ok: true, layerId, portalWrite: false };
}

export async function searchAndGoTo(query) {
  const text = String(query || '').trim();
  if (!text || !mapView) return { ok: false };
  const oauth = await fetchOperationalMapOAuthConfig().catch(() => ({}));
  const params = new URLSearchParams({
    f: 'json',
    singleLine: text,
    maxLocations: '1',
    outFields: '*'
  });
  const apiKey = demoApiKeyFrom(oauth);
  if (apiKey) params.set('token', apiKey);
  const root = apiKey
    ? 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer'
    : 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
  try {
    const data = await postArcGisForm(`${root}/findAddressCandidates`, params, 8000);
    const candidate = data.candidates?.[0];
    const lon = Number(candidate?.location?.x);
    const lat = Number(candidate?.location?.y);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { ok: false };
    mapView.center = [lon, lat];
    if (Number.isFinite(mapView.zoom) && mapView.zoom < 14) mapView.zoom = 15;
    return { ok: true, longitude: lon, latitude: lat, address: candidate.address || text, portalWrite: false };
  } catch {
    return { ok: false };
  }
}

export function getMapViewCreateCount() {
  return mapViewCreateCount;
}

export function getMapFoundationSnapshot() {
  return snapshot();
}

function disablePopups(layer) {
  if (!layer) return;
  try {
    if ('popupEnabled' in layer) layer.popupEnabled = false;
  } catch {
    // some Esri layers expose popupEnabled as read-only
  }
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
  view.zoom = SPATIAL_V2_MAP_ZOOM;
  view.rotation = 0;
}

function adjustMapZoom(view, deltaZoom) {
  if (!view || !deltaZoom) return;
  const zoom = Number(view.zoom);
  if (Number.isFinite(zoom)) {
    const minZoom = Number(view.constraints?.minZoom);
    const maxZoom = Number(view.constraints?.maxZoom);
    let next = zoom + deltaZoom;
    if (Number.isFinite(minZoom)) next = Math.max(minZoom, next);
    if (Number.isFinite(maxZoom)) next = Math.min(maxZoom, next);
    view.zoom = next;
    return;
  }
  const scale = Number(view.scale);
  if (Number.isFinite(scale) && scale > 0) {
    view.scale = deltaZoom > 0 ? scale / 2 : scale * 2;
  }
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
    #iqai-spatial-v2 .iqai-v2-map-host {
      display: block !important;
    }
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

async function waitForMapLayerViewReady(view, layer, reactiveUtils) {
  if (!view || !layer || typeof view.whenLayerView !== 'function') {
    throw new Error('MAP VectorTileLayer readiness prerequisites are missing.');
  }
  if (!reactiveUtils || typeof reactiveUtils.whenOnce !== 'function') {
    throw new Error('ArcGIS reactive readiness utilities are unavailable.');
  }

  return withTimeout((async () => {
    if (typeof layer.load === 'function') await layer.load();
    if (layer.loadStatus === 'failed' || layer.loadError) {
      throw new Error(`MAP VectorTileLayer failed to load: ${sanitizeError(layer.loadError)}`);
    }

    const layerView = await view.whenLayerView(layer);
    if (!layerView) throw new Error('MAP VectorTileLayer LayerView was not created.');
    await reactiveUtils.whenOnce(() => layerView.updating === false);

    if (layerView.updating !== false) {
      throw new Error('MAP VectorTileLayer LayerView did not settle.');
    }
    if (layerView.suspended === true) {
      throw new Error('MAP VectorTileLayer LayerView is suspended.');
    }
    if (layer.loadError) {
      throw new Error(`MAP VectorTileLayer runtime failure: ${sanitizeError(layer.loadError)}`);
    }
    if (view.fatalError) {
      throw new Error(`MapView fatal error: ${sanitizeError(view.fatalError)}`);
    }
    return layerView;
  })(), MAP_READY_TIMEOUT_MS, 'MAP VectorTileLayer readiness');
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

async function ensureMapViewSurfaceSize(view, container) {
  const started = Date.now();
  while (Date.now() - started < 1500) {
    const w = Math.round(container?.clientWidth || 0);
    const h = Math.round(container?.clientHeight || 0);
    if (w >= 64 && h >= 64 && typeof view.resize === 'function') view.resize();
    await waitFrames();
    const canvases = container?.querySelectorAll?.('canvas') || [];
    let maxArea = 0;
    for (const canvas of canvases) {
      maxArea = Math.max(maxArea, Number(canvas.width || 0) * Number(canvas.height || 0));
    }
    const hostArea = Math.max(1, w * h);
    if (maxArea >= hostArea * 0.5) {
      unlockMapHostSize(container);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  unlockMapHostSize(container);
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
  applyOperationalHome(view);
}

async function applyOptionalLocalApiKey() {
  const oauth = await fetchOperationalMapOAuthConfig().catch(() => ({}));
  const apiKey = demoApiKeyFrom(oauth);
  if (!apiKey) return { apiKeyConfigured: false, authMode: 'none' };
  try {
    const esriConfig = await importArc('@arcgis/core/config.js');
    esriConfig.apiKey = apiKey;
  } catch {
    // geocode/add-data may stay unauthenticated; map boot must not fail
  }
  return { apiKeyConfigured: true, authMode: 'local-api-key' };
}

function hideBootImageryPlaceholder() {
  const observation = getImageryObservationLayer();
  if (observation) observation.visible = false;
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
  installMapViewHostCss();
  void applyOptionalLocalApiKey().catch(() => {});

  const [IqaiMap, MapView, GroupLayer, GraphicsLayer, reactiveUtils] = await withTimeout(
    Promise.all([
      importArc('@arcgis/core/Map.js'),
      importArc('@arcgis/core/views/MapView.js'),
      importArc('@arcgis/core/layers/GroupLayer.js'),
      importArc('@arcgis/core/layers/GraphicsLayer.js'),
      importArc('@arcgis/core/core/reactiveUtils.js')
    ]),
    45000,
    'ArcGIS module import'
  );

  mapBasemap = await createIqaiMapBasemap();
  cartoBaseLayer = firstBasemapLayer(mapBasemap);
  sessionEsriBasemapId = IQAI_MAP_BASEMAP_ID;
  sessionBasemapCache.set(IQAI_MAP_BASEMAP_ID, mapBasemap);
  groundSurface = 'map';
  void prepareAerialBasemap().catch(() => {});
  const map = new IqaiMap({
    basemap: mapBasemap
  });
  opsGraphicsLayer = new GraphicsLayer({
    id: 'iqai-v2-ops-graphics',
    title: 'Operational Layers',
    listMode: 'hide',
    visible: true
  });
  map.add(opsGraphicsLayer);

  if (mapView) {
    return getMapFoundationController();
  }

  if (!(container instanceof HTMLElement)) {
    throw new Error('Map stage container is not an HTMLElement.');
  }

  await waitForMapHostLayout(container);
  installMapViewHostCss();
  preserveMapViewDrawingBuffer();
  hideBootImageryPlaceholder();

  webMap = map;
  webMapCreateCount += 1;
  unlockMapHostSize(container);
  const view = new MapView({
    container,
    map: webMap,
    center: [MONTREAL_OPERATIONAL_CENTER.longitude, MONTREAL_OPERATIONAL_CENTER.latitude],
    zoom: SPATIAL_V2_MAP_ZOOM,
    rotation: 0,
    constraints: {
      snapToZoom: false,
      minZoom: 2,
      maxZoom: IQAI_MAP_MAX_ZOOM
    }
  });
  mapView = view;
  mapViewCreateCount += 1;

  const hostSize = `${container.clientWidth}x${container.clientHeight}`;
  if (container.clientWidth < 8 || container.clientHeight < 8) {
    throw new Error(`Map stage container is too small (${hostSize}).`);
  }

  try {
    mapView.popupEnabled = false;
  } catch {
    // MapView popupEnabled can be read-only on this SDK build
  }
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

  await withTimeout(mapView.when(), MAP_READY_TIMEOUT_MS, 'MapView readiness');
  await ensureMapViewSurfaceSize(mapView, container);
  suspendEmptyIqaiPlanes();
  // ArcGIS 5.1 keeps required attribution in the default MapView UI.
  // Assigning legacy string aliases to ui.components throws asynchronously.
  await ensureMontrealViewpoint(mapView);
  if (isGreaterMontrealLongitudeLatitude(mapView.center?.longitude, mapView.center?.latitude)) {
    homeViewpoint = mapView.viewpoint?.clone?.() || null;
  }
  await setIqaiGroundSurface('map');
  wakeIqaiMapSurface();
  await waitForMapLayerViewReady(mapView, cartoBaseLayer, reactiveUtils);
  void ensureImageryObservationSlot(webMap).catch(() => {});

  lastDiagnostics = {
    webmapItemId: null,
    webmapTitle: 'IQAI Map',
    portalIndependent: true,
    portalUser: null,
    portalUrl: null,
    authMode: 'none'
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
    getOpsGraphicsLayer,
    wakeIqaiMapSurface,
    presentIqaiMapSurface,
    getIqaiGroundSurface,
    setIqaiGroundSurface,
    listSessionBasemaps,
    getSessionEsriBasemapId,
    setSessionEsriBasemap,
    getAuthoredLayerIds,
    listOperationalLayers,
    setOperationalLayerVisibility,
    setOperationalLayerOpacity,
    searchPortalItems,
    addSessionPortalItem,
    searchAndGoTo,
    getMapViewCreateCount,
    subscribe: subscribeMapFoundation,
    zoomIn: async () => {
      adjustMapZoom(mapView, 1);
    },
    zoomOut: async () => {
      adjustMapZoom(mapView, -1);
    },
    goHome: async () => {
      if (homeViewpoint && mapView && typeof mapView.goTo === 'function') {
        await mapView.goTo(homeViewpoint, { animate: false });
        return;
      }
      applyOperationalHome(mapView);
    }
  };
}
