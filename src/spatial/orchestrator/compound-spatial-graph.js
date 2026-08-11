/**
 * Typed TaskGraph for compound spatial objectives.
 */
import { randomUUID } from 'node:crypto';
import {
  createTaskGraph,
  createTask,
  TASK_STATES,
  DEPENDENCY_TYPES
} from './contracts.js';

export const COMPOUND_TASK_CAPABILITIES = Object.freeze({
  INTELLIGENCE_RESEARCH: 'INTELLIGENCE_RESEARCH',
  GOVERN_CANDIDATE: 'GOVERN_CANDIDATE',
  GEOCODE_GOVERNED_EVENT: 'GEOCODE_GOVERNED_EVENT',
  REFERENCE_DATA_RESOLUTION: 'REFERENCE_DATA_RESOLUTION',
  SPATIAL_PROXIMITY: 'SPATIAL_PROXIMITY',
  MAP_ACTION: 'MAP_ACTION'
});

/**
 * @param {object} compoundSpec
 * @param {object} context
 */
export function buildCompoundSpatialTaskGraph(compoundSpec = {}, context = {}) {
  const graphId = context.graphId || randomUUID();
  const traceId = context.traceId || graphId;
  const tasks = [
    createTask({
      taskId: 'compound-intelligence-research',
      graphId,
      capabilityId: COMPOUND_TASK_CAPABILITIES.INTELLIGENCE_RESEARCH,
      state: TASK_STATES.PLANNED
    }),
    createTask({
      taskId: 'compound-govern-candidate',
      graphId,
      capabilityId: COMPOUND_TASK_CAPABILITIES.GOVERN_CANDIDATE,
      state: TASK_STATES.WAITING
    }),
    createTask({
      taskId: 'compound-geocode-event',
      graphId,
      capabilityId: COMPOUND_TASK_CAPABILITIES.GEOCODE_GOVERNED_EVENT,
      state: TASK_STATES.WAITING
    }),
    createTask({
      taskId: 'compound-reference-data',
      graphId,
      capabilityId: COMPOUND_TASK_CAPABILITIES.REFERENCE_DATA_RESOLUTION,
      state: TASK_STATES.READY
    }),
    createTask({
      taskId: 'compound-spatial-proximity',
      graphId,
      capabilityId: COMPOUND_TASK_CAPABILITIES.SPATIAL_PROXIMITY,
      state: TASK_STATES.WAITING
    }),
    createTask({
      taskId: 'compound-map-action',
      graphId,
      capabilityId: COMPOUND_TASK_CAPABILITIES.MAP_ACTION,
      state: TASK_STATES.WAITING
    })
  ];

  const dependencies = [
    {
      dependencyId: randomUUID(),
      graphId,
      fromTaskId: 'compound-intelligence-research',
      toTaskId: 'compound-govern-candidate',
      type: DEPENDENCY_TYPES.STREAM
    },
    {
      dependencyId: randomUUID(),
      graphId,
      fromTaskId: 'compound-govern-candidate',
      toTaskId: 'compound-geocode-event',
      type: DEPENDENCY_TYPES.HARD_SUCCESS
    },
    {
      dependencyId: randomUUID(),
      graphId,
      fromTaskId: 'compound-reference-data',
      toTaskId: 'compound-spatial-proximity',
      type: DEPENDENCY_TYPES.HARD_SUCCESS
    },
    {
      dependencyId: randomUUID(),
      graphId,
      fromTaskId: 'compound-geocode-event',
      toTaskId: 'compound-spatial-proximity',
      type: DEPENDENCY_TYPES.HARD_SUCCESS
    },
    {
      dependencyId: randomUUID(),
      graphId,
      fromTaskId: 'compound-spatial-proximity',
      toTaskId: 'compound-map-action',
      type: DEPENDENCY_TYPES.HARD_SUCCESS
    }
  ];

  return createTaskGraph({
    graphId,
    objectiveId: compoundSpec.objectiveId || randomUUID(),
    traceId,
    tasks,
    dependencies,
    compoundSpec
  });
}
