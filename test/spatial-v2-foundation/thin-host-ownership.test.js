import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  EXECUTION_MODE,
  MIGRATION_STATE,
  POLICY_ACTION,
  POLICY_OUTCOME,
  TRUTH_CLASS,
  VIEW_ID,
  createActionEnvelope
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';
import { createPolicyService } from '../../public/spatial-v2/policy/index.js';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

const APP_SHELL_DENYLIST = [
  'map-foundation',
  'time-engine',
  'ground-controller',
  'spatial-focus',
  'Street360Control',
  'GooglePhotorealistic3dControl',
  'ImageryPanel',
  'OperatorImageryExperience',
  'createStateStore',
  'createPolicyService',
  'createJobManager',
  'initMapFoundation',
  'new MapView(',
  'portalItem.update'
];

test('AppShell source is composition-only and has no provider or policy authority', () => {
  const app = read('shell/AppShell.js');
  assert.match(app, /mountAppShell/);
  assert.match(app, /composition only/);
  for (const marker of APP_SHELL_DENYLIST) {
    assert.equal(app.includes(marker), false, `AppShell contains ${marker}`);
  }
  assert.doesNotMatch(app, /createStateStore/);
  assert.doesNotMatch(app, /policy-service/);
  assert.doesNotMatch(app, /time-engine/);
});

test('MapStage host does not construct MapView and chassis files do not add a second constructor', () => {
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  const chassisDirs = ['registries', 'policy', 'jobs', 'runtime', 'hosts', 'bootstrap', 'brain'];
  const files = chassisDirs.flatMap((dir) => walk(path.join(V2, dir)));
  files.push(path.join(V2, 'shell', 'AppShell.js'));
  files.push(path.join(V2, 'shell', 'SystemsRail.js'));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /new MapView\(/, file);
    assert.doesNotMatch(text, /portalItem\.update/, file);
    assert.doesNotMatch(text, /\.save\(/, file);
  }
});

test('chassis execute uses CapabilityRuntime and ResultCommitter, not AppShell', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `w2-${++n}`
  });
  const before = chassis.stateStore.getRevision();
  await chassis.executeChassis('chassis.set-active-system', { systemId: 'layers' });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.workspace.activeToolIds[0], 'layers');
  assert.equal(world.revision, before + 1);

  await chassis.executeChassis('view.select', { viewId: VIEW_ID.STREET_360 });
  const after = chassis.stateStore.getSnapshot();
  assert.deepEqual(after.views.activeViewIds, [VIEW_ID.STREET_360]);
  assert.equal(chassis.viewRegistry.require(VIEW_ID.STREET_360).migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.viewRegistry.require(VIEW_ID.ANALYZE_3D).migrationState, MIGRATION_STATE.MIGRATED);
});

test('unmigrated and unavailable capabilities fail closed before adapter execution', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `deny-${++n}`
  });
  const mapped = await chassis.executeChassis('map', {});
  assert.equal(mapped.ok, true);
  assert.equal(chassis.stateStore.getSnapshot().views.activeViewIds[0], VIEW_ID.MAP);
  await assert.rejects(
    () => chassis.executeChassis('imagery', {}),
    (error) => error.code === 'CAPABILITY_UNMIGRATED'
  );
  await assert.rejects(
    () => chassis.executeChassis('analysis', {}),
    (error) => error.code === 'CAPABILITY_UNAVAILABLE'
  );
  const portal = chassis.policyService.authorize({
    actorContext: { actorRef: 'operator:session', identityRef: 'operator:session', source: ACTION_SOURCE.OPERATOR },
    capabilityId: 'capture.share',
    policyAction: POLICY_ACTION.PORTAL_PUBLISH,
    resourceRefs: [],
    requestedRights: [],
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
    dataClassifications: [],
    worldId: chassis.stateStore.getSnapshot().worlds.activeWorldId,
    sessionId: chassis.stateStore.getSnapshot().context.sessionId
  });
  assert.equal(portal.outcome, POLICY_OUTCOME.DENY);
});

test('only ResultCommitter applies capability results onto StateStore', async () => {
  let n = 0;
  const store = createStateStore({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `cmt-${++n}`
  });
  const policyService = createPolicyService({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `pol-${++n}`
  });
  const { createResultCommitter } = await import('../../public/spatial-v2/runtime/result-committer.js');
  const committer = createResultCommitter({ stateStore: store, policyService });
  const world = store.getSnapshot();
  const action = createActionEnvelope({
    actionId: 'action-1',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:session',
    capabilityId: 'chassis.set-active-system',
    input: {},
    worldId: world.worlds.activeWorldId,
    baseWorldRevision: world.revision,
    traceId: 'trace-1',
    requestedAt: '2026-08-18T16:00:00.000Z'
  });
  const denied = {
    schemaId: 'iqai.spatial.policy/1.0.0',
    decisionId: 'decision-deny',
    outcome: POLICY_OUTCOME.DENY,
    reasonCodes: ['UNKNOWN_IDENTITY'],
    obligations: [],
    policyVersion: '1.0.0',
    capabilityId: 'chassis.set-active-system',
    policyAction: POLICY_ACTION.DISPLAY,
    actorRef: 'operator:session',
    resourceRefs: [],
    grantId: null,
    integrityToken: 'pol-decision-deny:operator:session:chassis.set-active-system:DISPLAY:DENY',
    decidedAt: '2026-08-18T16:00:00.000Z',
    expiresAt: null
  };
  assert.throws(
    () => committer.commit({
      action,
      policyDecision: denied,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      result: {
        resultId: 'r1',
        resultType: 'workspace-selection',
        truthClass: TRUTH_CLASS.CALCULATED,
        statePatch: {
          patchId: 'p1',
          baseRevision: world.revision,
          actorRef: 'operator:session',
          source: ACTION_SOURCE.OPERATOR,
          capabilityId: 'chassis.set-active-system',
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            workspace: {
              workspaceId: world.workspace.workspaceId,
              kind: world.workspace.kind,
              activeToolIds: ['time']
            }
          }
        }
      }
    }),
    (error) => error.code === 'FORGED_POLICY_DECISION'
  );
  assert.equal(store.getRevision(), world.revision);
});

test('visible shell stamps required systems and honest unmigrated labels', () => {
  const appSource = read('shell/AppShell.js');
  const rail = read('shell/SystemsRail.js');
  const catalog = read('bootstrap/chassis-catalog.js');
  const stage = read('hosts/view-host.js');
  assert.match(appSource, /renderSystemsRail/);
  assert.match(appSource, /renderMapStageHost/);
  assert.match(appSource, /renderInspectorHost/);
  assert.match(appSource, /renderBrainHost/);
  for (const label of [
    'WORKSPACE',
    'VIEW',
    'FOCUS / SELECT',
    'LAYERS',
    'TIME',
    'ANALYZE',
    'AI / ASK IQAI',
    'SIMULATE',
    'INSPECTOR',
    'CAPTURE / SHARE'
  ]) {
    assert.match(catalog, new RegExp(label.replace('/', '\\/')));
  }
  for (const view of ['MAP', 'STREET 360', '3D VISUAL', '3D ANALYZE']) {
    assert.match(rail, new RegExp(view.replace(' ', '\\s+')));
  }
  assert.match(catalog, /UNMIGRATED/);
  assert.match(catalog, /UNAVAILABLE/);
  assert.match(stage, /DROP PIN/);
  assert.match(stage, /SECOND VIEW/);
  assert.match(stage, /UNMIGRATED/);
  assert.doesNotMatch(stage, /NO MAPVIEW THIS WAVE/);
  assert.doesNotMatch(stage, /What do you want to know or do/);
});

test('Ask on the chassis remains fail-closed and does not default to GIS', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `ask-${++n}`
  });
  const empty = await chassis.submitAsk({ text: '  ' });
  assert.equal(empty.state, 'UNROUTED');
  const unknown = await chassis.submitAsk({ text: 'please do something unrelated' });
  assert.equal(unknown.state, 'UNROUTED');
  const imagery = await chassis.submitAsk({ text: 'imagery' });
  assert.equal(imagery.state, 'UNAVAILABLE');
  const map = await chassis.submitAsk({ text: 'map' });
  assert.equal(map.state, 'ROUTED');
  assert.equal(map.result?.engineExecuted, false);
});

test('JOB execution enqueues without mutating World State', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `jobcap-${++n}`
  });
  chassis.capabilityRegistry.register({
    id: 'chassis.job-sum',
    owner: 'tool-builder',
    title: 'Sum',
    resultType: 'sum',
    requiredPolicyAction: POLICY_ACTION.DISPLAY,
    effectClass: EFFECT_CLASS.READ_ONLY,
    execution: { mode: EXECUTION_MODE.JOB, targets: ['LOCAL_CPU'] },
    migrationState: MIGRATION_STATE.MIGRATED
  });
  const before = chassis.stateStore.getRevision();
  const result = await chassis.executeChassis('chassis.job-sum', { values: [1, 2] });
  assert.equal(result.ok, true);
  assert.equal(result.executed, false);
  assert.equal(result.job.status, 'QUEUED');
  assert.equal(chassis.stateStore.getRevision(), before);
  const running = chassis.jobManager.start(result.job.jobId);
  assert.equal(running.status, 'RUNNING');
  const complete = chassis.jobManager.complete(result.job.jobId, { resultRef: 'sum-1' });
  assert.equal(complete.status, 'COMPLETE');
  assert.equal(chassis.stateStore.getRevision(), before);
});

test('in-memory chassis capability can run through bootstrap without external calls', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T16:00:00.000Z',
    idFactory: () => `live-${++n}`
  });
  const result = await chassis.executeChassis('chassis.inspect-world', {});
  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.equal(result.result.truthClass, TRUTH_CLASS.CALCULATED);
  assert.equal(chassis.jobManager.list().length, 0);
});
