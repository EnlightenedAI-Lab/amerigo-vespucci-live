/**
 * PLACE_POI_SEARCH V1 client adapter.
 */
import { executeMapActionPlan } from './orchestrator/map-action-executor.js';
import { renderMapResultOnRuntime } from './spatial-map-command.js';
import { getMapView } from './spatial-arcgis-runtime.js';

export const PLACE_POI_SEARCH_PATH = '/api/spatial/place-poi/search';

/**
 * @param {object} [view]
 */
export function collectHereOriginContext(view = getMapView()) {
  if (!view?.center) return null;
  return {
    longitude: view.center.longitude,
    latitude: view.center.latitude,
    label: 'Current map center'
  };
}

/**
 * @param {string} prompt
 * @param {object} [options]
 */
export async function runPlacePoiSearch(prompt, options = {}) {
  const started = performance.now();
  const originContext = options.originContext
    || (/\bhere\b/i.test(prompt) ? collectHereOriginContext() : null);

  const response = await fetch(PLACE_POI_SEARCH_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      originContext,
      sessionScope: options.sessionScope || `poi:${Date.now()}`
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    return {
      ok: false,
      error: body.message || `HTTP ${response.status}`,
      code: body.code || null,
      latencyMs: performance.now() - started
    };
  }

  let executionReceipt = null;
  if (body.mapActionPlan && options.execute !== false) {
    const renderStarted = performance.now();
    executionReceipt = await executeMapActionPlan(body.mapActionPlan, {
      graphId: body.mapActionPlan.graphId,
      traceId: options.traceId,
      renderMapResultOnRuntime: async (payload) => renderMapResultOnRuntime(payload)
    });
    body.performance = {
      ...(body.performance || {}),
      timeToRenderedPOIsMs: performance.now() - renderStarted
    };
  }

  return {
    ok: true,
    ...body,
    executionReceipt,
    latencyMs: performance.now() - started
  };
}
