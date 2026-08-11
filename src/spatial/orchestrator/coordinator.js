/**
 * In-process IQAI Coordinator — TaskGraph runner (Phase 1).
 */
import { createSpatialLatencyTrace } from '../spatial-latency-trace.js';
import {
  CAPABILITY_AUTHORITATIVE_DATA_QUERY,
  createMilestoneEvent,
  createTaskGraphReceipt,
  createTaskReceipt,
  createTaskRequest,
  MILESTONE_TYPES,
  TASK_STATES
} from './contracts.js';
import { assertCapabilityAvailable } from './capability-registry.js';
import { buildObjectiveSpecFromPrompt } from './objective-spec.js';
import {
  buildDeterministicFireStationTaskGraph,
  TASK_IDS,
  validateTaskGraphStructure
} from './fire-station-graph.js';
import {
  assertTaskStateTransition,
  evaluateDependency,
  isTerminalTaskState
} from './task-state-machine.js';
import { WORKER_DISPATCH } from './workers.js';

/**
 * @param {object} graph
 */
export class TaskGraphCoordinator {
  constructor(graph, options = {}) {
    this.graph = graph;
    this.options = options;
    this.tasks = new Map((graph.tasks || []).map((task) => [task.taskId, { ...task }]));
    this.dependencies = graph.dependencies || [];
    this.results = new Map();
    this.receipts = [];
    this.events = [];
    this.cancelled = false;
    this.idempotencyStore = options.idempotencyStore || new Map();
    this.overheadSamples = [];
    this.trace = options.trace || createSpatialLatencyTrace(graph.traceId, { strategy: 'DETERMINISTIC_GIS' });
    this.milestones = [];
  }

  recordOverhead(label, startedAt) {
    this.overheadSamples.push({ label, durationMs: Date.now() - startedAt });
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  setTaskState(taskId, nextState) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    assertTaskStateTransition(task, nextState);
    task.state = nextState;
    task.updatedAt = new Date().toISOString();
    this.events.push({
      type: 'TASK_STATE',
      taskId,
      state: nextState,
      at: new Date().toISOString()
    });
  }

  evaluateReadiness(taskId) {
    const deps = this.dependencies.filter((dep) => dep.taskId === taskId);
    if (!deps.length) return true;
    return deps.every((dep) => {
      const parent = this.tasks.get(dep.dependsOn);
      return evaluateDependency(dep.type, [parent?.state]);
    });
  }

  validateGraph() {
    const started = Date.now();
    const validation = validateTaskGraphStructure(this.graph);
    this.recordOverhead('graph_validation', started);
    if (!validation.valid) {
      const err = new Error(validation.issues.join(', '));
      err.code = 'INVALID_TASK_GRAPH';
      throw err;
    }
    for (const task of this.tasks.values()) {
      assertCapabilityAvailable(task.capabilityId, task.capabilityVersion);
    }
    return validation;
  }

  cancel() {
    this.cancelled = true;
    for (const task of this.tasks.values()) {
      if (!isTerminalTaskState(task.state)) {
        this.setTaskState(task.taskId, TASK_STATES.CANCELLED);
      }
    }
    this.events.push({ type: 'GRAPH_CANCELLED', at: new Date().toISOString() });
  }

  /**
   * @param {object} task
   * @param {object} deps
   */
  async dispatchTask(task, deps = {}) {
    if (this.cancelled) {
      this.setTaskState(task.taskId, TASK_STATES.CANCELLED);
      return null;
    }
    const cached = this.idempotencyStore.get(task.idempotencyKey);
    if (cached?.result) {
      this.results.set(task.taskId, cached.result);
      this.setTaskState(task.taskId, cached.result.status);
      return cached.result;
    }

    const lookupStarted = Date.now();
    const worker = WORKER_DISPATCH[task.capabilityId];
    this.recordOverhead('registry_lookup', lookupStarted);
    if (!worker) {
      this.setTaskState(task.taskId, TASK_STATES.FAILED);
      return null;
    }

    this.setTaskState(task.taskId, TASK_STATES.RUNNING);
    const attempt = (task.attempt || 0) + 1;
    task.attempt = attempt;
    const request = createTaskRequest({
      graphId: this.graph.graphId,
      taskId: task.taskId,
      traceId: this.graph.traceId,
      attempt,
      idempotencyKey: task.idempotencyKey,
      capabilityId: task.capabilityId,
      capabilityVersion: task.capabilityVersion,
      input: deps.taskInput || {}
    });

    const dispatchStarted = Date.now();
    const result = await worker(request, {
      ...deps,
      cancelled: this.cancelled,
      idempotencyStore: this.idempotencyStore
    });
    this.recordOverhead('task_dispatch', dispatchStarted);
    this.results.set(task.taskId, result);
    this.idempotencyStore.set(task.idempotencyKey, { result, receiptId: result.resultId });
    this.setTaskState(task.taskId, result.status);

    this.receipts.push(createTaskReceipt({
      graphId: this.graph.graphId,
      taskId: task.taskId,
      traceId: this.graph.traceId,
      attempt,
      state: result.status,
      capabilityId: task.capabilityId,
      workerAgentId: task.workerAgentId,
      latencyMs: result.latencyMs,
      idempotencyKey: task.idempotencyKey,
      resultId: result.resultId,
      resultVersion: result.resultVersion,
      events: [{ type: 'COMPLETED', at: new Date().toISOString() }]
    }));
    return result;
  }

  recordMilestone(milestone, status = 'REACHED', taskId = null) {
    const event = createMilestoneEvent({
      milestone,
      status,
      graphId: this.graph.graphId,
      taskId,
      traceId: this.graph.traceId
    });
    this.milestones.push(event);
    return event;
  }

  async run(deps = {}) {
    const coordinatorStarted = Date.now();
    this.validateGraph();
    const stopAfterTaskId = deps.stopAfterTaskId || null;

    for (const task of this.tasks.values()) {
      this.setTaskState(task.taskId, TASK_STATES.WAITING);
      if (this.evaluateReadiness(task.taskId)) {
        this.setTaskState(task.taskId, TASK_STATES.READY);
      }
    }

    const executionOrder = [
      TASK_IDS.AUTHORITATIVE_QUERY,
      TASK_IDS.BUILD_MAP_PLAN,
      TASK_IDS.EXECUTE_MAP_PLAN
    ];

    let queryResult = null;
    let planResult = null;
    let executeResult = null;

    for (const taskId of executionOrder) {
      if (this.cancelled) break;
      const task = this.getTask(taskId);
      if (!this.evaluateReadiness(taskId)) {
        this.setTaskState(taskId, TASK_STATES.SKIPPED);
        continue;
      }
      this.setTaskState(taskId, TASK_STATES.READY);

      if (taskId === TASK_IDS.AUTHORITATIVE_QUERY) {
        queryResult = await this.dispatchTask(task, {
          ...deps,
          taskInput: {
            prompt: deps.prompt,
            objectiveSpec: deps.objectiveSpec
          }
        });
        const mapResult = queryResult?.output?.mapResult;
        if (mapResult?.supported && (mapResult.features?.length || mapResult.summary?.matchedFeatures)) {
          this.recordMilestone(MILESTONE_TYPES.FIRST_MAPPABLE_EVENT, 'REACHED', taskId);
        } else {
          this.recordMilestone(MILESTONE_TYPES.FIRST_SOURCE, 'NOT_APPLICABLE', taskId);
          this.recordMilestone(MILESTONE_TYPES.FIRST_CANDIDATE, 'NOT_APPLICABLE', taskId);
          this.recordMilestone(MILESTONE_TYPES.FIRST_GOVERNED_EVENT, 'NOT_APPLICABLE', taskId);
        }
        if (queryResult?.status !== TASK_STATES.SUCCEEDED) break;
      }

      if (taskId === TASK_IDS.BUILD_MAP_PLAN) {
        planResult = await this.dispatchTask(task, {
          ...deps,
          taskInput: {
            upstreamResult: queryResult,
            sessionScope: this.graph.graphId
          }
        });
        if (planResult?.status !== TASK_STATES.SUCCEEDED) break;
        if (stopAfterTaskId === TASK_IDS.BUILD_MAP_PLAN) break;
      }

      if (taskId === TASK_IDS.EXECUTE_MAP_PLAN) {
        executeResult = await this.dispatchTask(task, {
          ...deps,
          taskInput: {
            upstreamResult: planResult,
            sessionScope: this.graph.graphId
          }
        });
        if (executeResult?.output?.receipt?.success) {
          this.recordMilestone(MILESTONE_TYPES.FIRST_RENDERED_FEATURE, 'REACHED', taskId);
          this.recordMilestone(MILESTONE_TYPES.INITIAL_LAYER_READY, 'REACHED', taskId);
        }
      }
    }

    const overheadMs = this.overheadSamples.reduce((sum, sample) => sum + sample.durationMs, 0);
    this.recordOverhead('graph_completion', coordinatorStarted);

    const terminalStates = [...this.tasks.values()].map((task) => task.state);
    const finalState = this.cancelled
      ? TASK_STATES.CANCELLED
      : (terminalStates.every((state) => state === TASK_STATES.SUCCEEDED)
        ? TASK_STATES.SUCCEEDED
        : (terminalStates.some((state) => state === TASK_STATES.DEGRADED)
          ? TASK_STATES.DEGRADED
          : TASK_STATES.FAILED));

    const graphReceipt = createTaskGraphReceipt({
      graphId: this.graph.graphId,
      objectiveId: this.graph.objectiveId,
      traceId: this.graph.traceId,
      finalState,
      taskReceipts: this.receipts,
      milestones: this.milestones,
      coordinatorOverheadMs: overheadMs,
      cancelled: this.cancelled
    });

    return {
      graphId: this.graph.graphId,
      traceId: this.graph.traceId,
      finalState,
      cancelled: this.cancelled,
      queryResult,
      planResult,
      executeResult,
      mapResult: queryResult?.output?.mapResult || null,
      mapActionPlan: planResult?.output?.plan || null,
      mapExecutionReceipt: executeResult?.output?.receipt || null,
      taskGraphReceipt: graphReceipt,
      taskReceipts: this.receipts,
      milestones: this.milestones,
      events: this.events,
      coordinatorOverhead: {
        totalMs: overheadMs,
        samples: this.overheadSamples,
        p50Ms: percentile(this.overheadSamples.map((s) => s.durationMs), 50),
        p95Ms: percentile(this.overheadSamples.map((s) => s.durationMs), 95)
      },
      latencyTrace: this.trace.toPayload()
    };
  }
}

/**
 * @param {number[]} values
 * @param {number} p
 */
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/**
 * @param {string} prompt
 * @param {object} deps
 */
export async function runDeterministicTaskGraph(prompt, deps = {}) {
  const objectiveSpec = deps.objectiveSpec || buildObjectiveSpecFromPrompt(prompt, deps.context || {});
  const graph = deps.graph || buildDeterministicFireStationTaskGraph(objectiveSpec, {
    traceId: deps.traceId,
    sessionScope: deps.sessionScope
  });
  const coordinator = new TaskGraphCoordinator(graph, deps);
  const result = await coordinator.run({
    ...deps,
    prompt,
    objectiveSpec
  });
  return { objectiveSpec, graph, ...result };
}

/**
 * Phase 2 seam documentation (not implemented):
 * Research worker emits partial CandidateEvent -> STREAM dependency ->
 * Agent 2 GovernCandidate -> AdmissionDecision -> GATE -> geocode ->
 * MapActionPlan patch -> first rendered feature -> DATA_VERSION enrichments.
 */
export const PHASE_2_SEAM = Object.freeze({
  candidateStreamDependency: 'STREAM',
  governanceGateDependency: 'GATE',
  enrichmentPatchDependency: 'DATA_VERSION',
  attachPoint: 'TaskGraphCoordinator.dispatchTask after MAP_ACTION_EXECUTOR'
});
