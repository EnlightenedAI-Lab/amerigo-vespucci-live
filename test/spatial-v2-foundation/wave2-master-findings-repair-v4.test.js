import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  EXECUTION_MODE,
  MIGRATION_STATE,
  POLICY_ACTION,
  TRUTH_CLASS,
  createActionEnvelope,
  createCapabilityDescriptor
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

function confirmationFields(overrides = {}) {
  return {
    actorRef: 'operator:session',
    identityRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z',
    ...overrides
  };
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

function collectBannedPublicPaths(root, banned) {
  const hits = [];
  const seen = new WeakSet();
  function walk(value, path, depth) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) return;
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const nextPath = `${path}.${key}`;
      if (banned.has(key)) hits.push(nextPath);
      let child;
      try {
        child = value[key];
      } catch {
        continue;
      }
      if (typeof child === 'function' && banned.has(key)) hits.push(`${nextPath}()`);
      if (child && typeof child === 'object') walk(child, nextPath, depth + 1);
    }
  }
  walk(root, 'chassis', 0);
  return hits;
}

function impersonationFrom(legit, id) {
  return {
    id,
    version: legit.version,
    owner: legit.owner,
    title: legit.title,
    inputSchema: legit.inputSchema,
    outputSchema: legit.outputSchema,
    resultType: legit.resultType,
    preconditionIds: [...legit.preconditionIds],
    compatibleViews: [...legit.compatibleViews],
    compatibleLayerFamilies: [...legit.compatibleLayerFamilies],
    requiredRights: [...legit.requiredRights],
    requiredPolicyAction: legit.requiredPolicyAction,
    execution: { mode: legit.execution.mode, targets: [...legit.execution.targets] },
    effectClass: legit.effectClass,
    adapterId: legit.adapterId,
    cancellation: legit.cancellation,
    undoPolicy: legit.undoPolicy,
    migrationState: MIGRATION_STATE.CHASSIS
  };
}

test('public bootstrap exposes no callable trusted operator-confirmation issuer', () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v4op') });
  const hits = collectBannedPublicPaths(chassis, new Set([
    'operatorConfirmationBoundary',
    'recordConfirmationEvent'
  ]));
  assert.deepEqual(hits, []);
  assert.equal(chassis.operatorConfirmationBoundary, undefined);
  assert.equal(typeof chassis.policyService.issueOperatorConfirmation, 'function');
  assert.throws(
    () => chassis.policyService.issueOperatorConfirmation(confirmationFields()),
    (error) => error instanceof ContractError && error.code === 'TRUSTED_OPERATOR_EVIDENCE_REQUIRED'
  );
  assert.throws(
    () => chassis.policyService.issueOperatorConfirmation({
      ...confirmationFields(),
      source: ACTION_SOURCE.OPERATOR
    }),
    (error) => error.code === 'TRUSTED_OPERATOR_EVIDENCE_REQUIRED'
  );
});

test('legitimate trusted operator-confirmation path still works privately', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('v4legit') });
  const boundary = policy.takeOperatorConfirmationBoundary();
  const fields = confirmationFields();
  const evidence = boundary.recordConfirmationEvent(fields);
  const confirmation = policy.issueOperatorConfirmation({ evidence });
  const grant = policy.issueGrant({
    actorRef: fields.actorRef,
    capabilityId: fields.capabilityId,
    policyAction: fields.policyAction,
    resourceRefs: fields.resourceRefs,
    sessionId: fields.sessionId,
    expiresAt: fields.expiresAt
  }, { confirmation });
  assert.equal(grant.capabilityId, 'chassis.external-write');
  assert.throws(
    () => policy.issueOperatorConfirmation({ evidence }),
    (error) => error.code === 'OPERATOR_EVIDENCE_REPLAY'
  );
});

test('fake chassis ID and owner cannot obtain CHASSIS trust', async () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v4ch') });
  const registrarHits = collectBannedPublicPaths(chassis, new Set([
    'chassisRegistrar',
    'registerChassis'
  ]));
  assert.deepEqual(registrarHits, []);
  assert.throws(
    () => chassis.capabilityRegistry.takeChassisRegistrar(),
    (error) => error.code === 'CHASSIS_REGISTRAR_ALREADY_TAKEN'
  );

  let impersonationRuns = 0;
  const impersonation = descriptorBase({
    id: 'chassis.specialist-impersonation',
    owner: 'tool-builder',
    migrationState: MIGRATION_STATE.CHASSIS
  });
  assert.throws(
    () => chassis.capabilityRegistry.register(impersonation),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );
  assert.equal(chassis.capabilityRegistry.get('chassis.specialist-impersonation'), null);
  assert.equal(chassis.capabilityRegistry.isChassisTrusted('chassis.specialist-impersonation'), false);

  const legit = chassis.capabilityRegistry.require('chassis.inspect-world');
  assert.throws(
    () => chassis.capabilityRegistry.register(impersonationFrom(legit, 'chassis.specialist-impersonation')),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );
  assert.throws(
    () => createCapabilityDescriptor(impersonationFrom(legit, 'chassis.copied-inspect')),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );

  assert.throws(
    () => chassis.capabilityRegistry.bindAdapter('chassis.specialist-impersonation', '1.0.0', {
      execute() {
        impersonationRuns += 1;
        return {
          result: {
            resultId: 'impersonation-result',
            resultType: 'world-diagnostic',
            truthClass: TRUTH_CLASS.CALCULATED,
            statePatch: null
          }
        };
      }
    }),
    (error) => error.code === 'UNKNOWN_CAPABILITY'
  );
  assert.equal(impersonationRuns, 0);

  const omitted = chassis.capabilityRegistry.register(descriptorBase({
    id: 'chassis.omitted-state',
    owner: 'tool-builder'
  }));
  assert.equal(omitted.migrationState, MIGRATION_STATE.UNMIGRATED);
  let omittedRuns = 0;
  chassis.capabilityRegistry.bindAdapter('chassis.omitted-state', '1.0.0', {
    execute() {
      omittedRuns += 1;
      return {
        result: {
          resultId: 'omitted-result',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  });
  const world = chassis.stateStore.getSnapshot();
  await assert.rejects(
    () => chassis.capabilityRuntime.execute(createActionEnvelope({
      actionId: 'action-omitted-chassis-id',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'chassis.omitted-state',
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: 'trace-omitted-chassis-id'
    }, { now: clock() })),
    (error) => error.code === 'CAPABILITY_UNMIGRATED'
  );
  assert.equal(omittedRuns, 0);
});

test('legitimate trusted chassis registration still executes; MIGRATED specialists remain gated', async () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v4ok') });
  const inspect = await chassis.executeChassis('chassis.inspect-world', {});
  assert.equal(inspect.ok, true);
  assert.equal(inspect.executed, true);
  assert.equal(chassis.capabilityRegistry.isChassisTrusted('chassis.inspect-world'), true);
  assert.equal(chassis.capabilityRegistry.isChassisTrusted('view.select'), true);
  assert.equal(chassis.capabilityRegistry.require('map').migrationState, MIGRATION_STATE.MIGRATED);

  const now = clock();
  const idFactory = ids('v4iso');
  const store = createStateStore({ now, idFactory });
  const capabilityRegistry = createCapabilityRegistry();
  const chassisRegistrar = capabilityRegistry.takeChassisRegistrar();
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
  chassisRegistrar.register(descriptorBase({
    id: 'chassis.echo',
    migrationState: MIGRATION_STATE.CHASSIS
  }));
  capabilityRegistry.register(descriptorBase({
    id: 'specialist.echo',
    owner: 'arcgis',
    migrationState: MIGRATION_STATE.MIGRATED
  }));
  let chassisRuns = 0;
  let specialistRuns = 0;
  chassisRegistrar.bindAdapter('chassis.echo', '1.0.0', {
    execute() {
      chassisRuns += 1;
      return {
        result: {
          resultId: 'chassis-echo-result',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  });
  capabilityRegistry.bindAdapter('specialist.echo', '1.0.0', {
    execute() {
      specialistRuns += 1;
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
  async function run(capabilityId) {
    return runtime.execute(createActionEnvelope({
      actionId: `action-${capabilityId}`,
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId,
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: `trace-${capabilityId}`
    }, { now }));
  }
  assert.equal((await run('chassis.echo')).ok, true);
  assert.equal(chassisRuns, 1);
  assert.equal((await run('specialist.echo')).ok, true);
  assert.equal(specialistRuns, 1);
});
