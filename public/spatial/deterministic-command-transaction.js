/**
 * Deterministic command transaction — monotonic commandId ownership, atomic
 * canonical commit, explicit settlement, and immutable request context.
 */

import { recordCommandBoundary } from './a1-runtime-provenance.js';

export const A1_TRANSACTION_VERSION = 'A1-RP2-TRANSACTION-05';

let generation = 0;
/** @type {number} */
let activeCommandId = 0;

/** @type {Map<number, object>} */
const commandContexts = new Map();

/** @type {Map<number, {
 *   commandId: number,
 *   meta: object,
 *   requiredStages: string[],
 *   completedStages: Set<string>,
 *   settled: boolean,
 *   payload: object | null,
 *   startedAt: number,
 *   stageTimings: Record<string, number>,
 *   promise: Promise<object | null>,
 *   resolve: (value: object | null) => void,
 *   reject: (error: Error) => void,
 *   markStage: Function,
 *   forceSettle: Function
 * }>} */
const settlements = new Map();

/** @type {object | null} */
let committedCanonical = null;

/** @type {number | null} */
let committedCommandId = null;

const RENDERING_STAGES = ['query_complete', 'render_complete', 'presentation_complete', 'canonical_commit', 'renderer_settled'];
const COUNT_STAGES = ['query_complete', 'canonical_commit', 'presentation_complete'];
const LOCATE_STAGES = ['query_complete', 'render_complete', 'presentation_complete', 'canonical_commit'];
const CLEAR_STAGES = ['invalidated', 'canonical_commit', 'renderer_settled'];

function resolveRequiredStages(meta = {}) {
  const operation = String(meta.operation || meta.action || '').toUpperCase();
  if (operation === 'COUNT' || operation === 'CATEGORY_COUNTS_WITHIN') return COUNT_STAGES;
  if (operation === 'LOCATE') return LOCATE_STAGES;
  if (operation === 'CLEAR' || operation === 'RESET') return CLEAR_STAGES;
  return RENDERING_STAGES;
}

function recordTransaction(commandId, stage, detail = {}) {
  recordCommandBoundary('transaction', {
    version: A1_TRANSACTION_VERSION,
    commandId,
    stage,
    activeCommandId,
    generation,
    ...detail
  });
}

function createSettlement(commandId, meta = {}) {
  const requiredStages = resolveRequiredStages(meta);
  const completedStages = new Set();
  const stageTimings = {};
  const startedAt = Date.now();
  let settled = false;
  let payload = null;
  /** @type {(value: object | null) => void} */
  let resolveFn;
  /** @type {(error: Error) => void} */
  let rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const entry = {
    commandId,
    meta: { ...meta },
    requiredStages,
    completedStages,
    settled: false,
    payload: null,
    startedAt,
    stageTimings,
    promise,
    resolve: resolveFn,
    reject: rejectFn,
    markStage: null,
    forceSettle: null
  };

  function maybeSettle(result = null) {
    if (settled || commandId !== activeCommandId) return;
    const ready = requiredStages.every((stage) => completedStages.has(stage));
    if (!ready) return;
    settled = true;
    entry.settled = true;
    payload = result;
    entry.payload = result;
    recordTransaction(commandId, 'SETTLED', {
      stages: [...completedStages],
      canonicalCount: result?.canonicalCount ?? null,
      durationMs: Date.now() - startedAt
    });
    resolveFn(result);
  }

  entry.markStage = (stage, detail = {}) => {
    if (settled) return false;
    if (!assertCommandOwnership(commandId, stage)) return false;
    completedStages.add(stage);
    stageTimings[stage] = Date.now() - startedAt;
    recordTransaction(commandId, stage.toUpperCase(), {
      ...detail,
      elapsedMs: stageTimings[stage]
    });
    maybeSettle(detail.canonical || payload || committedCanonical);
    return true;
  };

  entry.forceSettle = (result = null) => {
    if (settled) return entry.payload;
    settled = true;
    entry.settled = true;
    entry.payload = result;
    recordTransaction(commandId, 'SETTLED_FORCED', {
      canonicalCount: result?.canonicalCount ?? null,
      durationMs: Date.now() - startedAt,
      stages: [...completedStages]
    });
    resolveFn(result);
    return result;
  };

  settlements.set(commandId, entry);
  return entry;
}

/**
 * @param {object} [meta]
 * @returns {{ commandId: number, generation: number }}
 */
export function beginDeterministicCommand(meta = {}) {
  generation += 1;
  activeCommandId = generation;
  const commandId = activeCommandId;
  createSettlement(commandId, meta);
  recordTransaction(commandId, 'BEGIN', {
    command: meta.command || null,
    operation: meta.operation || meta.action || null,
    dataset: meta.dataset || null
  });
  return { commandId, generation };
}

/**
 * @param {number} commandId
 * @param {object} context
 */
export function setCommandRequestContext(commandId, context = {}) {
  if (!Number.isFinite(commandId) || commandId <= 0) return null;
  const prior = commandContexts.get(commandId) || {};
  const merged = {
    ...prior,
    ...context,
    commandId
  };
  commandContexts.set(commandId, merged);
  const entry = settlements.get(commandId);
  if (entry) {
    entry.meta = { ...entry.meta, ...merged };
    entry.requiredStages = resolveRequiredStages(entry.meta);
  }
  recordTransaction(commandId, 'REQUEST_CONTEXT', merged);
  return merged;
}

export function getCommandRequestContext(commandId) {
  return commandContexts.get(commandId) || null;
}

/**
 * @param {number} commandId
 * @param {object} meta
 */
export function updateCommandTransactionMeta(commandId, meta = {}) {
  const entry = settlements.get(commandId);
  if (!entry) return null;
  entry.meta = { ...entry.meta, ...meta };
  entry.requiredStages = resolveRequiredStages(entry.meta);
  return entry.meta;
}

export function invalidateDeterministicCommandGeneration(reason = 'invalidate') {
  generation += 1;
  activeCommandId = generation;
  const commandId = activeCommandId;
  createSettlement(commandId, { action: 'INVALIDATE', reason });
  settlements.get(commandId)?.markStage('invalidated', { reason });
  recordTransaction(commandId, 'INVALIDATE', { reason });
  return { commandId, generation };
}

export function getActiveCommandId() {
  return activeCommandId;
}

export function getCommandGeneration() {
  return generation;
}

export function getCommandSettlement(commandId) {
  return settlements.get(commandId) || null;
}

export function getSettledCommandResult(commandId) {
  const entry = settlements.get(commandId);
  if (!entry?.settled) return null;
  return entry.payload || null;
}

/**
 * @param {number} commandId
 * @param {string} stage
 */
export function assertCommandOwnership(commandId, stage) {
  if (!Number.isFinite(commandId) || commandId <= 0) return false;
  if (commandId !== activeCommandId) {
    recordTransaction(commandId, 'STALE_WRITE_REJECTED', { stage, activeCommandId });
    return false;
  }
  return true;
}

export function markCommandStage(commandId, stage, detail = {}) {
  const entry = settlements.get(commandId);
  if (!entry) return false;
  return entry.markStage(stage, detail);
}

function validateSettlementInvariants(commandId, canonical, detail = {}) {
  const context = getCommandRequestContext(commandId);
  const violations = [];
  if (!canonical) return violations;
  if (canonical.commandId !== commandId) {
    violations.push(`canonical.commandId ${canonical.commandId} !== ${commandId}`);
  }
  if (context?.requestedOperation && canonical.operation
    && String(canonical.operation).toUpperCase() !== String(context.requestedOperation).toUpperCase()) {
    violations.push(`operation ${canonical.operation} !== ${context.requestedOperation}`);
  }
  if (context?.requestedDatasetLabel && canonical.dataset
    && !String(canonical.dataset).toLowerCase().includes(String(context.requestedDatasetLabel).toLowerCase().split(' ')[0])) {
    violations.push(`dataset ${canonical.dataset} !== ${context.requestedDatasetLabel}`);
  }
  const queryCount = detail.queryPopulation
    ?? detail.matchedFeatures
    ?? context?.queryPopulation
    ?? null;
  if (Number(queryCount) > 0 && Number(canonical.canonicalCount) === 0) {
    violations.push(`nonzero query (${queryCount}) settled canonicalCount=0`);
  }
  if (violations.length) {
    recordTransaction(commandId, 'INVARIANT_VIOLATION', { violations, canonical, context });
  }
  return violations;
}

export function commitCanonicalToTransaction(commandId, canonical, detail = {}) {
  if (!assertCommandOwnership(commandId, 'canonical_commit')) return null;
  const context = getCommandRequestContext(commandId);
  const enriched = canonical ? {
    ...canonical,
    commandId,
    operation: canonical.operation || context?.requestedOperation || null,
    dataset: canonical.dataset || context?.requestedDatasetLabel || null,
    datasetKey: canonical.datasetKey || context?.requestedDatasetKey || null
  } : null;
  validateSettlementInvariants(commandId, enriched, detail);
  committedCanonical = enriched;
  committedCommandId = commandId;
  if (typeof window !== 'undefined') {
    window.__IQAI_CANONICAL_DETERMINISTIC_RESULT__ = committedCanonical;
  }
  markCommandStage(commandId, 'canonical_commit', { canonical: committedCanonical });
  return committedCanonical;
}

export function getCommittedCanonicalResult(commandId = null) {
  const settled = commandId != null ? getSettledCommandResult(commandId) : null;
  if (settled) return settled;
  if (commandId != null && committedCommandId !== commandId) return null;
  return committedCanonical;
}

export function settleDeterministicCommand(commandId, payload = null, detail = {}) {
  const entry = settlements.get(commandId);
  if (!entry) return payload;
  if (entry.settled) return entry.payload;
  if (!assertCommandOwnership(commandId, 'settle')) return null;
  const finalPayload = payload ?? committedCanonical;
  if (finalPayload) validateSettlementInvariants(commandId, finalPayload, detail);
  return entry.forceSettle(finalPayload);
}

export function awaitDeterministicCommandSettled(commandId, timeoutMs = 120000) {
  const entry = settlements.get(commandId);
  if (!entry) {
    return Promise.reject(new Error(`Unknown commandId ${commandId}`));
  }
  if (entry.settled) {
    return Promise.resolve(entry.payload);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command #${commandId} did not settle within ${timeoutMs}ms`));
    }, timeoutMs);
    entry.promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function buildEmptyCanonicalResult(commandId, options = {}) {
  return {
    commandId,
    phase: 'cleared',
    command: options.command || null,
    operation: options.operation || 'CLEAR',
    dataset: null,
    datasetKey: null,
    canonicalCount: 0,
    accountingCount: 0,
    activeObjectIdCount: 0,
    renderingMode: 'idle',
    categoryCount: null,
    objectIdQueryUsed: false,
    resultComplete: true,
    resultTruncated: false,
    objectIds: [],
    selectionApplied: false,
    cleared: true,
    publishedAt: new Date().toISOString()
  };
}

export function guardRendererWrite(commandId, stage) {
  const id = commandId ?? activeCommandId;
  return assertCommandOwnership(id, stage);
}

export function getTransactionDiagnostics(commandId) {
  const entry = settlements.get(commandId);
  const context = getCommandRequestContext(commandId);
  return {
    commandId,
    activeCommandId,
    context,
    settlement: entry ? {
      settled: entry.settled,
      requiredStages: entry.requiredStages,
      completedStages: [...entry.completedStages],
      stageTimings: { ...entry.stageTimings },
      durationMs: entry.settled ? Date.now() - entry.startedAt : null,
      payload: entry.payload
    } : null,
    committedCanonical
  };
}
