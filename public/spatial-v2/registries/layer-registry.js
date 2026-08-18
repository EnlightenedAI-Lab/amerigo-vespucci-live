/**
 * Layer registry. Definitions are immutable. Instances live in World State.
 * Authored catalog identity stays specialist-owned. This registry never writes Portal.
 */

import {
  createLayerDefinition,
  failClosed,
  frozenClone
} from '../foundation/contracts/index.js';

export function createLayerRegistry() {
  const byId = new Map();

  return Object.freeze({
    register(raw) {
      const definition = createLayerDefinition(raw);
      const key = `${definition.layerId}@${definition.version}`;
      if (byId.has(key) || [...byId.values()].some((item) => item.layerId === definition.layerId && item.version === definition.version)) {
        failClosed('DUPLICATE_LAYER', 'Layer id+version is already registered.', {
          layerId: definition.layerId,
          version: definition.version
        });
      }
      byId.set(key, definition);
      return definition;
    },
    get(layerId, version = '1.0.0') {
      return byId.get(`${layerId}@${version}`) || null;
    },
    require(layerId, version = '1.0.0') {
      const definition = this.get(layerId, version);
      if (!definition) {
        failClosed('UNKNOWN_LAYER', 'Layer is not registered.', { layerId, version });
      }
      return definition;
    },
    list() {
      return [...byId.values()].map((item) => frozenClone(item));
    },
    listByFamily(family) {
      return this.list().filter((item) => item.family === family);
    }
  });
}
