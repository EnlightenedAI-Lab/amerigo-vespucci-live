import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  EXECUTION_MODE,
  MIGRATION_STATE,
  POLICY_ACTION,
  POLICY_OUTCOME,
  TRUTH_CLASS,
  VIEW_AVAILABILITY,
  VIEW_ID,
  VIEW_LIFECYCLE,
  createActionEnvelope
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';
import { createCapabilityRegistry, createViewRegistry } from '../../public/spatial-v2/registries/index.js';
import { createPolicyGuard, createPolicyService } from '../../public/spatial-v2/policy/index.js';
import { createJobManager } from '../../public/spatial-v2/jobs/index.js';
import { createCapabilityRuntime, createResultCommitter } from '../../public/spatial-v2/runtime/index.js';
import { createViewHost } from '../../public/spatial-v2/hosts/view-host.js';

function clock() {
  return () => '2026-08-18T16:00:00.000Z';
}

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function mutationPatch(world, revision, toolId = 'time') {
  return {
    patchId: `patch-${toolId}-${revision}`,
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
    resultId: `result-${toolId}-${revision}`,
    resultType: 'workspace-selection',
    truthClass: TRUTH_CLASS.CALCULATED,
    statePatch: mutationPatch(world, revision, toolId)
  };
}

function boundAuthorize(policy, world, action, overrides = {}) {
  return policy.authorize({
    actorContext: {
      actorRef: action.actorRef,
      identityRef: action.actorRef,
      source: ACTION_SOURCE.OPERATOR
    },
    capabilityId: action.capabilityId,
    policyAction: POLICY_ACTION.DISPLAY,
    resourceRefs: [],
    requestedRights: [],
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    dataClassifications: [],
    worldId: action.worldId,
    sessionId: world.context.sessionId,
    actionId: action.actionId,
    worldRevision: action.baseWorldRevision,
    ...overrides
  });
}

function commitArgs(action, world, decision, extra = {}) {
  return {
    action,
    policyDecision: decision,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    actorRef: action.actorRef,
    capabilityId: action.capabilityId,
    policyAction: POLICY_ACTION.DISPLAY,
    identityRef: action.actorRef,
    sessionId: world.context.sessionId,
    resourceRefs: [],
    result: mutationResult(world, action.baseWorldRevision, extra.toolId || 'layers'),
    ...extra
  };
}

test('issued Policy ALLOW cannot be replayed or rebound to another context', () => {
  const now = clock();
  const store = createStateStore({ now, idFactory: ids('v2p') });
  const policy = createPolicyService({ now, idFactory: ids('v2pol'), knownIdentities: ['operator:session', 'operator:other'] });
  const committer = createResultCommitter({ stateStore: store, policyService: policy });
  const world = store.getSnapshot();
  const action = createActionEnvelope({
    actionId: 'action-bound',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:session',
    capabilityId: 'chassis.set-active-system',
    input: { systemId: 'layers' },
    worldId: world.worlds.activeWorldId,
    baseWorldRevision: world.revision,
    traceId: 'trace-bound'
  }, { now });
  const decision = boundAuthorize(policy, world, action);

  const otherCapability = createActionEnvelope({
    ...action,
    actionId: 'action-other-cap',
    capabilityId: 'chassis.inspect-world'
  }, { now });
  assert.throws(
    () => committer.commit(commitArgs(otherCapability, world, decision, { capabilityId: 'chassis.inspect-world' })),
    (error) => error.code === 'POLICY_DECISION_SCOPE'
  );

  const otherActor = createActionEnvelope({
    ...action,
    actionId: 'action-other-actor',
    actorRef: 'operator:other'
  }, { now });
  assert.throws(
    () => committer.commit(commitArgs(otherActor, world, decision, {
      actorRef: 'operator:other',
      identityRef: 'operator:other'
    })),
    (error) => error.code === 'POLICY_DECISION_SCOPE'
  );

  assert.throws(
    () => committer.commit(commitArgs(action, world, decision, { resourceRefs: ['layer:session'] })),
    (error) => error.code === 'POLICY_DECISION_SCOPE'
  );

  assert.throws(
    () => committer.commit(commitArgs(action, world, decision, { sessionId: 'session-other' })),
    (error) => error.code === 'POLICY_DECISION_SCOPE'
  );

  const otherWorld = createActionEnvelope({
    ...action,
    worldId: 'world-other'
  }, { now });
  assert.throws(
    () => committer.commit(commitArgs(otherWorld, world, decision)),
    (error) => error.code === 'POLICY_DECISION_SCOPE'
  );
  assert.equal(store.getRevision(), world.revision);

  committer.commit(commitArgs(action, world, decision));
  assert.equal(store.getSnapshot().workspace.activeToolIds[0], 'layers');
  assert.throws(
    () => committer.commit(commitArgs(action, store.getSnapshot(), decision, { toolId: 'time' })),
    (error) => error.code === 'POLICY_DECISION_REPLAY'
  );
});

test('caller-claimed OPERATOR cannot mint a grant without PolicyService confirmation', () => {
  const now = clock();
  const policy = createPolicyService({ now, idFactory: ids('v2g') });
  const grantBody = {
    actorRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z',
    operatorConfirmedAt: '2026-08-18T16:00:00.000Z'
  };
  assert.throws(
    () => policy.issueGrant(grantBody, { source: ACTION_SOURCE.OPERATOR }),
    (error) => error instanceof ContractError && error.code === 'OPERATOR_CONFIRMATION_REQUIRED'
  );

  assert.throws(
    () => policy.issueGrant(grantBody, {
      confirmation: {
        confirmationId: 'forged',
        integrityToken: 'forged-token',
        actorRef: 'operator:session',
        identityRef: 'operator:session',
        capabilityId: 'chassis.external-write',
        policyAction: POLICY_ACTION.EXTERNAL_WRITE,
        resourceRefs: ['layer:session'],
        sessionId: 'session-1',
        worldId: null,
        issuedAt: '2026-08-18T16:00:00.000Z',
        expiresAt: '2026-08-19T00:00:00.000Z'
      }
    }),
    (error) => error.code === 'FORGED_OPERATOR_CONFIRMATION'
  );

  const boundary = policy.takeOperatorConfirmationBoundary();
  const confirmationFields = {
    actorRef: 'operator:session',
    identityRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z'
  };
  const confirmation = policy.issueOperatorConfirmation({
    evidence: boundary.recordConfirmationEvent(confirmationFields)
  });
  assert.throws(
    () => policy.issueGrant({
      ...grantBody,
      capabilityId: 'capture.share',
      policyAction: POLICY_ACTION.PORTAL_PUBLISH
    }, { confirmation }),
    (error) => error.code === 'OPERATOR_CONFIRMATION_MISMATCH'
  );

  let t = Date.parse('2026-08-18T16:00:00.000Z');
  const expiring = createPolicyService({
    now: () => new Date(t).toISOString(),
    idFactory: ids('v2exp')
  });
  const expiringBoundary = expiring.takeOperatorConfirmationBoundary();
  const shortLived = expiring.issueOperatorConfirmation({
    evidence: expiringBoundary.recordConfirmationEvent({
      actorRef: 'operator:session',
      identityRef: 'operator:session',
      capabilityId: 'chassis.external-write',
      policyAction: POLICY_ACTION.EXTERNAL_WRITE,
      resourceRefs: ['layer:session'],
      sessionId: 'session-1',
      expiresAt: '2026-08-18T16:00:01.000Z'
    })
  });
  t += 2000;
  assert.throws(
    () => expiring.issueGrant(grantBody, { confirmation: shortLived }),
    (error) => error.code === 'OPERATOR_CONFIRMATION_EXPIRED'
  );

  const valid = policy.issueOperatorConfirmation({
    evidence: boundary.recordConfirmationEvent(confirmationFields)
  });
  const grant = policy.issueGrant(grantBody, { confirmation: valid });
  assert.equal(grant.capabilityId, 'chassis.external-write');
  assert.equal(grant.operatorConfirmedAt, valid.issuedAt);
  assert.throws(
    () => policy.issueGrant(grantBody, { confirmation: valid }),
    (error) => error.code === 'OPERATOR_CONFIRMATION_REPLAY'
  );
});

test('MAP mounts once, hides, yields to specialist, and returns the same instance', () => {
  const viewRegistry = createViewRegistry();
  viewRegistry.register({
    viewId: VIEW_ID.MAP,
    title: 'MAP',
    lifecycle: VIEW_LIFECYCLE.MOUNT_ONCE,
    availability: VIEW_AVAILABILITY.REGISTERED,
    migrationState: MIGRATION_STATE.MIGRATED
  });
  viewRegistry.register({
    viewId: VIEW_ID.STREET_360,
    title: 'STREET 360',
    lifecycle: VIEW_LIFECYCLE.DEFERRED,
    availability: VIEW_AVAILABILITY.REGISTERED,
    migrationState: MIGRATION_STATE.MIGRATED
  });
  const mapInstance = { id: 'mapview-1' };
  const counts = { mapMount: 0, mapShow: 0, mapHide: 0, streetShow: 0, streetHide: 0 };
  viewRegistry.bindAdapter(VIEW_ID.MAP, {
    mount() {
      counts.mapMount += 1;
      return mapInstance;
    },
    show() { counts.mapShow += 1; },
    hide() { counts.mapHide += 1; }
  });
  viewRegistry.bindAdapter(VIEW_ID.STREET_360, {
    show() { counts.streetShow += 1; },
    hide() { counts.streetHide += 1; }
  });
  const host = createViewHost({ viewRegistry });
  const store = createStateStore({ now: clock(), idFactory: ids('v2map') });
  const world = store.getSnapshot();

  const mounted = host.mount(VIEW_ID.MAP);
  assert.equal(counts.mapMount, 1);
  assert.equal(mounted.instance, mapInstance);
  host.hide(VIEW_ID.MAP);
  assert.equal(counts.mapHide, 1);
  host.show(VIEW_ID.STREET_360);
  assert.equal(counts.streetShow, 1);
  host.hide(VIEW_ID.STREET_360);
  assert.equal(counts.streetHide, 1);
  const returned = host.show(VIEW_ID.MAP);
  assert.equal(counts.mapMount, 1);
  assert.equal(returned.instance, mapInstance);
  assert.equal(host.getMountedInstance(VIEW_ID.MAP), mapInstance);
  assert.throws(
    () => host.mount(VIEW_ID.MAP),
    (error) => error.code === 'DUPLICATE_LIFECYCLE_TRANSITION'
  );
  assert.equal(counts.mapMount, 1);
  assert.equal(host.project(VIEW_ID.STREET_360, world).viewId, VIEW_ID.MAP);
  assert.equal(host.getActiveViewId(world), VIEW_ID.MAP);
  assert.deepEqual(store.getSnapshot().views.activeViewIds, world.views.activeViewIds);
});

test('only CHASSIS and MIGRATED/AVAILABLE capabilities may execute adapters', async () => {
  const now = clock();
  const idFactory = ids('v2m');
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

  function register(id, migrationState) {
    let executed = 0;
    const spec = {
      id,
      owner: 'tool-builder',
      title: id,
      resultType: 'echo',
      requiredPolicyAction: POLICY_ACTION.DISPLAY,
      effectClass: EFFECT_CLASS.READ_ONLY,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState,
      unavailableReason: `${migrationState} blocked`
    };
    const adapter = {
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
    };
    if (migrationState === MIGRATION_STATE.CHASSIS) {
      chassisRegistrar.register(spec);
      chassisRegistrar.bindAdapter(id, '1.0.0', adapter);
    } else {
      capabilityRegistry.register(spec);
      capabilityRegistry.bindAdapter(id, '1.0.0', adapter);
    }
    return () => executed;
  }

  const chassisRuns = register('chassis.echo', MIGRATION_STATE.CHASSIS);
  const migratedRuns = register('specialist.echo', MIGRATION_STATE.MIGRATED);
  const availableRuns = register('specialist.ready', MIGRATION_STATE.AVAILABLE);
  const unmigratedRuns = register('map', MIGRATION_STATE.UNMIGRATED);
  const unavailableRuns = register('analysis', MIGRATION_STATE.UNAVAILABLE);
  const disconnectedRuns = register('local-reason', MIGRATION_STATE.NOT_CONNECTED);

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
  assert.equal(chassisRuns(), 1);
  assert.equal((await run('specialist.echo')).ok, true);
  assert.equal(migratedRuns(), 1);
  assert.equal((await run('specialist.ready')).ok, true);
  assert.equal(availableRuns(), 1);

  await assert.rejects(() => run('map'), (error) => error.code === 'CAPABILITY_UNMIGRATED');
  await assert.rejects(() => run('analysis'), (error) => error.code === 'CAPABILITY_UNAVAILABLE');
  await assert.rejects(() => run('local-reason'), (error) => error.code === 'CAPABILITY_NOT_CONNECTED');
  assert.equal(unmigratedRuns(), 0);
  assert.equal(unavailableRuns(), 0);
  assert.equal(disconnectedRuns(), 0);
});

test('JobManager cancellation requires RUNNING ACK and forbids terminal replay', () => {
  const jobs = createJobManager({ now: clock(), idFactory: ids('v2j') });
  const spec = {
    capabilityId: 'chassis.job-sum',
    actorRef: 'operator:session',
    worldId: 'world-1',
    baseWorldRevision: 1
  };

  const queued = jobs.enqueue(spec);
  assert.equal(queued.status, 'QUEUED');
  assert.throws(() => jobs.acknowledgeCancel(queued.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  const cancelQueued = jobs.requestCancel(queued.jobId);
  assert.equal(cancelQueued.status, 'QUEUED');
  assert.throws(() => jobs.acknowledgeCancel(queued.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  assert.throws(() => jobs.complete(queued.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  assert.throws(() => jobs.fail(queued.jobId, 'no'), (error) => error.code === 'INVALID_JOB_TRANSITION');

  const running = jobs.start(queued.jobId);
  assert.equal(running.status, 'RUNNING');
  assert.throws(() => jobs.requestCancel(queued.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  const cancelled = jobs.acknowledgeCancel(queued.jobId);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.throws(() => jobs.acknowledgeCancel(queued.jobId), (error) => error.code === 'STALE_COMPLETION');
  assert.throws(() => jobs.complete(queued.jobId), (error) => error.code === 'STALE_COMPLETION');
  assert.throws(() => jobs.fail(queued.jobId, 'no'), (error) => error.code === 'STALE_COMPLETION');
  assert.throws(() => jobs.start(queued.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');
  assert.throws(() => jobs.requestCancel(queued.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');

  const completeJob = jobs.enqueue(spec);
  jobs.start(completeJob.jobId);
  jobs.complete(completeJob.jobId, { resultRef: 'ok' });
  assert.throws(() => jobs.acknowledgeCancel(completeJob.jobId), (error) => error.code === 'STALE_COMPLETION');
  assert.throws(() => jobs.requestCancel(completeJob.jobId), (error) => error.code === 'INVALID_JOB_TRANSITION');

  const failJob = jobs.enqueue(spec);
  jobs.start(failJob.jobId);
  jobs.fail(failJob.jobId, 'boom');
  assert.throws(() => jobs.acknowledgeCancel(failJob.jobId), (error) => error.code === 'STALE_COMPLETION');

  const runningCancel = jobs.enqueue(spec);
  jobs.start(runningCancel.jobId);
  jobs.requestCancel(runningCancel.jobId);
  assert.equal(jobs.acknowledgeCancel(runningCancel.jobId).status, 'CANCELLED');
});
