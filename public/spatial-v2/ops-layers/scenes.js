/** Configurable operational scenes. Local operator persistence only. */

export const STORAGE_KEY = 'iqai-spatial-v2-ops-scenes-v1';
export const MAX_CUSTOM = 3;

export const DEFAULT_SCENES = [
  {
    id: 'public-safety',
    title: 'PUBLIC SAFETY',
    builtin: true,
    layers: [
      'recent-crime',
      'pdq-territories',
      'pdq',
      'fire-interventions',
      'fire',
      'hospitals',
      'civic-311',
      'traffic-cameras'
    ]
  },
  {
    id: 'movement',
    title: 'MOVEMENT',
    builtin: true,
    layers: [
      'stm',
      'bixi',
      'bike-counters',
      'intersection-counts',
      'road-works',
      'qc-511',
      'traffic-cameras',
      'aircraft',
      'exo',
      'rem'
    ]
  },
  {
    id: 'infrastructure',
    title: 'INFRASTRUCTURE',
    builtin: true,
    layers: [
      'hydro',
      'road-works',
      'qc-511',
      'hospitals',
      'fire',
      'pdq',
      'snow-ops'
    ]
  },
  {
    id: 'weather-impact',
    title: 'WEATHER IMPACT',
    builtin: true,
    layers: [
      'weather',
      'air-quality',
      'hydrometric',
      'hydro',
      'road-works'
    ]
  },
  {
    id: 'wildfire',
    title: 'WILDFIRE',
    builtin: true,
    layers: [
      'wildfire-active',
      'wildfire-hotspots',
      'wildfire-perimeters',
      'wildfire-fwi',
      'weather',
      'air-quality',
      'qc-511'
    ]
  },
  {
    id: 'police-picture',
    title: 'POLICE PICTURE',
    builtin: true,
    layers: [
      'recent-crime',
      'pdq-territories',
      'pdq',
      'fire-interventions',
      'hospitals',
      'traffic-cameras',
      'road-works',
      'qc-511',
      'aircraft',
      'hydro',
      'weather'
    ]
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readStore() {
  try {
    if (typeof localStorage === 'undefined') return { scenes: {}, custom: [] };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scenes: {}, custom: [] };
    const parsed = JSON.parse(raw);
    return {
      scenes: parsed.scenes && typeof parsed.scenes === 'object' ? parsed.scenes : {},
      custom: Array.isArray(parsed.custom) ? parsed.custom.slice(0, MAX_CUSTOM) : []
    };
  } catch {
    return { scenes: {}, custom: [] };
  }
}

function writeStore(store) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    scenes: store.scenes || {},
    custom: (store.custom || []).slice(0, MAX_CUSTOM)
  }));
}

export function defaultLayers(id) {
  return clone(DEFAULT_SCENES.find((scene) => scene.id === id)?.layers || []);
}

export function listScenes(storeOverride) {
  const store = storeOverride || readStore();
  const builtins = DEFAULT_SCENES.map((scene) => ({
    ...scene,
    layers: Array.isArray(store.scenes[scene.id]) ? clone(store.scenes[scene.id]) : clone(scene.layers)
  }));
  const custom = (store.custom || []).map((scene) => ({
    id: scene.id,
    title: String(scene.title || 'MY VIEW').slice(0, 24).toUpperCase(),
    builtin: false,
    layers: Array.isArray(scene.layers) ? clone(scene.layers) : []
  }));
  return [...builtins, ...custom];
}

export function getScene(id, storeOverride) {
  return listScenes(storeOverride).find((scene) => scene.id === id) || null;
}

export function saveBuiltinLayers(id, layers) {
  if (!DEFAULT_SCENES.some((scene) => scene.id === id)) return false;
  const store = readStore();
  store.scenes[id] = [...new Set(layers)];
  writeStore(store);
  return true;
}

export function resetBuiltin(id) {
  if (!DEFAULT_SCENES.some((scene) => scene.id === id)) return false;
  const store = readStore();
  delete store.scenes[id];
  writeStore(store);
  return true;
}

export function saveCustomScene(title, layers) {
  const store = readStore();
  const name = String(title || '').trim().slice(0, 24).toUpperCase() || `MY VIEW ${(store.custom?.length || 0) + 1}`;
  if ((store.custom || []).length >= MAX_CUSTOM) {
    return { ok: false, message: 'Maximum 3 custom scenes' };
  }
  const id = `custom-${Date.now().toString(36)}`;
  store.custom = [...(store.custom || []), { id, title: name, layers: [...new Set(layers)] }];
  writeStore(store);
  return { ok: true, id, title: name };
}

export function overwriteCustomScene(id, title, layers) {
  const store = readStore();
  const idx = (store.custom || []).findIndex((scene) => scene.id === id);
  if (idx < 0) return { ok: false, message: 'Unknown custom scene' };
  store.custom[idx] = {
    id,
    title: String(title || store.custom[idx].title).trim().slice(0, 24).toUpperCase(),
    layers: [...new Set(layers)]
  };
  writeStore(store);
  return { ok: true, id };
}

export function sameSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

export function formatCount(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('en-CA');
}
