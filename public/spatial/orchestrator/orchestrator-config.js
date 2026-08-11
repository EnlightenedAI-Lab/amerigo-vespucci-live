/** TaskGraph V1 feature gate — mirrors server IQAI_TASKGRAPH_V1_ENABLED. */
export function isTaskGraphV1Enabled() {
  if (typeof window !== 'undefined') {
    if (window.__IQAI_TASKGRAPH_V1_ENABLED__ != null) {
      return Boolean(window.__IQAI_TASKGRAPH_V1_ENABLED__);
    }
    if (window.__IQAI_SPATIAL_RUNTIME_INFO__?.taskGraphV1Enabled != null) {
      return Boolean(window.__IQAI_SPATIAL_RUNTIME_INFO__.taskGraphV1Enabled);
    }
  }
  return false;
}

/** Progressive intelligence Phase 2 feature gate — default ON (rollback: IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED=false). */
export function isProgressiveIntelligenceV1Enabled() {
  if (typeof window !== 'undefined') {
    if (window.__IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED__ != null) {
      return Boolean(window.__IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED__);
    }
    if (window.__IQAI_SPATIAL_RUNTIME_INFO__?.progressiveIntelligenceV1Enabled != null) {
      return Boolean(window.__IQAI_SPATIAL_RUNTIME_INFO__.progressiveIntelligenceV1Enabled);
    }
  }
  return true;
}

export const TASKGRAPH_V1_ENABLED = isTaskGraphV1Enabled();
export const PROGRESSIVE_INTELLIGENCE_V1_ENABLED = isProgressiveIntelligenceV1Enabled();
