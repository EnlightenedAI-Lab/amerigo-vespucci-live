/**
 * Analyst-facing Point Intelligence status presentation.
 */
import {
  isMultiFamilyPointIntelligenceResponse,
  listQueriedFamilies
} from './point-intelligence-multifamily.js';
import {
  POINT_INTELLIGENCE_FAMILY_ORDER
} from './point-intelligence-config.js';

const STATUS_MESSAGES = Object.freeze({
  IDLE: '',
  QUERYING: 'Querying source intelligence…',
  SUCCESS: 'Source observations returned.',
  NO_RESULTS: 'No matching source observations were returned.',
  PARTIAL_RESULTS: 'Some source results were returned; the query was only partially completed.',
  INVALID_REQUEST: 'Point Intelligence request could not be submitted.',
  NO_VERIFIED_CAPABILITY: 'No verified Point Intelligence capability is currently available for this request.',
  NO_APPLICABLE_CAPABILITY: 'No verified Point Intelligence capability applies at this location.',
  PROVIDER_UNAVAILABLE: 'The source provider is currently unavailable.',
  QUERY_TIMEOUT: 'The source query timed out.',
  QUERY_SAFETY_BLOCKED: 'The request was blocked by Point Intelligence safety controls.',
  ERROR: 'Point Intelligence could not complete the request.'
});

/**
 * @param {string} queryState
 * @param {object} [response]
 */
export function formatPointIntelligenceStatus(queryState, response = {}) {
  const state = String(queryState || 'ERROR').toUpperCase();
  const message = response.message || STATUS_MESSAGES[state] || STATUS_MESSAGES.ERROR;
  const severity = ['SUCCESS', 'PARTIAL_RESULTS'].includes(state)
    ? 'success'
    : ['NO_RESULTS', 'NO_APPLICABLE_CAPABILITY', 'NO_VERIFIED_CAPABILITY'].includes(state)
      ? 'info'
      : state === 'QUERYING'
        ? 'neutral'
        : 'error';
  return { state, message, severity };
}

/**
 * @param {string | null | undefined} classification
 */
export function formatTemporalClassificationLabel(classification) {
  switch (String(classification || '').toUpperCase()) {
    case 'NEAR_REAL_TIME':
      return 'Near real-time observation';
    case 'RECENT':
      return 'Recent observation';
    case 'HISTORICAL':
      return 'Historical record';
    case 'STATIC':
      return 'Station registry metadata';
    default:
      return null;
  }
}

/**
 * @param {object} result
 */
export function formatTemporalEvidence(result) {
  const temporal = result?.temporal;
  if (!temporal || typeof temporal !== 'object') return [];
  const labels = {
    DATE: 'Observation date',
    date: 'Observation date',
    datetime: 'Observation time',
    CLIMATE_DATE: 'Climate date',
    LOCAL_DATE: 'Observation date',
    UTC_DATE: 'UTC observation time',
    OBSERVATION_DATETIME: 'Observation time',
    STATION_FIRST_DATE: 'Station record start',
    'date_tm-value': 'Observation time',
    lastUpdated: 'Last updated',
    observation_datetime: 'Observation time',
    DATETIME: 'Observation time',
    DATETIME_LST: 'Observation time (local)'
  };
  return Object.entries(temporal).map(([key, value]) => ({
    label: labels[key] || key.replace(/_/g, ' '),
    value: String(value)
  }));
}

/**
 * @param {object} response
 */
export function summarizePointIntelligenceResponse(response) {
  if (isMultiFamilyPointIntelligenceResponse(response)) {
    const families = listQueriedFamilies(response);
    const receipts = POINT_INTELLIGENCE_FAMILY_ORDER
      .map((family) => response.families?.[family]?.queryReceiptId)
      .filter(Boolean);
    const providers = families
      .map((family) => response.families?.[family]?.results?.[0]?.providerName)
      .filter(Boolean);
    return {
      queryState: response.queryState || 'ERROR',
      resultCount: response.resultCount ?? response.results?.length ?? 0,
      familiesWithEvidence: response.familiesWithEvidence ?? 0,
      informationFamily: null,
      providerName: providers[0] || null,
      queryReceiptId: receipts[0] || null,
      queryReceiptIds: receipts,
      queryRequestId: null,
      spatialPrecision: response.results?.[0]?.spatialPrecision || null,
      clickedCoordinates: response.request?.geometry?.coordinates || null,
      familySummaries: families.map((family) => {
        const entry = response.families?.[family] || {};
        return {
          informationFamily: family,
          queryState: entry.queryState,
          resultCount: entry.resultCount ?? 0,
          hasEvidence: Boolean(entry.hasEvidence),
          queryReceiptId: entry.queryReceiptId || null,
          providerName: entry.results?.[0]?.providerName || null
        };
      })
    };
  }

  const first = response?.results?.[0] || null;
  return {
    queryState: response?.queryState || 'ERROR',
    resultCount: response?.resultCount ?? response?.results?.length ?? 0,
    familiesWithEvidence: (response?.resultCount ?? response?.results?.length ?? 0) > 0 ? 1 : 0,
    informationFamily: response?.request?.informationFamily
      || first?.category
      || response?.plan?.selectedPrimary?.informationFamily
      || null,
    providerName: first?.providerName || response?.plan?.selectedPrimary?.providerName || null,
    queryReceiptId: response?.queryReceiptId || null,
    queryReceiptIds: response?.queryReceiptId ? [response.queryReceiptId] : [],
    queryRequestId: response?.queryRequestId || null,
    spatialPrecision: first?.spatialPrecision || null,
    clickedCoordinates: response?.request?.geometry?.coordinates || null,
    familySummaries: null
  };
}
