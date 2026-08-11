/**
 * Intelligence layer live-search request builder.
 */
import { LIVE_SEARCH_PATH } from './intelligence-layer-config.js';

export const TRACE_HEADER = 'x-iqai-trace-id';

/**
 * @param {object} request
 */
export function buildLiveSearchPayload(request = {}) {
  return {
    query: request.query,
    conceptId: request.conceptId || null,
    geography: request.geography,
    from: request.from,
    to: request.to,
    temporalField: request.temporalField || 'OCCURRED',
    includeLive: request.includeLive !== false,
    corpusMode: 'production',
    enrichWithLlm: true,
    persistLiveFindings: false,
    useLlmResearch: request.useLlmResearch !== false,
    researchProvider: request.researchProvider || null,
    researchExecution: request.researchExecution || null,
    traceId: request.traceId || null
  };
}

/**
 * @param {object} request
 * @param {object} [options]
 */
export async function queryIntelligenceLiveSearch(request = {}, options = {}) {
  const payload = buildLiveSearchPayload(request);
  const trace = options.trace || null;
  const headers = { 'Content-Type': 'application/json' };
  if (payload.traceId || trace?.traceId) {
    headers[TRACE_HEADER] = payload.traceId || trace.traceId;
  }
  trace?.mark('requestDispatched');
  const dispatchSpan = trace?.startSpan('CLIENT_HTTP_DISPATCH', { executionMode: 'SERIAL', criticalPath: true });
  const response = await fetch(LIVE_SEARCH_PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: options.signal
  });
  const body = await response.json().catch(() => ({}));
  trace?.mark('browserReceipt');
  if (dispatchSpan) trace.endSpan(dispatchSpan, { criticalPath: true });
  if (!response.ok || body.ok === false) {
    const message = body.error || `Intelligence search failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}
