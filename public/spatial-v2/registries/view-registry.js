/**
 * View registry. Only this registry plus ViewHost may own view lifecycle.
 * Adapters are later migrations. Unknown views fail closed.
 */

import {
  createViewDescriptor,
  failClosed,
  frozenClone
} from '../foundation/contracts/index.js';

export function createViewRegistry() {
  const byId = new Map();
  const adapters = new Map();

  return Object.freeze({
    register(raw) {
      const descriptor = createViewDescriptor(raw);
      if (byId.has(descriptor.viewId)) {
        failClosed('DUPLICATE_VIEW', 'View is already registered.', { viewId: descriptor.viewId });
      }
      byId.set(descriptor.viewId, descriptor);
      return descriptor;
    },
    bindAdapter(viewId, adapter) {
      if (!byId.has(viewId)) {
        failClosed('UNKNOWN_VIEW', 'Cannot bind an adapter for an unregistered view.', { viewId });
      }
      adapters.set(viewId, adapter);
      return true;
    },
    get(viewId) {
      return byId.get(viewId) || null;
    },
    require(viewId) {
      const descriptor = this.get(viewId);
      if (!descriptor) {
        failClosed('UNKNOWN_VIEW', 'View is not registered.', { viewId });
      }
      return descriptor;
    },
    getAdapter(viewId) {
      return adapters.get(viewId) || null;
    },
    list() {
      return [...byId.values()].map((item) => frozenClone(item));
    }
  });
}
