/**
 * Analytical MapActionPlan — governed events + authoritative hospitals + proximity highlights.
 */
import { randomUUID } from 'node:crypto';
import {
  MAP_ACTION_TYPES,
  createMapActionPlan
} from './contracts.js';
import { INTELLIGENCE_RESULTS_LAYER_PREFIX } from './intelligence-map-action-plan-builder.js';
import { buildIntelligenceFeatureKey } from './progressive-research-stream.js';

export const ANALYTICAL_HOSPITAL_LAYER_ID = 'iqai-analytical-hospitals';
export const ANALYTICAL_PUBLIC_BUILDINGS_LAYER_ID = 'iqai-analytical-public-buildings';

/**
 * @param {object} input
 */
export function buildAnalyticalMapActionPlan(input = {}) {
  const {
    governed,
    proximityResult,
    context = {}
  } = input;
  const candidate = governed?.candidate || {};
  const sessionScope = context.sessionScope || context.graphId;
  const eventFeatureKey = buildIntelligenceFeatureKey(governed, sessionScope);
  const intelligenceLayerId = context.layerId
    || `${INTELLIGENCE_RESULTS_LAYER_PREFIX}${context.conceptId || 'events'}`;
  const hospitals = proximityResult?.hospitals || proximityResult?.referenceFeatures || [];
  const referenceLayerId = context.referenceLayerId || ANALYTICAL_HOSPITAL_LAYER_ID;
  const hospitalLayerId = context.hospitalLayerId || referenceLayerId;
  const hospitalKeys = hospitals.map((h) => `ref:${h.featureId || h.id || h.name}`);
  const actions = [];

  actions.push({
    actionId: randomUUID(),
    type: MAP_ACTION_TYPES.CREATE_LAYER,
    layerId: intelligenceLayerId,
    presentation: 'INTELLIGENCE_EVENTS'
  });
  actions.push({
    actionId: randomUUID(),
    type: MAP_ACTION_TYPES.ADD_FEATURES,
    layerId: intelligenceLayerId,
    featureCount: 1,
    stableFeatureKeys: [eventFeatureKey]
  });

  if (hospitals.length) {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.CREATE_LAYER,
      layerId: hospitalLayerId,
      presentation: 'DETERMINISTIC_RESULTS'
    });
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.ADD_FEATURES,
      layerId: hospitalLayerId,
      featureCount: hospitals.length,
      stableFeatureKeys: hospitalKeys
    });
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.HIGHLIGHT,
      layerId: hospitalLayerId,
      mode: 'PROXIMITY_MATCH',
      stableFeatureKeys: hospitalKeys
    });
  }

  if (candidate.geometry && proximityResult?.thresholdMeters) {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.FILTER,
      mode: 'SEARCH_AREA',
      radiusMeters: proximityResult.thresholdMeters,
      geometry: candidate.geometry
    });
  }

  actions.push({
    actionId: randomUUID(),
    type: MAP_ACTION_TYPES.STYLE_BY_CATEGORY,
    layerId: intelligenceLayerId,
    caution: (governed?.admission?.outcome || governed?.admissionDecision?.outcome) === 'ADMIT_WITH_CAUTION'
  });

  if (!context.skipZoom) {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.ZOOM,
      mode: 'FIT_RESULTS'
    });
  }

  const mappableEvents = candidate.mappable && candidate.geometry ? [candidate] : [];
  const mapResultPayload = {
    supported: true,
    analytical: true,
    layerId: intelligenceLayerId,
    intelligenceLayerId,
    hospitalLayerId,
    referenceLayerId: hospitalLayerId,
    conceptId: context.conceptId || 'events',
    governedEventId: governed?.governedEventId,
    governedEventVersion: governed?.governedEventVersion || 1,
    events: [candidate],
    mappableEvents,
    hospitals,
    referenceFeatures: hospitals,
    spatialFacts: proximityResult?.spatialFacts || [],
    gisReceiptId: proximityResult?.gisReceipt?.receiptId,
    hospitalDatasetReceiptId: proximityResult?.hospitalDatasetReceipt?.receiptId
      || proximityResult?.referenceDatasetReceipt?.receiptId,
    referenceDatasetId: context.referenceDatasetId || null
  };

  return createMapActionPlan({
    planId: randomUUID(),
    graphId: context.graphId,
    taskResultId: governed?.governedEventId,
    taskResultVersion: governed?.governedEventVersion || 1,
    sessionScope,
    actions,
    stableFeatureKeys: [eventFeatureKey, ...hospitalKeys],
    mapResultRef: {
      resultId: governed?.governedEventId,
      resultVersion: governed?.governedEventVersion || 1
    },
    mapResultPayload
  });
}

/**
 * @param {object} priorPlan
 * @param {object} input
 */
export function buildAnalyticalMapUpdatePlan(priorPlan = {}, input = {}) {
  const plan = buildAnalyticalMapActionPlan(input);
  const eventKey = plan.stableFeatureKeys[0];
  plan.actions = plan.actions.map((action) => {
    if (action.type === MAP_ACTION_TYPES.ADD_FEATURES && action.layerId?.startsWith(INTELLIGENCE_RESULTS_LAYER_PREFIX)) {
      return {
        ...action,
        type: MAP_ACTION_TYPES.UPDATE_FEATURES,
        expectedVersion: (input.governed?.governedEventVersion || 2) - 1,
        patchType: 'geometryRefinement'
      };
    }
    return action;
  });
  plan.stableFeatureKeys = [eventKey, ...plan.stableFeatureKeys.slice(1)];
  return plan;
}
