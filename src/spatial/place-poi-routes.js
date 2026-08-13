/**
 * DYNAMIC_PLACE_SEARCH API route.
 */
import { executePlacePoiSearch, isPlacePoiV1Enabled } from './place-poi-search-service.js';
import { persistLastAiMapRunReceipt } from './ai-map-run-receipt.js';
import { httpStatusForPlaceStatus, DYNAMIC_PLACE_ROUTE } from './dynamic-place-search-status.js';

export const PLACE_POI_SEARCH_PATH = '/api/spatial/place-poi/search';

function persistPlaceReceipt(result, prompt) {
  const provenance = result.provenance || result.queryReceipt || {};
  persistLastAiMapRunReceipt({
    version: '1.0.0',
    trigger: 'dynamic-place-search',
    query: prompt || provenance.userPrompt || null,
    receiptId: result.mapActionPlan?.planId || null,
    traceId: result.mapActionPlan?.graphId || null,
    runId: result.mapActionPlan?.graphId || null,
    sessionScope: result.mapActionPlan?.sessionScope || null,
    startedAt: null,
    completedAt: new Date().toISOString(),
    elapsedMs: result.performance?.totalMs ?? null,
    sourceResultCount: result.places?.length ?? 0,
    governedCandidateCount: result.places?.length ?? 0,
    mappedCount: result.places?.length ?? 0,
    candidateIds: provenance.providerIds || [],
    candidates: [],
    rejectionDiagnostics: [],
    selectedEventId: null,
    finalState: result.status,
    statusMessage: result.message || null,
    interactiveDeadlineReached: false,
    streamed: false,
    clientCompletedAt: null,
    persistedAt: new Date().toISOString(),
    route: DYNAMIC_PLACE_ROUTE,
    dynamicPlaceSearch: provenance
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handlePlacePoiSearch(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  if (!isPlacePoiV1Enabled()) {
    return res.status(404).json({
      ok: false,
      status: 'EXECUTION_FAILURE',
      code: 'DISABLED',
      message: 'Place POI search is disabled.'
    });
  }
  try {
    const body = req.body || {};
    const result = await executePlacePoiSearch({
      prompt: body.prompt,
      intent: body.intent,
      originContext: body.originContext || null,
      sessionScope: body.sessionScope || null,
      graphId: body.graphId || null
    });
    persistPlaceReceipt(result, body.prompt);
    const httpStatus = result.ok
      ? 200
      : httpStatusForPlaceStatus(result.status || result.code, 400);
    return res.status(httpStatus).json(result);
  } catch {
    return res.status(500).json({
      ok: false,
      status: 'EXECUTION_FAILURE',
      code: 'EXECUTION_FAILURE',
      route: DYNAMIC_PLACE_ROUTE,
      message: 'Place POI search failed.'
    });
  }
}
