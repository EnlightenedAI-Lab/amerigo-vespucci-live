/**
 * Runtime layer groups for live operational feeds (browser only).
 */
import {
  getWebMap,
  importArc
} from './spatial-arcgis-runtime.js';
import {
  TRANSPORTATION_ACCESS_GROUP_ID,
  TRANSPORTATION_ACCESS_GROUP_TITLE
} from './hydro-quebec-outages-config.js';

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {import('@arcgis/core/WebMap').default} webMap
 */
export function collectWebMapLayerEntries(webMap = getWebMap()) {
  const entries = [];
  if (!webMap?.layers) return entries;

  function walk(collection, parent = null) {
    const items = collection?.items || collection || [];
    for (const layer of items) {
      entries.push({ layer, parent });
      if (layer.type === 'group' && layer.layers) {
        walk(layer.layers, layer);
      }
    }
  }

  walk(webMap.layers);
  return entries;
}

/**
 * @param {import('@arcgis/core/WebMap').default} webMap
 * @param {string} title
 */
export function findGroupLayerByTitle(webMap, title) {
  const target = normalizeTitle(title);
  return collectWebMapLayerEntries(webMap).find(
    ({ layer }) => layer.type === 'group' && normalizeTitle(layer.title) === target
  )?.layer || null;
}

/**
 * @param {import('@arcgis/core/WebMap').default} webMap
 * @param {string} layerId
 */
export function findLayerByIdRecursive(webMap, layerId) {
  return collectWebMapLayerEntries(webMap).find(
    ({ layer }) => layer.id === layerId
  ) || null;
}

/**
 * @param {import('@arcgis/core/layers/Layer').default} layer
 * @param {import('@arcgis/core/layers/GroupLayer').default} group
 */
export async function attachLayerToGroup(layer, group) {
  if (!layer || !group) return;
  const parent = layer.parent;
  if (parent === group) return;
  if (parent?.layers?.includes?.(layer)) {
    parent.remove(layer);
  } else {
    const webMap = getWebMap();
    if (webMap?.layers?.includes?.(layer)) {
      webMap.remove(layer);
    }
  }
  group.add(layer);
}

async function ensureRuntimeGroup(groupId, groupTitle, modules = null) {
  const webMap = getWebMap();
  if (!webMap) return null;

  const existingById = webMap.findLayerById?.(groupId)
    ?? collectWebMapLayerEntries(webMap).find(({ layer }) => layer.id === groupId)?.layer;
  if (existingById) return existingById;

  const existingByTitle = findGroupLayerByTitle(webMap, groupTitle);
  if (existingByTitle) return existingByTitle;

  const GroupLayer = modules?.GroupLayer || await importArc('@arcgis/core/layers/GroupLayer.js');
  const group = new GroupLayer({
    id: groupId,
    title: groupTitle,
    listMode: 'show',
    visible: true,
    layers: []
  });
  await group.load();
  webMap.add(group);
  return group;
}

/**
 * @param {Record<string, unknown>} [modules]
 */
export async function ensureTransportationAccessGroup(modules = null) {
  return ensureRuntimeGroup(
    TRANSPORTATION_ACCESS_GROUP_ID,
    TRANSPORTATION_ACCESS_GROUP_TITLE,
    modules
  );
}
