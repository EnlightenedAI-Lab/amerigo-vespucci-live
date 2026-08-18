/**
 * Model-provider registry seam. Wave 2 does not invoke or train models.
 * A future local reasoning adapter may wrap a locally installed model family
 * without becoming IQAI's product identity.
 */

import {
  MODEL_HEALTH,
  createModelProviderDescriptor,
  failClosed,
  frozenClone
} from '../foundation/contracts/index.js';

function unimplementedAdapter(providerId) {
  return Object.freeze({
    providerId,
    async health() {
      return Object.freeze({
        providerId,
        state: MODEL_HEALTH.NOT_CONNECTED,
        reason: 'Model provider adapters are a later Brain implementation. Local absence must not fall back to cloud.'
      });
    },
    async invoke() {
      failClosed(
        'MODEL_UNIMPLEMENTED',
        'Model invoke is not implemented in this wave. Brain Phase 0 is deferred.'
      );
    },
    async cancel() {
      return { cancelled: false, reason: 'No running model invocation.' };
    }
  });
}

export function createModelProviderRegistry() {
  const byId = new Map();
  const adapters = new Map();

  return Object.freeze({
    register(raw, adapter = null) {
      const descriptor = createModelProviderDescriptor(raw);
      if (byId.has(descriptor.providerId)) {
        failClosed('DUPLICATE_MODEL_PROVIDER', 'Model provider is already registered.', {
          providerId: descriptor.providerId
        });
      }
      byId.set(descriptor.providerId, descriptor);
      adapters.set(descriptor.providerId, adapter || unimplementedAdapter(descriptor.providerId));
      return descriptor;
    },
    get(providerId) {
      return byId.get(providerId) || null;
    },
    require(providerId) {
      const descriptor = this.get(providerId);
      if (!descriptor) {
        failClosed('UNKNOWN_MODEL_PROVIDER', 'Model provider is not registered.', { providerId });
      }
      return descriptor;
    },
    getAdapter(providerId) {
      return adapters.get(providerId) || null;
    },
    primaryLocal() {
      return this.list().find((item) => item.locality === 'LOCAL' && item.primaryForBrain) || null;
    },
    list() {
      return [...byId.values()].map((item) => frozenClone(item));
    }
  });
}
