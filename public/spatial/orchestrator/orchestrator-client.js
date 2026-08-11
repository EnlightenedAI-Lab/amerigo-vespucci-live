/**
 * Client TaskGraph orchestration entry — deterministic GIS vertical slice.
 */
import { isTaskGraphV1Enabled } from './orchestrator-config.js';
import { executeMapActionPlan } from './map-action-executor.js';
import { projectOrchestratorStatus } from './orchestrator-status.js';

const ORCHESTRATOR_PATH = '/api/spatial/orchestrator/deterministic';

/**
 * @param {string} prompt
 * @param {object} options
 */
export async function runTaskGraphMapCommand(prompt, options = {}) {
  if (!isTaskGraphV1Enabled()) {
    return { handled: false };
  }

  const appShell = options.appShell;
  if (!appShell) return { handled: false, error: 'AppShell required' };

  let status = projectOrchestratorStatus('UNDERSTANDING');
  appShell.setOrchestratorStatus?.(status);

  const serverResponse = await fetch(ORCHESTRATOR_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      traceId: options.traceId || null,
      sessionScope: options.commandId ? `cmd:${options.commandId}` : null
    })
  });
  const serverBody = await serverResponse.json().catch(() => ({}));
  if (!serverResponse.ok || !serverBody.ok) {
    status = projectOrchestratorStatus('FAILED');
    appShell.setOrchestratorStatus?.(status);
    throw new Error(serverBody.error || `Orchestrator HTTP ${serverResponse.status}`);
  }

  status = projectOrchestratorStatus('MAPPING');
  appShell.setOrchestratorStatus?.(status);

  const plan = serverBody.mapActionPlan;
  const mapResult = serverBody.mapResult;
  let mapExecutionReceipt = null;

  if (plan) {
    mapExecutionReceipt = await executeMapActionPlan(plan, {
      graphId: serverBody.graphId,
      traceId: serverBody.traceId,
      idempotencyKey: plan.planId,
      cancelled: options.cancelled,
      renderMapResultOnRuntime: async (payload) => {
        if (typeof appShell.handleMapCommandBody === 'function') {
          await appShell.handleMapCommandBody(
            payload,
            prompt,
            options.catalog,
            options.expansion || null,
            null,
            options.commandId
          );
          return;
        }
        const { renderMapResultOnRuntime } = await import('../spatial-map-command.js');
        return renderMapResultOnRuntime(payload);
      }
    });
  } else if (mapResult && typeof appShell.handleMapCommandBody === 'function') {
    await appShell.handleMapCommandBody(
      mapResult,
      prompt,
      options.catalog,
      options.expansion || null,
      null,
      options.commandId
    );
  }

  status = projectOrchestratorStatus(
    serverBody.finalState === 'SUCCEEDED' ? 'COMPLETE' : 'DEGRADED'
  );
  appShell.setOrchestratorStatus?.(status);

  if (typeof window !== 'undefined') {
    window.__IQAI_LAST_TASKGRAPH_RECEIPT__ = {
      taskGraphReceipt: serverBody.taskGraphReceipt,
      mapExecutionReceipt,
      traceId: serverBody.traceId
    };
  }

  return {
    handled: true,
    commandId: options.commandId,
    mapResult,
    orchestrator: serverBody,
    mapExecutionReceipt
  };
}

export { isTaskGraphV1Enabled };
