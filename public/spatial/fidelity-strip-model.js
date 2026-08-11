/**
 * Deterministic IQAI Trust / Fidelity Strip view model (read-only Agent 2 receipts).
 */
import { getGovernedEvent } from './governed-event-store.js';
import { buildResearchControlBarModel } from './intelligence-research-control-bar.js';
import { getIntelligenceLayersState } from './intelligence-layer-service.js';
import { FIDELITY_SELECTION_MODES } from './fidelity-selection-hub.js';
import { isKnownIqaiDataset } from './agol-feature-details.js';

const CARD_KEYS = Object.freeze([
  'ADMISSION',
  'INTEGRITY',
  'SOURCE',
  'CORROBORATION',
  'SPATIAL',
  'TEMPORAL',
  'PROVENANCE'
]);

const NOT_ASSESSED = 'NOT ASSESSED';
const UNKNOWN = 'UNKNOWN';

function compact(value, fallback = '—') {
  if (value == null || value === '') return fallback;
  return String(value);
}

function formatCorroboration(lineage = {}) {
  const summary = lineage.corroborationSummary;
  if (summary) return String(summary).replace(/_/g, ' ');
  const independent = lineage.independentLineageCount;
  const lineageCount = lineage.lineageCount;
  if (Number.isFinite(independent) && independent > 1) return `${independent} INDEPENDENT`;
  if (Number.isFinite(lineageCount) && lineageCount > 0) return `${lineageCount} LINEAGE`;
  return NOT_ASSESSED;
}

function formatSpatial(spatial = {}) {
  const precision = spatial.locationPrecision || spatial.spatialPrecision;
  if (spatial.spatialConflict) return 'CONFLICTING';
  if (precision) return String(precision).replace(/_/g, ' ');
  if (spatial.geocodeDeferred) return 'DERIVED GEOCODE';
  if (spatial.geometryProvided === false) return 'UNRESOLVED';
  return NOT_ASSESSED;
}

function formatTemporal(temporal = {}) {
  if (temporal.publishedAtSubstitutedForOccurrence) {
    return 'APPROXIMATE · PUBLISHED ONLY';
  }
  if (!temporal.occurrenceKnown && temporal.publishedAt) {
    return `UNKNOWN · PUBL ${compact(temporal.publishedAt, '').slice(0, 10)}`;
  }
  if (temporal.occurrenceKnown && temporal.occurredAt) {
    const precision = temporal.occurrencePrecision || temporal.timePrecision || 'DAY';
    return `KNOWN · ${String(precision).replace(/_/g, ' ')}`;
  }
  if (temporal.occurredAt) return `KNOWN · ${temporal.occurredAt.slice(0, 10)}`;
  if (temporal.publishedAt) return `UNKNOWN · PUBL ${temporal.publishedAt.slice(0, 10)}`;
  return UNKNOWN;
}

function formatSource(source = {}) {
  const cls = source.sourceIntelligenceClass;
  if (cls && cls !== 'UNKNOWN') return String(cls).replace(/_/g, ' ');
  if (source.isOfficial) return 'OFFICIAL';
  if (source.authorityType) return String(source.authorityType).replace(/_/g, ' ');
  return NOT_ASSESSED;
}

function buildIntegrityCard(assessment) {
  if (!assessment) {
    return { primary: NOT_ASSESSED, secondary: null, detail: null };
  }
  const grade = assessment.grade;
  const score = assessment.score;
  const primary = grade != null && score != null ? `${grade} · ${score}` : (assessment.status || NOT_ASSESSED);
  return {
    primary,
    secondary: assessment.status || null,
    detail: {
      model: assessment.integrityModelVersion || '1.0.0',
      dimensions: assessment.dimensions || null,
      rules: assessment.rulesTriggered || [],
      caps: assessment.caps || [],
      warnings: assessment.warnings || [],
      summaryFacts: assessment.summaryFacts || []
    }
  };
}

function splitEventCards(built = {}) {
  const { epistemicBanner = null, ...cards } = built;
  return { cards, epistemicBanner };
}

function buildEventCards({ admissionDecision, integrityAssessment, receipt, whyOnMapNote }) {
  const admission = admissionDecision || {};
  const sourceFacts = admission.sourceFacts || {};
  const spatialFacts = admission.spatialFacts || {};
  const temporalFacts = admission.temporalFacts || {};
  const lineage = admission.evidenceLineageFacts
    || admission.governedCandidate?.evidenceLineageFacts
    || {};

  return {
    ADMISSION: {
      primary: compact(admission.outcome, NOT_ASSESSED),
      secondary: (admission.reasonCodes || []).join(', ') || null,
      detail: {
        permittedDisplayMode: admission.permittedDisplayMode || null,
        governanceStatus: admission.governanceStatus || null
      }
    },
    INTEGRITY: buildIntegrityCard(integrityAssessment),
    SOURCE: {
      primary: formatSource(sourceFacts),
      secondary: sourceFacts.isOfficial ? 'OFFICIAL' : null,
      detail: {
        sourceIntelligenceClass: sourceFacts.sourceIntelligenceClass || null,
        isOfficial: sourceFacts.isOfficial ?? null,
        authorityType: sourceFacts.authorityType || null,
        authoritativeAnchor: lineage.authoritativeAnchor ?? null
      }
    },
    CORROBORATION: {
      primary: formatCorroboration(lineage),
      secondary: lineage.independentLineageCount != null
        ? `${lineage.independentLineageCount} independent · ${lineage.lineageCount ?? 0} lineage`
        : null,
      detail: {
        corroborationSummary: lineage.corroborationSummary || null,
        lineageCount: lineage.lineageCount ?? null,
        independentLineageCount: lineage.independentLineageCount ?? null,
        sourceReportCount: lineage.sourceReportCount ?? null,
        multipleUrlsNotIndependent: lineage.multipleUrlsNotIndependent ?? null,
        copiedOrDerivativeReporting: lineage.copiedOrDerivativeReporting ?? null
      }
    },
    SPATIAL: {
      primary: formatSpatial(spatialFacts),
      secondary: spatialFacts.geometrySource || null,
      detail: {
        locationPrecision: spatialFacts.locationPrecision || null,
        spatialConflict: spatialFacts.spatialConflict ?? null,
        geometryProvided: spatialFacts.geometryProvided ?? null,
        geocodeDeferred: spatialFacts.geocodeDeferred ?? null
      }
    },
    TEMPORAL: {
      primary: formatTemporal(temporalFacts),
      secondary: temporalFacts.occurredAt && temporalFacts.publishedAt
        ? `Occ ${temporalFacts.occurredAt.slice(0, 10)} · Pub ${temporalFacts.publishedAt.slice(0, 10)}`
        : null,
      detail: {
        occurrenceKnown: temporalFacts.occurrenceKnown ?? null,
        occurredAt: temporalFacts.occurredAt || null,
        publishedAt: temporalFacts.publishedAt || null,
        publishedAtSubstitutedForOccurrence: temporalFacts.publishedAtSubstitutedForOccurrence ?? null
      }
    },
    PROVENANCE: {
      primary: compact(receipt?.executionStatus || receipt?.retrievalStatus, NOT_ASSESSED),
      secondary: receipt?.receiptId ? receipt.receiptId.slice(0, 12) : null,
      detail: {
        receiptId: receipt?.receiptId || null,
        corpusIntegrityClass: sourceFacts.corpusIntegrityClass || null,
        evidenceOrigin: receipt?.evidenceOrigin || null,
        retrievalStatus: receipt?.retrievalStatus || null
      }
    },
    epistemicBanner: whyOnMapNote || null
  };
}

function buildRunLayerCards(layerState = {}) {
  const model = buildResearchControlBarModel(layerState);
  const evidence = model.evidence || {};
  return {
    mode: 'RUN_LAYER',
    cards: {
      ADMISSION: {
        primary: evidence.admitted != null ? `${evidence.admitted} ADMIT` : '—',
        secondary: [
          evidence.hold != null ? `${evidence.hold} HOLD` : null,
          evidence.reject != null ? `${evidence.reject} REJECT` : null
        ].filter(Boolean).join(' · ') || null
      },
      INTEGRITY: { primary: NOT_ASSESSED, secondary: 'Run aggregate only' },
      SOURCE: { primary: model.research?.providers || '—', secondary: model.research?.mode || null },
      CORROBORATION: {
        primary: evidence.reports != null ? `${evidence.reports} REPORTS` : '—',
        secondary: evidence.duplicates != null ? `${evidence.duplicates} dup` : null
      },
      SPATIAL: {
        primary: `${model.spatial?.mapped ?? 0} mapped`,
        secondary: model.spatial?.unresolved ? `${model.spatial.unresolved} unresolved` : null
      },
      TEMPORAL: {
        primary: model.temporal?.label || '—',
        secondary: model.temporal?.enforced ? 'Window enforced' : null
      },
      PROVENANCE: {
        primary: model.provenance || '—',
        secondary: model.retrieval || null
      }
    },
    epistemicBanner: null
  };
}

function buildReferenceCards(attributes = {}) {
  const dataset = attributes.datasetId || attributes.iqaiType || attributes.amenity || 'GIS';
  return {
    mode: 'REFERENCE_GIS',
    cards: {
      ADMISSION: { primary: '—', secondary: 'Non-intelligence feature' },
      INTEGRITY: { primary: '—', secondary: 'Non-intelligence feature' },
      SOURCE: { primary: compact(dataset), secondary: attributes.providerName || attributes.sourceName || null },
      CORROBORATION: { primary: '—', secondary: null },
      SPATIAL: { primary: compact(attributes.spatialPrecision, '—'), secondary: null },
      TEMPORAL: { primary: '—', secondary: null },
      PROVENANCE: {
        primary: 'DETERMINISTIC GIS',
        secondary: attributes.datasetId || attributes.iqaiType || null
      }
    },
    epistemicBanner: null
  };
}

function buildOpenWorldCards(item = {}) {
  const raw = item.raw || {};
  return buildEventCards({
    admissionDecision: {
      outcome: raw.admissionOutcome || raw.admissionDecision?.outcome || 'ADMIT',
      reasonCodes: raw.reasonCodes || raw.admissionDecision?.reasonCodes || [],
      sourceFacts: {
        sourceIntelligenceClass: raw.sourceIntelligenceClass || item.sourceFamily || null,
        isOfficial: raw.isOfficial ?? null
      },
      spatialFacts: {
        locationPrecision: item.spatialPrecision || raw.spatialPrecision || null,
        spatialConflict: raw.spatialConflict ?? false,
        geometryProvided: Boolean(item.geometry)
      },
      temporalFacts: {
        occurrenceKnown: Boolean(item.occurrenceTime),
        occurredAt: item.occurrenceTime || null,
        publishedAt: item.publicationTime || null,
        publishedAtSubstitutedForOccurrence: false
      },
      evidenceLineageFacts: {
        corroborationSummary: item.corroboration || raw.corroborationSummary || null,
        lineageCount: raw.lineageCount ?? item.lineage?.eventCandidateCount ?? null,
        independentLineageCount: raw.independentLineageCount ?? null,
        sourceReportCount: raw.sourceReportCount ?? null
      }
    },
    integrityAssessment: item.integrityAssessment || null,
    receipt: raw.receipt || null,
    whyOnMapNote: item.summary || raw.whyOnMapSummary || null
  });
}

/**
 * @param {object} input
 */
export function buildFidelityStripModel(input = {}) {
  const { selection = {}, integrityAssessment = null } = input;
  const mode = selection.mode || FIDELITY_SELECTION_MODES.NONE;

  if (mode === FIDELITY_SELECTION_MODES.NONE) {
    return { visible: false, mode, cards: null, epistemicBanner: null };
  }

  if (mode === FIDELITY_SELECTION_MODES.REFERENCE_GIS) {
    const attrs = selection.attributes || {};
    if (selection.openWorldItem) {
      const split = splitEventCards(buildOpenWorldCards(selection.openWorldItem));
      return { visible: true, mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT, ...split };
    }
    return { visible: true, ...buildReferenceCards(attrs) };
  }

  if (mode === FIDELITY_SELECTION_MODES.OPEN_WORLD) {
    const split = splitEventCards(buildOpenWorldCards(selection.openWorldItem || {}));
    return { visible: true, mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT, ...split };
  }

  if (mode === FIDELITY_SELECTION_MODES.RUN_LAYER) {
    const layerState = input.layerState || getIntelligenceLayersState();
    return { visible: true, ...buildRunLayerCards(layerState) };
  }

  if (mode === FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT) {
    const eventId = selection.eventId || selection.attributes?.eventId;
    const governed = getGovernedEvent(eventId);
    const admissionDecision = governed?.admissionDecision || null;
    const receipt = governed?.receipt || null;
    const whyOnMapNote = selection.attributes?.whyOnMapSummary
      || governed?.candidate?.whyOnMapSummary
      || null;

    if (!admissionDecision && !selection.attributes?.admissionOutcome) {
      if (isKnownIqaiDataset(selection.attributes)) {
        return { visible: true, ...buildReferenceCards(selection.attributes || {}) };
      }
      return { visible: true, mode, cards: buildReferenceCards(selection.attributes || {}).cards, epistemicBanner: null };
    }

    const split = splitEventCards(buildEventCards({
      admissionDecision: admissionDecision || {
        outcome: selection.attributes?.admissionOutcome,
        reasonCodes: selection.attributes?.reasonCodes
          ? String(selection.attributes.reasonCodes).split(',').filter(Boolean)
          : [],
        permittedDisplayMode: selection.attributes?.permittedDisplayMode,
        sourceFacts: {},
        spatialFacts: { locationPrecision: selection.attributes?.locationPrecision },
        temporalFacts: {
          occurredAt: selection.attributes?.occurredAt,
          publishedAt: selection.attributes?.publishedAt,
          occurrenceKnown: Boolean(selection.attributes?.occurredAt)
        },
        evidenceLineageFacts: selection.attributes?.corroborationSummary
          ? { corroborationSummary: selection.attributes.corroborationSummary }
          : {}
      },
      integrityAssessment,
      receipt,
      whyOnMapNote
    }));
    return { visible: true, mode, ...split };
  }

  return { visible: false, mode, cards: null, epistemicBanner: null };
}

/**
 * Build integrity assess API target from governed bundle.
 * @param {object} governed
 */
export function buildIntegrityAssessTarget(governed = {}) {
  const candidate = governed.candidate || governed.governedCandidate || {};
  const admission = governed.admissionDecision || governed.admission || {};
  return {
    ...candidate,
    eventId: candidate.eventId || governed.eventId,
    sourceReports: candidate.sourceReports || [],
    corroborationSummary: admission.evidenceLineageFacts?.corroborationSummary
      || candidate.evidenceLineageFacts?.corroborationSummary,
    spatialPrecision: admission.spatialFacts?.locationPrecision || candidate.locationPrecision,
    occurredAt: admission.temporalFacts?.occurredAt || candidate.occurredAt,
    publishedAt: admission.temporalFacts?.publishedAt || candidate.publishedAt,
    occurrenceKnown: admission.temporalFacts?.occurrenceKnown ?? candidate.occurrenceKnown
  };
}

export { CARD_KEYS, NOT_ASSESSED, UNKNOWN };
