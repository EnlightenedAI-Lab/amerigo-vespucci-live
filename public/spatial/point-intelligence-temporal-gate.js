/**
 * Deterministic Point Intelligence temporal execution gate.
 */
import { PI_TIME_MODE } from './point-intelligence-temporal-state.js';
import { isTemporalModeExecutable } from './point-intelligence-temporal-support.js';
import { POINT_INTELLIGENCE_TEMPORAL_LATEST } from './point-intelligence-config.js';

/**
 * @param {object} temporalState
 */
export function canExecutePointIntelligenceTemporalRequest(temporalState) {
  if (!temporalState?.valid) {
    return {
      status: 'UNSUPPORTED',
      reason: 'INVALID_TEMPORAL_STATE',
      message: temporalState?.validationMessage || 'Temporal state is invalid.'
    };
  }
  if (!isTemporalModeExecutable(temporalState.mode)) {
    return {
      status: 'UNSUPPORTED',
      reason: 'HISTORICAL_NOT_AVAILABLE',
      message: 'Historical Point Intelligence execution is not yet available for the selected families.'
    };
  }
  return { status: 'EXECUTABLE', reason: null, message: null };
}

/**
 * Governed request-model representation for future Agent 5 integration.
 * @param {object} temporalState
 */
export function buildPointIntelligenceTemporalIntentPayload(temporalState) {
  if (!temporalState?.valid) {
    return { ok: false, error: temporalState?.validationMessage || 'Invalid temporal state' };
  }
  if (temporalState.mode === PI_TIME_MODE.LATEST) {
    return { ok: true, temporalIntent: { ...POINT_INTELLIGENCE_TEMPORAL_LATEST } };
  }
  if (temporalState.mode === PI_TIME_MODE.AT) {
    return {
      ok: true,
      temporalIntent: {
        mode: 'AT',
        at: temporalState.at
      }
    };
  }
  if (temporalState.mode === PI_TIME_MODE.RANGE) {
    return {
      ok: true,
      temporalIntent: {
        mode: 'RANGE',
        start: temporalState.rangeStart,
        end: temporalState.rangeEnd
      }
    };
  }
  return { ok: false, error: 'Unknown temporal mode' };
}

export function getUnsupportedTemporalMessage() {
  return 'Historical Point Intelligence execution is not yet available for the selected families.';
}
