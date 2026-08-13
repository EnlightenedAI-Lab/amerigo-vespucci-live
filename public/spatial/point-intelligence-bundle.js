/**
 * Agent 5 LocationIntelligenceBundle → Agent 1 presentation model adapter.
 */
import { POINT_INTELLIGENCE_FAMILY_ORDER } from './point-intelligence-config.js';

const EVIDENCE_STATES = new Set(['SUCCESS', 'PARTIAL_RESULTS']);

/**
 * @param {string} status
 */
export function familyStatusHasEvidence(status) {
  return EVIDENCE_STATES.has(String(status || ''));
}

/**
 * @param {object} bundle
 */
export function isBundleResponse(bundle) {
  return Boolean(
    bundle?.bundleId
    || bundle?.bundle === true
    || (Array.isArray(bundle?.families) && bundle?.bundleState)
  );
}

/**
 * @param {object} familyEvidence
 */
export function familyEvidenceHasResults(familyEvidence) {
  if (!familyEvidence) return false;
  const count = familyEvidence.resultCount ?? familyEvidence.results?.length ?? 0;
  return familyStatusHasEvidence(familyEvidence.status) && count > 0;
}

/**
 * @param {object} bundle Agent 5 LocationIntelligenceBundle
 * @param {{ longitude: number, latitude: number }} point
 * @param {number} queryGroupId
 */
export function adaptBundleResponse(bundle, point, queryGroupId) {
  /** @type {Record<string, object>} */
  const familyMap = {};
  const flatResults = [];

  for (const familyEvidence of bundle?.families || []) {
    const family = familyEvidence.informationFamily;
    const results = Array.isArray(familyEvidence.results) ? familyEvidence.results : [];
    const hasEvidence = familyEvidenceHasResults(familyEvidence);
    familyMap[family] = {
      informationFamily: family,
      queryState: familyEvidence.status,
      operatorStatus: familyEvidence.operatorStatus
        || (hasEvidence ? 'PASS' : (familyEvidence.status === 'NO_RESULTS' ? 'NO DATA' : 'UNAVAILABLE')),
      queryReceiptId: familyEvidence.queryReceiptId || null,
      queryRequestId: familyEvidence.queryRequestId || null,
      resultCount: familyEvidence.resultCount ?? results.length,
      results,
      hasEvidence,
      error: familyEvidence.error || null,
      nativeId: familyEvidence.nativeId || null,
      temporalClassification: familyEvidence.temporalClassification || null
    };
    if (hasEvidence) {
      flatResults.push(...results.map((result) => ({
        ...result,
        category: result.category || family
      })));
    }
  }

  const familiesWithEvidence = Object.values(familyMap).filter((entry) => entry.hasEvidence).length;
  const bundleState = bundle?.bundleState || 'ERROR';

  return {
    bundle: true,
    bundleId: bundle?.bundleId || null,
    orchestrationId: bundle?.orchestrationId || null,
    bundleState,
    queryState: bundleState,
    multiFamily: true,
    queryGroupId,
    families: familyMap,
    familiesWithEvidence,
    familiesQueried: bundle?.families?.length ?? Object.keys(familyMap).length,
    results: flatResults,
    resultCount: flatResults.length,
    plannerDecision: bundle?.plannerDecision || null,
    relationships: bundle?.relationships || null,
    queryReceipts: bundle?.queryReceipts || [],
    temporalSummary: bundle?.temporalSummary || null,
    spatialSummary: bundle?.spatialSummary || null,
    request: bundle?.query || {
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      selectionMode: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    },
    error: bundle?.error || null,
    timings: bundle?.timings || null,
    fallback: bundle?.fallback || null
  };
}

/**
 * @param {object} response
 */
export function listBundleFamilies(response) {
  if (!response?.families) return [];
  return POINT_INTELLIGENCE_FAMILY_ORDER.filter((family) => response.families[family]);
}

/**
 * @param {object} relationships
 */
export function formatRelationshipFacts(relationships) {
  if (!relationships || typeof relationships !== 'object') return [];
  const facts = [];
  const availability = relationships.familyAvailability;
  if (availability) {
    facts.push(`${availability.withResults ?? 0} of ${availability.requested ?? 0} families returned evidence`);
  }
  for (const [family, info] of Object.entries(relationships.observationAgePerFamily || {})) {
    if (!info || info.seconds == null) continue;
    const minutes = Math.round(info.seconds / 60);
    facts.push(`${family} observation: ${minutes} min old`);
  }
  for (const [family, info] of Object.entries(relationships.nearestObservationPerFamily || {})) {
    if (info?.clickDistanceMeters == null) continue;
    const meters = info.clickDistanceMeters;
    const label = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
    facts.push(`Nearest ${family}: ${label}`);
  }
  if (relationships.timestampSpread?.spreadSeconds != null) {
    const spreadMin = Math.round(relationships.timestampSpread.spreadSeconds / 60);
    facts.push(`Observation time spread: ${spreadMin} min`);
  }
  return facts;
}
