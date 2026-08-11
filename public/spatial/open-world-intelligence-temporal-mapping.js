/**
 * Agent 1 Time Lens × interpretation → governed Agent 2 query semantics.
 */
import { PI_TIME_MODE, PI_KNOWLEDGE_SEMANTICS } from './point-intelligence-temporal-state.js';

export const AGENT2_QUERY_SUPPORT = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  INVALID: 'INVALID'
});

/**
 * @param {{ timeMode?: string, interpretation?: string }} input
 */
export function isAgent2TemporalQuerySupported(input = {}) {
  const timeMode = input.timeMode || PI_TIME_MODE.LATEST;
  const interpretation = input.interpretation || PI_KNOWLEDGE_SEMANTICS.APPEARED;

  if (interpretation === PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF) {
    if (timeMode !== PI_TIME_MODE.AT) {
      return {
        status: AGENT2_QUERY_SUPPORT.INVALID,
        message: 'KNOWN AS OF requires AT with a valid knowledge instant.'
      };
    }
    return { status: AGENT2_QUERY_SUPPORT.SUPPORTED };
  }

  if (interpretation === PI_KNOWLEDGE_SEMANTICS.ACTIVE) {
    if (timeMode === PI_TIME_MODE.LATEST) {
      return { status: AGENT2_QUERY_SUPPORT.SUPPORTED };
    }
    return {
      status: AGENT2_QUERY_SUPPORT.UNSUPPORTED,
      message: 'ACTIVE interpretation is supported for LATEST operational incidents only.'
    };
  }

  if (interpretation === PI_KNOWLEDGE_SEMANTICS.APPEARED
    || interpretation === PI_KNOWLEDGE_SEMANTICS.CURRENT) {
    return { status: AGENT2_QUERY_SUPPORT.SUPPORTED };
  }

  return {
    status: AGENT2_QUERY_SUPPORT.UNSUPPORTED,
    message: 'Unsupported temporal interpretation.'
  };
}

/**
 * Build governed Agent 2 query parameters — no connector authority.
 * @param {{ keyword?: string, temporal?: object, interpretation?: string, spatial?: object }} input
 */
export function buildAgent2SearchQueryPlan(input = {}) {
  const temporal = input.temporal || {};
  const interpretation = input.interpretation || PI_KNOWLEDGE_SEMANTICS.APPEARED;
  const support = isAgent2TemporalQuerySupported({
    timeMode: temporal.mode,
    interpretation
  });
  if (support.status !== AGENT2_QUERY_SUPPORT.SUPPORTED) {
    return { ok: false, ...support };
  }

  const keyword = String(input.keyword || '').trim();
  const plan = {
    keyword: keyword || null,
    interpretation,
    temporalMode: temporal.mode || PI_TIME_MODE.LATEST,
    spatial: {
      geometry: input.spatial?.geometry || null,
      radiusMeters: input.spatial?.radiusMeters || null,
      province: input.spatial?.province || 'QC'
    },
    archive: null,
    incidents: null,
    events: null
  };

  if (interpretation === PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF) {
    plan.archive = { mode: 'AS_OF', asOf: temporal.at };
  } else if (interpretation === PI_KNOWLEDGE_SEMANTICS.ACTIVE) {
    plan.incidents = { operationalScope: 'current', projectionEligible: 'true' };
  } else if (temporal.mode === PI_TIME_MODE.RANGE) {
    plan.archive = {
      mode: 'HISTORICAL',
      occurrenceFrom: temporal.rangeStart,
      occurrenceTo: temporal.rangeEnd
    };
    plan.incidents = { operationalScope: 'all' };
    plan.events = { operationalScope: 'all', geometryEligible: 'true' };
  } else if (temporal.mode === PI_TIME_MODE.AT) {
    plan.archive = {
      mode: 'HISTORICAL',
      occurrenceFrom: temporal.at,
      occurrenceTo: temporal.at
    };
    plan.incidents = { operationalScope: 'all' };
    plan.events = { operationalScope: 'all', geometryEligible: 'true' };
  } else {
    plan.archive = { mode: 'CURRENT' };
    plan.incidents = { operationalScope: 'current', projectionEligible: 'true' };
    plan.events = { operationalScope: 'current', geometryEligible: 'true' };
  }

  if (keyword) {
    if (plan.archive) plan.archive.freeText = keyword;
  }

  return { ok: true, plan };
}
