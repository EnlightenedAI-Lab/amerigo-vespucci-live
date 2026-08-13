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
  SUCCESS: 'Point Intelligence ready.',
  NO_RESULTS: 'No matching source observations were returned.',
  NO_DATA: 'No data available for this location.',
  PARTIAL_RESULTS: 'Partial data — some information families returned evidence.',
  PARTIAL_FAILURE: 'Partial data — some information families were unavailable.',
  PARTIAL_DATA: 'Partial data — some information families returned evidence.',
  INVALID_REQUEST: 'Point Intelligence request could not be submitted.',
  NO_VERIFIED_CAPABILITY: 'No verified Point Intelligence capability is currently available for this request.',
  NO_APPLICABLE_CAPABILITY: 'No verified Point Intelligence capability applies at this location.',
  PROVIDER_UNAVAILABLE: 'The source provider is currently unavailable.',
  QUERY_TIMEOUT: 'The source query timed out.',
  QUERY_SAFETY_BLOCKED: 'The request was blocked by Point Intelligence safety controls.',
  TEMPORAL_UNSUPPORTED: 'Historical Point Intelligence execution is not yet available for the selected families.',
  ERROR: 'Point Intelligence could not complete the request.'
});

const INFO_STATES = new Set([
  'NO_RESULTS',
  'NO_DATA',
  'NO_APPLICABLE_CAPABILITY',
  'NO_VERIFIED_CAPABILITY',
  'PARTIAL_RESULTS',
  'PARTIAL_FAILURE',
  'PARTIAL_DATA'
]);

const SUCCESS_STATES = new Set(['SUCCESS']);

/**
 * @param {string} queryState
 */
export function operatorStatusForFamilyState(queryState) {
  switch (String(queryState || '').toUpperCase()) {
    case 'SUCCESS':
    case 'PARTIAL_RESULTS':
      return 'PASS';
    case 'NO_RESULTS':
    case 'NO_DATA':
      return 'NO DATA';
    case 'NO_APPLICABLE_CAPABILITY':
    case 'NO_VERIFIED_CAPABILITY':
      return 'UNAVAILABLE';
    case 'QUERY_TIMEOUT':
      return 'TIMEOUT';
    case 'PROVIDER_UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'QUERYING':
      return 'LOADING';
    default:
      return 'ERROR';
  }
}

/**
 * @param {string} queryState
 * @param {object} [response]
 */
export function formatPointIntelligenceStatus(queryState, response = {}) {
  const state = String(queryState || 'ERROR').toUpperCase();
  const familiesWithEvidence = Number(response.familiesWithEvidence || 0);
  if (familiesWithEvidence > 0 && ['ERROR', 'PARTIAL_FAILURE', 'PROVIDER_UNAVAILABLE', 'QUERY_TIMEOUT'].includes(state)) {
    return {
      state: 'PARTIAL_DATA',
      message: `${familiesWithEvidence} information ${familiesWithEvidence === 1 ? 'family' : 'families'} returned evidence.`,
      severity: 'info',
      ux: 'PARTIAL'
    };
  }
  const message = response.message || STATUS_MESSAGES[state] || STATUS_MESSAGES.ERROR;
  const severity = SUCCESS_STATES.has(state)
    ? 'success'
    : INFO_STATES.has(state)
      ? 'info'
      : state === 'QUERYING'
        ? 'neutral'
        : 'error';
  const ux = state === 'QUERYING'
    ? 'LOADING'
    : SUCCESS_STATES.has(state)
      ? 'READY'
      : INFO_STATES.has(state)
        ? (state === 'NO_RESULTS' || state === 'NO_DATA' ? 'NO_DATA' : 'PARTIAL')
        : 'FAILURE';
  return { state, message, severity, ux };
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
