/**
 * Live Mobility runtime group (browser only).
 */
import { getWebMap, importArc } from './spatial-arcgis-runtime.js';
import { findLayerByIdRecursive } from './runtime-layer-groups.js';
import {
  LIVE_MOBILITY_GROUP_ID,
  LIVE_MOBILITY_GROUP_TITLE
} from './aircraft-live-config.js';

/**
 * @param {Record<string, unknown>} [modules]
 */
export async function ensureLiveMobilityGroup(modules = null) {
  const webMap = getWebMap();
  if (!webMap) return null;

  const existingEntry = findLayerByIdRecursive(webMap, LIVE_MOBILITY_GROUP_ID);
  if (existingEntry?.layer) return existingEntry.layer;

  const GroupLayer = modules?.GroupLayer || await importArc('@arcgis/core/layers/GroupLayer.js');
  const group = new GroupLayer({
    id: LIVE_MOBILITY_GROUP_ID,
    title: LIVE_MOBILITY_GROUP_TITLE,
    listMode: 'show',
    visible: false,
    layers: []
  });
  await group.load();
  webMap.add(group);
  return group;
}
