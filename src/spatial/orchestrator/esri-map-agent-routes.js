/**
 * Phase 5 Esri map agent API — bounded pilot route.
 */
import {
  proposeAndValidateEsriMapAgentPlan,
  ESRI_MAP_AGENT_CAPABILITY
} from './esri-map-agent-service.js';
import { assessEsriAiFeasibility } from './esri-ai-feasibility.js';

export const ORCHESTRATOR_ESRI_MAP_AGENT_PATH = '/api/spatial/orchestrator/esri-map-agent';

function isEsriAgenticEnabled() {
  return /^true$/i.test(process.env.IQAI_ESRI_AGENTIC_V1_ENABLED || '');
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleOrchestratorEsriMapAgent(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  if (!isEsriAgenticEnabled()) {
    return res.status(404).json({ ok: false, error: 'Esri agentic pilot disabled', enabled: false });
  }
  try {
    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'prompt required' });
    }
    const result = proposeAndValidateEsriMapAgentPlan({
      prompt,
      mapContext: body.mapContext || {},
      sessionScope: body.sessionScope || null
    });
    return res.status(200).json({
      ok: result.approved,
      enabled: true,
      capability: ESRI_MAP_AGENT_CAPABILITY,
      feasibility: assessEsriAiFeasibility(),
      ...result
    });
  } catch (error) {
    return res.status(error.code === 'AUTHORITY_VIOLATION' ? 403 : 400).json({
      ok: false,
      error: error?.message || 'Esri map agent proposal failed',
      code: error?.code || null
    });
  }
}

export function isEsriMapAgentPilotEnabled() {
  return isEsriAgenticEnabled();
}
