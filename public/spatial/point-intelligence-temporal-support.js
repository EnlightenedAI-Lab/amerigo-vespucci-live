/**
 * Capability-aware temporal support declaration — Agent 1 contract truth.
 */
import { PI_TIME_MODE } from './point-intelligence-temporal-state.js';

export const TEMPORAL_SUPPORT = Object.freeze({
  SUPPORTED_NOW: 'SUPPORTED_NOW',
  FUTURE_READY: 'FUTURE_READY',
  NOT_APPLICABLE: 'NOT_APPLICABLE'
});

/** Ratified production truth: Agent 5 executes LATEST only. */
const SUPPORT_MATRIX = Object.freeze({
  [PI_TIME_MODE.LATEST]: TEMPORAL_SUPPORT.SUPPORTED_NOW,
  [PI_TIME_MODE.AT]: TEMPORAL_SUPPORT.FUTURE_READY,
  [PI_TIME_MODE.RANGE]: TEMPORAL_SUPPORT.FUTURE_READY
});

export function getTemporalSupportLevel(mode) {
  return SUPPORT_MATRIX[mode] || TEMPORAL_SUPPORT.NOT_APPLICABLE;
}

export function getPointIntelligenceTemporalSupportModel() {
  return {
    LATEST: getTemporalSupportLevel(PI_TIME_MODE.LATEST),
    AT: getTemporalSupportLevel(PI_TIME_MODE.AT),
    RANGE: getTemporalSupportLevel(PI_TIME_MODE.RANGE)
  };
}

export function isTemporalModeExecutable(mode) {
  return getTemporalSupportLevel(mode) === TEMPORAL_SUPPORT.SUPPORTED_NOW;
}
