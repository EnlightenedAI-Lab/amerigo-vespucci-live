/**
 * Durable last-run receipt for progressive AI MAP executions.
 * In-memory, overwrite-last-only, redacted — readable by Control Tower workers.
 */

/** @type {import('./ai-map-run-receipt.js').AiMapRunReceipt | null} */
let lastAiMapRunReceipt = null;

const SECRET_PATTERN = /(api[_-]?key|password|token|secret|authorization|bearer)\s*[:=]\s*\S+/gi;

/**
 * @param {string | null | undefined} text
 */
function redactSecrets(text) {
  if (!text || typeof text !== 'string') return text || null;
  return text.replace(SECRET_PATTERN, '$1=[REDACTED]');
}

/**
 * @param {string[] | null | undefined} reasonCodes
 */
export function formatDeterministicReasonCodes(reasonCodes) {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) return null;
  return reasonCodes.filter(Boolean).join(', ');
}

/**
 * @param {string | null | undefined} outcome
 * @param {string[] | null | undefined} reasonCodes
 */
export function buildConciseRejectionSummary(outcome, reasonCodes) {
  if (!outcome || outcome === 'ADMIT' || outcome === 'ADMIT_WITH_CAUTION') return null;
  const formatted = formatDeterministicReasonCodes(reasonCodes);
  return formatted || outcome;
}

/**
 * @param {object[]} governedEvents
 */
export function buildCandidateDiagnostics(governedEvents = []) {
  return governedEvents.map((entry) => {
    const eventId = entry.governedEventId
      || entry.candidate?.eventId
      || entry.admissionDecision?.eventId
      || null;
    const admission = entry.admissionDecision || entry.admission || {};
    const outcome = admission.outcome || null;
    const reasonCodes = Array.isArray(admission.reasonCodes) ? [...admission.reasonCodes] : [];
    return {
      eventId,
      outcome,
      reasonCodes,
      rejectionSummary: buildConciseRejectionSummary(outcome, reasonCodes),
      title: redactSecrets(entry.candidate?.title || entry.governedCandidate?.title || null)
    };
  }).filter((row) => row.eventId);
}

/**
 * @param {object} streamResult
 */
export function computeSourceResultCount(streamResult = {}) {
  const corpusCount = Array.isArray(streamResult.corpusResult?.events)
    ? streamResult.corpusResult.events.length
    : 0;
  const liveCount = Array.isArray(streamResult.liveResult?.candidates)
    ? streamResult.liveResult.candidates.length
    : 0;
  return corpusCount + liveCount;
}

/**
 * @param {object} input
 * @returns {import('./ai-map-run-receipt.js').AiMapRunReceipt}
 */
export function buildProgressiveRunReceipt({
  query,
  traceId = null,
  startedAt,
  completedAt = new Date().toISOString(),
  result = {},
  sessionScope = null,
  trigger = 'progressive-intelligence-api'
}) {
  const streamResult = result.streamResult || {};
  const governanceStats = streamResult.governanceStats || {};
  const governedEvents = Array.isArray(result.governedEvents) ? result.governedEvents : [];
  const candidates = buildCandidateDiagnostics(governedEvents);
  const startedMs = startedAt ? Date.parse(startedAt) : Date.now();
  const completedMs = Date.parse(completedAt);
  const elapsedMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
    ? Math.max(0, completedMs - startedMs)
    : result.performance?.totalMs ?? null;

  const receiptId = result.taskGraphReceipt?.receiptId
    || result.taskGraphReceipt?.graphReceiptId
    || traceId
    || null;

  const rejectionDiagnostics = candidates
    .filter((c) => c.outcome === 'REJECT' || c.outcome === 'HOLD')
    .map((c) => ({
      eventId: c.eventId,
      outcome: c.outcome,
      reasonCodes: c.reasonCodes,
      rejectionSummary: c.rejectionSummary
    }));

  return {
    version: '1.0.0',
    trigger,
    query: redactSecrets(String(query || '').trim()) || null,
    receiptId,
    traceId: traceId || result.traceId || null,
    runId: result.taskGraphReceipt?.graphId || result.graph?.graphId || null,
    sessionScope: sessionScope || null,
    startedAt: startedAt || null,
    completedAt,
    elapsedMs,
    sourceResultCount: computeSourceResultCount(streamResult),
    governedCandidateCount: governedEvents.length,
    governanceCounts: {
      ADMIT: governanceStats.admit || 0,
      ADMIT_WITH_CAUTION: governanceStats.admitWithCaution || 0,
      HOLD: governanceStats.hold || 0,
      REJECT: governanceStats.reject || 0
    },
    mappedCount: Number(result.mappedCount || 0),
    candidateIds: candidates.map((c) => c.eventId),
    candidates,
    rejectionDiagnostics,
    selectedEventId: null,
    finalState: result.finalState || null,
    statusMessage: null,
    interactiveDeadlineReached: Boolean(streamResult.interactiveDeadlineReached),
    streamed: null,
    clientCompletedAt: null,
    persistedAt: new Date().toISOString()
  };
}

/**
 * @param {import('./ai-map-run-receipt.js').AiMapRunReceipt} receipt
 */
export function persistLastAiMapRunReceipt(receipt) {
  lastAiMapRunReceipt = receipt;
  return lastAiMapRunReceipt;
}

/**
 * @param {Partial<import('./ai-map-run-receipt.js').AiMapRunReceipt>} partial
 */
export function mergeLastAiMapRunReceipt(partial = {}) {
  if (!lastAiMapRunReceipt) {
    lastAiMapRunReceipt = {
      version: '1.0.0',
      trigger: partial.trigger || 'client-completion-only',
      query: redactSecrets(partial.query || null),
      receiptId: partial.receiptId || null,
      traceId: partial.traceId || null,
      runId: partial.runId || null,
      sessionScope: partial.sessionScope || null,
      startedAt: partial.startedAt || null,
      completedAt: partial.completedAt || new Date().toISOString(),
      elapsedMs: partial.elapsedMs ?? null,
      sourceResultCount: partial.sourceResultCount ?? null,
      governedCandidateCount: partial.governedCandidateCount ?? null,
      governanceCounts: partial.governanceCounts || {
        ADMIT: 0,
        ADMIT_WITH_CAUTION: 0,
        HOLD: 0,
        REJECT: 0
      },
      mappedCount: partial.mappedCount ?? 0,
      candidateIds: partial.candidateIds || [],
      candidates: partial.candidates || [],
      rejectionDiagnostics: partial.rejectionDiagnostics || [],
      selectedEventId: partial.selectedEventId || null,
      finalState: partial.finalState || null,
      statusMessage: partial.statusMessage || null,
      interactiveDeadlineReached: Boolean(partial.interactiveDeadlineReached),
      streamed: partial.streamed ?? null,
      clientCompletedAt: partial.clientCompletedAt || new Date().toISOString(),
      persistedAt: new Date().toISOString()
    };
    return lastAiMapRunReceipt;
  }

  lastAiMapRunReceipt = {
    ...lastAiMapRunReceipt,
    ...partial,
    query: partial.query != null ? redactSecrets(String(partial.query)) : lastAiMapRunReceipt.query,
    governanceCounts: {
      ...lastAiMapRunReceipt.governanceCounts,
      ...(partial.governanceCounts || {})
    },
    candidates: partial.candidates || lastAiMapRunReceipt.candidates,
    candidateIds: partial.candidateIds || lastAiMapRunReceipt.candidateIds,
    rejectionDiagnostics: partial.rejectionDiagnostics || lastAiMapRunReceipt.rejectionDiagnostics,
    clientCompletedAt: partial.clientCompletedAt || new Date().toISOString(),
    persistedAt: new Date().toISOString()
  };
  return lastAiMapRunReceipt;
}

export function getLastAiMapRunReceipt() {
  return lastAiMapRunReceipt;
}

export function clearLastAiMapRunReceipt() {
  lastAiMapRunReceipt = null;
}

/**
 * @typedef {object} AiMapRunReceipt
 * @property {string} version
 * @property {string} trigger
 * @property {string | null} query
 * @property {string | null} receiptId
 * @property {string | null} traceId
 * @property {string | null} runId
 * @property {string | null} sessionScope
 * @property {string | null} startedAt
 * @property {string | null} completedAt
 * @property {number | null} elapsedMs
 * @property {number | null} sourceResultCount
 * @property {number | null} governedCandidateCount
 * @property {{ ADMIT: number, ADMIT_WITH_CAUTION: number, HOLD: number, REJECT: number }} governanceCounts
 * @property {number} mappedCount
 * @property {string[]} candidateIds
 * @property {object[]} candidates
 * @property {object[]} rejectionDiagnostics
 * @property {string | null} selectedEventId
 * @property {string | null} finalState
 * @property {string | null} statusMessage
 * @property {boolean} interactiveDeadlineReached
 * @property {boolean | null} streamed
 * @property {string | null} clientCompletedAt
 * @property {string} persistedAt
 */
