import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMapFromPrompt } from '../src/spatial/iqai-mapper.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';
import { buildObjectiveSpecFromPrompt } from '../src/spatial/orchestrator/objective-spec.js';
import {
  buildDeterministicFireStationTaskGraph,
  TASK_IDS,
  validateTaskGraphStructure
} from '../src/spatial/orchestrator/fire-station-graph.js';
import {
  CAPABILITY_AUTHORITATIVE_DATA_QUERY,
  DEPENDENCY_TYPES,
  MAP_PLAN_VALIDATION,
  TASK_STATES,
  buildIdempotencyKey,
  buildStableFeatureKey
} from '../src/spatial/orchestrator/contracts.js';
import {
  assertCapabilityAvailable,
  lookupCapability
} from '../src/spatial/orchestrator/capability-registry.js';
import {
  canTransitionTaskState,
  evaluateDependency
} from '../src/spatial/orchestrator/task-state-machine.js';
import { buildMapActionPlanFromMapResult } from '../src/spatial/orchestrator/map-action-plan-builder.js';
import { validateMapActionPlan } from '../src/spatial/orchestrator/map-action-validator.js';
import {
  TaskGraphCoordinator,
  runDeterministicTaskGraph,
  PHASE_2_SEAM
} from '../src/spatial/orchestrator/coordinator.js';
import { executeMapPlanExecutorWorker } from '../src/spatial/orchestrator/workers.js';
import { createTaskRequest, createTaskResult } from '../src/spatial/orchestrator/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures', 'montreal-fire-stations-sample.geojson'), 'utf8');
const PROMPT = 'Map fire stations within 3 km of 997 de la Commune';
const ORIGIN = { latitude: 45.492941, longitude: -73.648837 };

function mockDeps() {
  return {
    geocodeFn: async () => [{
      geocoder: 'ArcGIS World GeocodeServer',
      resolvedAddress: '997 Rue De La Commune O, Montréal, QC',
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      score: 100
    }],
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(fixture)
    }),
    buildMapFromPrompt
  };
}

function mockExecutor(store = new Map()) {
  return async (plan, options = {}) => {
    const key = options.idempotencyKey || plan.planId;
    if (options.cancelled) {
      return { success: false, mutatedMap: false, planId: plan.planId };
    }
    if (store.has(key)) {
      return { success: true, skippedDuplicate: true, mutatedMap: false, planId: plan.planId, featureKeys: store.get(key) };
    }
    store.set(key, plan.stableFeatureKeys || []);
    return { success: true, skippedDuplicate: false, mutatedMap: true, planId: plan.planId, featureKeys: plan.stableFeatureKeys || [] };
  };
}

describe('TaskGraph orchestrator V1', () => {
  it('normalizes ObjectiveSpec from existing parser', () => {
    const spec = buildObjectiveSpecFromPrompt(PROMPT);
    assert.equal(spec.operation, 'WITHIN');
    assert.equal(spec.datasetId, DATASET_IDS.FIRE_STATIONS);
    assert.equal(spec.distanceMeters, 3000);
    assert.match(spec.locationText, /997 de la Commune/i);
    assert.ok(spec.objectiveId);
  });

  it('validates TaskGraph schema and rejects cycles', () => {
    const spec = buildObjectiveSpecFromPrompt(PROMPT);
    const graph = buildDeterministicFireStationTaskGraph(spec);
    const valid = validateTaskGraphStructure(graph);
    assert.equal(valid.valid, true);
    assert.equal(graph.tasks.length, 3);
    assert.equal(graph.dependencies[0].type, DEPENDENCY_TYPES.HARD_SUCCESS);

    const cyclic = {
      ...graph,
      dependencies: [
        { taskId: TASK_IDS.AUTHORITATIVE_QUERY, dependsOn: TASK_IDS.EXECUTE_MAP_PLAN, type: DEPENDENCY_TYPES.HARD_SUCCESS },
        { taskId: TASK_IDS.EXECUTE_MAP_PLAN, dependsOn: TASK_IDS.AUTHORITATIVE_QUERY, type: DEPENDENCY_TYPES.HARD_SUCCESS }
      ]
    };
    assert.equal(validateTaskGraphStructure(cyclic).valid, false);
  });

  it('enforces task state transitions', () => {
    assert.equal(canTransitionTaskState(TASK_STATES.PLANNED, TASK_STATES.READY), true);
    assert.equal(canTransitionTaskState(TASK_STATES.SUCCEEDED, TASK_STATES.READY), false);
    assert.equal(evaluateDependency(DEPENDENCY_TYPES.HARD_SUCCESS, [TASK_STATES.SUCCEEDED]), true);
    assert.equal(evaluateDependency(DEPENDENCY_TYPES.HARD_SUCCESS, [TASK_STATES.FAILED]), false);
  });

  it('looks up provider-neutral capabilities and fails unavailable ones', () => {
    const capability = lookupCapability(CAPABILITY_AUTHORITATIVE_DATA_QUERY, '1.0.0');
    assert.ok(capability);
    assert.equal(capability.constraints.providerNeutral, true);
    assert.throws(() => assertCapabilityAvailable('NOT_A_CAPABILITY'), /Capability not registered/);
  });

  it('builds and validates MapActionPlan', () => {
    const mapResult = {
      supported: true,
      request: { action: 'WITHIN', datasetIds: [DATASET_IDS.FIRE_STATIONS], radiusMeters: 3000 },
      origin: { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude },
      features: [{ stationNumber: '12', latitude: 45.49, longitude: -73.64 }],
      summary: { matchedFeatures: 1 }
    };
    const taskResult = createTaskResult({
      resultId: 'res-1',
      graphId: 'g1',
      taskId: TASK_IDS.AUTHORITATIVE_QUERY,
      status: TASK_STATES.SUCCEEDED,
      output: { mapResult }
    });
    const plan = buildMapActionPlanFromMapResult(taskResult, { graphId: 'g1', sessionScope: 'g1' });
    const validation = validateMapActionPlan(plan, { sessionScope: 'g1', expectedResultVersion: 1, mapResultPayload: mapResult });
    assert.equal(validation.status, MAP_PLAN_VALIDATION.APPROVED);
    assert.ok(plan.actions.some((action) => action.type === 'ADD_FEATURES'));
  });

  it('rejects unauthorized and stale MapActionPlans with zero mutation', async () => {
    const badPlan = {
      schemaVersion: '9.9.9',
      planId: 'bad',
      actions: [{ actionId: 'a1', type: 'DELETE_LAYER' }],
      taskResultId: null
    };
    const validation = validateMapActionPlan(badPlan, {});
    assert.equal(validation.approved, false);
    let mutated = false;
    const upstream = createTaskResult({
      graphId: 'g1',
      taskId: TASK_IDS.BUILD_MAP_PLAN,
      status: TASK_STATES.SUCCEEDED,
      output: { plan: badPlan, validation }
    });
    const request = createTaskRequest({
      graphId: 'g1',
      taskId: TASK_IDS.EXECUTE_MAP_PLAN,
      capabilityId: 'MAP_ACTION_EXECUTOR',
      input: { upstreamResult: upstream }
    });
    await executeMapPlanExecutorWorker(request, {
      executeMapActionPlan: async () => {
        mutated = true;
        return { success: true, mutatedMap: true };
      }
    });
    assert.equal(mutated, false);
  });

  it('runs deterministic TaskGraph and matches legacy GIS result', async () => {
    const deps = mockDeps();
    const legacy = await buildMapFromPrompt(PROMPT, deps);
    const graphRun = await runDeterministicTaskGraph(PROMPT, {
      ...deps,
      executeMapActionPlan: mockExecutor()
    });
    const taskgraph = graphRun.mapResult;
    assert.equal(taskgraph.supported, legacy.supported);
    assert.equal(taskgraph.request.radiusMeters, legacy.request.radiusMeters);
    assert.equal(taskgraph.summary.matchedFeatures, legacy.summary.matchedFeatures);
    assert.deepEqual(
      taskgraph.features.map((f) => f.stationNumber).sort(),
      legacy.features.map((f) => f.stationNumber).sort()
    );
    assert.equal(graphRun.taskGraphReceipt.finalState, TASK_STATES.SUCCEEDED);
    assert.ok(graphRun.taskGraphReceipt.traceId);
    assert.equal(graphRun.taskReceipts.length, 3);
  });

  it('supports idempotent replay without duplicate execution side effects', async () => {
    const deps = mockDeps();
    const store = new Map();
    const executor = mockExecutor(store);
    const first = await runDeterministicTaskGraph(PROMPT, { ...deps, executeMapActionPlan: executor, sessionScope: 'replay-scope' });
    const second = await runDeterministicTaskGraph(PROMPT, { ...deps, executeMapActionPlan: executor, sessionScope: 'replay-scope' });
    assert.equal(first.mapExecutionReceipt.mutatedMap, true);
    assert.equal(second.mapExecutionReceipt.skippedDuplicate, true);
    assert.equal(second.mapExecutionReceipt.mutatedMap, false);
  });

  it('cancels graph and ignores late map mutation', async () => {
    const spec = buildObjectiveSpecFromPrompt(PROMPT);
    const graph = buildDeterministicFireStationTaskGraph(spec);
    const coordinator = new TaskGraphCoordinator(graph, {});
    coordinator.cancel();
    const planResult = createTaskResult({
      graphId: graph.graphId,
      taskId: TASK_IDS.BUILD_MAP_PLAN,
      status: TASK_STATES.SUCCEEDED,
      output: {
        plan: { planId: 'p1', planIdempotency: true, actions: [], mapResultPayload: { supported: true } },
        validation: { approved: true }
      }
    });
    const request = createTaskRequest({
      graphId: graph.graphId,
      taskId: TASK_IDS.EXECUTE_MAP_PLAN,
      capabilityId: 'MAP_ACTION_EXECUTOR',
      input: { upstreamResult: planResult }
    });
    let mutated = false;
    const result = await executeMapPlanExecutorWorker(request, {
      cancelled: true,
      executeMapActionPlan: async () => {
        mutated = true;
        return { success: true, mutatedMap: true };
      }
    });
    assert.equal(result.status, TASK_STATES.CANCELLED);
    assert.equal(mutated, false);
  });

  it('marks deterministic worker failure as FAILED not DEGRADED', async () => {
    const deps = {
      buildMapFromPrompt: async () => ({ supported: false, message: 'unsupported' })
    };
    const run = await runDeterministicTaskGraph(PROMPT, {
      ...deps,
      executeMapActionPlan: mockExecutor()
    });
    assert.equal(run.finalState, TASK_STATES.FAILED);
  });

  it('uses stable feature keys for updates', () => {
    const key = buildStableFeatureKey({ stationNumber: '12' }, { request: { datasetIds: ['FIRE_STATIONS'] } });
    assert.match(key, /fire_stations:12/);
    const idem = buildIdempotencyKey({
      capabilityId: CAPABILITY_AUTHORITATIVE_DATA_QUERY,
      normalizedInput: { prompt: PROMPT },
      sessionScope: 'scope-a'
    });
    assert.equal(idem, buildIdempotencyKey({
      capabilityId: CAPABILITY_AUTHORITATIVE_DATA_QUERY,
      normalizedInput: { prompt: PROMPT },
      sessionScope: 'scope-a'
    }));
  });

  it('keeps coordinator control-plane overhead under 150ms p95 with mocked worker', async () => {
    const deps = {
      buildMapFromPrompt: async () => ({
        supported: true,
        request: { action: 'WITHIN', datasetIds: [DATASET_IDS.FIRE_STATIONS], radiusMeters: 3000 },
        origin: ORIGIN,
        features: [],
        summary: { matchedFeatures: 0 }
      }),
      executeMapActionPlan: mockExecutor()
    };
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const run = await runDeterministicTaskGraph(PROMPT, { ...deps, sessionScope: `bench-${i}` });
      samples.push(run.coordinatorOverhead.p95Ms);
    }
    const p95 = samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];
    assert.ok(p95 <= 150, `coordinator p95 overhead ${p95}ms exceeds 150ms target`);
  });

  it('documents Phase 2 seam without implementing live path', () => {
    assert.equal(PHASE_2_SEAM.candidateStreamDependency, 'STREAM');
    assert.equal(PHASE_2_SEAM.governanceGateDependency, 'GATE');
    assert.match(PHASE_2_SEAM.attachPoint, /dispatchTask/);
  });
});
