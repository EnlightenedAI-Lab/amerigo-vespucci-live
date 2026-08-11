/**
 * Phase 4 Cross-Agent Spatial Analysis API route.
 */
import {
  runCrossAgentSpatialAnalysis,
  CROSS_AGENT_VERTICAL_SLICE_QUERY
} from './cross-agent-spatial-coordinator.js';
import { parseCompoundSpatialObjective } from './compound-objective-parser.js';
import { createSpatialLatencyTrace } from '../spatial-latency-trace.js';

export const ORCHESTRATOR_CROSS_AGENT_PATH = '/api/spatial/orchestrator/cross-agent-spatial-analysis';

function isCrossAgentEnabled() {
  return /^true$/i.test(process.env.IQAI_CROSS_AGENT_SPATIAL_V1_ENABLED || '');
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleOrchestratorCrossAgentSpatialAnalysis(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  if (!isCrossAgentEnabled()) {
    return res.status(404).json({ ok: false, error: 'Cross-agent spatial analysis V1 disabled' });
  }
  try {
    const body = req.body || {};
    const trace = createSpatialLatencyTrace(body.traceId || null, {
      strategy: 'CROSS_AGENT_SPATIAL_ANALYSIS_V1'
    });
    trace.mark('serverReceipt');
    const now = new Date();
    const compoundSpec = parseCompoundSpatialObjective(String(body.query || CROSS_AGENT_VERTICAL_SLICE_QUERY).trim(), now);
    const temporal = compoundSpec?.temporal;
    const from = body.from || temporal?.from || new Date(now.getTime() - 30 * 86400000).toISOString();
    const to = body.to || temporal?.to || now.toISOString();
    const result = await runCrossAgentSpatialAnalysis({
      query: String(body.query || CROSS_AGENT_VERTICAL_SLICE_QUERY).trim(),
      conceptId: body.conceptId || compoundSpec?.conceptId || 'fires',
      geography: body.geography || compoundSpec?.geography || 'Greater Montréal',
      from,
      to,
      temporalField: body.temporalField || temporal?.temporalField || 'OCCURRED',
      researchExecution: body.researchExecution || 'FAST',
      proximityThresholdMeters: body.proximityThresholdMeters || compoundSpec?.thresholdMeters || 2000,
      traceId: trace.traceId
    }, {
      trace,
      sessionScope: body.sessionScope || null,
      executeMapActionPlan: body.dryRun ? null : undefined
    });
    return res.status(200).json({ ok: result.ok, enabled: true, ...result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Cross-agent spatial analysis failed',
      code: error?.code || null
    });
  }
}

export function isCrossAgentSpatialEnabled() {
  return isCrossAgentEnabled();
}
