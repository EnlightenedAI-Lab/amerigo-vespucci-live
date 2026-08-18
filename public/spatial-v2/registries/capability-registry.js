/**
 * Capability registry. Describes existing registered contracts, not aspirations.
 * Duplicate id+version, unknown schema, and unknown id fail closed.
 * Registration and adapter binding do not confer execution authority.
 * CHASSIS registration and adapter binding use a one-shot trusted registrar.
 */

import {
  MIGRATION_STATE,
  createCapabilityDescriptor,
  failClosed,
  frozenClone
} from '../foundation/contracts/index.js';
import { createChassisCapabilityDescriptor } from '../foundation/contracts/capability.js';

function keyOf(id, version) {
  return `${id}@${version}`;
}

function sealTrustedAdapter(adapter) {
  const execute = adapter?.execute;
  if (typeof execute !== 'function') {
    failClosed('INVALID_ADAPTER', 'Capability adapter must expose execute().');
  }
  return Object.freeze({
    execute(action, context) {
      return execute.call(adapter, action, context);
    }
  });
}

export function createCapabilityRegistry() {
  const byKey = new Map();
  const adapters = new Map();
  const chassisKeys = new Set();
  let chassisRegistrarTaken = false;
  let runtimeAdapterLookupTaken = false;

  function insert(descriptor, adapter) {
    const key = keyOf(descriptor.id, descriptor.version);
    if (byKey.has(key)) {
      failClosed('DUPLICATE_CAPABILITY', 'Capability id+version is already registered.', {
        id: descriptor.id,
        version: descriptor.version
      });
    }
    byKey.set(key, descriptor);
    if (descriptor.migrationState === MIGRATION_STATE.CHASSIS) {
      chassisKeys.add(key);
    }
    if (adapter) {
      adapters.set(
        key,
        descriptor.migrationState === MIGRATION_STATE.CHASSIS ? sealTrustedAdapter(adapter) : adapter
      );
    }
    return descriptor;
  }

  function bindPublicAdapter(id, version, adapter) {
    const key = keyOf(id, version);
    if (!byKey.has(key)) {
      failClosed('UNKNOWN_CAPABILITY', 'Cannot bind an adapter for an unregistered capability.', { id, version });
    }
    if (chassisKeys.has(key)) {
      failClosed(
        'TRUSTED_CHASSIS_ADAPTER',
        'Public callers cannot bind or replace a trusted CHASSIS adapter.',
        { id, version }
      );
    }
    if (!adapter || typeof adapter.execute !== 'function') {
      failClosed('INVALID_ADAPTER', 'Capability adapter must expose execute().', { id });
    }
    adapters.set(key, adapter);
    return true;
  }

  function bindTrustedChassisAdapter(id, version, adapter) {
    const key = keyOf(id, version);
    if (!chassisKeys.has(key)) {
      failClosed(
        'UNTRUSTED_CHASSIS_REGISTRATION',
        'Trusted chassis adapter binding requires a trusted CHASSIS registration.',
        { id, version }
      );
    }
    if (!adapter || typeof adapter.execute !== 'function') {
      failClosed('INVALID_ADAPTER', 'Capability adapter must expose execute().', { id });
    }
    if (adapters.has(key)) {
      failClosed(
        'CHASSIS_ADAPTER_IMMUTABLE',
        'A trusted CHASSIS adapter cannot be replaced once bound.',
        { id, version }
      );
    }
    adapters.set(key, sealTrustedAdapter(adapter));
    return true;
  }

  function takeChassisRegistrar() {
    if (chassisRegistrarTaken) {
      failClosed(
        'CHASSIS_REGISTRAR_ALREADY_TAKEN',
        'The trusted chassis registrar is already held by the host.'
      );
    }
    chassisRegistrarTaken = true;
    return Object.freeze({
      register(raw, adapter = null) {
        const descriptor = insert(createChassisCapabilityDescriptor(raw), adapter);
        return descriptor;
      },
      bindAdapter(id, version, adapter) {
        return bindTrustedChassisAdapter(id, version, adapter);
      }
    });
  }

  function takeRuntimeAdapterLookup() {
    if (runtimeAdapterLookupTaken) {
      failClosed(
        'RUNTIME_ADAPTER_LOOKUP_ALREADY_TAKEN',
        'The trusted adapter lookup is already held by the runtime host.'
      );
    }
    runtimeAdapterLookupTaken = true;
    return function getExecutableAdapter(id, version = '1.0.0') {
      return adapters.get(keyOf(id, version)) || null;
    };
  }

  return Object.freeze({
    register(raw, adapter = null) {
      return insert(createCapabilityDescriptor(raw), adapter);
    },
    takeChassisRegistrar,
    takeRuntimeAdapterLookup,
    isChassisTrusted(id, version = '1.0.0') {
      return chassisKeys.has(keyOf(id, version));
    },
    bindAdapter(id, version, adapter) {
      return bindPublicAdapter(id, version, adapter);
    },
    get(id, version = '1.0.0') {
      return byKey.get(keyOf(id, version)) || null;
    },
    require(id, version = '1.0.0') {
      const descriptor = this.get(id, version);
      if (!descriptor) {
        failClosed('UNKNOWN_CAPABILITY', 'Capability is not registered.', { id, version });
      }
      return descriptor;
    },
    getAdapter(id, version = '1.0.0') {
      const key = keyOf(id, version);
      const adapter = adapters.get(key);
      if (!adapter) return null;
      if (chassisKeys.has(key)) {
        return Object.freeze({ bound: true });
      }
      return adapter;
    },
    list() {
      return [...byKey.values()].map((item) => frozenClone(item));
    }
  });
}
