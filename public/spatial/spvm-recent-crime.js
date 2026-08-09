/**
 * SPVM 90-day crime GeoJSON — IQAI server proxy (no AGOL hosting / no external redirect).
 */
import {
  importArc,
  getWebMap
} from './spatial-arcgis-runtime.js';
import {
  findGroupLayerByTitle,
  findLayerByIdRecursive,
  attachLayerToGroup
} from './runtime-layer-groups.js';
import {
  SPVM_LAYER_ID,
  SPVM_LAYER_TITLE,
  PUBLIC_SAFETY_GROUP_TITLE,
  SPVM_LOCAL_GEOJSON_URL,
  SPVM_LAYER_FIELDS
} from './spvm-recent-crime-config.js';
import { applySpvmLayerPresentation, buildSpvmIncidentsRenderer, buildSpvmClusterReduction } from './spvm-crime-render.js';

/** @type {import('@arcgis/core/layers/GeoJSONLayer').default | null} */
let spvmLayer = null;
/** @type {boolean} */
let visibilitySyncing = false;
/** @type {boolean} */
let desiredVisible = false;
/** @type {Set<(visible: boolean) => void>} */
const visibilityListeners = new Set();

export function getSpvmLayer() {
  return spvmLayer;
}

export function isSpvmDesiredVisible() {
  return desiredVisible;
}

export function onSpvmVisibilityChange(listener) {
  visibilityListeners.add(listener);
  if (spvmLayer) listener(spvmLayer.visible);
  return () => visibilityListeners.delete(listener);
}

export function isSpvmRecentCrimeLayer(layer) {
  return layer?.id === SPVM_LAYER_ID;
}

export function syncSpvmVisibility(visible) {
  desiredVisible = Boolean(visible);
  if (visibilitySyncing) return;
  visibilitySyncing = true;
  if (spvmLayer) spvmLayer.visible = desiredVisible;
  if (desiredVisible) ensurePublicSafetyParentVisible();
  visibilitySyncing = false;
  for (const listener of visibilityListeners) listener(desiredVisible);
}

function ensurePublicSafetyParentVisible() {
  const parent = spvmLayer?.parent;
  if (parent?.type === 'group' && !parent.visible) {
    parent.visible = true;
  }
}

function notifyVisibility(visible) {
  for (const listener of visibilityListeners) listener(Boolean(visible));
}

function attachSpvmVisibilityWatchers() {
  if (!spvmLayer || spvmLayer.__spvmVisibilityWatchAttached) return;
  spvmLayer.__spvmVisibilityWatchAttached = true;
  spvmLayer.watch('visible', (visible) => {
    if (visibilitySyncing) return;
    visibilitySyncing = true;
    if (spvmLayer) spvmLayer.visible = visible;
    if (visible) ensurePublicSafetyParentVisible();
    visibilitySyncing = false;
    notifyVisibility(visible);
  });
}

async function primeSpvmLayerPresentation(layer) {
  try {
    if (!layer.loaded) await layer.load();
    await applySpvmLayerPresentation(layer, 'INCIDENTS');
  } catch (error) {
    console.warn('[IQAI] SPVM layer presentation failed', error?.message || error);
  }
}

async function ensureSpvmLayer() {
  const webMap = getWebMap();
  if (!webMap) return null;

  const existing = findLayerByIdRecursive(webMap, SPVM_LAYER_ID)?.layer;
  if (existing) {
    spvmLayer = existing;
    spvmLayer.visible = desiredVisible;
    attachSpvmVisibilityWatchers();
    await primeSpvmLayerPresentation(spvmLayer);
    return spvmLayer;
  }

  const GeoJSONLayer = await importArc('@arcgis/core/layers/GeoJSONLayer.js');
  const layer = new GeoJSONLayer({
    url: SPVM_LOCAL_GEOJSON_URL,
    id: SPVM_LAYER_ID,
    title: SPVM_LAYER_TITLE,
    listMode: 'show',
    visible: desiredVisible,
    fields: [...SPVM_LAYER_FIELDS],
    popupEnabled: true,
    popupTemplate: {
      title: 'SPVM Reported Crime',
      content: [
        {
          type: 'fields',
          fieldInfos: [
            { fieldName: 'date', label: 'Date' },
            { fieldName: 'shiftLabel', label: 'Shift' },
            { fieldName: 'pdq', label: 'PDQ' },
            { fieldName: 'spatialPrecision', label: 'Spatial precision' },
            { fieldName: 'temporalPrecision', label: 'Temporal precision' },
            { fieldName: 'sourceName', label: 'Source' }
          ]
        }
      ]
    },
    renderer: buildSpvmIncidentsRenderer(),
    featureReduction: buildSpvmClusterReduction()
  });

  await layer.load();

  const publicSafetyGroup = findGroupLayerByTitle(webMap, PUBLIC_SAFETY_GROUP_TITLE);
  if (publicSafetyGroup) {
    await attachLayerToGroup(layer, publicSafetyGroup);
  } else {
    console.warn('[IQAI] Public Safety group unavailable — SPVM layer attached to WebMap root');
    webMap.add(layer);
  }

  spvmLayer = layer;
  spvmLayer.visible = desiredVisible;
  attachSpvmVisibilityWatchers();
  await primeSpvmLayerPresentation(spvmLayer);
  return spvmLayer;
}

/**
 * @param {{ onRegistered?: () => void, onError?: (error: Error) => void }} [options]
 */
export function startSpvmRecentCrimeLayer(options = {}) {
  void ensureSpvmLayer()
    .then((layer) => {
      if (!layer) throw new Error('SPVM crime layer could not be created');
      options.onRegistered?.();
    })
    .catch((error) => {
      console.warn('[IQAI] SPVM recent crime layer failed to start', error?.message || error);
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    });

  return {
    stop: () => {
      spvmLayer = null;
    }
  };
}
