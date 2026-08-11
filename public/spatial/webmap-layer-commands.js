/**
 * Client-side layer visibility / zoom commands against actual WebMap layers.
 */

import { getMapView, getWebMap, importArc } from './spatial-arcgis-runtime.js';
import {
  findRuntimeLayerByCatalogId,
  findRuntimeLayerByCatalogEntry,
  getToggleableCatalogEntries,
  getWebMapLayerCatalogSnapshot,
  applyStartupLayerVisibilityPolicy,
  syncCatalogVisibilityFromRuntime
} from './webmap-layer-catalog.js';
import { syncAircraftVisibility } from './aircraft-live.js';
import { syncVesselsVisibility } from './vessels-live.js';
import { AIRCRAFT_LAYER_ID } from './aircraft-live-config.js';
import { VESSELS_LAYER_ID } from './vessels-live-config.js';
import { syncHydroOutageVisibility } from './hydro-quebec-outages.js';
import { HYDRO_GROUP_ID } from './hydro-quebec-outages-config.js';
import { syncSpvmVisibility } from './spvm-recent-crime.js';
import { SPVM_LAYER_ID } from './spvm-recent-crime-config.js';

const SINGLE_OPS = {
  SHOW_LAYERS: 'SHOW_LAYER',
  HIDE_LAYERS: 'HIDE_LAYER',
  TOGGLE_LAYERS: 'TOGGLE_LAYER',
  ZOOM_TO_LAYERS: 'ZOOM_TO_LAYER'
};

function mapSingleOperation(operation) {
  return SINGLE_OPS[operation] || operation;
}

function ensureAncestorGroupsVisible(layer) {
  let parent = layer?.parent;
  while (parent) {
    if (parent.type === 'group' && !parent.visible) {
      parent.visible = true;
    }
    parent = parent.parent;
  }
}

/**
 * @param {object} layerControl
 */
export async function executeLayerControl(layerControl) {
  const layer = layerControl.catalogId
    ? findRuntimeLayerByCatalogId(layerControl.catalogId)
    : findRuntimeLayerByCatalogEntry(layerControl);

  if (!layer) {
    throw new Error(`Layer not found in Montreal 1: ${layerControl.title || layerControl.catalogId}`);
  }

  if (!layer.loaded) await layer.load();

  const operation = layerControl.operation;
  if (operation === 'SHOW_LAYER' || operation === 'SHOW_LAYERS') {
    ensureAncestorGroupsVisible(layer);
    layer.visible = true;
    if (layer.id === AIRCRAFT_LAYER_ID) syncAircraftVisibility(true);
    if (layer.id === VESSELS_LAYER_ID) syncVesselsVisibility(true);
    if (layer.id === HYDRO_GROUP_ID) syncHydroOutageVisibility(true);
    if (layer.id === SPVM_LAYER_ID) syncSpvmVisibility(true);
    syncCatalogVisibilityFromRuntime();
    return { layerId: layer.id, title: layer.title, visible: true };
  }
  if (operation === 'HIDE_LAYER' || operation === 'HIDE_LAYERS') {
    layer.visible = false;
    if (layer.id === AIRCRAFT_LAYER_ID) syncAircraftVisibility(false);
    if (layer.id === VESSELS_LAYER_ID) syncVesselsVisibility(false);
    if (layer.id === HYDRO_GROUP_ID) syncHydroOutageVisibility(false);
    if (layer.id === SPVM_LAYER_ID) syncSpvmVisibility(false);
    syncCatalogVisibilityFromRuntime();
    return { layerId: layer.id, title: layer.title, visible: false };
  }
  if (operation === 'TOGGLE_LAYER' || operation === 'TOGGLE_LAYERS') {
    layer.visible = !layer.visible;
    if (layer.id === AIRCRAFT_LAYER_ID) syncAircraftVisibility(layer.visible);
    if (layer.id === VESSELS_LAYER_ID) syncVesselsVisibility(layer.visible);
    if (layer.id === HYDRO_GROUP_ID) syncHydroOutageVisibility(layer.visible);
    if (layer.id === SPVM_LAYER_ID) syncSpvmVisibility(layer.visible);
    syncCatalogVisibilityFromRuntime();
    return { layerId: layer.id, title: layer.title, visible: layer.visible };
  }
  if (operation === 'ZOOM_TO_LAYER' || operation === 'ZOOM_TO_LAYERS') {
    await zoomToLayerExtent(layer);
    return { layerId: layer.id, title: layer.title, zoomed: true };
  }

  throw new Error(`Unsupported layer control: ${operation}`);
}

async function zoomToLayerExtent(layer) {
  const view = getMapView();
  if (!view) throw new Error('MapView is not ready');

  let target = layer.fullExtent;
  if (!target && layer.type === 'feature') {
    const extent = await layer.queryExtent();
    target = extent?.extent;
  }
  if (!target) {
    throw new Error(`No extent available for layer: ${layer.title || layer.id}`);
  }
  await view.goTo(target);
}

async function zoomToCombinedExtents(layers) {
  const view = getMapView();
  if (!view) throw new Error('MapView is not ready');

  const extents = [];
  for (const layer of layers) {
    if (!layer.loaded) await layer.load();
    let target = layer.fullExtent;
    if (!target && layer.type === 'feature') {
      const extent = await layer.queryExtent();
      target = extent?.extent;
    }
    if (target) extents.push(target);
  }
  if (!extents.length) {
    throw new Error('No extent available for the referenced layers.');
  }
  if (extents.length === 1) {
    await view.goTo(extents[0]);
    return;
  }
  const geometryEngine = await importArc('@arcgis/core/geometry/geometryEngine.js');
  const combined = geometryEngine.union(extents);
  await view.goTo(combined);
}

/**
 * @param {string} operation
 * @param {object[]} layerEntries
 */
export async function executeLayerControls(operation, layerEntries) {
  const singleOp = mapSingleOperation(operation);
  const runtimeLayers = [];

  for (const entry of layerEntries) {
    const layer = entry.catalogId
      ? findRuntimeLayerByCatalogId(entry.catalogId)
      : findRuntimeLayerByCatalogEntry(entry);
    if (!layer) {
      throw new Error(`Layer not found: ${entry.title || entry.catalogId}`);
    }
    runtimeLayers.push(layer);
  }

  if (operation === 'ZOOM_TO_LAYERS') {
    await zoomToCombinedExtents(runtimeLayers);
    syncCatalogVisibilityFromRuntime();
    return runtimeLayers.map((layer) => ({ layerId: layer.id, title: layer.title, zoomed: true }));
  }

  const results = [];
  for (const entry of layerEntries) {
    results.push(await executeLayerControl({
      operation: singleOp,
      catalogId: entry.catalogId,
      layerId: entry.layerId,
      title: entry.title
    }));
  }
  return results;
}

export async function executeHideAllSourceLayers() {
  const catalog = getWebMapLayerCatalogSnapshot();
  const entries = getToggleableCatalogEntries(catalog);
  await executeLayerControls('HIDE_LAYERS', entries);
  return { count: entries.length, layers: entries };
}

function getScopedResultLayerIds() {
  const webMap = getWebMap();
  if (!webMap) return [];
  return webMap.layers.toArray()
    .filter((layer) => layer.id?.startsWith('iqai-'))
    .map((layer) => layer.id);
}

export function countVisibleScopedResultLayers() {
  const webMap = getWebMap();
  if (!webMap) return 0;
  const featureLayers = webMap.layers.toArray()
    .filter((layer) => layer.id?.startsWith('iqai-webmap-') && layer.visible);
  if (featureLayers.length) return featureLayers.length;
  const group = webMap.findLayerById('iqai-map-result');
  return group?.visible ? 1 : 0;
}

/** Hide all toggleable source WebMap layers plus any visible IQAI scoped result layers. */
export async function executeHideAllDisplayed() {
  const sourceResult = await executeHideAllSourceLayers();
  const scopedIds = getScopedResultLayerIds();
  const scopedVisible = countVisibleScopedResultLayers();
  if (scopedIds.length) {
    await setIqaiResultsVisible(false, scopedIds);
  }
  return {
    sourceCount: sourceResult.count,
    scopedCount: scopedVisible,
    layers: sourceResult.layers
  };
}

/** @deprecated alias — hides source layers only */
export async function executeHideAllOperational() {
  return executeHideAllSourceLayers();
}

export async function executeShowAllOperational() {
  const catalog = getWebMapLayerCatalogSnapshot();
  const entries = getToggleableCatalogEntries(catalog);
  await executeLayerControls('SHOW_LAYERS', entries);
  return { count: entries.length, layers: entries };
}

export async function executeShowOnlyLayers(layerEntries) {
  const catalog = getWebMapLayerCatalogSnapshot();
  const toggleable = getToggleableCatalogEntries(catalog);
  const showIds = new Set(layerEntries.map((entry) => entry.catalogId));
  const hideEntries = toggleable.filter((entry) => !showIds.has(entry.catalogId));
  if (hideEntries.length) await executeLayerControls('HIDE_LAYERS', hideEntries);
  await executeLayerControls('SHOW_LAYERS', layerEntries);
  return { shown: layerEntries, hidden: hideEntries.length };
}

export async function restoreMapLayerVisibility() {
  const result = await applyStartupLayerVisibilityPolicy();
  return { restored: result.hidden };
}

export async function setIqaiResultsVisible(visible, layerIds = []) {
  const webMap = getWebMap();
  if (!webMap) return { updated: 0 };

  let updated = 0;
  const targets = layerIds.length
    ? layerIds
    : webMap.layers.toArray().filter((layer) => layer.id?.startsWith('iqai-')).map((layer) => layer.id);

  for (const id of targets) {
    const layer = webMap.findLayerById(id);
    if (!layer) continue;
    layer.visible = visible;
    updated += 1;
  }

  const group = webMap.findLayerById('iqai-map-result');
  if (group && !targets.includes('iqai-map-result')) {
    group.visible = visible;
    updated += 1;
  }

  return { updated, visible };
}
