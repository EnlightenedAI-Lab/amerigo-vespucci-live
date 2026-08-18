import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFECT_CLASS,
  EXECUTION_MODE,
  LAYER_FAMILY,
  MIGRATION_STATE,
  POLICY_ACTION,
  SCHEMA_IDS,
  VIEW_ID,
  VIEW_LIFECYCLE,
  createCapabilityDescriptor,
  createLayerDefinition,
  createViewDescriptor
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';
import {
  createCapabilityRegistry,
  createLayerRegistry,
  createViewRegistry
} from '../../public/spatial-v2/registries/index.js';

function cap(overrides = {}) {
  return {
    id: 'chassis.echo',
    owner: 'tool-builder',
    title: 'Echo',
    resultType: 'echo',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.READ_ONLY,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    migrationState: MIGRATION_STATE.CHASSIS,
    ...overrides
  };
}

test('capability registry rejects duplicate id+version and unknown lookup', () => {
  const registry = createCapabilityRegistry();
  const chassisRegistrar = registry.takeChassisRegistrar();
  chassisRegistrar.register(cap());
  assert.equal(registry.require('chassis.echo').schemaId, SCHEMA_IDS.CAPABILITY);
  assert.throws(
    () => chassisRegistrar.register(cap()),
    (error) => error instanceof ContractError && error.code === 'DUPLICATE_CAPABILITY'
  );
  assert.throws(
    () => registry.require('missing'),
    (error) => error.code === 'UNKNOWN_CAPABILITY'
  );
});

test('capability descriptor rejects unknown schema and unknown effect class', () => {
  assert.throws(
    () => createCapabilityDescriptor(cap({ schemaId: 'iqai.spatial.capability/9.9.9' })),
    (error) => error.code === 'UNSUPPORTED_SCHEMA'
  );
  assert.throws(
    () => createCapabilityDescriptor(cap({ effectClass: 'MAGIC' })),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
});

test('layer registry keeps definition identity separate from World State instances', () => {
  const registry = createLayerRegistry();
  const definition = registry.register({
    layerId: 'session-workspace',
    title: 'Session',
    family: LAYER_FAMILY.SESSION_INVESTIGATION,
    availability: 'CHASSIS',
    migrationState: 'CHASSIS'
  });
  assert.equal(definition.layerId, 'session-workspace');
  assert.equal(registry.require('session-workspace').family, LAYER_FAMILY.SESSION_INVESTIGATION);
  assert.throws(
    () => registry.register({
      layerId: 'session-workspace',
      title: 'Session',
      family: LAYER_FAMILY.SESSION_INVESTIGATION
    }),
    (error) => error.code === 'DUPLICATE_LAYER'
  );
  assert.throws(
    () => createLayerDefinition({
      layerId: 'x',
      title: 'x',
      family: 'WEATHER'
    }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
});

test('view registry registers frozen views and rejects unknown ids', () => {
  const registry = createViewRegistry();
  registry.register({
    viewId: VIEW_ID.MAP,
    lifecycle: VIEW_LIFECYCLE.MOUNT_ONCE,
    availability: 'UNMIGRATED',
    migrationState: 'UNMIGRATED'
  });
  assert.equal(registry.require(VIEW_ID.MAP).lifecycle, VIEW_LIFECYCLE.MOUNT_ONCE);
  assert.throws(
    () => registry.register({
      viewId: VIEW_ID.MAP,
      lifecycle: VIEW_LIFECYCLE.MOUNT_ONCE
    }),
    (error) => error.code === 'DUPLICATE_VIEW'
  );
  assert.throws(
    () => createViewDescriptor({
      viewId: 'GLOBE',
      lifecycle: VIEW_LIFECYCLE.DEFERRED
    }),
    (error) => error.code === 'UNKNOWN_VIEW'
  );
});
