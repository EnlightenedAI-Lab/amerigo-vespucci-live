/**
 * Central Point Intelligence temporal state (Time Lens foundation).
 * Stores UTC ISO instants + explicit display timezone.
 */
export const PI_TIME_MODE = Object.freeze({
  LATEST: 'LATEST',
  AT: 'AT',
  RANGE: 'RANGE'
});

export const PI_KNOWLEDGE_SEMANTICS = Object.freeze({
  CURRENT: 'CURRENT',
  APPEARED: 'APPEARED',
  ACTIVE: 'ACTIVE',
  KNOWN_AS_OF: 'KNOWN_AS_OF'
});

const DEFAULT_DISPLAY_TIMEZONE = 'America/Toronto';
const SESSION_KEY = 'iqai.pi.time-lens.v1';

let temporalGeneration = 0;

/** @type {import('./point-intelligence-temporal-state.js').PointIntelligenceTemporalState} */
let temporalState = createDefaultTemporalState();

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function createDefaultTemporalState() {
  return {
    mode: PI_TIME_MODE.LATEST,
    at: null,
    rangeStart: null,
    rangeEnd: null,
    displayTimezone: DEFAULT_DISPLAY_TIMEZONE,
    interpretationMode: PI_KNOWLEDGE_SEMANTICS.CURRENT,
    valid: true,
    validationMessage: null,
    temporalGeneration: 0
  };
}

function emit() {
  const snapshot = getPointIntelligenceTemporalState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

/**
 * @param {string | null | undefined} value
 */
export function parseTemporalInstant(value) {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * @param {object} partial
 */
export function normalizeTemporalState(partial = {}) {
  const mode = partial.mode || PI_TIME_MODE.LATEST;
  const displayTimezone = partial.displayTimezone || DEFAULT_DISPLAY_TIMEZONE;
  const next = {
    mode,
    at: parseTemporalInstant(partial.at),
    rangeStart: parseTemporalInstant(partial.rangeStart),
    rangeEnd: parseTemporalInstant(partial.rangeEnd),
    displayTimezone,
    interpretationMode: partial.interpretationMode || PI_KNOWLEDGE_SEMANTICS.CURRENT,
    valid: true,
    validationMessage: null,
    temporalGeneration
  };

  if (mode === PI_TIME_MODE.LATEST) {
    next.at = null;
    next.rangeStart = null;
    next.rangeEnd = null;
    return next;
  }

  if (mode === PI_TIME_MODE.AT) {
    next.rangeStart = null;
    next.rangeEnd = null;
    if (!next.at) {
      next.valid = false;
      next.validationMessage = 'AT requires a valid date and time.';
    }
    return next;
  }

  if (mode === PI_TIME_MODE.RANGE) {
    next.at = null;
    if (!next.rangeStart || !next.rangeEnd) {
      next.valid = false;
      next.validationMessage = 'RANGE requires both start and end.';
      return next;
    }
    if (new Date(next.rangeStart).getTime() > new Date(next.rangeEnd).getTime()) {
      next.valid = false;
      next.validationMessage = 'RANGE start must be before or equal to end.';
    }
  }

  return next;
}

/**
 * @param {object} state
 */
export function validateTemporalState(state) {
  return normalizeTemporalState(state);
}

/**
 * @param {string | null} iso
 * @param {string} timeZone
 */
export function formatTemporalInstantForDisplay(iso, timeZone = DEFAULT_DISPLAY_TIMEZONE) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short'
  }).format(date);
  return `${datePart} · ${timePart}`;
}

/**
 * @param {object} state
 */
export function formatTemporalStateSummary(state = temporalState) {
  if (!state || state.mode === PI_TIME_MODE.LATEST) {
    return { headline: 'TIME · LATEST', detail: 'Latest available evidence' };
  }
  if (state.mode === PI_TIME_MODE.AT) {
    const label = formatTemporalInstantForDisplay(state.at, state.displayTimezone);
    return { headline: 'TIME · AT', detail: label || 'AT (incomplete)' };
  }
  const start = formatTemporalInstantForDisplay(state.rangeStart, state.displayTimezone);
  const end = formatTemporalInstantForDisplay(state.rangeEnd, state.displayTimezone);
  return {
    headline: 'TIME · RANGE',
    detail: start && end ? `${start} → ${end}` : 'RANGE (incomplete)'
  };
}

export function getPointIntelligenceTemporalState() {
  return { ...temporalState };
}

export function getActiveTemporalGeneration() {
  return temporalGeneration;
}

export function subscribePointIntelligenceTemporalState(listener) {
  listeners.add(listener);
  listener(getPointIntelligenceTemporalState());
  return () => listeners.delete(listener);
}

/**
 * @param {object} partial
 */
export function setPointIntelligenceTemporalState(partial) {
  temporalGeneration += 1;
  temporalState = normalizeTemporalState({ ...partial, temporalGeneration });
  temporalState.temporalGeneration = temporalGeneration;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      mode: temporalState.mode,
      at: temporalState.at,
      rangeStart: temporalState.rangeStart,
      rangeEnd: temporalState.rangeEnd,
      displayTimezone: temporalState.displayTimezone,
      interpretationMode: temporalState.interpretationMode
    }));
  } catch { /* ignore */ }
  emit();
  return temporalState;
}

export function restorePointIntelligenceTemporalStateFromSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return temporalState;
    const parsed = JSON.parse(raw);
    temporalGeneration += 1;
    temporalState = normalizeTemporalState(parsed);
    temporalState.temporalGeneration = temporalGeneration;
    emit();
  } catch { /* ignore */ }
  return temporalState;
}

/**
 * Future Agent 2 seam — reusable temporal context.
 */
export function getCurrentTemporalContext() {
  const state = getPointIntelligenceTemporalState();
  return {
    mode: state.mode,
    at: state.at,
    rangeStart: state.rangeStart,
    rangeEnd: state.rangeEnd,
    timezone: state.displayTimezone,
    displayTimezone: state.displayTimezone,
    interpretation: state.interpretationMode,
    valid: state.valid,
    temporalGeneration: state.temporalGeneration
  };
}

/**
 * Build local datetime input defaults for AT mode in display timezone.
 * @param {string} iso
 * @param {string} timeZone
 */
export function toLocalDateTimeInputValue(iso, timeZone = DEFAULT_DISPLAY_TIMEZONE) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * @param {string} localValue e.g. 2026-08-03T21:00
 * @param {string} timeZone
 */
export function localDateTimeInputToUtcIso(localValue, timeZone = DEFAULT_DISPLAY_TIMEZONE) {
  if (!localValue) return null;
  const match = String(localValue).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  const utcGuess = probe.toISOString();
  const rendered = toLocalDateTimeInputValue(utcGuess, timeZone);
  if (rendered === localValue) return utcGuess;
  const offsetMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00Z`)
    - Date.parse(utcGuess);
  const adjusted = new Date(Date.parse(utcGuess) - offsetMs);
  const secondPass = toLocalDateTimeInputValue(adjusted.toISOString(), timeZone);
  if (secondPass === localValue) return adjusted.toISOString();
  const hourOffset = Number(hour);
  const estOffsetHours = timeZone === 'America/Toronto' ? 4 : 0;
  const fallback = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hourOffset + estOffsetHours, Number(minute)));
  return fallback.toISOString();
}
