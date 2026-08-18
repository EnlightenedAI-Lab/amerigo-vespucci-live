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

function createRuntimeHarness() {
  const now = clock();
  const idFactory = ids('v3');
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
  return { now, store, capabilityRegistry, chassisRegistrar, runtime };
}

function bindCountingAdapter(binder, id) {
  let executed = 0;
  binder.bindAdapter(id, '1.0.0', {
    execute() {
      executed += 1;
      return {
        result: {
          resultId: `${id}-result`,
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  });
  return () => executed;
}

test('arbitrary caller cannot issue operator confirmation from raw identity and scope', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('v3p1') });
  assert.throws(
    () => policy.issueOperatorConfirmation(confirmationFields()),
    (error) => error instanceof ContractError && error.code === 'TRUSTED_OPERATOR_EVIDENCE_REQUIRED'
  );
  assert.throws(
    () => policy.issueOperatorConfirmation({}),
    (error) => error.code === 'TRUSTED_OPERATOR_EVIDENCE_REQUIRED'
  );
});

test('caller-supplied OPERATOR string cannot issue operator confirmation', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('v3p2') });
  assert.throws(
    () => policy.issueOperatorConfirmation({
      ...confirmationFields(),
      source: ACTION_SOURCE.OPERATOR
    }),
    (error) => error.code === 'TRUSTED_OPERATOR_EVIDENCE_REQUIRED'
  );
});

test('forged, mismatched, expired, and replayed trusted-boundary evidence fail closed', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('v3p3') });
  const boundary = policy.takeOperatorConfirmationBoundary();
  const fields = confirmationFields();
  const evidence = boundary.recordConfirmationEvent(fields);

  assert.throws(
    () => policy.issueOperatorConfirmation({
      evidence: { eventId: 'forged-event', integrityToken: 'forged-token' }
    }),
    (error) => error.code === 'FORGED_OPERATOR_EVIDENCE'
  );
  assert.throws(
    () => policy.issueOperatorConfirmation({
      evidence: { eventId: evidence.eventId, integrityToken: 'wrong-token' }
    }),
    (error) => error.code === 'FORGED_OPERATOR_EVIDENCE'
  );

  assert.throws(
    () => policy.issueOperatorConfirmation({
      evidence,
      actorRef: 'stranger',
      identityRef: 'stranger'
    }),
    (error) => error.code === 'OPERATOR_EVIDENCE_MISMATCH'
  );
  assert.throws(
    () => policy.issueOperatorConfirmation({
      evidence,
      capabilityId: 'capture.share',
      resourceRefs: ['layer:other']
    }),
    (error) => error.code === 'OPERATOR_EVIDENCE_MISMATCH'
  );
  const worldEvidence = boundary.recordConfirmationEvent(confirmationFields({ worldId: 'world-1' }));
  assert.throws(
    () => policy.issueOperatorConfirmation({
      evidence: worldEvidence,
      worldId: 'world-other'
    }),
    (error) => error.code === 'OPERATOR_EVIDENCE_MISMATCH'
  );

  let t = Date.parse('2026-08-18T16:00:00.000Z');
  const expiring = createPolicyService({
    now: () => new Date(t).toISOString(),
    idFactory: ids('v3exp')
  });
  const expiringBoundary = expiring.takeOperatorConfirmationBoundary();
  const expiredEvidence = expiringBoundary.recordConfirmationEvent(confirmationFields({
    expiresAt: '2026-08-18T16:00:01.000Z'
  }));
  t += 2000;
  assert.throws(
    () => expiring.issueOperatorConfirmation({ evidence: expiredEvidence }),
    (error) => error.code === 'OPERATOR_EVIDENCE_EXPIRED'
  );

  const confirmation = policy.issueOperatorConfirmation({ evidence, ...fields });
  assert.equal(confirmation.actorRef, 'operator:session');
  assert.equal(confirmation.capabilityId, 'chassis.external-write');
  assert.throws(
    () => policy.issueOperatorConfirmation({ evidence, ...fields }),
    (error) => error.code === 'OPERATOR_EVIDENCE_REPLAY'
  );
});

test('valid trusted operator-confirmation path succeeds exactly once', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('v3p4') });
  const boundary = policy.takeOperatorConfirmationBoundary();
  const fields = confirmationFields();
  const evidence = boundary.recordConfirmationEvent(fields);
  assert.equal(Object.keys(evidence).sort().join(','), 'eventId,integrityToken');
  assert.equal(evidence.actorRef, undefined);

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
  assert.throws(
    () => policy.issueGrant({
      actorRef: fields.actorRef,
      capabilityId: fields.capabilityId,
      policyAction: fields.policyAction,
      resourceRefs: fields.resourceRefs,
      sessionId: fields.sessionId,
      expiresAt: fields.expiresAt
    }, { confirmation }),
    (error) => error.code === 'OPERATOR_CONFIRMATION_REPLAY'
  );
  assert.throws(
    () => policy.takeOperatorConfirmationBoundary(),
    (error) => error.code === 'OPERATOR_BOUNDARY_ALREADY_TAKEN'
  );
});

test('composition root does not expose the trusted operator-confirmation issuer', () => {
  const chassis = createSpatialV2Chassis({ now: clock(), idFactory: ids('v3b') });
  assert.equal(chassis.operatorConfirmationBoundary, undefined);
  assert.equal(Object.hasOwn(chassis, 'operatorConfirmationBoundary'), false);
  assert.throws(
    () => chassis.policyService.takeOperatorConfirmationBoundary(),
    (error) => error.code === 'OPERATOR_BOUNDARY_ALREADY_TAKEN'
  );
  assert.throws(
    () => chassis.policyService.issueOperatorConfirmation(confirmationFields()),
    (error) => error.code === 'TRUSTED_OPERATOR_EVIDENCE_REQUIRED'
  );
});

test('omitted migrationState defaults to UNMIGRATED and cannot execute', async () => {
  const omitted = createCapabilityDescriptor(descriptorBase({ id: 'map', owner: 'arcgis' }));
  assert.equal(omitted.migrationState, MIGRATION_STATE.UNMIGRATED);
  assert.equal(omitted.id, 'map');

  const chassisOmitted = createCapabilityDescriptor(descriptorBase({ id: 'chassis.echo' }));
  assert.equal(chassisOmitted.migrationState, MIGRATION_STATE.UNMIGRATED);

  const harness = createRuntimeHarness();
  harness.capabilityRegistry.register(descriptorBase({ id: 'map', owner: 'arcgis' }));
  const runs = bindCountingAdapter(harness.capabilityRegistry, 'map');
  const world = harness.store.getSnapshot();
  await assert.rejects(
    () => harness.runtime.execute(createActionEnvelope({
      actionId: 'action-omitted',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'map',
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: 'trace-omitted'
    }, { now: harness.now })),
    (error) => error.code === 'CAPABILITY_UNMIGRATED'
  );
  assert.equal(runs(), 0);
});

test('explicit UNMIGRATED, NOT CONNECTED, and UNAVAILABLE never reach adapters', async () => {
  const harness = createRuntimeHarness();
  function register(id, migrationState) {
    harness.capabilityRegistry.register(descriptorBase({
      id,
      owner: 'arcgis',
      migrationState,
      unavailableReason: `${migrationState} blocked`
    }));
    return bindCountingAdapter(harness.capabilityRegistry, id);
  }
  const unmigratedRuns = register('map', MIGRATION_STATE.UNMIGRATED);
  const unavailableRuns = register('analysis', MIGRATION_STATE.UNAVAILABLE);
  const disconnectedRuns = register('local-reason', MIGRATION_STATE.NOT_CONNECTED);
  const world = harness.store.getSnapshot();
  async function run(capabilityId) {
    return harness.runtime.execute(createActionEnvelope({
      actionId: `action-${capabilityId}`,
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId,
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: `trace-${capabilityId}`
    }, { now: harness.now }));
  }
  await assert.rejects(() => run('map'), (error) => error.code === 'CAPABILITY_UNMIGRATED');
  await assert.rejects(() => run('analysis'), (error) => error.code === 'CAPABILITY_UNAVAILABLE');
  await assert.rejects(() => run('local-reason'), (error) => error.code === 'CAPABILITY_NOT_CONNECTED');
  assert.equal(unmigratedRuns(), 0);
  assert.equal(unavailableRuns(), 0);
  assert.equal(disconnectedRuns(), 0);
});

test('arbitrary specialist cannot claim CHASSIS; only trusted chassis registrations may', async () => {
  assert.throws(
    () => createCapabilityDescriptor(descriptorBase({
      id: 'map',
      owner: 'arcgis',
      migrationState: MIGRATION_STATE.CHASSIS
    })),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );
  assert.throws(
    () => createCapabilityDescriptor(descriptorBase({
      id: 'map',
      owner: 'tool-builder',
      migrationState: MIGRATION_STATE.CHASSIS
    })),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );
  assert.throws(
    () => createCapabilityDescriptor(descriptorBase({
      id: 'chassis.echo',
      owner: 'arcgis',
      migrationState: MIGRATION_STATE.CHASSIS
    })),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );

  assert.throws(
    () => createCapabilityDescriptor(descriptorBase({
      id: 'chassis.echo',
      owner: 'tool-builder',
      migrationState: MIGRATION_STATE.CHASSIS
    })),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );
  assert.throws(
    () => createCapabilityDescriptor(descriptorBase({
      id: 'view.select',
      owner: 'tool-builder',
      migrationState: MIGRATION_STATE.CHASSIS
    })),
    (error) => error.code === 'UNTRUSTED_CHASSIS_REGISTRATION'
  );

  const harness = createRuntimeHarness();
  harness.chassisRegistrar.register(descriptorBase({
    id: 'chassis.echo',
    migrationState: MIGRATION_STATE.CHASSIS
  }));
  const chassisRuns = bindCountingAdapter(harness.chassisRegistrar, 'chassis.echo');
  const world = harness.store.getSnapshot();
  const result = await harness.runtime.execute(createActionEnvelope({
    actionId: 'action-chassis',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:session',
    capabilityId: 'chassis.echo',
    input: {},
    worldId: world.worlds.activeWorldId,
    baseWorldRevision: world.revision,
    traceId: 'trace-chassis'
  }, { now: harness.now }));
  assert.equal(result.ok, true);
  assert.equal(chassisRuns(), 1);
});

test('MIGRATED and AVAILABLE specialists can execute; registration alone is not authority', async () => {
  const harness = createRuntimeHarness();
  harness.capabilityRegistry.register(descriptorBase({
    id: 'specialist.echo',
    owner: 'arcgis',
    migrationState: MIGRATION_STATE.MIGRATED
  }));
  harness.capabilityRegistry.register(descriptorBase({
    id: 'specialist.ready',
    owner: 'arcgis',
    migrationState: MIGRATION_STATE.AVAILABLE
  }));
  harness.capabilityRegistry.register(descriptorBase({
    id: 'specialist.blocked',
    owner: 'arcgis'
  }));
  const migratedRuns = bindCountingAdapter(harness.capabilityRegistry, 'specialist.echo');
  const availableRuns = bindCountingAdapter(harness.capabilityRegistry, 'specialist.ready');
  const blockedRuns = bindCountingAdapter(harness.capabilityRegistry, 'specialist.blocked');
  const world = harness.store.getSnapshot();
  async function run(capabilityId) {
    return harness.runtime.execute(createActionEnvelope({
      actionId: `action-${capabilityId}`,
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId,
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: `trace-${capabilityId}`
    }, { now: harness.now }));
  }
  assert.equal((await run('specialist.echo')).ok, true);
  assert.equal(migratedRuns(), 1);
  assert.equal((await run('specialist.ready')).ok, true);
  assert.equal(availableRuns(), 1);
  await assert.rejects(() => run('specialist.blocked'), (error) => error.code === 'CAPABILITY_UNMIGRATED');
  assert.equal(blockedRuns(), 0);
  assert.equal(harness.capabilityRegistry.require('specialist.blocked').migrationState, MIGRATION_STATE.UNMIGRATED);
});
