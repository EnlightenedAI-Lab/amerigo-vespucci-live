import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFidelityStripModel,
  buildIntegrityAssessTarget,
  CARD_KEYS,
  NOT_ASSESSED
} from '../public/spatial/fidelity-strip-model.js';
import {
  classifyMapFeatureSelection,
  FIDELITY_SELECTION_MODES
} from '../public/spatial/fidelity-selection-hub.js';
import {
  registerGovernedEvent,
  clearGovernedEventStore,
  registerGovernedFromMapPayload,
  registerGovernedFromProgressiveBundle,
  getGovernedEvent
} from '../public/spatial/governed-event-store.js';
import { eventToFeatureAttributes } from '../public/spatial/intelligence-layer-popup.js';

const ADMISSION_DECISION = {
  outcome: 'ADMIT_WITH_CAUTION',
  reasonCodes: ['ADMITTED', 'GEOCODE_DEFERRED'],
  permittedDisplayMode: 'FULL_PRECISION',
  governanceStatus: 'SUCCESS',
  sourceFacts: {
    sourceIntelligenceClass: 'EDITORIAL_NEWS',
    isOfficial: false,
    authorityType: 'NEWS_ORGANIZATION',
    corpusIntegrityClass: 'PARTIAL'
  },
  spatialFacts: {
    locationPrecision: 'STREET_ADDRESS',
    spatialConflict: false,
    geometryProvided: true,
    geometrySource: 'GEOCODE',
    geocodeDeferred: false
  },
  temporalFacts: {
    occurrenceKnown: true,
    occurredAt: '2026-08-01T03:00:00Z',
    publishedAt: '2026-08-01T08:00:00Z',
    publishedAtSubstitutedForOccurrence: false
  },
  evidenceLineageFacts: {
    corroborationSummary: 'SINGLE_LINEAGE',
    lineageCount: 1,
    independentLineageCount: 1,
    sourceReportCount: 1,
    multipleUrlsNotIndependent: false,
    copiedOrDerivativeReporting: false,
    authoritativeAnchor: false
  }
};

describe('Fidelity Strip view model', () => {
  it('exposes seven deterministic cards for intelligence events', () => {
    clearGovernedEventStore();
    registerGovernedEvent('evt-a', {
      admissionDecision: ADMISSION_DECISION,
      candidate: { eventId: 'evt-a', title: 'Warehouse fire' },
      receipt: { receiptId: 'rcpt-1', executionStatus: 'SUCCESS', retrievalStatus: 'COMPLETE' }
    });
    const model = buildFidelityStripModel({
      selection: {
        mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT,
        eventId: 'evt-a',
        attributes: { eventId: 'evt-a', iqaiFidelityPlane: 'INTELLIGENCE' }
      },
      integrityAssessment: {
        grade: 'B',
        score: 82,
        status: 'SCORED',
        integrityModelVersion: '1.0.0',
        dimensions: { RECORD_INTEGRITY: 80 },
        rulesTriggered: [],
        caps: [],
        warnings: []
      }
    });
    assert.equal(model.visible, true);
    for (const key of CARD_KEYS) assert.ok(model.cards[key], key);
    assert.equal(model.cards.ADMISSION.primary, 'ADMIT_WITH_CAUTION');
    assert.equal(model.cards.INTEGRITY.primary, 'B · 82');
    assert.equal(model.cards.SOURCE.primary, 'EDITORIAL NEWS');
    assert.equal(model.cards.CORROBORATION.primary, 'SINGLE LINEAGE');
    assert.equal(model.cards.SPATIAL.primary, 'STREET ADDRESS');
    assert.match(model.cards.TEMPORAL.primary, /^KNOWN/);
    assert.notEqual(model.cards.TEMPORAL.detail.occurredAt, model.cards.TEMPORAL.detail.publishedAt);
  });

  it('does not attach intelligence metrics to POI/reference features', () => {
    const model = buildFidelityStripModel({
      selection: {
        mode: FIDELITY_SELECTION_MODES.REFERENCE_GIS,
        attributes: { datasetId: 'AMENITIES', amenity: 'cafe', name: 'Starbucks' }
      }
    });
    assert.equal(model.mode, 'REFERENCE_GIS');
    assert.equal(model.cards.ADMISSION.primary, '—');
    assert.equal(model.cards.INTEGRITY.primary, '—');
    assert.equal(model.cards.PROVENANCE.primary, 'DETERMINISTIC GIS');
  });

  it('updates when switching Event A to Event B', () => {
    clearGovernedEventStore();
    registerGovernedEvent('evt-a', { admissionDecision: { ...ADMISSION_DECISION, outcome: 'ADMIT' } });
    registerGovernedEvent('evt-b', {
      admissionDecision: {
        ...ADMISSION_DECISION,
        outcome: 'HOLD',
        reasonCodes: ['MISSING_OCCURRENCE']
      }
    });
    const a = buildFidelityStripModel({
      selection: { mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT, eventId: 'evt-a', attributes: { eventId: 'evt-a' } }
    });
    const b = buildFidelityStripModel({
      selection: { mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT, eventId: 'evt-b', attributes: { eventId: 'evt-b' } }
    });
    assert.equal(a.cards.ADMISSION.primary, 'ADMIT');
    assert.equal(b.cards.ADMISSION.primary, 'HOLD');
    assert.notEqual(a.cards.ADMISSION.primary, b.cards.ADMISSION.primary);
  });

  it('classifies intelligence layer attributes separately from hospitals', () => {
    const intel = classifyMapFeatureSelection({ eventId: 'evt-1', iqaiFidelityPlane: 'INTELLIGENCE' });
    const hospital = classifyMapFeatureSelection({ datasetId: 'HOSPITALS', name: 'General Hospital' });
    assert.equal(intel.mode, FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT);
    assert.equal(hospital.mode, FIDELITY_SELECTION_MODES.REFERENCE_GIS);
  });

  it('registers governed payloads from map action plans', () => {
    clearGovernedEventStore();
    registerGovernedFromMapPayload({
      governedEventId: 'evt-map',
      admission: ADMISSION_DECISION,
      events: [{ eventId: 'evt-map', title: 'Incident' }]
    });
    const stored = buildFidelityStripModel({
      selection: { mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT, eventId: 'evt-map', attributes: { eventId: 'evt-map' } }
    });
    assert.equal(stored.cards.ADMISSION.primary, 'ADMIT_WITH_CAUTION');
  });

  it('maps feature attributes with admission fields for map graphics', () => {
    const attrs = eventToFeatureAttributes({
      eventId: 'evt-1',
      title: 'Fire',
      admissionOutcome: 'ADMIT',
      reasonCodes: ['ADMITTED'],
      locationPrecision: 'EXACT_PLACE',
      corroborationSummary: 'SINGLE_LINEAGE',
      occurredAt: '2026-08-01T03:00:00Z',
      publishedAt: '2026-08-01T08:00:00Z'
    });
    assert.equal(attrs.iqaiFidelityPlane, 'INTELLIGENCE');
    assert.equal(attrs.admissionOutcome, 'ADMIT');
    assert.equal(attrs.corroborationSummary, 'SINGLE_LINEAGE');
  });

  it('builds integrity assess target from governed bundle', () => {
    const target = buildIntegrityAssessTarget({
      eventId: 'evt-1',
      candidate: { eventId: 'evt-1', title: 'Fire', sourceReports: [{ url: 'https://example.com' }] },
      admissionDecision: ADMISSION_DECISION
    });
    assert.equal(target.eventId, 'evt-1');
    assert.equal(target.corroborationSummary, 'SINGLE_LINEAGE');
    assert.equal(target.occurredAt, '2026-08-01T03:00:00Z');
  });

  it('clears to hidden when selection mode is NONE', () => {
    const model = buildFidelityStripModel({
      selection: { mode: FIDELITY_SELECTION_MODES.NONE }
    });
    assert.equal(model.visible, false);
    assert.equal(model.cards, null);
  });

  it('never invents trust percentage labels', () => {
    clearGovernedEventStore();
    registerGovernedEvent('evt-a', {
      admissionDecision: ADMISSION_DECISION,
      candidate: { eventId: 'evt-a' }
    });
    const model = buildFidelityStripModel({
      selection: {
        mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT,
        eventId: 'evt-a',
        attributes: { eventId: 'evt-a' }
      },
      integrityAssessment: null
    });
    assert.equal(model.cards.INTEGRITY.primary, NOT_ASSESSED);
    assert.ok(!JSON.stringify(model).match(/trust\s*%|confidence\s*%|probability/i));
  });

  it('registers progressive HOLD/REJECT bundles into the client store', () => {
    clearGovernedEventStore();
    const entry = registerGovernedFromProgressiveBundle({
      governedEventId: 'evt-reject-live',
      admission: { outcome: 'REJECT', reasonCodes: ['NO_SOURCE_URL'], eventId: 'evt-reject-live' },
      candidate: { eventId: 'evt-reject-live', title: 'Rejected fire' },
      receipt: { receiptId: 'rcp-1' }
    });
    assert.equal(entry.eventId, 'evt-reject-live');
    assert.equal(entry.source, 'progressive-intelligence');
    assert.equal(entry.admissionDecision.outcome, 'REJECT');
    assert.equal(getGovernedEvent('evt-reject-live')?.admissionDecision?.outcome, 'REJECT');
  });
});
