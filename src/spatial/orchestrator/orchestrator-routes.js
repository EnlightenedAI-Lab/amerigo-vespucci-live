/**
 * Server orchestrator routes — TaskGraph deterministic execution API.
 */
import { runDeterministicTaskGraph } from './coordinator.js';
import { buildMapFromPrompt } from '../iqai-mapper.js';
import { TASK_IDS } from './fire-station-graph.js';

export const ORCHESTRATOR_DETERMINISTIC_PATH = '/api/spatial/orchestrator/deterministic';

function isTaskGraphEnabled() {
  return /^true$/i.test(process.env.IQAI_TASKGRAPH_V1_ENABLED || '');
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleOrchestratorDeterministic(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  if (!isTaskGraphEnabled()) {
    return res.status(404).json({ ok: false, error: 'TaskGraph V1 disabled' });
  }
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'prompt is required' });
    }
    const executeMapPlan = req.body?.executeMapPlan === true;
    const result = await runDeterministicTaskGraph(prompt, {
      buildMapFromPrompt,
      stopAfterTaskId: executeMapPlan ? null : TASK_IDS.BUILD_MAP_PLAN,
      executeMapActionPlan: async (plan, opts) => {
        if (!executeMapPlan) {
          return {
            success: true,
            planId: plan.planId,
            serverSkippedExecution: true,
            mutatedMap: false
          };
        }
        return opts?.executeMapActionPlan?.(plan, opts);
      },
      traceId: req.body?.traceId || null,
      sessionScope: req.body?.sessionScope || null
    });
    return res.status(200).json({
      ok: true,
      enabled: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Orchestrator execution failed',
      code: error?.code || null
    });
  }
}

export function isOrchestratorTaskGraphEnabled() {
  return isTaskGraphEnabled();
}
