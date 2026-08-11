/**
 * Deterministic fire-station vertical slice TaskGraph builder.
 */
import { randomUUID } from 'node:crypto';
import {
  CAPABILITY_AUTHORITATIVE_DATA_QUERY,
  CAPABILITY_VERSION,
  DEPENDENCY_TYPES,
  TASK_STATES,
  buildIdempotencyKey,
  createTask,
  createTaskGraph
} from './contracts.js';

export const TASK_IDS = Object.freeze({
  AUTHORITATIVE_QUERY: 'task-authoritative-query',
  BUILD_MAP_PLAN: 'task-build-map-plan',
  EXECUTE_MAP_PLAN: 'task-execute-map-plan'
});

/**
 * @param {object} objectiveSpec
 * @param {object} [options]
 */
export function buildDeterministicFireStationTaskGraph(objectiveSpec, options = {}) {
  const graphId = options.graphId || randomUUID();
  const traceId = options.traceId || randomUUID();
  const sessionScope = options.sessionScope || graphId;
  const normalizedInput = {
    prompt: objectiveSpec.originalText,
    operation: objectiveSpec.operation,
    datasetId: objectiveSpec.datasetId,
    locationText: objectiveSpec.locationText,
    distanceMeters: objectiveSpec.distanceMeters
  };
  const queryKey = buildIdempotencyKey({
    capabilityId: CAPABILITY_AUTHORITATIVE_DATA_QUERY,
    capabilityVersion: CAPABILITY_VERSION,
    normalizedInput,
    sessionScope
  });
  const planKey = buildIdempotencyKey({
    capabilityId: 'MAP_ACTION_PLAN_BUILDER',
    capabilityVersion: CAPABILITY_VERSION,
    normalizedInput: { fromTask: TASK_IDS.AUTHORITATIVE_QUERY },
    sessionScope
  });
  const executeKey = buildIdempotencyKey({
    capabilityId: 'MAP_ACTION_EXECUTOR',
    capabilityVersion: CAPABILITY_VERSION,
    normalizedInput: { fromTask: TASK_IDS.BUILD_MAP_PLAN },
    sessionScope
  });

  const tasks = [
    createTask({
      taskId: TASK_IDS.AUTHORITATIVE_QUERY,
      graphId,
      capabilityId: CAPABILITY_AUTHORITATIVE_DATA_QUERY,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'deterministic-gis-worker',
      state: TASK_STATES.PLANNED,
      idempotencyKey: queryKey,
      inputRef: { objectiveId: objectiveSpec.objectiveId }
    }),
    createTask({
      taskId: TASK_IDS.BUILD_MAP_PLAN,
      graphId,
      capabilityId: 'MAP_ACTION_PLAN_BUILDER',
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'map-plan-builder-worker',
      state: TASK_STATES.PLANNED,
      idempotencyKey: planKey
    }),
    createTask({
      taskId: TASK_IDS.EXECUTE_MAP_PLAN,
      graphId,
      capabilityId: 'MAP_ACTION_EXECUTOR',
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'arcgis-map-executor',
      state: TASK_STATES.PLANNED,
      idempotencyKey: executeKey
    })
  ];

  const dependencies = [
    {
      taskId: TASK_IDS.BUILD_MAP_PLAN,
      dependsOn: TASK_IDS.AUTHORITATIVE_QUERY,
      type: DEPENDENCY_TYPES.HARD_SUCCESS
    },
    {
      taskId: TASK_IDS.EXECUTE_MAP_PLAN,
      dependsOn: TASK_IDS.BUILD_MAP_PLAN,
      type: DEPENDENCY_TYPES.GATE
    }
  ];

  return createTaskGraph({
    graphId,
    objectiveId: objectiveSpec.objectiveId,
    traceId,
    tasks,
    dependencies
  });
}

/**
 * @param {object} graph
 */
export function validateTaskGraphStructure(graph = {}) {
  const issues = [];
  if (!graph.graphId) issues.push('MISSING_GRAPH_ID');
  if (!graph.tasks?.length) issues.push('EMPTY_TASK_LIST');
  const taskIds = new Set((graph.tasks || []).map((task) => task.taskId));
  for (const dep of graph.dependencies || []) {
    if (!taskIds.has(dep.taskId) || !taskIds.has(dep.dependsOn)) {
      issues.push('INVALID_DEPENDENCY_REFERENCE');
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const adjacency = new Map();
  for (const dep of graph.dependencies || []) {
    if (!adjacency.has(dep.taskId)) adjacency.set(dep.taskId, []);
    adjacency.get(dep.taskId).push(dep.dependsOn);
  }
  function dfs(node) {
    if (visiting.has(node)) {
      issues.push('CYCLIC_GRAPH');
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const parent of adjacency.get(node) || []) dfs(parent);
    visiting.delete(node);
    visited.add(node);
  }
  for (const taskId of taskIds) dfs(taskId);
  return { valid: issues.length === 0, issues };
}
