/**
 * Progressive intelligence orchestrator API — Phase 2 vertical slice.
 */
import { runProgressiveIntelligenceGraph, PROGRESSIVE_VERTICAL_SLICE_QUERY } from './progressive-intelligence-coordinator.js';
import { createSpatialLatencyTrace } from '../spatial-latency-trace.js';
import { resolveResearchExecution } from '../intelligence-layer-research-contract.js';

import { resolveProgressiveIntelligenceV1Enabled, INTERACTIVE_INTELLIGENCE_DEADLINE_MS } from './progressive-intelligence-config.js';

export const ORCHESTRATOR_PROGRESSIVE_PATH = '/api/spatial/orchestrator/progressive-intelligence';

function isProgressiveEnabled() {
  return resolveProgressiveIntelligenceV1Enabled();
}

function buildProgressiveRequest(body, query) {
  const now = new Date();
  const from = body.from || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = body.to || now.toISOString();
  return {
    query,
    conceptId: body.conceptId || 'fires',
    geography: body.geography || 'Greater Montréal',
    from,
    to,
    temporalField: body.temporalField || 'OCCURRED',
    researchExecution: resolveResearchExecution(body),
    traceId: body.traceId || null
  };
}

function writeNdjson(res, payload) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    const ok = res.write(`${JSON.stringify(payload)}\n`);
    if (typeof res.flush === 'function') res.flush();
    return ok !== false;
  } catch {
    return false;
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleOrchestratorProgressiveIntelligence(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!isProgressiveEnabled()) {
    res.type('application/json');
    return res.status(404).json({ ok: false, error: 'Progressive intelligence V1 disabled' });
  }

  const body = req.body || {};
  const query = String(body.query || PROGRESSIVE_VERTICAL_SLICE_QUERY).trim();
  const stream = body.stream === true;
  const execution = resolveResearchExecution(body);
  const trace = createSpatialLatencyTrace(body.traceId || null, {
    strategy: execution === 'DEEP' ? 'PROGRESSIVE_INTELLIGENCE_DEEP' : 'PROGRESSIVE_INTELLIGENCE_FAST'
  });
  trace.mark('serverReceipt');
  const request = buildProgressiveRequest(body, query);

  try {
    if (stream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      // Prevent client disconnects from crashing the Node process mid-research.
      res.on('error', () => {});
      req.on('aborted', () => {});
      writeNdjson(res, { type: 'started', query, traceId: trace.traceId });
    } else {
      res.type('application/json');
    }

    let clientGone = false;
    const safeWrite = (payload) => {
      if (clientGone || req.aborted) return false;
      const ok = writeNdjson(res, payload);
      if (!ok) clientGone = true;
      return ok;
    };

    const result = await runProgressiveIntelligenceGraph(request, {
      trace,
      sessionScope: body.sessionScope || null,
      onGovernedEvent: stream
        ? async (governed) => {
          safeWrite({
            type: 'governedEvent',
            governedEventId: governed?.governedEventId || governed?.candidate?.eventId || null,
            governed
          });
        }
        : undefined,
      onMapPlanReady: stream
        ? async ({ plan, governed, isUpdate }) => {
          safeWrite({
            type: 'mapPlan',
            plan,
            governedEventId: governed?.governedEventId || governed?.candidate?.eventId || null,
            isUpdate: Boolean(isUpdate)
          });
        }
        : undefined,
      onMapExecution: stream
        ? async ({ receipt, governed }) => {
          if (receipt?.mutatedMap) {
            safeWrite({
              type: 'rendered',
              governedEventId: governed?.governedEventId || governed?.candidate?.eventId || null,
              at: Date.now()
            });
          }
        }
        : undefined
    });

    const payload = {
      ok: result.ok,
      enabled: true,
      query,
      interactiveDeadlineMs: INTERACTIVE_INTELLIGENCE_DEADLINE_MS,
      ...result
    };

    if (stream) {
      safeWrite({ type: 'complete', body: payload });
      if (!res.writableEnded) res.end();
      return;
    }
    return res.status(200).json(payload);
  } catch (error) {
    if (stream) {
      writeNdjson(res, { type: 'error', error: error?.message || 'Progressive orchestrator failed', code: error?.code || null });
      if (!res.writableEnded) res.end();
      return;
    }
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Progressive orchestrator failed',
      code: error?.code || null
    });
  }
}

export function isProgressiveIntelligenceEnabled() {
  return isProgressiveEnabled();
}
