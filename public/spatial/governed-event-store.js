/**
 * Client-side index of Agent 2 governed intelligence events (read-only).
 */

/** @type {Map<string, object>} */
const byEventId = new Map();

/**
 * @param {string} eventId
 * @param {object} bundle
 */
export function registerGovernedEvent(eventId, bundle = {}) {
  const id = eventId || bundle?.governedEventId || bundle?.candidate?.eventId;
  if (!id) return null;
  const existing = byEventId.get(id) || {};
  byEventId.set(id, {
    ...existing,
    ...bundle,
    eventId: id,
    registeredAt: new Date().toISOString()
  });
  if (typeof window !== 'undefined') {
    window.__IQAI_GOVERNED_EVENT_STORE__ = getGovernedEventStoreSnapshot();
  }
  return byEventId.get(id);
}

/**
 * @param {string} eventId
 */
export function getGovernedEvent(eventId) {
  if (!eventId) return null;
  return byEventId.get(eventId) || null;
}

export function clearGovernedEventStore() {
  byEventId.clear();
  if (typeof window !== 'undefined') {
    window.__IQAI_GOVERNED_EVENT_STORE__ = {};
  }
}

export function getGovernedEventStoreSnapshot() {
  return Object.fromEntries(byEventId.entries());
}

/**
 * @param {object} payload mapResultPayload from intelligence MapActionPlan
 */
export function registerGovernedFromMapPayload(payload = {}) {
  const candidate = payload.events?.[0] || payload.mappableEvents?.[0] || null;
  const eventId = payload.governedEventId || candidate?.eventId || candidate?.governedEventId;
  if (!eventId) return null;
  const admissionDecision = payload.admission || payload.admissionDecision || null;
  return registerGovernedEvent(eventId, {
    admissionDecision,
    governedCandidate: payload.governedCandidate
      || admissionDecision?.governedCandidate
      || null,
    candidate,
    receipt: payload.receipt || null,
    governedEventVersion: payload.governedEventVersion || candidate?.governedEventVersion || 1,
    featureKey: payload.featureKey || null,
    source: 'progressive-map-plan'
  });
}

/**
 * Register any Agent 2 governed outcome from progressive intelligence
 * (ADMIT / ADMIT_WITH_CAUTION / HOLD / REJECT) — not map-plan gated.
 * @param {object} governed
 */
export function registerGovernedFromProgressiveBundle(governed = {}) {
  const eventId = governed.governedEventId
    || governed.candidate?.eventId
    || governed.admission?.eventId
    || governed.admissionDecision?.eventId;
  if (!eventId) return null;
  return registerGovernedEvent(eventId, {
    admissionDecision: governed.admission || governed.admissionDecision || null,
    governedCandidate: governed.governedCandidate || null,
    candidate: governed.candidate || null,
    receipt: governed.receipt || null,
    governedEventVersion: governed.governedEventVersion || 1,
    source: 'progressive-intelligence'
  });
}

/**
 * @param {object[]} list
 */
export function registerGovernedEventsFromList(list = []) {
  const registered = [];
  for (const governed of list) {
    const entry = registerGovernedFromProgressiveBundle(governed);
    if (entry) registered.push(entry.eventId);
  }
  return registered;
}
