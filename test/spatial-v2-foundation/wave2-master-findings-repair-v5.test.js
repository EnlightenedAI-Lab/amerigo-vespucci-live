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

function maliciousAdapter(counter) {
  return {
    execute() {
      counter.runs += 1;
      return {
        result: {
          resultId: 'malicious-result',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  };
}

test('public bindAdapter cannot replace a trusted CHASSIS adapter', async () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v5h') });
  const publicView = chassis.capabilityRegistry.getAdapter('chassis.inspect-world');
  assert.equal(publicView.bound, true);
  assert.equal(publicView.execute, undefined);
  const counter = { runs: 0 };

  assert.throws(
    () => chassis.capabilityRegistry.bindAdapter('chassis.inspect-world', '1.0.0', maliciousAdapter(counter)),
    (error) => error instanceof ContractError && error.code === 'TRUSTED_CHASSIS_ADAPTER'
  );
  assert.equal(chassis.capabilityRegistry.getAdapter('chassis.inspect-world').bound, true);

  const legit = chassis.capabilityRegistry.require('chassis.inspect-world');
  assert.throws(
    () => chassis.capabilityRegistry.bindAdapter(legit.id, legit.version, maliciousAdapter(counter)),
    (error) => error.code === 'TRUSTED_CHASSIS_ADAPTER'
  );

  const result = await chassis.executeChassis('chassis.inspect-world', {});
  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.equal(result.result.resultType, 'world-diagnostic');
  assert.equal(counter.runs, 0);
});

test('trusted CHASSIS adapter binding is private, one-shot, and immutable', () => {
  const now = clock();
  const idFactory = ids('v5p');
  const capabilityRegistry = createCapabilityRegistry();
  const chassisRegistrar = capabilityRegistry.takeChassisRegistrar();
  chassisRegistrar.register(descriptorBase({
    id: 'chassis.echo',
    migrationState: MIGRATION_STATE.CHASSIS
  }));
  const first = {
    execute() {
      return {
        result: {
          resultId: 'first',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  };
  assert.equal(chassisRegistrar.bindAdapter('chassis.echo', '1.0.0', first), true);
  const publicView = capabilityRegistry.getAdapter('chassis.echo');
  assert.equal(publicView.bound, true);
  assert.notEqual(publicView, first);
  const counter = { runs: 0 };
  assert.throws(
    () => capabilityRegistry.bindAdapter('chassis.echo', '1.0.0', maliciousAdapter(counter)),
    (error) => error.code === 'TRUSTED_CHASSIS_ADAPTER'
  );
  assert.throws(
    () => chassisRegistrar.bindAdapter('chassis.echo', '1.0.0', maliciousAdapter(counter)),
    (error) => error.code === 'CHASSIS_ADAPTER_IMMUTABLE'
  );
  assert.equal(capabilityRegistry.getAdapter('chassis.echo').bound, true);
  assert.equal(counter.runs, 0);
});

test('MIGRATED specialist adapter binding still works through the public path', async () => {
  const now = clock();
  const idFactory = ids('v5m');
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
  capabilityRegistry.bindAdapter('specialist.echo', '1.0.0', {
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
  });
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
