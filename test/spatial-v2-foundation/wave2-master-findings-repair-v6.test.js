import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  EXECUTION_MODE,
  MIGRATION_STATE,
  POLICY_ACTION,
  TRUTH_CLASS,
  createActionEnvelope
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';
import { createCapabilityRegistry } from '../../public/spatial-v2/registries/index.js';
import { createPolicyGuard, createPolicyService } from '../../public/spatial-v2/policy/index.js';
import { createJobManager } from '../../public/spatial-v2/jobs/index.js';
import { createCapabilityRuntime, createResultCommitter } from '../../public/spatial-v2/runtime/index.js';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';

function clock() {
  return () => '2026-08-18T16:00:00.000Z';
}

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function descriptorBase(overrides = {}) {
  return {
    owner: 'tool-builder',
    title: 'Test capability',
    resultType: 'echo',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.READ_ONLY,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    ...overrides
  };
}

test('getAdapter does not expose a mutable live trusted CHASSIS adapter', async () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v6h') });
  const trusted = chassis.capabilityRegistry.getAdapter('chassis.inspect-world');
  assert.equal(Object.isFrozen(trusted), true);
  assert.equal(trusted.bound, true);
  assert.equal(trusted.execute, undefined);
  assert.equal(chassis.getExecutableAdapter, undefined);
  assert.throws(
    () => chassis.capabilityRegistry.takeRuntimeAdapterLookup(),
    (error) => error.code === 'RUNTIME_ADAPTER_LOOKUP_ALREADY_TAKEN'
  );

  let malicious = 0;
  const maliciousExecute = () => {
    malicious += 1;
    return {
      result: {
        resultId: 'malicious',
        resultType: 'echo',
        truthClass: TRUTH_CLASS.CALCULATED,
        statePatch: null
      }
    };
  };
  assert.throws(() => {
    trusted.execute = maliciousExecute;
  });
  assert.throws(() => {
    trusted.nested = { execute: maliciousExecute };
  });
  assert.throws(() => Object.defineProperty(trusted, 'execute', { value: maliciousExecute }));
  assert.equal(trusted.execute, undefined);

  assert.throws(
    () => chassis.capabilityRegistry.bindAdapter('chassis.inspect-world', '1.0.0', { execute: maliciousExecute }),
    (error) => error instanceof ContractError && error.code === 'TRUSTED_CHASSIS_ADAPTER'
  );

  const result = await chassis.executeChassis('chassis.inspect-world', {});
  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.equal(result.result.resultType, 'world-diagnostic');
  assert.equal(malicious, 0);
});

test('trusted bootstrap binding still works and MIGRATED specialists remain public', async () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v6b') });
  const inspect = await chassis.executeChassis('chassis.inspect-world', {});
  assert.equal(inspect.ok, true);
  assert.equal(inspect.result.resultType, 'world-diagnostic');

  const now = clock();
  const idFactory = ids('v6m');
  const store = createStateStore({ now, idFactory });
  const capabilityRegistry = createCapabilityRegistry();
  capabilityRegistry.takeChassisRegistrar();
  const policy = createPolicyService({ now, idFactory, knownIdentities: ['operator:session'] });
  const runtime = createCapabilityRuntime({
    capabilityRegistry,
    policyGuard: createPolicyGuard(policy),
    resultCommitter: createResultCommitter({ stateStore: store, policyService: policy }),
    jobManager: createJobManager({ now, idFactory }),
    stateStore: store,
    now,
    idFactory
  });
  capabilityRegistry.register(descriptorBase({
    id: 'specialist.echo',
    owner: 'arcgis',
    migrationState: MIGRATION_STATE.MIGRATED
  }));
  let runs = 0;
  const specialistAdapter = {
    execute() {
      runs += 1;
      return {
        result: {
          resultId: 'specialist-echo-result',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  };
  capabilityRegistry.bindAdapter('specialist.echo', '1.0.0', specialistAdapter);
  assert.equal(capabilityRegistry.getAdapter('specialist.echo'), specialistAdapter);
  const world = store.getSnapshot();
  const result = await runtime.execute(createActionEnvelope({
    actionId: 'action-specialist.echo',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:session',
    capabilityId: 'specialist.echo',
    input: {},
    worldId: world.worlds.activeWorldId,
    baseWorldRevision: world.revision,
    traceId: 'trace-specialist'
  }, { now }));
  assert.equal(result.ok, true);
  assert.equal(runs, 1);
});
