/**
 * Operational Layers V1.5 controller for Spatial V2.
 * Layers / Discover owns visibility. WOA is not duplicated here.
 */
import {
  DEFAULT_SCENES,
  getScene,
  listScenes,
  resetBuiltin,
  saveBuiltinLayers,
  sameSet
} from './scenes.js';
import { buildLayerInfo } from './snapshot.js';
import { buildSceneBrief } from './scene-brief.js';
import { getOpsView, setOpsOverlay } from './overlay.js';

export const VISIBILITY_OWNER = 'layers-discover';
export const ACQUISITION_OWNER = 'world-object-acquisition';
export const OPS_INSTANCE_PREFIX = 'ops-';
export const CATALOG_URL = '/api/spatial-v2/ops-layers/catalog';
export const LAYER_URL = '/api/spatial-v2/ops-layers/layers';

const WOA_OBJECT_CLASSES = Object.freeze(['building', 'sidewalk', 'park', 'evaluation_unit', 'hydrant', 'traffic_signal']);

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
  listeners: new Set()
};

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
  }
  emit();
  return catalog;
}

export async function fetchLayerPayload(id, options = {}) {
  const params = new URLSearchParams();
  if (options.window) params.set('window', options.window);
  if (options.category) params.set('category', options.category);
  const qs = params.toString();
  const res = await fetch(`${LAYER_URL}/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  return res.json();
}

export async function setLayerVisible(id, on) {
  const layer = layerById(id);
  if (!layer || isWoaObjectClass(id)) return null;
  if (on) {
    const payload = await fetchLayerPayload(id);
    attachPayload(id, payload);
    await setOpsOverlay(layer, payload, true);
    state.visible.add(id);
    layer.on = true;
  } else {
    await setOpsOverlay(layer, layer.lastPayload || { geojson: { type: 'FeatureCollection', features: [] } }, false);
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
  if (!scene?.builtin) return false;
  return saveBuiltinLayers(sceneId, layerIds);
}

export function resetConfiguredMembership(sceneId) {
  return resetBuiltin(sceneId);
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
  const order = ['public-safety', 'movement', 'infrastructure', 'environment', 'wildfire'];
  for (const groupId of order) {
    const items = (state.catalog?.layers || [])
      .filter((layer) => layer.group === groupId)
      .map((layer) => ({
        instanceId: instanceIdFor(layer.id),
        layerId: 'ops-discover',
        objectClass: layer.id,
        title: layer.title,
        source: layer.provider,
        visible: state.visible.has(layer.id),
        status: layer.status,
        togglable: true,
        family: GROUP_TITLE[groupId],
        session: true,
        depth: 0,
        group: GROUP_TITLE[groupId],
        legend: [],
        infoAvailable: true
      }));
    if (items.length) {
      groups.push({
        family: GROUP_TITLE[groupId],
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
    infoLayerId: state.infoLayerId,
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
