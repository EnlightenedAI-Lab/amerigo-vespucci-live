/**
 * Session registry for user-added ArcGIS layers.
 */
import {
  USER_ADDED_LAYER_PREFIX,
  buildUserAddedProvenance
} from './arcgis-data-add-provenance.js';
import { getLayerStableIdentity } from './arcgis-data-add-resolver.js';

/** @type {Map<string, object>} */
const entriesByLayerId = new Map();
/** @type {Map<string, string>} */
const identityToLayerId = new Map();

function hashIdentity(identity) {
  let hash = 0;
  const str = String(identity || '');
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * @param {import('@arcgis/core/layers/Layer').default} layer
 * @param {object} provenance
 */
export function registerUserAddedLayer(layer, provenance = {}) {
  const identity = getLayerStableIdentity(layer, provenance);
  const existingId = identityToLayerId.get(identity);
  if (existingId) {
    const existing = entriesByLayerId.get(existingId);
    return { duplicate: true, entry: existing, identity };
  }

  const layerId = isUserAddedLayerId(layer.id)
    ? layer.id
    : `${USER_ADDED_LAYER_PREFIX}${hashIdentity(identity)}`;
  layer.id = layerId;

  const entry = {
    layerId,
    identity,
    layer,
    provenance: buildUserAddedProvenance({
      ...provenance,
      title: layer.title,
      addedAt: new Date().toISOString()
    })
  };

  entriesByLayerId.set(layerId, entry);
  identityToLayerId.set(identity, layerId);
  return { duplicate: false, entry, identity };
}

/**
 * @param {string} identity
 */
export function findUserAddedByIdentity(identity) {
  const layerId = identityToLayerId.get(identity);
  return layerId ? entriesByLayerId.get(layerId) || null : null;
}

export function listUserAddedLayers() {
  return [...entriesByLayerId.values()];
}

/**
 * @param {string} layerId
 */
export function getUserAddedEntry(layerId) {
  return entriesByLayerId.get(layerId) || null;
}

/**
 * @param {string} layerId
 */
export function unregisterUserAddedLayer(layerId) {
  const entry = entriesByLayerId.get(layerId);
  if (!entry) return null;
  entriesByLayerId.delete(layerId);
  identityToLayerId.delete(entry.identity);
  return entry;
}

export function isUserAddedLayerId(layerId) {
  return String(layerId || '').startsWith(USER_ADDED_LAYER_PREFIX);
}

export function isUserAddedLayer(layer) {
  return isUserAddedLayerId(layer?.id);
}
