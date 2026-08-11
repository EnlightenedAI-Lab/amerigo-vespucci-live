/**
 * Multi-family Point Intelligence response aggregation.
 */
import { POINT_INTELLIGENCE_FAMILY_ORDER } from './point-intelligence-config.js';

const EVIDENCE_STATES = new Set(['SUCCESS', 'PARTIAL_RESULTS']);

/**
 * @param {object} response
 */
export function familyResponseHasEvidence(response) {
  if (!EVIDENCE_STATES.has(String(response?.queryState || ''))) return false;
  const count = response?.resultCount ?? response?.results?.length ?? 0;
  return count > 0;
}

/**
 * @param {Record<string, object>} familyResponses
 */
export function deriveMultiFamilyQueryState(familyResponses) {
  const entries = Object.values(familyResponses || {});
  if (!entries.length) return 'ERROR';

  const withEvidence = entries.filter((entry) => entry.hasEvidence);
  if (withEvidence.length > 0) {
    const hasFailure = entries.some((entry) => (
      ['PROVIDER_UNAVAILABLE', 'QUERY_TIMEOUT', 'QUERY_SAFETY_BLOCKED', 'ERROR'].includes(entry.queryState)
    ));
    return hasFailure ? 'PARTIAL_RESULTS' : 'SUCCESS';
  }

  const states = new Set(entries.map((entry) => entry.queryState));
  if (states.size === 1) return [...states][0];
  if (states.has('NO_APPLICABLE_CAPABILITY')) return 'NO_APPLICABLE_CAPABILITY';
  if (states.has('NO_RESULTS')) return 'NO_RESULTS';
  if (states.has('PROVIDER_UNAVAILABLE')) return 'PROVIDER_UNAVAILABLE';
  return 'NO_RESULTS';
}

/**
 * @param {{ longitude: number, latitude: number }} point
 * @param {string[]} families
 * @param {object[]} responses
 * @param {number} queryGroupId
 */
export function buildMultiFamilyResponse(point, families, responses, queryGroupId) {
  /** @type {Record<string, object>} */
  const familyMap = {};
  const flatResults = [];

  families.forEach((family, index) => {
    const response = responses[index] || { queryState: 'ERROR', results: [] };
    const results = Array.isArray(response.results) ? response.results : [];
    const hasEvidence = familyResponseHasEvidence(response);
    familyMap[family] = {
      informationFamily: family,
      queryState: response.queryState || 'ERROR',
      queryReceiptId: response.queryReceiptId || null,
      queryRequestId: response.queryRequestId || null,
      resultCount: response.resultCount ?? results.length,
      results,
      hasEvidence,
      error: response.error || null
    };
    if (hasEvidence) {
      flatResults.push(...results.map((result) => ({
        ...result,
        category: result.category || family
      })));
    }
  });

  const familiesWithEvidence = Object.values(familyMap).filter((entry) => entry.hasEvidence).length;
  const queryState = deriveMultiFamilyQueryState(familyMap);

  return {
    multiFamily: true,
    queryGroupId,
    queryState,
    families: familyMap,
    familiesWithEvidence,
    results: flatResults,
    resultCount: flatResults.length,
    request: {
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude]
      }
    }
  };
}

/**
 * @param {object} response
 */
export function isMultiFamilyPointIntelligenceResponse(response) {
  return Boolean(response?.multiFamily && response?.families);
}

/**
 * @param {object} response
 * @param {string} [family]
 */
export function getFamilyResponse(response, family) {
  if (!response) return null;
  if (isMultiFamilyPointIntelligenceResponse(response)) {
    return response.families?.[family] || null;
  }
  if (!family || response.request?.informationFamily === family) return response;
  return null;
}

/**
 * @param {object} response
 */
export function listQueriedFamilies(response) {
  if (isMultiFamilyPointIntelligenceResponse(response)) {
    return POINT_INTELLIGENCE_FAMILY_ORDER.filter((family) => response.families?.[family]);
  }
  const family = response?.request?.informationFamily || response?.results?.[0]?.category;
  return family ? [family] : [];
}
