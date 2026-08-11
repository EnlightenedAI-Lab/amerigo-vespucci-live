/**
 * Bounded workers — wrap existing deterministic GIS without rewriting it.
 */
import {
  CAPABILITY_AUTHORITATIVE_DATA_QUERY,
  createTaskError,
  createTaskResult,
  TASK_STATES
} from './contracts.js';
import { buildMapActionPlanFromMapResult } from './map-action-plan-builder.js';
import { validateMapActionPlan } from './map-action-validator.js';
import { objectiveSpecToPrompt } from './objective-spec.js';

/**
 * @param {object} taskRequest
 * @param {object} deps
 */
export async function executeAuthoritativeDataQueryWorker(taskRequest, deps = {}) {
  const started = Date.now();
  const buildMapFromPrompt = deps.buildMapFromPrompt;
  if (!buildMapFromPrompt) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.FAILED,
      error: createTaskError({ code: 'WORKER_UNAVAILABLE', message: 'buildMapFromPrompt missing' }),
      latencyMs: Date.now() - started
    });
  }
  try {
    const prompt = taskRequest.input?.prompt || objectiveSpecToPrompt(taskRequest.input?.objectiveSpec || {});
    const mapResult = await buildMapFromPrompt(prompt, deps);
    const status = mapResult.supported ? TASK_STATES.SUCCEEDED : TASK_STATES.FAILED;
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status,
      output: { mapResult, capabilityId: CAPABILITY_AUTHORITATIVE_DATA_QUERY },
      error: mapResult.supported ? null : createTaskError({
        code: 'UNSUPPORTED_REQUEST',
        message: mapResult.message || 'Unsupported deterministic request'
      }),
      latencyMs: Date.now() - started
    });
  } catch (error) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.FAILED,
      error: createTaskError({
        code: error.code || 'WORKER_FAILURE',
        message: error.message || 'Authoritative data query failed',
        retryable: Boolean(error.retryable)
      }),
      latencyMs: Date.now() - started
    });
  }
}

/**
 * @param {object} taskRequest
 * @param {object} deps
 */
export function executeMapPlanBuilderWorker(taskRequest, deps = {}) {
  const started = Date.now();
  const upstream = taskRequest.input?.upstreamResult;
  if (!upstream || upstream.status !== TASK_STATES.SUCCEEDED) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.FAILED,
      error: createTaskError({ code: 'MISSING_UPSTREAM_RESULT', message: 'Authoritative query did not succeed' }),
      latencyMs: Date.now() - started
    });
  }
  try {
    const plan = buildMapActionPlanFromMapResult(upstream, {
      graphId: taskRequest.graphId,
      sessionScope: taskRequest.input?.sessionScope
    });
    const validation = validateMapActionPlan(plan, {
      sessionScope: taskRequest.input?.sessionScope,
      expectedResultVersion: upstream.resultVersion,
      mapResultPayload: plan.mapResultPayload
    });
    if (!validation.approved) {
      return createTaskResult({
        graphId: taskRequest.graphId,
        taskId: taskRequest.taskId,
        traceId: taskRequest.traceId,
        attempt: taskRequest.attempt,
        status: TASK_STATES.FAILED,
        output: { plan, validation },
        error: createTaskError({ code: 'MAP_PLAN_REJECTED', message: validation.issues.join(', ') }),
        latencyMs: Date.now() - started
      });
    }
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.SUCCEEDED,
      output: { plan, validation },
      latencyMs: Date.now() - started
    });
  } catch (error) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.FAILED,
      error: createTaskError({ code: error.code || 'PLAN_BUILD_FAILED', message: error.message }),
      latencyMs: Date.now() - started
    });
  }
}

/**
 * @param {object} taskRequest
 * @param {object} deps
 */
export async function executeMapPlanExecutorWorker(taskRequest, deps = {}) {
  const started = Date.now();
  if (deps.cancelled) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.CANCELLED,
      error: createTaskError({ code: 'GRAPH_CANCELLED', message: 'Graph cancelled before map execution' }),
      latencyMs: Date.now() - started
    });
  }
  const upstream = taskRequest.input?.upstreamResult;
  const plan = upstream?.output?.plan;
  const validation = upstream?.output?.validation;
  if (!plan || !validation?.approved) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.FAILED,
      error: createTaskError({ code: 'UNAPPROVED_PLAN', message: 'MapActionPlan not approved' }),
      latencyMs: Date.now() - started
    });
  }
  const executeMapActionPlan = deps.executeMapActionPlan;
  if (!executeMapActionPlan) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.FAILED,
      error: createTaskError({ code: 'EXECUTOR_UNAVAILABLE', message: 'Map executor missing' }),
      latencyMs: Date.now() - started
    });
  }
  const receipt = await executeMapActionPlan(plan, {
    graphId: taskRequest.graphId,
    traceId: taskRequest.traceId,
    idempotencyKey: taskRequest.idempotencyKey,
    idempotencyStore: deps.idempotencyStore,
    cancelled: deps.cancelled
  });
  if (deps.cancelled && receipt?.mutatedMap === true) {
    return createTaskResult({
      graphId: taskRequest.graphId,
      taskId: taskRequest.taskId,
      traceId: taskRequest.traceId,
      attempt: taskRequest.attempt,
      status: TASK_STATES.CANCELLED,
      output: { receipt, lateResult: true },
      error: createTaskError({ code: 'LATE_RESULT_IGNORED', message: 'Late map result ignored after cancellation' }),
      latencyMs: Date.now() - started
    });
  }
  return createTaskResult({
    graphId: taskRequest.graphId,
    taskId: taskRequest.taskId,
    traceId: taskRequest.traceId,
    attempt: taskRequest.attempt,
    status: receipt.success === false ? TASK_STATES.FAILED : TASK_STATES.SUCCEEDED,
    output: { receipt, plan },
    latencyMs: Date.now() - started
  });
}

export const WORKER_DISPATCH = Object.freeze({
  [CAPABILITY_AUTHORITATIVE_DATA_QUERY]: executeAuthoritativeDataQueryWorker,
  MAP_ACTION_PLAN_BUILDER: executeMapPlanBuilderWorker,
  MAP_ACTION_EXECUTOR: executeMapPlanExecutorWorker
});
