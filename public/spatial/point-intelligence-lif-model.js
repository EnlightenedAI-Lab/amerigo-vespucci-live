/**
 * Location Intelligence Focus (LIF) — presentation model only.
 * Transforms Agent 5 bundle / adapted multi-family response into UI structure.
 * Does NOT normalize evidence or plan capabilities.
 */
import {
  DEFAULT_RADIUS_METERS,
  getPointIntelligenceFamilyMetadata,
  listPointIntelligenceDomains,
  POINT_INTELLIGENCE_FAMILY_ORDER
} from './point-intelligence-config.js';

function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/** @typedef {'EVIDENCE' | 'NO_LOCAL_EVIDENCE' | 'NOT_APPLICABLE' | 'PROVIDER_ISSUE'} CoverageState */

const PROVIDER_ISSUE_STATES = new Set([
  'PROVIDER_UNAVAILABLE',
  'QUERY_TIMEOUT',
  'QUERY_SAFETY_BLOCKED',
  'PARTIAL_FAILURE',
  'ERROR'
]);

const EVIDENCE_QUERY_STATES = new Set(['SUCCESS', 'PARTIAL_RESULTS']);

const TEMPORAL_BUCKET = Object.freeze({
  STATIC: 'stationRegistry',
  STATION_REGISTRY: 'stationRegistry',
  HISTORICAL: 'historical',
  RECENT: 'recent',
  NEAR_REAL_TIME: 'nearRealTime'
});

const TEMPORAL_BUCKET_LABELS = Object.freeze({
  stationRegistry: 'Station registry',
  historical: 'Historical',
  recent: 'Recent',
  nearRealTime: 'Near real-time'
});

const COVERAGE_LABELS = Object.freeze({
  EVIDENCE: 'Evidence',
  NO_LOCAL_EVIDENCE: 'No local evidence',
  NOT_APPLICABLE: 'Not applicable',
  PROVIDER_ISSUE: 'Provider issue'
});

/**
 * @param {string} queryState
 * @param {boolean} hasEvidence
 */
export function deriveCoverageState(queryState, hasEvidence) {
  const state = String(queryState || '').toUpperCase();
  if (hasEvidence && EVIDENCE_QUERY_STATES.has(state)) return 'EVIDENCE';
  if (state === 'NO_APPLICABLE_CAPABILITY' || state === 'NO_VERIFIED_CAPABILITY') return 'NOT_APPLICABLE';
  if (PROVIDER_ISSUE_STATES.has(state)) return 'PROVIDER_ISSUE';
  if (state === 'NO_RESULTS' || !hasEvidence) return 'NO_LOCAL_EVIDENCE';
  return 'NO_LOCAL_EVIDENCE';
}

/**
 * @param {string | null | undefined} classification
 */
export function temporalClassificationBucket(classification) {
  return TEMPORAL_BUCKET[String(classification || '').toUpperCase()] || null;
}

/**
 * @param {object} response
 */
export function buildTemporalMix(response) {
  const mix = {
    stationRegistry: 0,
    historical: 0,
    recent: 0,
    nearRealTime: 0
  };
  for (const family of Object.values(response?.families || {})) {
    if (!family?.hasEvidence) continue;
    const bucket = temporalClassificationBucket(
      family.temporalClassification || family.results?.[0]?.temporalClassification
    );
    if (bucket) mix[bucket] += 1;
  }
  return Object.entries(mix)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      label: TEMPORAL_BUCKET_LABELS[key],
      count
    }));
}

/**
 * @param {object} entry
 * @param {object} [relationships]
 */
function familyNearestDistance(entry, relationships) {
  const family = entry.informationFamily;
  const rel = relationships?.nearestObservationPerFamily?.[family];
  if (rel?.clickDistanceMeters != null) return rel.clickDistanceMeters;
  const first = entry.results?.[0];
  return first?.clickDistanceMeters ?? null;
}

/**
 * @param {number | null | undefined} seconds
 */
export function formatObservationAge(seconds) {
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)} sec ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

/**
 * @param {object} entry
 * @param {object} [relationships]
 */
function familyNewestAge(entry, relationships) {
  const family = entry.informationFamily;
  const rel = relationships?.observationAgePerFamily?.[family];
  if (rel?.seconds != null) return formatObservationAge(rel.seconds);
  return null;
}

/**
 * @param {object} entry
 */
function buildFamilyRow(entry, relationships, radiusMeters) {
  const meta = getPointIntelligenceFamilyMetadata(entry.informationFamily);
  const coverageState = deriveCoverageState(entry.queryState, entry.hasEvidence);
  const temporalClass = entry.temporalClassification
    || entry.results?.[0]?.temporalClassification
    || null;
  const temporalLabel = temporalClassificationBucket(temporalClass)
    ? TEMPORAL_BUCKET_LABELS[temporalClassificationBucket(temporalClass)]
    : null;
  const resultCount = entry.resultCount ?? entry.results?.length ?? 0;
  const nearest = familyNearestDistance(entry, relationships);
  const newestAge = familyNewestAge(entry, relationships);

  let summaryLine = '';
  if (coverageState === 'EVIDENCE') {
    const parts = ['Evidence'];
    if (resultCount > 0) parts.push(`${resultCount} observation${resultCount === 1 ? '' : 's'}`);
    if (temporalLabel) parts.push(temporalLabel);
    summaryLine = parts.join(' · ');
  } else if (coverageState === 'NO_LOCAL_EVIDENCE') {
    summaryLine = `No local evidence within ${formatDistanceMeters(radiusMeters) || `${radiusMeters} m`}`;
  } else if (coverageState === 'NOT_APPLICABLE') {
    summaryLine = 'No applicable capability at this location';
  } else if (coverageState === 'PROVIDER_ISSUE') {
    summaryLine = String(entry.queryState || 'Provider issue').replace(/_/g, ' ').toLowerCase();
  }

  const headerMeta = [];
  if (nearest != null) headerMeta.push(formatDistanceMeters(nearest));
  if (newestAge) headerMeta.push(newestAge);

  return {
    informationFamily: entry.informationFamily,
    label: meta.label,
    domainId: meta.domainId,
    domainOrder: meta.domainOrder,
    familyOrder: meta.order,
    coverageState,
    coverageLabel: COVERAGE_LABELS[coverageState],
    queryState: entry.queryState,
    hasEvidence: Boolean(entry.hasEvidence),
    resultCount,
    temporalClassification: temporalClass,
    temporalLabel,
    nearestDistanceMeters: nearest,
    nearestDistanceLabel: formatDistanceMeters(nearest),
    newestAgeLabel: newestAge,
    summaryLine,
    headerMeta: headerMeta.filter(Boolean),
    queryReceiptId: entry.queryReceiptId || null,
    results: entry.results || [],
    sortPriority: coverageSortPriority(coverageState)
  };
}

/**
 * @param {CoverageState} state
 */
function coverageSortPriority(state) {
  switch (state) {
    case 'EVIDENCE': return 0;
    case 'NO_LOCAL_EVIDENCE': return 1;
    case 'NOT_APPLICABLE': return 2;
    case 'PROVIDER_ISSUE': return 3;
    default: return 4;
  }
}

/**
 * @param {object[]} familyRows
 */
export function groupFamiliesByDomain(familyRows) {
  const domains = listPointIntelligenceDomains();
  /** @type {Map<string, object>} */
  const domainMap = new Map(domains.map((domain) => [domain.id, { ...domain, families: [] }]));
  domainMap.set('other', { id: 'other', label: 'Other', order: 999, families: [] });

  for (const row of familyRows) {
    const domain = domainMap.get(row.domainId) || domainMap.get('other');
    domain.families.push(row);
  }

  for (const domain of domainMap.values()) {
    domain.families.sort((a, b) => (
      a.sortPriority - b.sortPriority
      || a.familyOrder - b.familyOrder
      || a.label.localeCompare(b.label)
    ));
    domain.evidenceCount = domain.families.filter((f) => f.coverageState === 'EVIDENCE').length;
    domain.familyCount = domain.families.length;
  }

  return [...domainMap.values()].filter((domain) => domain.families.length > 0);
}

/**
 * @param {object} response
 * @param {{ latitude: number, longitude: number }} [point]
 */
export function buildFamilyCoverageModel(response, point) {
  const relationships = response?.relationships || null;
  const radiusMeters = response?.request?.radiusMeters ?? DEFAULT_RADIUS_METERS;
  const families = response?.families || {};
  const order = POINT_INTELLIGENCE_FAMILY_ORDER.filter((family) => families[family]);
  const unordered = Object.keys(families).filter((family) => !order.includes(family));
  const familyKeys = [...order, ...unordered];

  const rows = familyKeys.map((family) => buildFamilyRow(
    { informationFamily: family, ...families[family] },
    relationships,
    radiusMeters
  ));

  return {
    radiusMeters,
    rows,
    domains: groupFamiliesByDomain(rows)
  };
}

/**
 * @param {object} response
 */
export function buildBundleSummaryModel(response) {
  const families = Object.values(response?.families || {});
  const familiesChecked = response?.familiesQueried ?? families.length;
  const withEvidence = families.filter((f) => f.hasEvidence).length;
  const withoutLocalEvidence = families.filter((f) => (
    deriveCoverageState(f.queryState, f.hasEvidence) === 'NO_LOCAL_EVIDENCE'
  )).length;
  const notApplicable = families.filter((f) => (
    deriveCoverageState(f.queryState, f.hasEvidence) === 'NOT_APPLICABLE'
  )).length;
  const providerIssues = families.filter((f) => (
    deriveCoverageState(f.queryState, f.hasEvidence) === 'PROVIDER_ISSUE'
  )).length;

  const bundleState = String(response?.bundleState || response?.queryState || 'ERROR').toUpperCase();
  const healthyPartial = bundleState === 'PARTIAL_RESULTS'
    && providerIssues === 0
    && withEvidence > 0;

  let bundleStateLabel = bundleState.replace(/_/g, ' ').toLowerCase();
  if (healthyPartial) bundleStateLabel = 'partial evidence';

  return {
    familiesChecked,
    familiesWithEvidence: withEvidence,
    familiesWithoutLocalEvidence: withoutLocalEvidence,
    familiesNotApplicable: notApplicable,
    familiesWithProviderIssues: providerIssues,
    bundleState,
    bundleStateLabel,
    healthyPartial,
    evidenceSummary: `${withEvidence} of ${familiesChecked} information families returned local evidence`,
    temporalMix: buildTemporalMix(response)
  };
}

/**
 * @param {object} relationships
 * @param {Record<string, object>} familyLabelByKey
 * @param {number} [radiusMeters]
 */
export function buildDeterministicFactModel(relationships, familyLabelByKey = {}, radiusMeters = DEFAULT_RADIUS_METERS) {
  if (!relationships || typeof relationships !== 'object') return [];
  const facts = [];

  for (const [family, info] of Object.entries(relationships.nearestObservationPerFamily || {})) {
    if (info?.clickDistanceMeters == null) continue;
    const label = familyLabelByKey[family]?.label || family;
    const place = info.stationName || info.placeName || info.title || null;
    const distance = formatDistanceMeters(info.clickDistanceMeters);
    facts.push({
      kind: 'nearest',
      familyKey: family,
      focusable: true,
      priority: 10,
      label: 'Nearest',
      text: place ? `${label} · ${place} · ${distance}` : `${label} · ${distance}`
    });
  }

  for (const [family, info] of Object.entries(relationships.observationAgePerFamily || {})) {
    if (!info || info.seconds == null) continue;
    const label = familyLabelByKey[family]?.label || family;
    const age = formatObservationAge(info.seconds);
    facts.push({
      kind: 'newest',
      familyKey: family,
      focusable: true,
      priority: 20,
      label: 'Newest',
      text: `${label} · ${age}`
    });
  }

  for (const gap of relationships.coverageGaps || []) {
    const family = gap?.informationFamily || gap?.family;
    if (!family) continue;
    const label = familyLabelByKey[family]?.label || family;
    facts.push({
      kind: 'coverage',
      priority: 30,
      label: 'Coverage',
      text: `${label} · no local evidence within ${formatDistanceMeters(radiusMeters) || `${radiusMeters} m`}`
    });
  }

  if (relationships.timestampSpread?.spreadSeconds != null) {
    const spreadHours = (relationships.timestampSpread.spreadSeconds / 3600).toFixed(0);
    facts.push({
      kind: 'spread',
      priority: 40,
      label: 'Time span',
      text: `Evidence timestamps span ${spreadHours} h`
    });
  }

  for (const shared of relationships.sharedStationIdentifiers || []) {
    if (!shared?.identifier) continue;
    const families = (shared.families || []).map((f) => familyLabelByKey[f]?.label || f).join(', ');
    facts.push({
      kind: 'shared',
      priority: 50,
      label: 'Shared station',
      text: families ? `${families} · ${shared.identifier}` : shared.identifier
    });
  }

  return facts.sort((a, b) => a.priority - b.priority).slice(0, 8);
}

/**
 * @param {object} response
 * @param {{ latitude?: number, longitude?: number, lat?: number, lon?: number }} [point]
 */
export function buildLocationIntelligenceFocusModel(response, point = {}) {
  const lat = point?.latitude ?? point?.lat
    ?? response?.request?.geometry?.coordinates?.[1];
  const lon = point?.longitude ?? point?.lon
    ?? response?.request?.geometry?.coordinates?.[0];
  const radiusMeters = response?.request?.radiusMeters ?? DEFAULT_RADIUS_METERS;

  const summary = buildBundleSummaryModel(response);
  const coverage = buildFamilyCoverageModel(response, point);

  const familyLabelByKey = Object.fromEntries(
    coverage.rows.map((row) => [row.informationFamily, row])
  );

  const facts = buildDeterministicFactModel(
    response?.relationships,
    familyLabelByKey,
    radiusMeters
  );

  return {
    heading: 'Point Intelligence',
    location: {
      latitude: lat,
      longitude: lon,
      radiusMeters,
      label: Number.isFinite(lat) && Number.isFinite(lon)
        ? `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`
        : null
    },
    summary,
    coverage,
    facts,
    bundleId: response?.bundleId || null,
    orchestrationId: response?.orchestrationId || null
  };
}

export { COVERAGE_LABELS, TEMPORAL_BUCKET_LABELS };
