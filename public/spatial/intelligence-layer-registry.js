/**
 * Session registry for dynamic intelligence research layers.
 */
import { INTELLIGENCE_LAYER_PREFIX } from './intelligence-layer-config.js';

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
 * @param {object} request
 */
export function buildIntelligenceLayerIdentity(request = {}) {
  return [
    request.query,
    request.geography,
    request.from,
    request.to,
    request.temporalField || 'OCCURRED'
  ].join('|').toLowerCase();
}

/**
 * @param {object} entry
 */
export function registerIntelligenceLayer(entry) {
  const identity = entry.identity || buildIntelligenceLayerIdentity(entry.request);
  const existingId = identityToLayerId.get(identity);
  if (existingId) {
    return { duplicate: false, replaced: true, entry: entriesByLayerId.get(existingId), layerId: existingId, identity };
  }

  const layerId = `${INTELLIGENCE_LAYER_PREFIX}${hashIdentity(identity)}`;
  const record = {
    layerId,
    identity,
    request: entry.request,
    normalized: entry.normalized || null,
    raw: entry.raw || null,
    layer: entry.layer || null,
    state: entry.state || 'idle',
    lastRefreshedAt: entry.lastRefreshedAt || null
  };
  entriesByLayerId.set(layerId, record);
  identityToLayerId.set(identity, layerId);
  return { duplicate: false, replaced: false, entry: record, layerId, identity };
}

export function getIntelligenceLayerEntry(layerId) {
  return entriesByLayerId.get(layerId) || null;
}

export function listIntelligenceLayers() {
  return [...entriesByLayerId.values()];
}

export function updateIntelligenceLayerEntry(layerId, patch = {}) {
  const entry = entriesByLayerId.get(layerId);
  if (!entry) return null;
  Object.assign(entry, patch);
  return entry;
}

export function unregisterIntelligenceLayer(layerId) {
  const entry = entriesByLayerId.get(layerId);
  if (!entry) return null;
  entriesByLayerId.delete(layerId);
  identityToLayerId.delete(entry.identity);
  return entry;
}

export function isIntelligenceLayerId(layerId) {
  return String(layerId || '').startsWith(INTELLIGENCE_LAYER_PREFIX);
}
