/**
 * Evidence + QueryReceipt inspector models — governed bundle truth only.
 */
import { getObservationId, observationHasSpatialGeometry } from './point-intelligence-map-presentation.js';
import { getPointIntelligenceFamilyMetadata } from './point-intelligence-config.js';
import { deriveCoverageState } from './point-intelligence-lif-model.js';
import { formatClickDistance, formatObservationTimestamp, formatClimateObservationDate } from './point-intelligence-presentation.js';
import { formatTemporalClassificationLabel } from './point-intelligence-status.js';
import { sanitizeEvidenceRecord, sanitizeReceiptModel } from './point-intelligence-inspector-safe.js';
import { AOI_CLASS, EVIDENCE_ROLE, formatAoiDistanceLabel } from './point-intelligence-aoi-geometry.js';

function formatCoords(geometry) {
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
    }
  }
  return null;
}

function formatRadius(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function findFamilyEntry(response, family) {
  return response?.families?.[family] || null;
}

function findReceiptStub(response, family, receiptId = null) {
  const stubs = Array.isArray(response?.queryReceipts) ? response.queryReceipts : [];
  if (receiptId) {
    return stubs.find((row) => row.queryReceiptId === receiptId) || null;
  }
  return stubs.find((row) => row.informationFamily === family) || null;
}

function findSpatialFamilySummary(response, family) {
  const rows = response?.spatialSummary?.families || [];
  return rows.find((row) => row.informationFamily === family) || null;
}

function findTemporalFamilySummary(response, family) {
  const rows = response?.temporalSummary?.families || [];
  return rows.find((row) => row.informationFamily === family) || null;
}

function findPlannerCapability(response, family) {
  const eligible = response?.plannerDecision?.eligible || [];
  return eligible.find((row) => row.informationFamily === family) || null;
}

function findResultByObservationId(response, observationId) {
  const all = [];
  for (const family of Object.values(response?.families || {})) {
    if (Array.isArray(family.results)) all.push(...family.results);
  }
  if (Array.isArray(response?.results)) all.push(...response.results);
  return all.find((result) => getObservationId(result) === observationId) || null;
}

function extractMeasurements(result) {
  const lines = [];
  const obs = result?.observation;
  if (obs?.value != null) {
    const unit = obs.unit === 'C' ? '°C' : obs.unit || '';
    const label = ({
      air_temp: 'Temperature',
      avg_air_temp_pst1hr: 'Temperature (1 hr avg)',
      rel_hum: 'Humidity',
      stn_pres: 'Pressure',
      temperature: 'Temperature',
      aqhi: 'AQHI',
      LEVEL: 'Water level',
      DISCHARGE: 'Discharge'
    })[obs.property] || obs.property?.replace(/_/g, ' ') || 'Measurement';
    lines.push({ label, value: `${obs.value}${unit ? ` ${unit}` : ''}` });
  }
  const props = result?.properties || {};
  const mean = props.MEAN_TEMPERATURE;
  if (mean != null) lines.push({ label: 'Mean temperature', value: `${mean} °C` });
  if (props.TOTAL_PRECIPITATION != null) lines.push({ label: 'Precipitation', value: `${props.TOTAL_PRECIPITATION} mm` });
  if (props.aqhi != null || props.AQHI != null) lines.push({ label: 'AQHI', value: String(props.aqhi ?? props.AQHI) });
  return lines;
}

function stationIdentity(result) {
  const props = result?.properties || {};
  return props.STATION_NUMBER || props.IDENTIFIER || props.CLIMATE_IDENTIFIER
    || props['station-name-value'] || props.location_name_en || props.location_name
    || result?.nativeRecordId || null;
}

function formatExecutionStatus(queryState) {
  const state = String(queryState || '').toUpperCase();
  if (state === 'SUCCESS' || state === 'PARTIAL_RESULTS') return 'Query completed';
  if (state === 'NO_RESULTS') return 'Query completed — no local evidence';
  if (state === 'NO_APPLICABLE_CAPABILITY' || state === 'NO_VERIFIED_CAPABILITY') return 'Not applicable';
  if (['PROVIDER_UNAVAILABLE', 'QUERY_TIMEOUT', 'QUERY_SAFETY_BLOCKED', 'ERROR', 'PARTIAL_FAILURE'].includes(state)) {
    return 'Provider issue';
  }
  return state.replace(/_/g, ' ').toLowerCase();
}

function formatResultStatus(familyEntry, queryState) {
  const coverage = deriveCoverageState(queryState, Boolean(familyEntry?.hasEvidence));
  return ({
    EVIDENCE: 'Evidence returned',
    NO_LOCAL_EVIDENCE: 'No local evidence',
    NOT_APPLICABLE: 'Not applicable',
    PROVIDER_ISSUE: 'Provider issue'
  })[coverage] || coverage;
}

function buildAoiRelationship(result) {
  if (result?.acquisitionRole === EVIDENCE_ROLE) {
    const distance = formatAoiDistanceLabel(result.queryOriginDistanceMeters ?? result.clickDistanceMeters);
    return {
      classification: EVIDENCE_ROLE,
      kind: 'EVIDENCE',
      label: 'SUPPORTING OBSERVATION',
      distanceLabel: distance ? `${distance} from query origin` : null,
      coverage: false,
      influence: false,
      interpolation: false
    };
  }
  if (!result?.aoiClassification) return null;
  if (result.aoiClassification === AOI_CLASS.INSIDE_AOI) {
    return {
      classification: AOI_CLASS.INSIDE_AOI,
      label: 'INSIDE ACQUISITION AREA',
      distanceLabel: null,
      coverage: false
    };
  }
  if (result.aoiClassification === AOI_CLASS.SUPPORTING_EXTERNAL) {
    const distance = formatAoiDistanceLabel(result.aoiBoundaryDistanceMeters);
    return {
      classification: AOI_CLASS.SUPPORTING_EXTERNAL,
      label: 'SUPPORTING EXTERNAL OBSERVATION',
      distanceLabel: distance ? `${distance} from AOI boundary` : null,
      coverage: false
    };
  }
  return null;
}

/**
 * @param {object} response
 * @param {string} observationId
 */
export function buildSafeEvidenceInspectorModel(response, observationId) {
  const result = findResultByObservationId(response, observationId);
  if (!result) return null;

  const family = result.category || result.nativeCollectionId;
  const meta = getPointIntelligenceFamilyMetadata(family);
  const hasGeometry = observationHasSpatialGeometry(result);
  const observedAt = result?.observation?.observedAt
    || result?.temporal?.LOCAL_DATE
    || result?.temporal?.['date_tm-value']
    || result?.properties?.LOCAL_DATE
    || result?.properties?.['date_tm-value']
    || null;
  const publicationTime = result?.properties?.lastUpdated
    || result?.temporal?.lastUpdated
    || null;

  const model = {
    level: 'OBSERVATION',
    observationId: getObservationId(result),
    informationFamily: family,
    familyLabel: meta?.label || family,
    resultKind: result.resultKind || null,
    capabilityId: result.capabilityId || null,
    stationIdentity: stationIdentity(result),
    nativeRecordId: result.nativeRecordId || null,
    nativeCollectionId: result.nativeCollectionId || null,
    queryReceiptId: result.queryReceiptId || findFamilyEntry(response, family)?.queryReceiptId || null,
    spatial: hasGeometry ? {
      geometryType: result.geometry?.type || null,
      coordinates: formatCoords(result.geometry),
      distanceFromAnchor: formatClickDistance(result.clickDistanceMeters),
      spatialPrecision: result.spatialPrecision || null
    } : { unavailable: true, message: 'No spatial geometry' },
    temporal: {
      observationTime: formatObservationTimestamp(observedAt) || formatClimateObservationDate(observedAt),
      sourcePublicationTime: formatObservationTimestamp(publicationTime),
      retrievalTime: formatObservationTimestamp(result.retrievedAt),
      knowledgeTime: formatObservationTimestamp(result.retrievedAt),
      temporalClass: formatTemporalClassificationLabel(result.temporalClassification),
      ageLabel: null
    },
    provider: {
      providerName: result.providerName || null,
      protocolFamily: result.protocolFamily || null,
      sourceCollection: result.nativeCollectionId || null,
      sourceEndpoint: result.provenance?.source || null
    },
    measurements: extractMeasurements(result),
    aoiRelationship: buildAoiRelationship(result),
    sourceTrace: [
      result.providerName,
      result.nativeCollectionId,
      stationIdentity(result),
      'observation'
    ].filter(Boolean),
    hasGeometry,
    raw: sanitizeEvidenceRecord(result)
  };

  return model;
}

/**
 * @param {object} response
 * @param {string} family
 * @param {string} [receiptId]
 */
export function buildSafeQueryReceiptInspectorModel(response, family, receiptId = null) {
  const familyEntry = findFamilyEntry(response, family);
  if (!familyEntry && !receiptId) return null;

  const resolvedFamily = family || familyEntry?.informationFamily;
  const stub = findReceiptStub(response, resolvedFamily, receiptId || familyEntry?.queryReceiptId);
  const receiptKey = stub?.queryReceiptId || familyEntry?.queryReceiptId || receiptId;
  const spatial = findSpatialFamilySummary(response, resolvedFamily);
  const temporal = findTemporalFamilySummary(response, resolvedFamily);
  const capability = findPlannerCapability(response, resolvedFamily);
  const meta = getPointIntelligenceFamilyMetadata(resolvedFamily);
  const queryState = stub?.queryState || familyEntry?.queryState || 'UNKNOWN';
  const anchor = response?.spatialSummary?.requestedGeometry
    || response?.request?.geometry
    || null;
  const radiusMeters = response?.spatialSummary?.radiusMeters
    ?? response?.request?.radiusMeters
    ?? null;
  const representative = familyEntry?.results?.[0] || null;
  const eligibility = spatial?.spatialEligibility || null;
  const intent = response?.plannerDecision?.temporalIntent
    || response?.request?.temporalIntent
    || null;
  const temporalRequest = intent ? {
    mode: intent.mode || null,
    at: intent.at || null,
    rangeStart: intent.start || intent.rangeStart || null,
    rangeEnd: intent.end || intent.rangeEnd || null,
    providerTemporalSupport: intent.providerTemporalSupport || response?.plannerDecision?.providerTemporalSupport || null,
    executionTemporalParameters: intent.executionTemporalParameters || null,
    resultTemporalCoverage: intent.resultTemporalCoverage || temporal?.coverage || null,
    retrievalTime: intent.retrievalTime || formatObservationTimestamp(representative?.retrievedAt)
  } : null;

  const model = {
    level: 'QUERY_RECEIPT',
    queryReceiptId: receiptKey,
    queryRequestId: stub?.queryRequestId || familyEntry?.queryRequestId || null,
    informationFamily: resolvedFamily,
    familyLabel: meta?.label || resolvedFamily,
    capabilityId: capability?.capabilityId || representative?.capabilityId || null,
    nativeId: capability?.nativeId || familyEntry?.nativeId || representative?.nativeCollectionId || null,
    providerName: representative?.providerName || null,
    queryMode: response?.plannerDecision?.selectionMode || response?.request?.selectionMode || 'AUTO',
    temporalIntent: intent?.mode || 'LATEST',
    temporalRequest,
    queryAnchor: formatCoords(anchor),
    radiusMeters,
    radiusLabel: formatRadius(radiusMeters),
    executionStatus: formatExecutionStatus(queryState),
    resultStatus: formatResultStatus(familyEntry, queryState),
    resultCount: familyEntry?.resultCount ?? 0,
    bundleId: response?.bundleId || null,
    orchestrationId: response?.orchestrationId || null,
    timing: {
      retrievedAt: formatObservationTimestamp(representative?.retrievedAt),
      temporalClass: formatTemporalClassificationLabel(
        temporal?.temporalClassification || familyEntry?.temporalClassification
      ),
      newestObservedAt: formatObservationTimestamp(temporal?.newestObservedAt)
    },
    spatialAccounting: eligibility ? {
      providerResultsReceived: eligibility.providerResultsReceived,
      excludedOutsideRadius: eligibility.excludedOutsideRadius,
      excludedNoPointGeometry: eligibility.excludedNoPointGeometry,
      resultsReturned: eligibility.resultsReturned,
      requestedRadiusMeters: eligibility.requestedRadiusMeters,
      predicate: eligibility.predicate
    } : null,
    retrievalEnvelope: eligibility?.providerRetrievalEnvelope || null,
    error: familyEntry?.error ? sanitizeEvidenceRecord({ error: familyEntry.error }).error : null,
    sourceTrace: [
      representative?.providerName || 'Provider',
      capability?.nativeId || familyEntry?.nativeId,
      meta?.label || resolvedFamily,
      'QueryReceipt'
    ].filter(Boolean),
    governed: true,
    raw: sanitizeReceiptModel({
      queryReceiptId: receiptKey,
      queryRequestId: stub?.queryRequestId || familyEntry?.queryRequestId,
      informationFamily: resolvedFamily,
      queryState,
      resultCount: familyEntry?.resultCount ?? 0,
      capabilityId: capability?.capabilityId,
      nativeId: capability?.nativeId,
      temporalIntent: response?.request?.temporalIntent,
      spatialAccounting: eligibility,
      bundleId: response?.bundleId,
      orchestrationId: response?.orchestrationId
    })
  };

  return model;
}

/**
 * @param {object} response
 * @param {string} observationId
 */
export function resolveReceiptForObservation(response, observationId) {
  const result = findResultByObservationId(response, observationId);
  if (!result) return null;
  const family = result.category || result.nativeCollectionId;
  return buildSafeQueryReceiptInspectorModel(response, family, result.queryReceiptId);
}

/**
 * Controlled provider-issue fixture model for acceptance.
 */
export function buildProviderIssueReceiptFixture() {
  const response = {
    bundleId: 'iqai.pi.bundle.fixture-provider-issue',
    orchestrationId: 'iqai.pi.bundleorch.fixture',
    bundleState: 'PARTIAL_FAILURE',
    request: {
      geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      radiusMeters: 3000,
      temporalIntent: { mode: 'LATEST' }
    },
    plannerDecision: { selectionMode: 'AUTO', temporalIntent: { mode: 'LATEST' }, eligible: [{
      informationFamily: 'air-quality',
      capabilityId: 'iqai.pi.candidate.fixture',
      nativeId: 'aqhi-observations-realtime'
    }] },
    families: {
      'air-quality': {
        informationFamily: 'air-quality',
        queryState: 'PROVIDER_UNAVAILABLE',
        queryReceiptId: 'iqai.pi.qreceipt.fixture-issue',
        queryRequestId: 'iqai.pi.queryreq.fixture-issue',
        resultCount: 0,
        results: [],
        hasEvidence: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Provider temporarily unavailable',
          retryable: true,
          authorization: 'Bearer secret-token-should-redact',
          apiKey: 'evil-key'
        },
        nativeId: 'aqhi-observations-realtime'
      }
    },
    queryReceipts: [{
      queryReceiptId: 'iqai.pi.qreceipt.fixture-issue',
      queryRequestId: 'iqai.pi.queryreq.fixture-issue',
      informationFamily: 'air-quality',
      queryState: 'PROVIDER_UNAVAILABLE'
    }],
    spatialSummary: {
      requestedGeometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      radiusMeters: 3000,
      families: [{
        informationFamily: 'air-quality',
        spatialEligibility: {
          requestedRadiusMeters: 3000,
          providerResultsReceived: 0,
          resultsReturned: 0
        }
      }]
    }
  };
  return buildSafeQueryReceiptInspectorModel(response, 'air-quality');
}
