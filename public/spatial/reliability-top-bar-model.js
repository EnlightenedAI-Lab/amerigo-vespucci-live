/**
 * Reliability / Trust top bar view model — deterministic receipt projection only.
 * Aggregation rules are documented inline; no fabricated confidence scores.
 */

export const REASON_CODE_HINTS = Object.freeze({
  UNKNOWN_OCCURRENCE: 'Occurrence time could not be established.',
  NO_SOURCE_URL: 'No source URL provided.',
  MISSING_PROVENANCE: 'Missing provenance context.',
  OUTSIDE_TIME_WINDOW: 'Outside the requested time window.',
  MISSING_LOCATION_TEXT: 'Location text is missing.',
  COARSE_LOCATION_ONLY: 'Location precision is too coarse.',
  DUPLICATE_EVENT: 'Duplicate event.',
  SPATIAL_CONFLICT: 'Spatial conflict detected.',
  PRODUCTION_FIXTURE: 'Production fixture marker.',
  AGGREGATOR_SOURCE: 'Aggregator source lineage.',
  MISSING_OCCURRENCE: 'Occurrence time is missing.',
  ADMITTED: 'Admitted by Agent 2 governance.'
});

/**
 * @param {{ ADMIT?: number, ADMIT_WITH_CAUTION?: number, HOLD?: number, REJECT?: number }} governanceCounts
 */
export function aggregateGovernanceOutcome(governanceCounts = {}) {
  const admit = governanceCounts.ADMIT || 0;
  const caution = governanceCounts.ADMIT_WITH_CAUTION || 0;
  const hold = governanceCounts.HOLD || 0;
  const reject = governanceCounts.REJECT || 0;
  const total = admit + caution + hold + reject;
  if (total === 0) return 'NO CANDIDATES';
  const labels = [];
  if (admit > 0) labels.push('ADMIT');
  if (caution > 0) labels.push('CAUTION');
  if (hold > 0) labels.push('HOLD');
  if (reject > 0) labels.push('REJECT');
  if (labels.length === 1) return labels[0];
  return 'MIXED';
}

/**
 * @param {string} code
 */
export function reasonCodeHint(code) {
  if (!code) return null;
  return REASON_CODE_HINTS[code] || null;
}

/**
 * @param {string[] | null | undefined} reasonCodes
 */
export function formatReasonCodesHuman(reasonCodes = []) {
  if (!Array.isArray(reasonCodes) || !reasonCodes.length) return null;
  return reasonCodes.map((code) => {
    const hint = reasonCodeHint(code);
    return hint ? `${code} — ${hint}` : code;
  }).join('\n');
}

/**
 * @param {object[]} rejectionDiagnostics
 * @param {string | null} governanceOutcome
 */
export function buildRejectionPresentation(rejectionDiagnostics = [], governanceOutcome = null) {
  if (!rejectionDiagnostics.length) {
    if (governanceOutcome === 'REJECT') {
      return { compact: 'REJECT', detail: null, reasonCodes: [] };
    }
    return { compact: null, detail: null, reasonCodes: [] };
  }
  const codes = new Set();
  for (const row of rejectionDiagnostics) {
    for (const code of row.reasonCodes || []) codes.add(code);
  }
  const uniqueCodes = [...codes];
  const outcome = governanceOutcome === 'MIXED' ? 'REJECT' : (governanceOutcome || 'REJECT');
  if (uniqueCodes.length === 1) {
    const code = uniqueCodes[0];
    return {
      compact: `${outcome} · ${code.replace(/_/g, ' ')}`,
      detail: reasonCodeHint(code),
      reasonCodes: uniqueCodes
    };
  }
  return {
    compact: `${outcome} · ${uniqueCodes.length} REASONS`,
    detail: formatReasonCodesHuman(uniqueCodes),
    reasonCodes: uniqueCodes
  };
}

/**
 * Minimum independent lineage count across candidates (documented aggregation).
 * @param {object[]} candidates
 * @param {Record<string, object>} governedLookup
 */
export function deriveCorroborationDisplay(candidates = [], governedLookup = {}) {
  let minIndependent = null;
  let maxIndependent = null;
  let minLineage = null;
  for (const candidate of candidates) {
    const lineage = governedLookup[candidate.eventId]?.admissionDecision?.evidenceLineageFacts
      || governedLookup[candidate.eventId]?.admission?.evidenceLineageFacts
      || {};
    const independent = lineage.independentLineageCount;
    const lineageCount = lineage.lineageCount;
    if (Number.isFinite(independent)) {
      minIndependent = minIndependent == null ? independent : Math.min(minIndependent, independent);
      maxIndependent = maxIndependent == null ? independent : Math.max(maxIndependent, independent);
    }
    if (Number.isFinite(lineageCount)) {
      minLineage = minLineage == null ? lineageCount : Math.min(minLineage, lineageCount);
    }
  }
  if (minIndependent == null && minLineage == null) {
    return {
      display: '—',
      detail: 'Corroboration not available on run receipt.',
      sourceField: 'admissionDecision.evidenceLineageFacts'
    };
  }
  if ((maxIndependent ?? minIndependent ?? 0) <= 1 && (minLineage ?? 0) <= 1) {
    return {
      display: 'SINGLE LINEAGE',
      detail: 'No independent lineage corroboration detected across governed candidates.',
      sourceField: 'admissionDecision.evidenceLineageFacts.independentLineageCount'
    };
  }
  const range = minIndependent === maxIndependent
    ? String(minIndependent)
    : `${minIndependent}–${maxIndependent}`;
  return {
    display: `INDEPENDENT ${range}`,
    detail: 'Minimum independent lineage count across governed candidates.',
    sourceField: 'admissionDecision.evidenceLineageFacts.independentLineageCount'
  };
}

/**
 * Run-level integrity uses minimum available assessed score when present; otherwise unavailable.
 * @param {object[]} candidates
 * @param {Record<string, object>} governedLookup
 */
export function deriveIntegrityDisplay(candidates = [], governedLookup = {}) {
  let minScore = null;
  let minGrade = null;
  for (const candidate of candidates) {
    const assessment = governedLookup[candidate.eventId]?.integrityAssessment
      || governedLookup[candidate.eventId]?.admissionDecision?.integrityAssessment
      || null;
    if (!assessment) continue;
    if (Number.isFinite(assessment.score)) {
      minScore = minScore == null ? assessment.score : Math.min(minScore, assessment.score);
    }
    if (assessment.grade && !minGrade) minGrade = assessment.grade;
  }
  if (minScore == null) {
    return {
      display: '—',
      detail: 'Integrity assessment not present on run receipt.',
      sourceField: 'integrityAssessment (not on receipt V1)'
    };
  }
  return {
    display: minGrade ? `${minScore} · ${minGrade}` : String(minScore),
    detail: 'Minimum integrity score across candidates with assessments (no averaging).',
    sourceField: 'integrityAssessment.score'
  };
}

/**
 * @param {object[]} candidates
 * @param {Record<string, object>} governedLookup
 * @param {object[]} rejectionDiagnostics
 */
export function deriveTemporalReliability(candidates = [], governedLookup = {}, rejectionDiagnostics = []) {
  const reasonCodes = new Set(rejectionDiagnostics.flatMap((row) => row.reasonCodes || []));
  for (const candidate of candidates) {
    for (const code of candidate.reasonCodes || []) reasonCodes.add(code);
  }
  if (reasonCodes.has('UNKNOWN_OCCURRENCE') || reasonCodes.has('MISSING_OCCURRENCE')) {
    return {
      display: 'TIME UNKNOWN',
      tone: 'warn',
      detail: 'Occurrence time not established.',
      sourceField: 'admissionDecision.reasonCodes / temporalFacts.occurrenceKnown'
    };
  }

  let hasPublishedOnly = false;
  let hasKnown = false;
  for (const candidate of candidates) {
    const temporal = governedLookup[candidate.eventId]?.admissionDecision?.temporalFacts || {};
    if (temporal.publishedAtSubstitutedForOccurrence) hasPublishedOnly = true;
    if (temporal.occurrenceKnown && temporal.occurredAt) hasKnown = true;
    if (!temporal.occurrenceKnown && temporal.publishedAt) hasPublishedOnly = true;
  }
  if (hasKnown && !hasPublishedOnly) {
    return {
      display: 'TIME ✓',
      tone: 'ok',
      detail: 'Occurrence time known for at least one governed candidate.',
      sourceField: 'admissionDecision.temporalFacts.occurrenceKnown'
    };
  }
  if (hasPublishedOnly) {
    return {
      display: 'TIME APPROX',
      tone: 'warn',
      detail: 'Publication time present; occurrence certainty is limited.',
      sourceField: 'admissionDecision.temporalFacts.publishedAt'
    };
  }
  return {
    display: 'UNKNOWN',
    tone: 'neutral',
    detail: 'Temporal certainty not established.',
    sourceField: 'admissionDecision.temporalFacts'
  };
}

/**
 * @param {object[]} candidates
 * @param {Record<string, object>} governedLookup
 */
export function deriveSpatialReliability(candidates = [], governedLookup = {}) {
  const labels = [];
  for (const candidate of candidates) {
    const spatial = governedLookup[candidate.eventId]?.admissionDecision?.spatialFacts || {};
    if (spatial.spatialConflict) labels.push('CONFLICTING');
    else if (spatial.locationPrecision) labels.push(String(spatial.locationPrecision).replace(/_/g, ' '));
    else if (spatial.geometryProvided === false || spatial.geocodeDeferred) labels.push('UNRESOLVED');
  }
  if (!labels.length) {
    return {
      display: '—',
      detail: 'Spatial precision not available on run receipt.',
      sourceField: 'admissionDecision.spatialFacts.locationPrecision'
    };
  }
  const unique = [...new Set(labels)];
  if (unique.length === 1) {
    const label = unique[0];
    const tone = label === 'UNRESOLVED' || label === 'CONFLICTING' ? 'warn' : 'ok';
    return {
      display: `LOCATION ${label}`,
      tone,
      detail: 'Derived from governed candidate spatialFacts (geocoder confidence separate from source trust).',
      sourceField: 'admissionDecision.spatialFacts.locationPrecision'
    };
  }
  return {
    display: 'LOCATION MIXED',
    tone: 'warn',
    detail: unique.join(', '),
    sourceField: 'admissionDecision.spatialFacts.locationPrecision'
  };
}

/**
 * @param {object[]} candidates
 * @param {Record<string, object>} governedLookup
 */
export function deriveFreshnessDisplay(candidates = [], governedLookup = {}) {
  let hasOccurrence = false;
  let hasPublicationOnly = false;
  for (const candidate of candidates) {
    const temporal = governedLookup[candidate.eventId]?.admissionDecision?.temporalFacts || {};
    if (temporal.occurrenceKnown && temporal.occurredAt) hasOccurrence = true;
    if (temporal.publishedAt && !temporal.occurrenceKnown) hasPublicationOnly = true;
  }
  if (hasOccurrence) {
    return {
      display: 'AS OF OCCURRENCE',
      detail: 'Freshness anchored to occurrence time when known.',
      sourceField: 'admissionDecision.temporalFacts.occurredAt'
    };
  }
  if (hasPublicationOnly) {
    return {
      display: 'PUBLICATION ONLY',
      detail: 'Publication time only — not occurrence certainty.',
      sourceField: 'admissionDecision.temporalFacts.publishedAt'
    };
  }
  return {
    display: 'UNKNOWN',
    detail: 'Freshness not established.',
    sourceField: 'admissionDecision.temporalFacts'
  };
}

/**
 * @param {object | null | undefined} next
 * @param {object | null | undefined} prev
 */
export function shouldApplyReceiptUpdate(next, prev) {
  if (!next) return false;
  if (!prev) return true;
  if (next.receiptId && prev.receiptId && next.receiptId === prev.receiptId) return true;
  const nextTs = Date.parse(next.clientCompletedAt || next.persistedAt || next.completedAt || 0);
  const prevTs = Date.parse(prev.clientCompletedAt || prev.persistedAt || prev.completedAt || 0);
  if (!Number.isFinite(nextTs) || !Number.isFinite(prevTs)) return true;
  return nextTs >= prevTs;
}

/**
 * @param {object} input
 */
export function buildReliabilityTopBarModel(input = {}) {
  const context = input.context || 'INTELLIGENCE';
  if (context === 'DETERMINISTIC_GIS') {
    return {
      visible: true,
      mode: 'DETERMINISTIC_GIS',
      pills: [{ key: 'RELIABILITY', value: 'GIS', tone: 'neutral' }],
      detail: {
        title: 'RELIABILITY',
        rows: [
          { label: 'Context', value: 'Deterministic GIS command' },
          { label: 'Intelligence metrics', value: 'Hidden — not an AI Map intelligence run' }
        ]
      }
    };
  }

  const receipt = input.receipt || null;
  if (!receipt?.receiptId) {
    return {
      visible: true,
      mode: 'NO_RUN',
      pills: [{ key: 'RELIABILITY', value: 'NO RUN', tone: 'neutral' }],
      detail: {
        title: 'RELIABILITY',
        rows: [{ label: 'Status', value: 'No AI Map intelligence run recorded yet.' }]
      }
    };
  }

  const governedLookup = input.governedLookup || {};
  const candidates = Array.isArray(receipt.candidates) ? receipt.candidates : [];
  const governanceOutcome = aggregateGovernanceOutcome(receipt.governanceCounts || {});
  const rejection = buildRejectionPresentation(receipt.rejectionDiagnostics || [], governanceOutcome);
  const integrity = deriveIntegrityDisplay(candidates, governedLookup);
  const corroboration = deriveCorroborationDisplay(candidates, governedLookup);
  const temporal = deriveTemporalReliability(candidates, governedLookup, receipt.rejectionDiagnostics || []);
  const spatial = deriveSpatialReliability(candidates, governedLookup);
  const freshness = deriveFreshnessDisplay(candidates, governedLookup);

  const pills = [
    { key: 'RELIABILITY', value: 'RUN', tone: 'neutral' },
    { key: 'SOURCES', value: String(receipt.sourceResultCount ?? '—'), tone: 'neutral' },
    { key: 'GOVERNED', value: String(receipt.governedCandidateCount ?? '—'), tone: 'neutral' },
    { key: 'MAPPED', value: String(receipt.mappedCount ?? 0), tone: receipt.mappedCount > 0 ? 'ok' : 'neutral' },
    { key: 'GOVERNANCE', value: governanceOutcome, tone: governanceOutcome === 'REJECT' || governanceOutcome === 'HOLD' ? 'warn' : (governanceOutcome === 'ADMIT' ? 'ok' : 'neutral') }
  ];
  if (rejection.compact) {
    pills.push({ key: 'REASON', value: rejection.compact, tone: 'warn' });
  }
  if (temporal.display) {
    pills.push({ key: 'TIME', value: temporal.display, tone: temporal.tone || 'neutral' });
  }
  if (spatial.display && spatial.display !== '—') {
    pills.push({ key: 'LOCATION', value: spatial.display.replace(/^LOCATION\s+/, ''), tone: spatial.tone || 'neutral' });
  }
  if (integrity.display !== '—') {
    pills.push({ key: 'INTEGRITY', value: integrity.display, tone: 'neutral' });
  } else if (corroboration.display !== '—') {
    pills.push({ key: 'CORROBORATION', value: corroboration.display, tone: 'neutral' });
  }

  return {
    visible: true,
    mode: 'INTELLIGENCE_RUN',
    query: receipt.query || null,
    receiptId: receipt.receiptId || null,
    traceId: receipt.traceId || null,
    pills,
    governanceOutcome,
    rejection,
    integrity,
    corroboration,
    temporal,
    spatial,
    freshness,
    detail: {
      title: 'RELIABILITY',
      rows: [
        { label: 'Sources', value: String(receipt.sourceResultCount ?? '—') },
        { label: 'Governed', value: String(receipt.governedCandidateCount ?? '—') },
        { label: 'Mapped', value: String(receipt.mappedCount ?? 0) },
        { label: 'Governance', value: governanceOutcome },
        { label: 'Reason', value: rejection.compact || '—' },
        { label: 'Reason detail', value: rejection.detail || formatReasonCodesHuman(rejection.reasonCodes) || '—' },
        { label: 'Integrity', value: integrity.display },
        { label: 'Corroboration', value: corroboration.display },
        { label: 'Temporal precision', value: temporal.display },
        { label: 'Location precision', value: spatial.display },
        { label: 'Freshness', value: freshness.display },
        { label: 'Receipt', value: receipt.receiptId || '—' }
      ]
    }
  };
}
