/**
 * Operational Layers V1.5 controller for Spatial V2.
 * Layers / Discover owns visibility. WOA is not duplicated here.
 */
import {
  DEFAULT_SCENES,
  getScene,
  listScenes,
  overwriteCustomScene,
  resetBuiltin,
  saveBuiltinLayers,
  saveCustomScene,
  sameSet
} from './scenes.js';
import { buildLayerInfo } from './snapshot.js';
import { buildSceneBrief } from './scene-brief.js';
import { visualClass } from './symbology.js';
import { getOpsView, setOpsLayerEmphasis, setOpsOverlay } from './overlay.js';

export const VISIBILITY_OWNER = 'layers-discover';
export const ACQUISITION_OWNER = 'world-object-acquisition';
export const OPS_INSTANCE_PREFIX = 'ops-';
export const CATALOG_URL = '/api/spatial-v2/ops-layers/catalog';
export const LAYER_URL = '/api/spatial-v2/ops-layers/layers';

const WOA_OBJECT_CLASSES = Object.freeze(['building', 'sidewalk', 'park', 'evaluation_unit', 'hydrant', 'traffic_signal']);
const generation = new Map();
const refreshTimers = new Map();

const GROUP_TITLE = {
  'public-safety': 'PUBLIC SAFETY',
  movement: 'MOVEMENT',
  infrastructure: 'INFRASTRUCTURE',
  environment: 'ENVIRONMENT',
  wildfire: 'WILDFIRE'
};

const state = {
  catalog: null,
  visible: new Set(),
  restoreSet: [],
  activeSceneId: null,
  sceneExact: false,
  applying: false,
  configureOpen: false,
  configureSceneId: null,
  infoLayerId: null,
  camerasInView: false,
  solarAt: null,
  solarArea: 'montreal',
  solarEmphasize: null,
  listeners: new Set()
};

function viewCenter() {
  const view = getOpsView();
  const c = view?.center;
  if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
    return { lat: c.latitude, lon: c.longitude };
  }
  return { lat: 45.5088, lon: -73.5617 };
}

function geographicPair(x, y, spatialReference) {
  if (spatialReference?.isGeographic || Math.abs(Number(x)) <= 180) {
    return { lon: Number(x), lat: Number(y) };
  }
  const lon = Number(x) / 20037508.34 * 180;
  const mercatorLat = Number(y) / 20037508.34 * 180;
  const lat = 180 / Math.PI * (2 * Math.atan(Math.exp(mercatorLat * Math.PI / 180)) - Math.PI / 2);
  return { lon, lat };
}

function emit() {
  for (const listener of state.listeners) {
    try { listener(snapshot()); } catch { /* ignore */ }
  }
}

function layerById(id) {
  return state.catalog?.layers?.find((layer) => layer.id === id) || null;
}

function attachPayload(id, payload) {
  const layer = layerById(id);
  if (!layer) return;
  layer.lastPayload = payload;
  if (payload?.status) layer.status = payload.status;
}

export function instanceIdFor(layerId) {
  return `${OPS_INSTANCE_PREFIX}${layerId}`;
}

export function layerIdFromInstance(instanceId) {
  const value = String(instanceId || '');
  return value.startsWith(OPS_INSTANCE_PREFIX) ? value.slice(OPS_INSTANCE_PREFIX.length) : null;
}

export function isWoaObjectClass(id) {
  return WOA_OBJECT_CLASSES.includes(id);
}

export async function loadCatalog() {
  const res = await fetch(CATALOG_URL, { cache: 'no-store' });
  const catalog = await res.json();
  if (!catalog?.layers) throw new Error(catalog?.message || 'Operational catalog failed');
  state.catalog = catalog;
  for (const layer of catalog.layers) {
    layer.on = state.visible.has(layer.id);
    layer.lastPayload = layer.lastPayload || null;
    if (layer.timeWindows && !layer.selectedWindow) {
      layer.selectedWindow = layer.timeWindows.default || '1d';
    }
    if (!layer.selectedCategory) layer.selectedCategory = 'all';
    if (!layer.selectedRoute) layer.selectedRoute = 'all';
  }
  emit();
  return catalog;
}

export async function fetchLayerPayload(id, options = {}) {
  const params = new URLSearchParams();
  if (options.window) params.set('window', options.window);
  if (options.category && options.category !== 'all') params.set('category', options.category);
  if (options.route && options.route !== 'all') params.set('route', options.route);
  if (options.lat != null) params.set('lat', String(options.lat));
  if (options.lon != null) params.set('lon', String(options.lon));
  if (options.at) params.set('at', String(options.at));
  if (options.area) params.set('area', String(options.area));
  if (options.minLat != null) params.set('minLat', String(options.minLat));
  if (options.maxLat != null) params.set('maxLat', String(options.maxLat));
  if (options.minLon != null) params.set('minLon', String(options.minLon));
  if (options.maxLon != null) params.set('maxLon', String(options.maxLon));
  const qs = params.toString();
  const res = await fetch(`${LAYER_URL}/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  return res.json();
}

function layerFetchOptions(layer) {
  const opts = {
    window: layer.selectedWindow,
    category: layer.selectedCategory,
    route: layer.selectedRoute
  };
  if (layer.id === 'sun-daylight') {
    const at = viewCenter();
    opts.lat = at.lat;
    opts.lon = at.lon;
    opts.area = state.solarArea || 'montreal';
    if (state.solarAt) opts.at = state.solarAt;
    if (opts.area === 'view') {
      const extent = getOpsView()?.extent;
      if (extent) {
        const southwest = geographicPair(extent.xmin, extent.ymin, extent.spatialReference);
        const northeast = geographicPair(extent.xmax, extent.ymax, extent.spatialReference);
        opts.minLat = southwest.lat;
        opts.maxLat = northeast.lat;
        opts.minLon = southwest.lon;
        opts.maxLon = northeast.lon;
      }
    }
  }
  return opts;
}

function clearRefresh(id) {
  const timer = refreshTimers.get(id);
  if (timer) clearInterval(timer);
  refreshTimers.delete(id);
}

function scheduleRefresh(layer, payload) {
  clearRefresh(layer.id);
  const refreshMs = Number(payload?.refreshMs);
  if (!Number.isFinite(refreshMs) || refreshMs < 5000 || !state.visible.has(layer.id)) return;
  refreshTimers.set(layer.id, setInterval(() => {
    if (!state.visible.has(layer.id)) {
      clearRefresh(layer.id);
      return;
    }
    void setLayerVisible(layer.id, true);
  }, refreshMs));
}

export async function setLayerVisible(id, on) {
  const layer = layerById(id);
  if (!layer || isWoaObjectClass(id)) return null;
  const token = (generation.get(id) || 0) + 1;
  generation.set(id, token);
  if (on) {
    if (!state.applying) {
      state.visible.add(id);
      layer.on = true;
      emit();
    }
    const payload = await fetchLayerPayload(id, layerFetchOptions(layer));
    attachPayload(id, payload);
    if (Array.isArray(payload?.categories)) layer.categories = payload.categories;
    if (Array.isArray(payload?.routes)) layer.routes = payload.routes;
    const overlay = await setOpsOverlay(layer, payload, true);
    if (generation.get(id) !== token) return layer;
    const painted = overlay?.ok === true && (overlay.graphicCount > 0 || ['AUTH_REQUIRED', 'UNAVAILABLE', 'FAILED'].includes(String(payload?.status || '')));
    if (overlay?.ok === true) {
      state.visible.add(id);
      layer.on = true;
      scheduleRefresh(layer, payload);
    } else if (!state.applying) {
      state.visible.delete(id);
      layer.on = false;
    }
    layer.overlayResult = overlay;
    if (!painted && overlay?.reason) layer.runtimeNote = overlay.reason;
  } else {
    clearRefresh(id);
    await setOpsOverlay(layer, layer.lastPayload || { geojson: { type: 'FeatureCollection', features: [] } }, false);
    if (generation.get(id) !== token) return layer;
    state.visible.delete(id);
    layer.on = false;
  }
  if (!state.applying) syncSceneMatch();
  emit();
  return layer;
}

export async function applyScene(sceneId) {
  const scene = getScene(sceneId);
  if (!scene || !state.catalog) return null;
  state.applying = true;
  const wanted = new Set(scene.layers);
  for (const layer of state.catalog.layers) {
    await setLayerVisible(layer.id, wanted.has(layer.id));
  }
  state.applying = false;
  state.activeSceneId = scene.id;
  state.sceneExact = true;
  emit();
  return scene;
}

export async function allOff() {
  if (!state.catalog) return [];
  const current = [...state.visible];
  if (current.length) state.restoreSet = current;
  state.applying = true;
  for (const layer of state.catalog.layers) {
    await setLayerVisible(layer.id, false);
  }
  state.applying = false;
  state.activeSceneId = null;
  state.sceneExact = false;
  emit();
  return current;
}

export async function restoreLayers() {
  if (!state.catalog || !state.restoreSet.length) return [];
  const wanted = new Set(state.restoreSet);
  state.applying = true;
  for (const layer of state.catalog.layers) {
    await setLayerVisible(layer.id, wanted.has(layer.id));
  }
  state.applying = false;
  syncSceneMatch();
  emit();
  return [...state.visible];
}

export async function soloLayer(id) {
  if (!state.catalog) return null;
  if (state.visible.size) state.restoreSet = [...state.visible];
  state.applying = true;
  for (const layer of state.catalog.layers) {
    await setLayerVisible(layer.id, layer.id === id);
  }
  state.applying = false;
  if (state.activeSceneId) state.sceneExact = false;
  emit();
  return id;
}

export function saveConfiguredMembership(sceneId, layerIds) {
  const scene = getScene(sceneId);
  if (!scene) return false;
  if (scene.builtin) return saveBuiltinLayers(sceneId, layerIds);
  return overwriteCustomScene(sceneId, scene.title, layerIds).ok === true;
}

export function resetConfiguredMembership(sceneId) {
  return resetBuiltin(sceneId);
}

export function saveCurrentScene(title) {
  return saveCustomScene(title, [...state.visible]);
}

export async function setLayerWindow(id, windowId) {
  const layer = layerById(id);
  if (!layer) return null;
  layer.selectedWindow = windowId;
  if (state.visible.has(id)) await setLayerVisible(id, true);
  else emit();
  return layer;
}

export async function setLayerCategory(id, category) {
  const layer = layerById(id);
  if (!layer) return null;
  layer.selectedCategory = category || 'all';
  if (state.visible.has(id)) await setLayerVisible(id, true);
  else emit();
  return layer;
}

export async function setLayerRoute(id, route) {
  const layer = layerById(id);
  if (!layer) return null;
  layer.selectedRoute = route || 'all';
  if (state.visible.has(id)) await setLayerVisible(id, true);
  else emit();
  return layer;
}

export function setCamerasInView(on) {
  state.camerasInView = on === true;
  emit();
}

export async function setSolarInstant(value) {
  state.solarAt = value ? new Date(value).toISOString() : null;
  if (state.visible.has('sun-daylight')) return setLayerVisible('sun-daylight', true);
  emit();
  return layerById('sun-daylight');
}

export async function setSolarArea(area) {
  state.solarArea = ['montreal', 'view', 'canada'].includes(area) ? area : 'montreal';
  if (state.visible.has('sun-daylight')) return setLayerVisible('sun-daylight', true);
  emit();
  return layerById('sun-daylight');
}

export function setSolarEmphasis(value) {
  state.solarEmphasize = value || null;
  setOpsLayerEmphasis('sun-daylight', state.solarEmphasize);
  emit();
  return state.solarEmphasize;
}

export async function refreshSolar() {
  if (!state.visible.has('sun-daylight')) return null;
  return setLayerVisible('sun-daylight', true);
}

function syncSceneMatch() {
  const visible = [...state.visible];
  if (!visible.length) {
    state.activeSceneId = null;
    state.sceneExact = false;
    return;
  }
  const match = listScenes().find((scene) => sameSet(visible, scene.layers));
  if (match) {
    state.activeSceneId = match.id;
    state.sceneExact = true;
    return;
  }
  if (state.activeSceneId) state.sceneExact = false;
}

export function setConfigureOpen(open, sceneId) {
  state.configureOpen = open === true;
  state.configureSceneId = sceneId || state.activeSceneId || 'public-safety';
  emit();
}

export function setInfoLayer(id) {
  state.infoLayerId = id || null;
  emit();
}

export function subscribeOpsLayers(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function drawerGroups() {
  const groups = [];
  const order = (state.catalog?.groups || [
    { id: 'public-safety' },
    { id: 'wildfire' },
    { id: 'movement' },
    { id: 'infrastructure' },
    { id: 'environment' }
  ]).map((group) => group.id);
  for (const groupId of order) {
    const family = GROUP_TITLE[groupId] || groupId;
    const items = (state.catalog?.layers || [])
      .filter((layer) => layer.group === groupId)
      .map((layer) => ({
        instanceId: instanceIdFor(layer.id),
        layerId: 'ops-discover',
        objectClass: layer.id,
        title: layer.title,
        source: layer.provider,
        provider: layer.provider,
        runtimeNote: layer.lastPayload?.message || layer.runtimeNote || layer.provider,
        visible: state.visible.has(layer.id),
        status: layer.lastPayload?.status || layer.status,
        color: layer.color,
        visualClass: visualClass(layer.id),
        featureCount: layer.lastPayload?.featureCount,
        timeWindows: layer.timeWindows || null,
        selectedWindow: layer.selectedWindow || layer.timeWindows?.default || null,
        selectedCategory: layer.selectedCategory || 'all',
        categories: layer.categories || layer.lastPayload?.categories || [],
        selectedRoute: layer.selectedRoute || 'all',
        routes: layer.routes || layer.lastPayload?.routes || [],
        togglable: true,
        family,
        session: true,
        depth: 0,
        group: family,
        legend: [],
        infoAvailable: true
      }));
    if (items.length) {
      groups.push({
        family,
        count: items.length,
        items
      });
    }
  }
  return groups;
}

export function snapshot() {
  const catalog = state.catalog;
  const scene = state.activeSceneId ? getScene(state.activeSceneId) : null;
  const visible = [...state.visible];
  const brief = buildSceneBrief(scene || { id: 'custom', title: 'VISIBLE SET', layers: visible }, {
    catalog,
    view: getOpsView()
  });
  const infoLayer = state.infoLayerId ? layerById(state.infoLayerId) : null;
  return {
    contract: 'iqai.spatial.ops-layers/1.5.0',
    visibilityOwner: VISIBILITY_OWNER,
    acquisitionOwner: ACQUISITION_OWNER,
    loaded: Boolean(catalog),
    layerCount: catalog?.layers?.length || 0,
    layerIds: (catalog?.layers || []).map((layer) => layer.id),
    visible,
    restoreEnabled: state.restoreSet.length > 0,
    restoreSet: [...state.restoreSet],
    activeSceneId: state.activeSceneId,
    sceneExact: state.sceneExact,
    configureOpen: state.configureOpen,
    configureSceneId: state.configureSceneId,
    scenes: listScenes(),
    groups: drawerGroups(),
    brief,
    camerasInView: state.camerasInView,
    infoLayerId: state.infoLayerId,
    solar: {
      visible: state.visible.has('sun-daylight'),
      at: state.solarAt,
      area: state.solarArea,
      emphasize: state.solarEmphasize,
      payload: layerById('sun-daylight')?.lastPayload || null
    },
    info: infoLayer ? buildLayerInfo(infoLayer, infoLayer.lastPayload || {}, { view: getOpsView() }) : null,
    blocked: (catalog?.layers || [])
      .filter((layer) => ['AUTH_REQUIRED', 'UNAVAILABLE', 'FAILED'].includes(layer.status))
      .map((layer) => ({ id: layer.id, status: layer.status })),
    hydrantInCatalog: (catalog?.layers || []).some((layer) => layer.id === 'hydrant'),
    trafficSignalInCatalog: (catalog?.layers || []).some((layer) => layer.id === 'traffic_signal'),
    solarPresent: (catalog?.layers || []).some((layer) => /solar/i.test(layer.id) || /solar/i.test(layer.title)),
    portPresent: (catalog?.layers || []).some((layer) => /port/i.test(layer.id) && layer.id !== 'airports')
  };
}

export { DEFAULT_SCENES, listScenes, getScene, sameSet };
