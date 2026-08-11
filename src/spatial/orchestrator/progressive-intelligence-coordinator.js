/**
 * Progressive intelligence TaskGraph coordinator — Phase 2 STREAM / GATE / DATA_VERSION.
 */
import { randomUUID } from 'node:crypto';
import { createSpatialLatencyTrace } from '../spatial-latency-trace.js';
import {
  createMilestoneEvent,
  createTaskGraphReceipt,
  createTaskReceipt,
  MILESTONE_TYPES,
  TASK_STATES
} from './contracts.js';
import { validateMapActionPlan } from './map-action-validator.js';
import { buildIntelligenceMapActionPlan } from './intelligence-map-action-plan-builder.js';
import {
  buildDataVersionPatch,
  buildIntelligenceFeatureKey,
  streamProgressiveResearch,
  PROGRESSIVE_VERTICAL_SLICE_QUERY
} from './progressive-research-stream.js';
import {
  buildProgressiveIntelligenceTaskGraph,
  validateTaskGraphStructure
} from './progressive-intelligence-graph.js';
import { assessEsriAiFeasibility } from './esri-ai-feasibility.js';
import { resolveResearchExecution } from '../intelligence-layer-research-contract.js';

/**
 * @param {object} request
 * @param {object} deps
 */
export async function runProgressiveIntelligenceGraph(request = {}, deps = {}) {
  const trace = deps.trace || createSpatialLatencyTrace(request.traceId || randomUUID(), {
    strategy: request.researchExecution === 'DEEP'
      ? 'PROGRESSIVE_INTELLIGENCE_DEEP'
      : 'PROGRESSIVE_INTELLIGENCE_FAST'
  });
  const execution = resolveResearchExecution(request);
  const started = Date.now();
  const overheadSamples = [];
  const milestones = [];
  const taskReceipts = [];
  const mappedFeatureKeys = new Set();
  const executionReceipts = [];
  const pendingMapPlans = [];
  let cancelled = Boolean(deps.cancelled);
  let firstRenderedAt = null;
  let enrichmentPatches = 0;

  const objectiveSpec = {
    objectiveId: randomUUID(),
    originalText: request.query || PROGRESSIVE_VERTICAL_SLICE_QUERY,
    conceptId: request.conceptId || 'fires',
    geography: request.geography || 'Greater Montréal',
    from: request.from,
    to: request.to,
    createdAt: new Date().toISOString()
  };

  const graph = buildProgressiveIntelligenceTaskGraph(objectiveSpec, {
    traceId: trace.traceId,
    sessionScope: deps.sessionScope || `prog:${trace.traceId}`
  });
  const validation = validateTaskGraphStructure(graph);
  if (!validation.valid) {
    const err = new Error(validation.issues.join(', '));
    err.code = 'INVALID_TASK_GRAPH';
    throw err;
  }

  function recordMilestone(milestone, status = 'REACHED', taskId = null) {
    const event = createMilestoneEvent({
      milestone,
      status,
      graphId: graph.graphId,
      taskId,
      traceId: trace.traceId
    });
    milestones.push(event);
    return event;
  }

  function recordReceipt(taskId, capabilityId, state, latencyMs, extra = {}) {
    const receipt = createTaskReceipt({
      graphId: graph.graphId,
      taskId,
      traceId: trace.traceId,
      state,
      capabilityId,
      latencyMs,
      ...extra
    });
    taskReceipts.push(receipt);
    return receipt;
  }

  const sessionScope = deps.sessionScope || graph.graphId;
  const layerId = deps.layerId || `iqai-intelligence-${request.conceptId || 'fires'}`;

  const streamResult = await (deps.streamProgressiveResearch || streamProgressiveResearch)(request, {
    onFirstSource: () => recordMilestone(MILESTONE_TYPES.FIRST_SOURCE, 'REACHED'),
    onFirstCandidate: () => recordMilestone(MILESTONE_TYPES.FIRST_CANDIDATE, 'REACHED'),
    onFirstGoverned: () => recordMilestone(MILESTONE_TYPES.FIRST_GOVERNED_EVENT, 'REACHED'),
    onFirstMappable: () => recordMilestone(MILESTONE_TYPES.FIRST_MAPPABLE_EVENT, 'REACHED'),
    onAdmittedCandidate: async (governed) => {
      if (cancelled) return;
      const governStarted = Date.now();
      recordReceipt('task-govern-candidate', 'GOVERN_CANDIDATE', TASK_STATES.SUCCEEDED, Date.now() - governStarted);

      const geocodeStarted = Date.now();
      const candidate = governed.candidate;
      if (!candidate.mappable || !candidate.geometry) {
        recordReceipt('task-geocode', 'GEOCODE_LOCATION', TASK_STATES.FAILED, Date.now() - geocodeStarted);
        return;
      }
      recordReceipt('task-geocode', 'GEOCODE_LOCATION', TASK_STATES.SUCCEEDED, Date.now() - geocodeStarted);

      const featureKey = buildIntelligenceFeatureKey(governed, sessionScope);
      const isUpdate = mappedFeatureKeys.has(featureKey);
      await deps.onGovernedMappableEvent?.(governed, { featureKey, isUpdate, sessionScope });

      const plan = buildIntelligenceMapActionPlan(governed, {
        graphId: graph.graphId,
        sessionScope,
        layerId,
        conceptId: request.conceptId,
        existingFeatureKeys: mappedFeatureKeys
      });

      const planValidation = validateMapActionPlan(plan, {
        sessionScope,
        expectedResultVersion: governed.governedEventVersion || 1,
        mapResultPayload: plan.mapResultPayload
      });
      if (!planValidation.approved) {
        recordReceipt('task-build-map-plan', 'MAP_ACTION_PLAN_BUILDER', TASK_STATES.FAILED, 0);
        return;
      }
      recordReceipt('task-build-map-plan', 'MAP_ACTION_PLAN_BUILDER', TASK_STATES.SUCCEEDED, 0);
      pendingMapPlans.push(plan);

      const executeMapActionPlan = deps.executeMapActionPlan;
      if (!executeMapActionPlan) {
        mappedFeatureKeys.add(featureKey);
        if (!firstRenderedAt) {
          recordMilestone(MILESTONE_TYPES.FIRST_MAPPABLE_EVENT, 'REACHED');
        }
        await deps.onMapPlanReady?.({ governed, plan, isUpdate });
        return;
      }
      if (cancelled) return;

      const execStarted = Date.now();
      const receipt = await executeMapActionPlan(plan, {
        graphId: graph.graphId,
        traceId: trace.traceId,
        idempotencyKey: plan.planId,
        idempotencyStore: deps.idempotencyStore,
        cancelled
      });
      const execLatency = Date.now() - execStarted;
      executionReceipts.push(receipt);

      if (receipt?.mutatedMap && !firstRenderedAt) {
        firstRenderedAt = Date.now();
        recordMilestone(MILESTONE_TYPES.FIRST_RENDERED_FEATURE, 'REACHED');
        recordMilestone(MILESTONE_TYPES.INITIAL_LAYER_READY, 'REACHED');
        trace.mark('firstRenderedFeature');
      } else if (receipt?.mutatedMap && isUpdate) {
        enrichmentPatches += 1;
      }

      if (receipt?.success !== false) {
        mappedFeatureKeys.add(featureKey);
      }
      recordReceipt('task-execute-map-plan', 'MAP_ACTION_EXECUTOR',
        receipt?.success === false ? TASK_STATES.FAILED : TASK_STATES.SUCCEEDED, execLatency);

      await deps.onMapExecution?.({ governed, plan, receipt, isUpdate });
    },
    onHeldOrRejected: async () => {
      /* diagnostics only */
    }
  }, { ...deps, trace, signal: deps.abortSignal, runStartedAt: started });

  cancelled = cancelled || streamResult.cancelled;

  if (enrichmentPatches > 0 || mappedFeatureKeys.size > 0) {
    recordMilestone(MILESTONE_TYPES.ENRICHMENT_COMPLETE, 'REACHED');
  } else {
    recordMilestone(MILESTONE_TYPES.ENRICHMENT_COMPLETE, 'NOT_APPLICABLE');
  }

  recordReceipt('task-corpus-search', 'CORPUS_SEARCH', TASK_STATES.SUCCEEDED, streamResult.metrics.corpusLatencyMs);
  recordReceipt('task-live-retrieval', 'LIVE_INTELLIGENCE_RETRIEVAL',
    streamResult.liveResult?.error && !streamResult.admittedEventIds?.length
      ? TASK_STATES.FAILED
      : (streamResult.liveResult?.partialFailure || streamResult.liveResult?.error || streamResult.coverage?.degradedReasonCodes?.length)
        ? TASK_STATES.DEGRADED
        : TASK_STATES.SUCCEEDED,
    streamResult.metrics.liveLatencyMs);

  const hasUsefulResults = mappedFeatureKeys.size > 0 || pendingMapPlans.length > 0;
  const isDegraded = Boolean(
    streamResult.coverage?.degradedReasonCodes?.length
    || streamResult.liveResult?.partialFailure
    || streamResult.liveResult?.fallbackUsed
    || (streamResult.liveResult?.error && hasUsefulResults)
  );

  const finalState = cancelled
    ? TASK_STATES.CANCELLED
    : hasUsefulResults
      ? (isDegraded ? TASK_STATES.DEGRADED : TASK_STATES.SUCCEEDED)
      : TASK_STATES.FAILED;

  const coordinatorOverheadMs = overheadSamples.reduce((sum, s) => sum + s.durationMs, 0);
  const taskGraphReceipt = createTaskGraphReceipt({
    graphId: graph.graphId,
    objectiveId: objectiveSpec.objectiveId,
    traceId: trace.traceId,
    finalState,
    taskReceipts,
    milestones,
    coordinatorOverheadMs,
    cancelled
  });

  const timeToFirstRenderedFeatureMs = firstRenderedAt ? firstRenderedAt - started : null;

  return {
    ok: pendingMapPlans.length > 0 || mappedFeatureKeys.size > 0,
    graph,
    objectiveSpec,
    finalState,
    cancelled,
    mappedFeatureKeys: [...mappedFeatureKeys],
    mappedCount: mappedFeatureKeys.size,
    pendingMapPlans,
    enrichmentPatches,
    taskGraphReceipt,
    taskReceipts,
    milestones,
    executionReceipts,
    streamResult,
    coverage: streamResult.coverage || null,
    selectionPlan: streamResult.selectionPlan || null,
    esriAiFeasibility: assessEsriAiFeasibility(),
    performance: {
      execution,
      totalMs: Date.now() - started,
      timeToFirstRenderedFeatureMs,
      timeToInitialLayerReadyMs: timeToFirstRenderedFeatureMs,
      totalEnrichmentMs: enrichmentPatches > 0 ? Date.now() - started : null,
      coordinatorOverheadMs,
      corpusLatencyMs: streamResult.metrics.corpusLatencyMs,
      liveRetrievalLatencyMs: streamResult.metrics.liveLatencyMs,
      providerSelectionLatencyMs: streamResult.metrics.providerSelectionLatencyMs,
      selectedProvider: streamResult.metrics.selectedProvider,
      fallbackUsed: streamResult.metrics.fallbackUsed,
      agent2RestLatencyMs: streamResult.metrics.agent2RestLatencyMs,
      agent2InternalLatencyMs: streamResult.metrics.agent2InternalLatencyMs,
      timeToFirstProviderByteMs: streamResult.metrics.timeToFirstProviderByteMs,
      timeToFirstValidSourceMs: streamResult.metrics.timeToFirstValidSourceMs,
      timeToFirstSourceMs: streamResult.metrics.timeToFirstSourceMs,
      timeToFirstCandidateMs: streamResult.metrics.timeToFirstCandidateMs,
      timeToFirstGovernedEventMs: streamResult.metrics.timeToFirstGovernedEventMs,
      timeToFirstGeocodedEventMs: streamResult.metrics.timeToFirstGeocodedEventMs,
      timeToFirstMappableEventMs: streamResult.metrics.timeToFirstMappableEventMs,
      firstSourceAt: streamResult.metrics.firstSourceAt,
      firstCandidateAt: streamResult.metrics.firstCandidateAt,
      firstGovernedAt: streamResult.metrics.firstGovernedAt,
      firstMappableAt: streamResult.metrics.firstMappableAt,
      firstRenderedAt
    },
    latencyTrace: trace.toPayload(),
    traceId: trace.traceId
  };
}

export { PROGRESSIVE_VERTICAL_SLICE_QUERY, buildDataVersionPatch };
