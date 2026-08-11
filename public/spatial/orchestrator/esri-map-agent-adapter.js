/**
 * Esri map agent client adapter — IQAI MAP SPECIALIST pilot.
 */
import { isEsriAgenticV1Enabled } from './esri-map-agent-config.js';
import {
  collectMapContextFromView,
  executeEsriMapAgentPlan
} from './esri-map-agent-executor.js';
import { getMapView } from '../spatial-arcgis-runtime.js';

export const ESRI_MAP_AGENT_API_PATH = '/api/spatial/orchestrator/esri-map-agent';

/**
 * @param {string} prompt
 * @param {object} [options]
 */
export async function runEsriMapAgentPilot(prompt, options = {}) {
  if (!isEsriAgenticV1Enabled()) {
    return { ok: false, error: 'Esri agentic pilot disabled', enabled: false };
  }

  const started = performance.now();
  const view = getMapView();
  const mapContext = {
    ...collectMapContextFromView(view?.map),
    graphId: options.graphId || null,
    ...(options.mapContext || {})
  };

  const res = await fetch(ESRI_MAP_AGENT_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      mapContext,
      sessionScope: options.sessionScope || 'esri-map-agent-pilot'
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: body.error || `HTTP ${res.status}`,
      code: body.code || null,
      latencyMs: Date.now() - started
    };
  }

  let executionReceipt = null;
  if (body.approved && body.mapActionPlan && options.execute !== false) {
    executionReceipt = await executeEsriMapAgentPlan(body.mapActionPlan, {
      graphId: body.mapActionPlan.graphId,
      traceId: options.traceId,
      simulateMapUnavailable: options.simulateMapUnavailable
    });
  }

  return {
    ok: body.ok,
    enabled: true,
    proposal: body.proposal,
    classification: body.classification,
    validation: body.validation,
    approved: body.approved,
    mapActionPlan: body.mapActionPlan,
    executionReceipt,
    statistics: executionReceipt?.statistics || body.mapActionPlan?.mapResultPayload?.statistics || null,
    authority: body.authority,
    latencyMs: Date.now() - started
  };
}
