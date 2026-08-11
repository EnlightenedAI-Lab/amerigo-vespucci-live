/**
 * IQAI Spatial Multi-Agent Orchestrator — V1 contracts (Phase 0).
 */
import { randomUUID, createHash } from 'node:crypto';

export const ORCHESTRATOR_SCHEMA_VERSION = '1.0.0';
export const CAPABILITY_AUTHORITATIVE_DATA_QUERY = 'AUTHORITATIVE_DATA_QUERY';
export const CAPABILITY_VERSION = '1.0.0';

export const TASK_STATES = Object.freeze({
  PLANNED: 'PLANNED',
  WAITING: 'WAITING',
  READY: 'READY',
  RUNNING: 'RUNNING',
  PARTIAL: 'PARTIAL',
  SUCCEEDED: 'SUCCEEDED',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SKIPPED: 'SKIPPED'
});

export const TERMINAL_TASK_STATES = new Set([
  TASK_STATES.SUCCEEDED,
  TASK_STATES.DEGRADED,
  TASK_STATES.FAILED,
  TASK_STATES.CANCELLED,
  TASK_STATES.SKIPPED
]);

export const DEPENDENCY_TYPES = Object.freeze({
  HARD_SUCCESS: 'HARD_SUCCESS',
  ANY_SUCCESS: 'ANY_SUCCESS',
  SOFT_COMPLETE: 'SOFT_COMPLETE',
  STREAM: 'STREAM',
  GATE: 'GATE',
  DATA_VERSION: 'DATA_VERSION'
});

export const MAP_ACTION_TYPES = Object.freeze({
  CREATE_LAYER: 'CREATE_LAYER',
  ADD_FEATURES: 'ADD_FEATURES',
  UPDATE_FEATURES: 'UPDATE_FEATURES',
  STYLE_BY_CATEGORY: 'STYLE_BY_CATEGORY',
  LABEL: 'LABEL',
  FILTER: 'FILTER',
  ZOOM: 'ZOOM',
  HIGHLIGHT: 'HIGHLIGHT',
  SELECT: 'SELECT'
});

export const MAP_PLAN_VALIDATION = Object.freeze({
  APPROVED: 'APPROVED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  REJECTED: 'REJECTED',
  STALE: 'STALE'
});

export const MILESTONE_TYPES = Object.freeze({
  FIRST_SOURCE: 'FIRST_SOURCE',
  FIRST_CANDIDATE: 'FIRST_CANDIDATE',
  FIRST_GOVERNED_EVENT: 'FIRST_GOVERNED_EVENT',
  FIRST_MAPPABLE_EVENT: 'FIRST_MAPPABLE_EVENT',
  FIRST_RENDERED_FEATURE: 'FIRST_RENDERED_FEATURE',
  INITIAL_LAYER_READY: 'INITIAL_LAYER_READY',
  ENRICHMENT_COMPLETE: 'ENRICHMENT_COMPLETE',
  AUTHORITATIVE_LAYER_READY: 'AUTHORITATIVE_LAYER_READY',
  FIRST_SPATIAL_FACT: 'FIRST_SPATIAL_FACT',
  ANALYTICAL_MAP_READY: 'ANALYTICAL_MAP_READY',
  NOT_APPLICABLE: 'NOT_APPLICABLE'
});

/**
 * @param {object} spec
 */
export function createObjectiveSpec(spec = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    objectiveId: spec.objectiveId || randomUUID(),
    originalText: String(spec.originalText || ''),
    intent: spec.intent || null,
    geography: spec.geography || 'Greater Montréal',
    locationText: spec.locationText || null,
    operation: spec.operation || null,
    datasetId: spec.datasetId || null,
    distanceMeters: spec.distanceMeters ?? null,
    units: spec.units || 'meters',
    mapSessionId: spec.mapSessionId || null,
    actorId: spec.actorId || null,
    createdAt: spec.createdAt || new Date().toISOString(),
    parserRef: spec.parserRef || null
  };
}

/**
 * @param {object} graph
 */
export function createTaskGraph(graph = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    graphId: graph.graphId || randomUUID(),
    objectiveId: graph.objectiveId,
    traceId: graph.traceId || randomUUID(),
    tasks: Array.isArray(graph.tasks) ? graph.tasks : [],
    dependencies: Array.isArray(graph.dependencies) ? graph.dependencies : [],
    createdAt: graph.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} task
 */
export function createTask(task = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    taskId: task.taskId || randomUUID(),
    graphId: task.graphId,
    capabilityId: task.capabilityId,
    capabilityVersion: task.capabilityVersion || CAPABILITY_VERSION,
    workerAgentId: task.workerAgentId || null,
    state: task.state || TASK_STATES.PLANNED,
    attempt: task.attempt || 0,
    maxAttempts: task.maxAttempts ?? 2,
    idempotencyKey: task.idempotencyKey || null,
    deadlineMs: task.deadlineMs ?? null,
    inputRef: task.inputRef || null,
    resultRef: task.resultRef || null,
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString()
  };
}

/**
 * @param {object} request
 */
export function createTaskRequest(request = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    requestId: request.requestId || randomUUID(),
    graphId: request.graphId,
    taskId: request.taskId,
    traceId: request.traceId,
    attempt: request.attempt || 1,
    idempotencyKey: request.idempotencyKey,
    capabilityId: request.capabilityId,
    capabilityVersion: request.capabilityVersion || CAPABILITY_VERSION,
    input: request.input || {},
    deadlineAt: request.deadlineAt || null,
    createdAt: request.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} result
 */
export function createTaskResult(result = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    resultId: result.resultId || randomUUID(),
    resultVersion: result.resultVersion || 1,
    graphId: result.graphId,
    taskId: result.taskId,
    traceId: result.traceId,
    attempt: result.attempt || 1,
    status: result.status || TASK_STATES.SUCCEEDED,
    output: result.output || null,
    outputRef: result.outputRef || null,
    error: result.error || null,
    latencyMs: result.latencyMs ?? null,
    immutable: true,
    createdAt: result.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} error
 */
export function createTaskError(error = {}) {
  return {
    code: error.code || 'TASK_ERROR',
    message: String(error.message || 'Task failed'),
    retryable: Boolean(error.retryable),
    details: error.details || null
  };
}

/**
 * @param {object} receipt
 */
export function createTaskReceipt(receipt = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    receiptId: receipt.receiptId || randomUUID(),
    graphId: receipt.graphId,
    taskId: receipt.taskId,
    traceId: receipt.traceId,
    attempt: receipt.attempt || 1,
    state: receipt.state,
    capabilityId: receipt.capabilityId,
    workerAgentId: receipt.workerAgentId || null,
    latencyMs: receipt.latencyMs ?? null,
    idempotencyKey: receipt.idempotencyKey || null,
    resultId: receipt.resultId || null,
    resultVersion: receipt.resultVersion || null,
    events: receipt.events || [],
    createdAt: receipt.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} receipt
 */
export function createTaskGraphReceipt(receipt = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    receiptId: receipt.receiptId || randomUUID(),
    graphId: receipt.graphId,
    objectiveId: receipt.objectiveId,
    traceId: receipt.traceId,
    finalState: receipt.finalState,
    taskReceipts: receipt.taskReceipts || [],
    milestones: receipt.milestones || [],
    coordinatorOverheadMs: receipt.coordinatorOverheadMs ?? null,
    cancelled: Boolean(receipt.cancelled),
    createdAt: receipt.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} plan
 */
export function createMapActionPlan(plan = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    planId: plan.planId || randomUUID(),
    graphId: plan.graphId,
    taskResultId: plan.taskResultId,
    taskResultVersion: plan.taskResultVersion ?? 1,
    sessionScope: plan.sessionScope,
    actions: Array.isArray(plan.actions) ? plan.actions : [],
    mapResultRef: plan.mapResultRef || null,
    mapResultPayload: plan.mapResultPayload || null,
    stableFeatureKeys: plan.stableFeatureKeys || [],
    createdAt: plan.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} receipt
 */
export function createMapExecutionReceipt(receipt = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    receiptId: receipt.receiptId || randomUUID(),
    planId: receipt.planId,
    graphId: receipt.graphId,
    traceId: receipt.traceId,
    actionIds: receipt.actionIds || [],
    layerIds: receipt.layerIds || [],
    featureKeys: receipt.featureKeys || [],
    success: receipt.success !== false,
    skippedDuplicate: Boolean(receipt.skippedDuplicate),
    latencyMs: receipt.latencyMs ?? null,
    createdAt: receipt.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} event
 */
export function createMilestoneEvent(event = {}) {
  return {
    schemaVersion: ORCHESTRATOR_SCHEMA_VERSION,
    milestone: event.milestone,
    status: event.status || 'REACHED',
    graphId: event.graphId,
    taskId: event.taskId || null,
    traceId: event.traceId,
    atMs: event.atMs ?? Date.now(),
    createdAt: event.createdAt || new Date().toISOString()
  };
}

/**
 * @param {object} input
 */
export function buildIdempotencyKey(input = {}) {
  const payload = JSON.stringify({
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion || CAPABILITY_VERSION,
    normalizedInput: input.normalizedInput || {},
    sessionScope: input.sessionScope || null,
    policyVersion: input.policyVersion || ORCHESTRATOR_SCHEMA_VERSION
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * @param {object} feature
 * @param {object} mapResult
 */
export function buildStableFeatureKey(feature = {}, mapResult = {}) {
  const dataset = mapResult?.request?.datasetIds?.[0]
    || mapResult?.summary?.conceptId
    || 'DATASET';
  const identity = feature.stationNumber
    || feature.objectId
    || feature.id
    || feature.name
    || `${feature.latitude},${feature.longitude}`;
  return `${dataset}:${String(identity)}`.toLowerCase();
}
