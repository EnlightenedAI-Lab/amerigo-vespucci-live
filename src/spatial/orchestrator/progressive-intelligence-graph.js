/**
 * Phase 2 progressive intelligence TaskGraph builder.
 */
import { randomUUID } from 'node:crypto';
import {
  CAPABILITY_VERSION,
  DEPENDENCY_TYPES,
  TASK_STATES,
  buildIdempotencyKey,
  createTask,
  createTaskGraph
} from './contracts.js';

export const PROGRESSIVE_TASK_IDS = Object.freeze({
  CORPUS_SEARCH: 'task-corpus-search',
  LIVE_RETRIEVAL: 'task-live-retrieval',
  GOVERN_CANDIDATE: 'task-govern-candidate',
  GEOCODE: 'task-geocode',
  BUILD_MAP_PLAN: 'task-build-map-plan',
  EXECUTE_MAP_PLAN: 'task-execute-map-plan',
  ENRICH_DATA_VERSION: 'task-enrich-data-version'
});

export const PROGRESSIVE_CAPABILITIES = Object.freeze({
  CORPUS_SEARCH: 'CORPUS_SEARCH',
  LIVE_INTELLIGENCE_RETRIEVAL: 'LIVE_INTELLIGENCE_RETRIEVAL',
  GOVERN_CANDIDATE: 'GOVERN_CANDIDATE',
  GEOCODE_LOCATION: 'GEOCODE_LOCATION',
  MAP_ACTION_PLAN_BUILDER: 'MAP_ACTION_PLAN_BUILDER',
  MAP_ACTION_EXECUTOR: 'MAP_ACTION_EXECUTOR',
  DATA_VERSION_ENRICHMENT: 'DATA_VERSION_ENRICHMENT'
});

/**
 * @param {object} objectiveSpec
 * @param {object} [options]
 */
export function buildProgressiveIntelligenceTaskGraph(objectiveSpec, options = {}) {
  const graphId = options.graphId || randomUUID();
  const traceId = options.traceId || randomUUID();
  const sessionScope = options.sessionScope || graphId;
  const normalizedInput = {
    query: objectiveSpec.originalText,
    conceptId: objectiveSpec.conceptId,
    geography: objectiveSpec.geography,
    from: objectiveSpec.from,
    to: objectiveSpec.to
  };

  const tasks = [
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.CORPUS_SEARCH,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.CORPUS_SEARCH,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'corpus-search-worker',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.CORPUS_SEARCH,
        normalizedInput,
        sessionScope
      })
    }),
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.LIVE_RETRIEVAL,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.LIVE_INTELLIGENCE_RETRIEVAL,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'live-retrieval-worker',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.LIVE_INTELLIGENCE_RETRIEVAL,
        normalizedInput,
        sessionScope
      })
    }),
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.GOVERN_CANDIDATE,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.GOVERN_CANDIDATE,
      workerAgentId: 'agent2-governance-adapter',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.GOVERN_CANDIDATE,
        normalizedInput: { stream: true },
        sessionScope
      })
    }),
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.GEOCODE,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.GEOCODE_LOCATION,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'esri-geocode-worker',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.GEOCODE_LOCATION,
        normalizedInput: { stream: true },
        sessionScope
      })
    }),
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.BUILD_MAP_PLAN,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.MAP_ACTION_PLAN_BUILDER,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'map-plan-builder-worker',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.MAP_ACTION_PLAN_BUILDER,
        normalizedInput: { intelligence: true },
        sessionScope
      })
    }),
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.EXECUTE_MAP_PLAN,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.MAP_ACTION_EXECUTOR,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'arcgis-map-executor',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.MAP_ACTION_EXECUTOR,
        normalizedInput: { intelligence: true },
        sessionScope
      })
    }),
    createTask({
      taskId: PROGRESSIVE_TASK_IDS.ENRICH_DATA_VERSION,
      graphId,
      capabilityId: PROGRESSIVE_CAPABILITIES.DATA_VERSION_ENRICHMENT,
      capabilityVersion: CAPABILITY_VERSION,
      workerAgentId: 'data-version-enrichment-worker',
      idempotencyKey: buildIdempotencyKey({
        capabilityId: PROGRESSIVE_CAPABILITIES.DATA_VERSION_ENRICHMENT,
        normalizedInput: { enrich: true },
        sessionScope
      })
    })
  ];

  const dependencies = [
    {
      taskId: PROGRESSIVE_TASK_IDS.GOVERN_CANDIDATE,
      dependsOn: PROGRESSIVE_TASK_IDS.LIVE_RETRIEVAL,
      type: DEPENDENCY_TYPES.STREAM
    },
    {
      taskId: PROGRESSIVE_TASK_IDS.GEOCODE,
      dependsOn: PROGRESSIVE_TASK_IDS.GOVERN_CANDIDATE,
      type: DEPENDENCY_TYPES.GATE
    },
    {
      taskId: PROGRESSIVE_TASK_IDS.BUILD_MAP_PLAN,
      dependsOn: PROGRESSIVE_TASK_IDS.GEOCODE,
      type: DEPENDENCY_TYPES.HARD_SUCCESS
    },
    {
      taskId: PROGRESSIVE_TASK_IDS.EXECUTE_MAP_PLAN,
      dependsOn: PROGRESSIVE_TASK_IDS.BUILD_MAP_PLAN,
      type: DEPENDENCY_TYPES.GATE
    },
    {
      taskId: PROGRESSIVE_TASK_IDS.ENRICH_DATA_VERSION,
      dependsOn: PROGRESSIVE_TASK_IDS.LIVE_RETRIEVAL,
      type: DEPENDENCY_TYPES.DATA_VERSION
    },
    {
      taskId: PROGRESSIVE_TASK_IDS.ENRICH_DATA_VERSION,
      dependsOn: PROGRESSIVE_TASK_IDS.EXECUTE_MAP_PLAN,
      type: DEPENDENCY_TYPES.SOFT_COMPLETE
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

export { validateTaskGraphStructure } from './fire-station-graph.js';
