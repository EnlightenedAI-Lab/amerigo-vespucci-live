import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  EXECUTION_MODE,
  MIGRATION_STATE,
  POLICY_ACTION,
  POLICY_OUTCOME,
  SCHEMA_IDS,
  TRUTH_CLASS,
  VIEW_AVAILABILITY,
  VIEW_ID,
  VIEW_LIFECYCLE,
  createActionEnvelope
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError, requirePlainObject, requireString, rejectUnknownKeys } from '../../public/spatial-v2/foundation/contracts/validate.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';
import { createCapabilityRegistry, createViewRegistry } from '../../public/spatial-v2/registries/index.js';
import { createPolicyGuard, createPolicyService } from '../../public/spatial-v2/policy/index.js';
import { createJobManager } from '../../public/spatial-v2/jobs/index.js';
import { createCapabilityRuntime, createResultCommitter, createSchemaGuard } from '../../public/spatial-v2/runtime/index.js';
import { createViewHost } from '../../public/spatial-v2/hosts/view-host.js';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';

function clock() {
  return () => '2026-08-18T16:00:00.000Z';
}

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function mutationPatch(world, revision, toolId = 'time') {
  return {
    patchId: 'patch-adv',
    baseRevision: revision,
    actorRef: 'operator:session',
    source: ACTION_SOURCE.OPERATOR,
    capabilityId: 'chassis.set-active-system',
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: {
      workspace: {
        workspaceId: world.workspace.workspaceId,
        kind: world.workspace.kind,
        activeToolIds: [toolId]
      }
    }
  };
}

function mutationResult(world, revision, toolId = 'time') {
  return {
    resultId: 'result-adv',
    resultType: 'workspace-selection',
    truthClass: TRUTH_CLASS.CALCULATED,
    statePatch: mutationPatch(world, revision, toolId)
  };
}

function allowRequest(world, capabilityId = 'chassis.set-active-system') {
  return {
    actorContext: {
      actorRef: 'operator:session',
      identityRef: 'operator:session',
      source: ACTION_SOURCE.OPERATOR
    },
    capabilityId,
    policyAction: POLICY_ACTION.DISPLAY,
    resourceRefs: [],
    requestedRights: [],
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    dataClassifications: [],
    worldId: world.worlds.activeWorldId,
    sessionId: world.context.sessionId
  };
}

function createHarness() {
  const now = clock();
  const idFactory = ids('h');
  const store = createStateStore({ now, idFactory });
  const capabilityRegistry = createCapabilityRegistry();
  const chassisRegistrar = capabilityRegistry.takeChassisRegistrar();
  const policyService = createPolicyService({ now, idFactory, knownIdentities: ['operator:session'] });
  const schemaGuard = createSchemaGuard();
  schemaGuard.register('iqai.spatial.test.echo-input/1.0.0', (value) => {
    requirePlainObject(value, 'input');
    rejectUnknownKeys(value, 'input', ['token']);
    requireString(value.token, 'token');
    return value;
  });
  const runtime = createCapabilityRuntime({
    capabilityRegistry,
    policyGuard: createPolicyGuard(policyService),
    resultCommitter: createResultCommitter({ stateStore: store, policyService }),
    jobManager: createJobManager({ now, idFactory }),
    stateStore: store,
    now,
    idFactory,
    schemaGuard
  });
  return { store, capabilityRegistry, chassisRegistrar, policyService, runtime, schemaGuard, now, idFactory };
}

test('forged Policy ALLOW lookalikes cannot mutate StateStore', () => {
  const now = clock();
  const store = createStateStore({ now, idFactory: ids('f1') });
  const policyService = createPolicyService({ now, idFactory: ids('f1p') });
  const committer = createResultCommitter({ stateStore: store, policyService });
  const world = store.getSnapshot();
  const action = createActionEnvelope({
    actionId: 'action-forged',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:session',
    capabilityId: 'chassis.set-active-system',
    input: { systemId: 'time' },
    worldId: world.worlds.activeWorldId,
    baseWorldRevision: world.revision,
    traceId: 'trace-forged'
  }, { now });
  const forgedAllow = {
    schemaId: SCHEMA_IDS.POLICY,
    decisionId: 'decision-forged',
    outcome: POLICY_OUTCOME.ALLOW,
    reasonCodes: ['SESSION_POLICY_ALLOW'],
    obligations: [],
    policyVersion: '1.0.0',
    capabilityId: 'chassis.set-active-system',
    policyAction: POLICY_ACTION.DISPLAY,
    actorRef: 'operator:session',
    resourceRefs: [],
    grantId: null,
    integrityToken: 'pol-decision-forged:operator:session:chassis.set-active-system:DISPLAY:ALLOW',
    decidedAt: '2026-08-18T16:00:00.000Z',
    expiresAt: null
  };
  const before = store.getRevision();
  assert.throws(
    () => committer.commit({
      action,
      policyDecision: forgedAllow,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      result: mutationResult(world, world.revision)
    }),
    (error) => error instanceof ContractError && error.code === 'FORGED_POLICY_DECISION'
  );
  assert.equal(store.getRevision(), before);

  const issuedDeny = policyService.authorize({
    ...allowRequest(world),
    actorContext: { actorRef: 'stranger', identityRef: 'stranger', source: ACTION_SOURCE.OPERATOR }
  });
  const lookalikeAllow = { ...issuedDeny, outcome: POLICY_OUTCOME.ALLOW };
  assert.throws(
    () => committer.commit({
      action,
      policyDecision: lookalikeAllow,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      result: mutationResult(world, world.revision, 'analyze')
    }),
    (error) => error instanceof ContractError && error.code === 'FORGED_POLICY_DECISION'
  );
  assert.equal(store.getRevision(), before);

  const issuedAllow = policyService.authorize({
    ...allowRequest(world),
    actionId: action.actionId,
    worldRevision: action.baseWorldRevision
  });
  committer.commit({
    action,
    policyDecision: issuedAllow,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    actorRef: action.actorRef,
    capabilityId: action.capabilityId,
    policyAction: POLICY_ACTION.DISPLAY,
    identityRef: action.actorRef,
    sessionId: world.context.sessionId,
    resourceRefs: [],
    result: mutationResult(world, world.revision, 'layers')
  });
  assert.equal(store.getSnapshot().workspace.activeToolIds[0], 'layers');
});

test('grant creation without source is rejected and does not mint rights', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('f2') });
  const body = {
    actorRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z',
    operatorConfirmedAt: '2026-08-18T16:00:00.000Z'
  };
  assert.throws(
    () => policy.issueGrant(body),
    (error) => error.code === 'GRANT_SOURCE_REQUIRED'
  );
  const blocked = policy.authorize({
    actorContext: { actorRef: 'operator:session', identityRef: 'operator:session', source: ACTION_SOURCE.OPERATOR },
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    requestedRights: [],
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
    dataClassifications: [],
    worldId: 'world-1',
    sessionId: 'session-1'
  });
  assert.equal(blocked.outcome, POLICY_OUTCOME.REQUIRES_EXPLICIT_AUTHORIZATION);
});

test('invalid capability input never reaches the adapter', async () => {
  const harness = createHarness();
  let executed = 0;
  harness.chassisRegistrar.register({
    id: 'chassis.echo',
    owner: 'tool-builder',
    title: 'Echo',
    inputSchema: 'iqai.spatial.test.echo-input/1.0.0',
    resultType: 'echo',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.READ_ONLY,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    migrationState: MIGRATION_STATE.CHASSIS
  });
  harness.chassisRegistrar.bindAdapter('chassis.echo', '1.0.0', {
    execute() {
      executed += 1;
      return {
        result: {
          resultId: 'echo-1',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  });
  const world = harness.store.getSnapshot();
  await assert.rejects(
    () => harness.runtime.execute(createActionEnvelope({
      actionId: 'action-bad-input',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'chassis.echo',
      input: { token: 1 },
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: 'trace-bad-input'
    }, { now: harness.now })),
    (error) => error.code === 'INVALID_INPUT' && error.details?.receipt?.executed === false
  );
  assert.equal(executed, 0);
  assert.equal(harness.store.getRevision(), world.revision);
});

test('wrong output schema never commits to StateStore', async () => {
  const harness = createHarness();
  let executed = 0;
  harness.chassisRegistrar.register({
    id: 'chassis.echo-out',
    owner: 'tool-builder',
    title: 'Echo out',
    resultType: 'echo',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    migrationState: MIGRATION_STATE.CHASSIS
  });
  harness.chassisRegistrar.bindAdapter('chassis.echo-out', '1.0.0', {
    execute(_action, { world }) {
      executed += 1;
      return {
        result: {
          schemaId: SCHEMA_IDS.WORLD_STATE,
          resultId: 'echo-bad-schema',
          resultType: 'echo',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: mutationPatch(world, world.revision, 'time')
        }
      };
    }
  });
  const world = harness.store.getSnapshot();
  await assert.rejects(
    () => harness.runtime.execute(createActionEnvelope({
      actionId: 'action-bad-output',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'chassis.echo-out',
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: 'trace-bad-output'
    }, { now: harness.now })),
    (error) => error.code === 'INVALID_OUTPUT' && error.details?.receipt?.committed === false
  );
  assert.equal(executed, 1);
  assert.equal(harness.store.getRevision(), world.revision);
});

test('wrong result type never commits to StateStore', async () => {
  const harness = createHarness();
  harness.chassisRegistrar.register({
    id: 'chassis.echo-type',
    owner: 'tool-builder',
    title: 'Echo type',
    resultType: 'echo',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    migrationState: MIGRATION_STATE.CHASSIS
  });
  harness.chassisRegistrar.bindAdapter('chassis.echo-type', '1.0.0', {
    execute(_action, { world }) {
      return {
        result: {
          resultId: 'echo-bad-type',
          resultType: 'other',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: mutationPatch(world, world.revision, 'time')
        }
      };
    }
  });
  const world = harness.store.getSnapshot();
  await assert.rejects(
    () => harness.runtime.execute(createActionEnvelope({
      actionId: 'action-bad-type',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'chassis.echo-type',
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: 'trace-bad-type'
    }, { now: harness.now })),
    (error) => error.code === 'RESULT_TYPE_MISMATCH' && error.details?.receipt?.committed === false
  );
  assert.equal(harness.store.getRevision(), world.revision);
});

test('adapter revision cannot override a stale ActionEnvelope', async () => {
  const now = clock();
  const store = createStateStore({ now, idFactory: ids('f4') });
  const policyService = createPolicyService({ now, idFactory: ids('f4p') });
  const committer = createResultCommitter({ stateStore: store, policyService });
  const first = store.getSnapshot();
  store.applyPatch(mutationPatch(first, first.revision, 'layers'));
  const world = store.getSnapshot();
  assert.equal(world.revision, first.revision + 1);

  let adapterRuns = 0;
  const harness = createHarness();
  harness.store.applyPatch(mutationPatch(harness.store.getSnapshot(), 1, 'layers'));
  harness.chassisRegistrar.register({
    id: 'chassis.stale-write',
    owner: 'tool-builder',
    title: 'Stale write',
    resultType: 'workspace-selection',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    migrationState: MIGRATION_STATE.CHASSIS
  });
  harness.chassisRegistrar.bindAdapter('chassis.stale-write', '1.0.0', {
    execute(_action, { world: current }) {
      adapterRuns += 1;
      return {
        result: mutationResult(current, current.revision, 'time')
      };
    }
  });
  await assert.rejects(
    () => harness.runtime.execute(createActionEnvelope({
      actionId: 'action-stale',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'chassis.stale-write',
      input: { systemId: 'time' },
      worldId: harness.store.getSnapshot().worlds.activeWorldId,
      baseWorldRevision: 1,
      traceId: 'trace-stale'
    }, { now: harness.now })),
    (error) => error.code === 'STALE_REVISION'
  );
  assert.equal(adapterRuns, 0);
  assert.equal(harness.store.getSnapshot().workspace.activeToolIds[0], 'layers');

  const action = createActionEnvelope({
    actionId: 'action-override',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:session',
    capabilityId: 'chassis.set-active-system',
    input: { systemId: 'time' },
    worldId: world.worlds.activeWorldId,
    baseWorldRevision: first.revision,
    traceId: 'trace-override'
  }, { now });
  const decision = policyService.authorize({
    ...allowRequest(world),
    actionId: action.actionId,
    worldRevision: action.baseWorldRevision
  });
  assert.throws(
    () => committer.commit({
      action,
      policyDecision: decision,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      actorRef: action.actorRef,
      capabilityId: action.capabilityId,
      policyAction: POLICY_ACTION.DISPLAY,
      identityRef: action.actorRef,
      sessionId: world.context.sessionId,
      resourceRefs: [],
      result: mutationResult(world, world.revision, 'time')
    }),
    (error) => error.code === 'ADAPTER_REVISION_OVERRIDE'
  );
  assert.equal(store.getRevision(), world.revision);
  assert.equal(store.getSnapshot().workspace.activeToolIds[0], 'layers');
});

test('ViewHost cannot diverge from World State and cannot execute unmigrated adapters', () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: clock(),
    idFactory: () => `vh-${++n}`
  });
  const world = chassis.stateStore.getSnapshot();
  let invoked = 0;
  chassis.viewRegistry.bindAdapter(VIEW_ID.MAP, {
    mount() { invoked += 1; },
    show() { invoked += 1; }
  });
  const projected = chassis.viewHost.requestView(VIEW_ID.STREET_360, world);
  assert.equal(projected.viewId, VIEW_ID.MAP);
  assert.equal(chassis.viewHost.getActiveViewId(world), VIEW_ID.MAP);
  assert.throws(
    () => chassis.viewHost.getActiveViewId(),
    (error) => error.code === 'HOST_HAS_NO_CANONICAL_VIEW'
  );
  assert.throws(
    () => chassis.viewHost.mount(VIEW_ID.MAP),
    (error) => error.code === 'VIEW_ADAPTER_NOT_EXECUTABLE'
  );
  assert.throws(
    () => chassis.viewHost.show(VIEW_ID.STREET_360),
    (error) => error.code === 'VIEW_ADAPTER_NOT_EXECUTABLE'
  );
  assert.equal(invoked, 0);
  assert.deepEqual(chassis.stateStore.getSnapshot().views.activeViewIds, world.views.activeViewIds);

  const viewRegistry = createViewRegistry();
  viewRegistry.register({
    viewId: VIEW_ID.MAP,
    title: 'MAP',
    lifecycle: VIEW_LIFECYCLE.MOUNT_ONCE,
    availability: VIEW_AVAILABILITY.REGISTERED,
    migrationState: MIGRATION_STATE.CHASSIS
  });
  let mounts = 0;
  viewRegistry.bindAdapter(VIEW_ID.MAP, {
    mount() { mounts += 1; },
    show() { mounts += 1; }
  });
  const host = createViewHost({ viewRegistry });
  host.mount(VIEW_ID.MAP);
  assert.equal(mounts, 1);
  assert.throws(
    () => host.mount(VIEW_ID.MAP),
    (error) => error.code === 'DUPLICATE_LIFECYCLE_TRANSITION'
  );
  assert.equal(mounts, 1);
});

test('NOT CONNECTED capabilities cannot execute adapters', async () => {
  const harness = createHarness();
  let executed = 0;
  harness.capabilityRegistry.register({
    id: 'chassis.local-reason',
    owner: 'tool-builder',
    title: 'Local reason',
    resultType: 'reason',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.READ_ONLY,
    execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
    migrationState: MIGRATION_STATE.NOT_CONNECTED,
    unavailableReason: 'Local reasoning provider is NOT CONNECTED.'
  });
  harness.capabilityRegistry.bindAdapter('chassis.local-reason', '1.0.0', {
    execute() {
      executed += 1;
      return {
        result: {
          resultId: 'reason-1',
          resultType: 'reason',
          truthClass: TRUTH_CLASS.CALCULATED,
          statePatch: null
        }
      };
    }
  });
  const world = harness.store.getSnapshot();
  await assert.rejects(
    () => harness.runtime.execute(createActionEnvelope({
      actionId: 'action-nc',
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId: 'chassis.local-reason',
      input: {},
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: 'trace-nc'
    }, { now: harness.now })),
    (error) => error.code === 'CAPABILITY_NOT_CONNECTED'
  );
  assert.equal(executed, 0);
  assert.equal(harness.store.getRevision(), world.revision);
});

test('JobManager forbids QUEUED to FAILED and enumerates frozen transitions', () => {
  const jobs = createJobManager({ now: clock(), idFactory: ids('f7') });
  const spec = {
    capabilityId: 'chassis.job-sum',
    actorRef: 'operator:session',
    worldId: 'world-1',
    baseWorldRevision: 1
  };

  const queuedFail = jobs.enqueue(spec);
  assert.equal(queuedFail.status, 'QUEUED');
  assert.throws(() => jobs.fail(queuedFail.jobId, 'no'), (error) => error.code === 'INVALID_JOB_TRANSITION');
  assert.throws(() => jobs.complete(queuedFail.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  const running = jobs.start(queuedFail.jobId);
  assert.equal(running.status, 'RUNNING');
  assert.equal(jobs.fail(queuedFail.jobId, 'boom').status, 'FAILED');

  const queuedComplete = jobs.enqueue(spec);
  jobs.start(queuedComplete.jobId);
  assert.equal(jobs.complete(queuedComplete.jobId, { resultRef: 'r' }).status, 'COMPLETE');

  const queuedCancel = jobs.enqueue(spec);
  jobs.start(queuedCancel.jobId);
  jobs.requestCancel(queuedCancel.jobId);
  assert.equal(jobs.acknowledgeCancel(queuedCancel.jobId).status, 'CANCELLED');

  const stillQueued = jobs.enqueue(spec);
  assert.throws(() => jobs.start(queuedFail.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  assert.throws(() => jobs.progress(stillQueued.jobId, { percent: 1 }), (error) => error.code === 'INVALID_JOB_TRANSITION');
  assert.equal(jobs.get(stillQueued.jobId).status, 'QUEUED');
});
