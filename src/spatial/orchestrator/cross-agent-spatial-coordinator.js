/**
 * Phase 4 Cross-Agent Spatial Analysis coordinator.
 * Combines governed live intelligence + authoritative hospitals + deterministic proximity.
 */
import { randomUUID } from 'node:crypto';
import { createSpatialLatencyTrace } from '../spatial-latency-trace.js';
import {
  createTaskGraphReceipt,
  MILESTONE_TYPES,
  TASK_STATES
} from './contracts.js';
import { validateMapActionPlan } from './map-action-validator.js';
import { runProgressiveIntelligenceGraph } from './progressive-intelligence-coordinator.js';
import {
  computeHospitalProximityForEvent,
  loadAuthoritativeHospitals,
  DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M
} from './hospital-proximity-analysis.js';
import {
  computeReferenceProximityForEvent,
  loadAuthoritativeReferenceDataset
} from './reference-proximity-analysis.js';
import {
  parseCompoundSpatialObjective,
  isCompoundSpatialObjective
} from './compound-objective-parser.js';
import { buildCompoundSpatialTaskGraph } from './compound-spatial-graph.js';
import {
  buildAnalyticalMapActionPlan,
  buildAnalyticalMapUpdatePlan
} from './analytical-map-action-plan-builder.js';
import {
  buildCrossAgentAnalystExplanation,
  buildCrossAgentAnalysisSummary
} from './cross-agent-analyst-explanation.js';
import {
  factsForEventVersion,
  invalidateFactsForGeometryChange,
  SPATIAL_FACT_STATUS
} from './spatial-fact-contract.js';
import { ADMISSION_OUTCOME } from './intelligence-admission.js';
import { DATASET_IDS } from '../dataset-registry.js';

export const CROSS_AGENT_VERTICAL_SLICE_QUERY =
  'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and show which are within 2 km of hospitals.';

export function isCrossAgentVerticalSliceQuery(query = '') {
  return isCompoundSpatialObjective(query);
}

/**
 * @param {object} request
 * @param {object} deps
 */
export async function runCrossAgentSpatialAnalysis(request = {}, deps = {}) {
  const trace = deps.trace || createSpatialLatencyTrace(request.traceId || randomUUID(), {
    strategy: 'CROSS_AGENT_SPATIAL_ANALYSIS_V1'
  });
  const started = Date.now();
  const milestones = [];
  const spatialFacts = [];
  const analyticalPlans = [];
  const executionReceipts = [];
  const explanations = [];
  const governedEvents = [];
  let hospitalLoad = null;
  let hospitalLoadError = null;
  let authoritativeLayerReadyAt = null;
  let firstSpatialFactAt = null;
  let analyticalMapReadyAt = null;
  let firstMappedEventAt = null;
  let windowDays = 30;
  const compoundSpec = parseCompoundSpatialObjective(request.query || CROSS_AGENT_VERTICAL_SLICE_QUERY)
    || parseCompoundSpatialObjective(CROSS_AGENT_VERTICAL_SLICE_QUERY);
  const graph = buildCompoundSpatialTaskGraph(compoundSpec || {}, {
    graphId: deps.graphId || trace.traceId,
    traceId: trace.traceId
  });
  const referenceDatasetId = compoundSpec?.referenceDatasetId || DATASET_IDS.HOSPITALS;
  const referenceLayerId = compoundSpec?.referenceLayerId || 'iqai-analytical-hospitals';
  const proximityThresholdMeters = request.proximityThresholdMeters
    || compoundSpec?.thresholdMeters
    || DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M;

  function recordMilestone(milestone, status = 'REACHED') {
    milestones.push({
      milestone,
      status,
      atMs: Date.now() - started,
      traceId: trace.traceId
    });
  }

  const hospitalPromise = (deps.hospitalLoad
    ? Promise.resolve(deps.hospitalLoad)
    : loadAuthoritativeReferenceDataset(referenceDatasetId, deps)
  ).then((load) => {
    hospitalLoad = load;
    if (!authoritativeLayerReadyAt) {
      authoritativeLayerReadyAt = Date.now();
      recordMilestone(MILESTONE_TYPES.AUTHORITATIVE_LAYER_READY);
      trace.mark('authoritativeLayerReady');
    }
    return load;
  }).catch((error) => {
    hospitalLoadError = error;
    return null;
  });

  async function analyzeGovernedEvent(governed, { isUpdate = false } = {}) {
    const outcome = governed.admission?.outcome || governed.admissionDecision?.outcome;
    if (outcome !== ADMISSION_OUTCOME.ADMIT && outcome !== ADMISSION_OUTCOME.ADMIT_WITH_CAUTION) {
      return null;
    }

    governedEvents.push(governed);
    if (isUpdate) {
      const priorVersion = (governed.governedEventVersion || 1) - 1;
      const invalidated = invalidateFactsForGeometryChange(spatialFacts, {
        eventId: governed.governedEventId,
        governedEventVersion: priorVersion,
        geometryVersion: (governed.candidate?.geometryVersion || 1) - 1
      });
      spatialFacts.length = 0;
      spatialFacts.push(...invalidated);
    }

    let proximityResult = null;
    try {
      await hospitalPromise;
      if (!hospitalLoad) {
        throw hospitalLoadError || new Error('Hospital dataset unavailable');
      }
      proximityResult = await computeReferenceProximityForEvent(governed, {
        ...deps,
        referenceLoad: hospitalLoad,
        hospitalLoad,
        referenceDatasetId,
        thresholdMeters: proximityThresholdMeters
      });
    } catch (error) {
      return {
        governed,
        spatialAnalysisError: error.message,
        code: error.code || 'SPATIAL_ANALYSIS_FAILED',
        degraded: true
      };
    }

    if (!firstSpatialFactAt && proximityResult.spatialFacts.length) {
      firstSpatialFactAt = Date.now();
      recordMilestone(MILESTONE_TYPES.FIRST_SPATIAL_FACT);
      trace.mark('firstSpatialFact');
    }
    spatialFacts.push(...proximityResult.spatialFacts);

    const plan = isUpdate
      ? buildAnalyticalMapUpdatePlan({}, { governed, proximityResult, context: {
        graphId: deps.graphId || trace.traceId,
        sessionScope: deps.sessionScope,
        conceptId: request.conceptId || compoundSpec?.conceptId || 'fires',
        referenceDatasetId,
        referenceLayerId
      } })
      : buildAnalyticalMapActionPlan({ governed, proximityResult, context: {
        graphId: deps.graphId || trace.traceId,
        sessionScope: deps.sessionScope,
        conceptId: request.conceptId || compoundSpec?.conceptId || 'fires',
        referenceDatasetId,
        referenceLayerId,
        skipZoom: Boolean(analyticalMapReadyAt)
      } });

    const validation = validateMapActionPlan(plan, {
      sessionScope: deps.sessionScope || plan.sessionScope,
      expectedResultVersion: governed.governedEventVersion || 1,
      mapResultPayload: plan.mapResultPayload
    });
    if (!validation.approved) return { governed, planRejected: true };

    analyticalPlans.push(plan);

    for (const hospital of proximityResult.hospitals.slice(0, 3)) {
      const fact = proximityResult.spatialFacts.find((f) => f.hospitalId === (hospital.featureId || hospital.id || hospital.name));
      explanations.push(buildCrossAgentAnalystExplanation({ governed, hospital, spatialFact: fact }));
    }

    if (deps.executeMapActionPlan) {
      const receipt = await deps.executeMapActionPlan(plan, {
        graphId: deps.graphId || trace.traceId,
        traceId: trace.traceId,
        idempotencyKey: `${plan.planId}:${governed.governedEventVersion}:${governed.candidate?.geometryVersion || 1}`
      });
      executionReceipts.push(receipt);
      if (receipt?.mutatedMap && !analyticalMapReadyAt) {
        analyticalMapReadyAt = Date.now();
        recordMilestone(MILESTONE_TYPES.ANALYTICAL_MAP_READY);
        trace.mark('analyticalMapReady');
      }
    }

    return { governed, proximityResult, plan };
  }

  const now = new Date();
  let progressiveResult = null;
  const temporal = compoundSpec?.temporal || {
    from: new Date(now.getTime() - 30 * 86400000).toISOString(),
    to: now.toISOString(),
    temporalField: 'OCCURRED',
    days: 30
  };
  windowDays = temporal.days || 30;
  const windowCandidates = compoundSpec?.temporal?.direction === 'FUTURE'
    ? [temporal.days || 7]
    : [30, 90];

  for (const days of windowCandidates) {
    windowDays = days;
    const from = request.from || temporal.from;
    const to = request.to || temporal.to;
    progressiveResult = await runProgressiveIntelligenceGraph({
      ...request,
      query: request.query || compoundSpec?.query || CROSS_AGENT_VERTICAL_SLICE_QUERY,
      conceptId: request.conceptId || compoundSpec?.conceptId || 'fires',
      geography: request.geography || compoundSpec?.geography || 'Greater Montréal',
      from,
      to,
      temporalField: temporal.temporalField || 'OCCURRED',
      researchExecution: request.researchExecution || 'FAST'
    }, {
      ...deps,
      trace,
      sessionScope: deps.sessionScope || `cross-agent:${trace.traceId}`,
      onGovernedMappableEvent: async (governed, meta) => {
        if (!firstMappedEventAt) {
          firstMappedEventAt = Date.now();
          trace.mark('firstMappedEvent');
        }
        await analyzeGovernedEvent(governed, { isUpdate: meta?.isUpdate });
      },
      onMapExecution: async ({ governed, receipt, isUpdate }) => {
        if (receipt?.mutatedMap && !firstMappedEventAt) {
          firstMappedEventAt = Date.now();
        }
        if (isUpdate) {
          await analyzeGovernedEvent(governed, { isUpdate: true });
        }
      }
    });
    if (progressiveResult?.mappedCount > 0 || governedEvents.length > 0) break;
  }

  const activeFacts = spatialFacts.filter((f) => f.status === SPATIAL_FACT_STATUS.ACTIVE);
  const spatialDegraded = Boolean(hospitalLoadError) || progressiveResult?.finalState === TASK_STATES.DEGRADED;
  const finalState = governedEvents.length && activeFacts.length
    ? (spatialDegraded ? TASK_STATES.DEGRADED : TASK_STATES.SUCCEEDED)
    : governedEvents.length && hospitalLoadError
      ? TASK_STATES.DEGRADED
      : (progressiveResult && compoundSpec && hospitalLoad)
        ? TASK_STATES.SUCCEEDED
        : progressiveResult?.finalState || TASK_STATES.FAILED;

  const perf = progressiveResult?.performance || {};
  const taskGraphReceipt = createTaskGraphReceipt({
    graphId: progressiveResult?.graph?.graphId,
    objectiveId: progressiveResult?.objectiveSpec?.objectiveId,
    traceId: trace.traceId,
    finalState,
    milestones
  });

  return {
    ok: Boolean(compoundSpec && progressiveResult && hospitalLoad) && (
      (governedEvents.length > 0 && (activeFacts.length > 0 || hospitalLoadError))
      || governedEvents.length === 0
    ),
    finalState,
    windowDays,
    compoundSpec,
    graph,
    progressiveResult,
    governedEvents,
    spatialFacts,
    activeSpatialFacts: activeFacts,
    analyticalPlans,
    executionReceipts,
    hospitalDatasetReceipt: hospitalLoad?.receipt || null,
    hospitalLoadError: hospitalLoadError?.message || null,
    analysisSummary: buildCrossAgentAnalysisSummary(explanations, {
      objective: request.query || CROSS_AGENT_VERTICAL_SLICE_QUERY,
      timeWindowDays: windowDays,
      eventsAnalyzed: governedEvents.length,
      spatialFactsProduced: activeFacts.length
    }),
    taskGraphReceipt,
    milestones,
    traceId: trace.traceId,
    performance: {
      timeToFirstGovernedEventMs: perf.timeToFirstGovernedEventMs,
      timeToFirstMappedEventMs: firstMappedEventAt ? firstMappedEventAt - started : perf.timeToFirstRenderedFeatureMs,
      timeToAuthoritativeLayerReadyMs: authoritativeLayerReadyAt ? authoritativeLayerReadyAt - started : null,
      timeToFirstSpatialFactMs: firstSpatialFactAt ? firstSpatialFactAt - started : null,
      timeToAnalyticalMapReadyMs: analyticalMapReadyAt ? analyticalMapReadyAt - started : null,
      researchLatencyMs: perf.timeToFirstRenderedFeatureMs,
      gisAnalysisLatencyMs: firstSpatialFactAt && authoritativeLayerReadyAt
        ? firstSpatialFactAt - authoritativeLayerReadyAt
        : null
    },
    receipts: {
      graphId: progressiveResult?.graph?.graphId,
      agent2AdmissionLinked: governedEvents.length > 0,
      gisReceiptLinked: activeFacts.some((f) => f.gisReceiptId),
      mapActionPlans: analyticalPlans.map((p) => p.planId),
      mapExecutionReceipts: executionReceipts.map((r) => r.receiptId || r.planId)
    }
  };
}

/**
 * Deterministic geometry refinement proof — A → B recompute without duplicate features.
 * @param {object} governedA
 * @param {object} governedB
 * @param {object} deps
 */
export async function proveSpatialFactRecompute(governedA, governedB, deps = {}) {
  const hospitalLoad = deps.hospitalLoad || await loadAuthoritativeHospitals(deps);
  const resultA = await computeHospitalProximityForEvent(governedA, { hospitalLoad, ...deps });
  let facts = [...resultA.spatialFacts];
  facts = invalidateFactsForGeometryChange(facts, {
    eventId: governedB.governedEventId,
    governedEventVersion: governedB.governedEventVersion,
    geometryVersion: governedB.candidate?.geometryVersion || 2
  });
  const resultB = await computeHospitalProximityForEvent(governedB, { hospitalLoad, ...deps });
  facts.push(...resultB.spatialFacts);
  const stale = facts.filter((f) => f.status === SPATIAL_FACT_STATUS.STALE);
  const active = factsForEventVersion(facts, {
    eventId: governedB.governedEventId,
    governedEventVersion: governedB.governedEventVersion,
    geometryVersion: governedB.candidate?.geometryVersion || 2
  });
  return {
    initialFactCount: resultA.spatialFacts.length,
    staleFactCount: stale.length,
    recomputedFactCount: resultB.spatialFacts.length,
    activeFactCount: active.length,
    duplicateEventId: governedA.governedEventId === governedB.governedEventId,
    geometryChanged: JSON.stringify(governedA.candidate?.geometry) !== JSON.stringify(governedB.candidate?.geometry)
  };
}
