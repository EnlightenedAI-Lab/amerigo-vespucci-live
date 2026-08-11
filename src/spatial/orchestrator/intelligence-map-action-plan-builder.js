/**
 * MapActionPlan builder for governed intelligence events.
 */
import { randomUUID } from 'node:crypto';
import {
  MAP_ACTION_TYPES,
  createMapActionPlan
} from './contracts.js';
import { buildIntelligenceFeatureKey } from './progressive-research-stream.js';

export const INTELLIGENCE_RESULTS_LAYER_PREFIX = 'iqai-intelligence-';

/**
 * @param {object} governed
 * @param {object} context
 */
export function buildIntelligenceMapActionPlan(governed = {}, context = {}) {
  const candidate = governed.candidate || {};
  const sessionScope = context.sessionScope || context.graphId;
  const featureKey = buildIntelligenceFeatureKey(governed, sessionScope);
  const layerId = context.layerId || `${INTELLIGENCE_RESULTS_LAYER_PREFIX}${context.conceptId || 'events'}`;
  const isUpdate = Boolean(context.existingFeatureKeys?.has(featureKey));
  const patchType = context.patchType || null;

  const intelligencePayload = {
    supported: true,
    layerId,
    conceptId: context.conceptId || candidate.concept,
    events: [candidate],
    mappableEvents: candidate.mappable && candidate.geometry ? [candidate] : [],
    admission: governed.admission,
    governedEventId: governed.governedEventId,
    governedEventVersion: governed.governedEventVersion || 1,
    featureKey,
    patchType,
    caution: (governed.admission?.outcome || governed.admissionDecision?.outcome) === 'ADMIT_WITH_CAUTION',
    permittedDisplayMode: governed.governedCandidate?.permittedDisplayMode
      || governed.admission?.permittedDisplayMode
      || null
  };

  const actions = [];
  if (!isUpdate) {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.CREATE_LAYER,
      layerId,
      presentation: 'INTELLIGENCE_EVENTS'
    });
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.ADD_FEATURES,
      layerId,
      featureCount: 1,
      stableFeatureKeys: [featureKey]
    });
  } else {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.UPDATE_FEATURES,
      layerId,
      stableFeatureKeys: [featureKey],
      expectedVersion: (governed.governedEventVersion || 2) - 1,
      patchType
    });
  }

  if (candidate.geometry) {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.STYLE_BY_CATEGORY,
      layerId,
      caution: intelligencePayload.caution
    });
    if (!isUpdate) {
      actions.push({
        actionId: randomUUID(),
        type: MAP_ACTION_TYPES.ZOOM,
        mode: 'FIT_RESULTS'
      });
    }
  }

  return createMapActionPlan({
    planId: randomUUID(),
    graphId: context.graphId,
    taskResultId: context.taskResultId || governed.governedEventId,
    taskResultVersion: context.taskResultVersion || governed.governedEventVersion || 1,
    sessionScope,
    actions,
    stableFeatureKeys: [featureKey],
    mapResultRef: {
      resultId: governed.governedEventId,
      resultVersion: governed.governedEventVersion || 1
    },
    mapResultPayload: intelligencePayload
  });
}
