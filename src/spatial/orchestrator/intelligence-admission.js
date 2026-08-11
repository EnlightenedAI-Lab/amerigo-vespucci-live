/**
 * Agent 2 admission contract constants — re-exported for Agent 1 schema validation only.
 * Policy evaluation lives exclusively in Agent 2 govern-candidate.
 */
export const ADMISSION_DECISION_VERSION = '1.0.0';

export const ADMISSION_OUTCOME = Object.freeze({
  ADMIT: 'ADMIT',
  ADMIT_WITH_CAUTION: 'ADMIT_WITH_CAUTION',
  HOLD: 'HOLD',
  REJECT: 'REJECT'
});

export const ADMISSION_REASON = Object.freeze({
  NO_SOURCE_URL: 'NO_SOURCE_URL',
  MISSING_PROVENANCE: 'MISSING_PROVENANCE',
  UNKNOWN_OCCURRENCE: 'UNKNOWN_OCCURRENCE',
  OUTSIDE_TIME_WINDOW: 'OUTSIDE_TIME_WINDOW',
  MISSING_LOCATION_TEXT: 'MISSING_LOCATION_TEXT',
  COARSE_LOCATION_ONLY: 'COARSE_LOCATION_ONLY',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
  SPATIAL_CONFLICT: 'SPATIAL_CONFLICT',
  PRODUCTION_FIXTURE: 'PRODUCTION_FIXTURE',
  AGGREGATOR_SOURCE: 'AGGREGATOR_SOURCE',
  ADMITTED: 'ADMITTED'
});

export { mapEventToAgent2Candidate } from './govern-candidate-client.js';

/**
 * @deprecated Agent 1 no longer owns admission policy.
 */
export function evaluateIntelligenceAdmission() {
  throw new Error('Agent 1 admission policy removed — use Agent 2 govern-candidate');
}

/**
 * @deprecated Use Agent 2 governedCandidate response.
 */
export function createGovernedCandidate() {
  throw new Error('Agent 1 governed candidate builder removed — use Agent 2 govern-candidate');
}
