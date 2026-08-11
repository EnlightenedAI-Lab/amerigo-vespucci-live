/**
 * Deterministic temporal admission gate for intelligence layer results.
 * Analyst-requested date range is enforced after research; the LLM cannot override it.
 */

export const TEMPORAL_FIELD = Object.freeze({
  OCCURRED: 'OCCURRED',
  PUBLISHED: 'PUBLISHED',
  ACQUIRED: 'ACQUIRED'
});

/**
 * @param {object} request
 */
export function resolveTemporalField(request = {}) {
  const raw = String(request.temporalField || TEMPORAL_FIELD.OCCURRED).toUpperCase();
  if (raw === TEMPORAL_FIELD.PUBLISHED) return TEMPORAL_FIELD.PUBLISHED;
  if (raw === TEMPORAL_FIELD.ACQUIRED) return TEMPORAL_FIELD.ACQUIRED;
  return TEMPORAL_FIELD.OCCURRED;
}

/**
 * @param {string|null|undefined} value
 */
export function normalizeTemporalInstant(value) {
  if (!value) return null;
  const normalized = String(value)
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212\u00AD]/g, '-')
    .replace(/\u202F/g, ' ')
    .trim();
  return normalized || null;
}

/**
 * @param {string|null|undefined} iso
 */
export function toEpochMs(iso) {
  const normalized = normalizeTemporalInstant(iso);
  if (!normalized) return null;
  const ms = new Date(normalized).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * @param {string|null|undefined} iso
 * @param {string|null|undefined} from
 * @param {string|null|undefined} to
 */
export function isWithinRange(iso, from, to) {
  const ms = toEpochMs(iso);
  if (ms == null) return false;
  const fromMs = toEpochMs(from);
  const toMs = toEpochMs(to);
  if (fromMs != null && ms < fromMs) return false;
  if (toMs != null && ms > toMs) return false;
  return true;
}

/**
 * Resolve the temporal instant used for admission. For OCCURRED, never substitute publishedAt.
 * @param {object} event
 * @param {string} temporalField
 */
export function resolveEventTemporalInstant(event, temporalField) {
  if (temporalField === TEMPORAL_FIELD.PUBLISHED) {
    return { instant: normalizeTemporalInstant(event.publishedAt), basis: 'publishedAt' };
  }
  if (temporalField === TEMPORAL_FIELD.ACQUIRED) {
    const report = (event.sourceReports || [])[0];
    const acquired = report?.retrievedAt || report?.provenance?.retrievedAt || null;
    return { instant: normalizeTemporalInstant(acquired), basis: 'acquiredAt' };
  }
  return { instant: normalizeTemporalInstant(event.occurredAt), basis: 'occurredAt' };
}

/**
 * @param {object} event
 * @param {object} request
 */
export function evaluateTemporalAdmission(event, request = {}) {
  const temporalField = resolveTemporalField(request);
  const { instant, basis } = resolveEventTemporalInstant(event, temporalField);
  const from = request.from || null;
  const to = request.to || null;

  if (!from && !to) {
    return { admitted: true, reason: 'NO_RANGE', temporalField, basis, instant };
  }

  if (!instant) {
    return {
      admitted: false,
      reason: temporalField === TEMPORAL_FIELD.OCCURRED
        ? 'UNKNOWN_OCCURRENCE'
        : 'UNKNOWN_TEMPORAL_BASIS',
      temporalField,
      basis,
      instant: null
    };
  }

  if (!isWithinRange(instant, from, to)) {
    return {
      admitted: false,
      reason: 'OUT_OF_RANGE',
      temporalField,
      basis,
      instant
    };
  }

  return { admitted: true, reason: 'IN_RANGE', temporalField, basis, instant };
}

/**
 * @param {object[]} events
 * @param {object} request
 */
export function applyIntelligenceLayerTemporalGate(events = [], request = {}) {
  const admitted = [];
  const rejected = [];
  let rejectedOutOfWindow = 0;
  let rejectedUnknownOccurrence = 0;

  for (const event of events) {
    const decision = evaluateTemporalAdmission(event, request);
    if (decision.admitted) {
      admitted.push(event);
      continue;
    }
    if (decision.reason === 'OUT_OF_RANGE') rejectedOutOfWindow += 1;
    if (decision.reason === 'UNKNOWN_OCCURRENCE' || decision.reason === 'UNKNOWN_TEMPORAL_BASIS') {
      rejectedUnknownOccurrence += 1;
    }
    rejected.push({ event, decision });
  }

  return {
    events: admitted,
    temporalGate: {
      temporalField: resolveTemporalField(request),
      from: request.from || null,
      to: request.to || null,
      admitted: admitted.length,
      rejected: rejected.length,
      rejectedOutOfWindow,
      rejectedUnknownOccurrence,
      rejectedEvents: rejected.map(({ event, decision }) => ({
        title: event.title,
        reason: decision.reason,
        instant: decision.instant,
        basis: decision.basis,
        occurredAt: event.occurredAt || null,
        publishedAt: event.publishedAt || null
      }))
    }
  };
}
