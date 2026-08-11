/**
 * MapActionPlan builder — converts deterministic map results into constrained plans.
 */
import { randomUUID } from 'node:crypto';
import {
  MAP_ACTION_TYPES,
  createMapActionPlan,
  buildStableFeatureKey
} from './contracts.js';

export const DETERMINISTIC_RESULTS_LAYER_ID = 'iqai-deterministic-results';

/**
 * @param {object} taskResult
 * @param {object} context
 */
export function buildMapActionPlanFromMapResult(taskResult = {}, context = {}) {
  const mapResult = taskResult.output?.mapResult || taskResult.output || null;
  if (!mapResult?.supported) {
    const err = new Error('Cannot build MapActionPlan from unsupported map result');
    err.code = 'UNSUPPORTED_MAP_RESULT';
    throw err;
  }

  const features = Array.isArray(mapResult.features) ? mapResult.features : [];
  const stableFeatureKeys = features.map((feature) => buildStableFeatureKey(feature, mapResult));
  const actions = [];

  if (mapResult.action === 'CLEAR' || mapResult.request?.action === 'CLEAR') {
    actions.push({ actionId: randomUUID(), type: MAP_ACTION_TYPES.FILTER, mode: 'CLEAR_RESULTS' });
  } else {
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.CREATE_LAYER,
      layerId: DETERMINISTIC_RESULTS_LAYER_ID,
      presentation: 'DETERMINISTIC_RESULTS'
    });
    if (mapResult.origin) {
      actions.push({
        actionId: randomUUID(),
        type: MAP_ACTION_TYPES.HIGHLIGHT,
        target: 'search-origin',
        geometry: {
          type: 'Point',
          coordinates: [mapResult.origin.longitude, mapResult.origin.latitude]
        }
      });
    }
    if (mapResult.request?.radiusMeters) {
      actions.push({
        actionId: randomUUID(),
        type: MAP_ACTION_TYPES.FILTER,
        mode: 'SEARCH_AREA',
        radiusMeters: mapResult.request.radiusMeters
      });
    }
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.ADD_FEATURES,
      layerId: DETERMINISTIC_RESULTS_LAYER_ID,
      featureCount: features.length,
      stableFeatureKeys
    });
    if (features.length) {
      actions.push({
        actionId: randomUUID(),
        type: MAP_ACTION_TYPES.STYLE_BY_CATEGORY,
        layerId: DETERMINISTIC_RESULTS_LAYER_ID
      });
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
    taskResultId: taskResult.resultId,
    taskResultVersion: taskResult.resultVersion || 1,
    sessionScope: context.sessionScope || context.graphId,
    actions,
    mapResultRef: {
      resultId: taskResult.resultId,
      resultVersion: taskResult.resultVersion || 1
    },
    stableFeatureKeys,
    mapResultPayload: mapResult
  });
}
