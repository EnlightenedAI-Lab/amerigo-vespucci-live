import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateGovernanceOutcome,
  buildRejectionPresentation,
  buildReliabilityTopBarModel,
  deriveCorroborationDisplay,
  deriveIntegrityDisplay,
  deriveTemporalReliability,
  reasonCodeHint,
  shouldApplyReceiptUpdate
} from '../public/spatial/reliability-top-bar-model.js';

const FIREARM_RECEIPT = {
  receiptId: 'c63e342a-30dd-4584-a9a1-87704cf99f83',
  query: 'Find officially reported firearm incidents in Montréal in the last 30 days and map only admissible events.',
  sourceResultCount: 7,
  governedCandidateCount: 2,
  mappedCount: 0,
  governanceCounts: { ADMIT: 0, ADMIT_WITH_CAUTION: 0, HOLD: 0, REJECT: 2 },
  candidates: [
    { eventId: 'live-event_e3c9299fb28c0b99', outcome: 'REJECT', reasonCodes: ['UNKNOWN_OCCURRENCE'] },
    { eventId: 'live-event_551dc6e978cbed8d', outcome: 'REJECT', reasonCodes: ['UNKNOWN_OCCURRENCE'] }
  ],
  rejectionDiagnostics: [
    { eventId: 'live-event_e3c9299fb28c0b99', outcome: 'REJECT', reasonCodes: ['UNKNOWN_OCCURRENCE'] },
    { eventId: 'live-event_551dc6e978cbed8d', outcome: 'REJECT', reasonCodes: ['UNKNOWN_OCCURRENCE'] }
  ]
};

describe('Reliability / Trust top bar model', () => {
  it('projects receipt source, governed, mapped, and governance counts', () => {
    const model = buildReliabilityTopBarModel({ receipt: FIREARM_RECEIPT, context: 'INTELLIGENCE' });
    assert.equal(model.mode, 'INTELLIGENCE_RUN');
    const byKey = Object.fromEntries(model.pills.map((pill) => [pill.key, pill.value]));
    assert.equal(byKey.SOURCES, '7');
    assert.equal(byKey.GOVERNED, '2');
    assert.equal(byKey.MAPPED, '0');
    assert.equal(byKey.GOVERNANCE, 'REJECT');
  });

  it('renders UNKNOWN_OCCURRENCE rejection compactly', () => {
    const rejection = buildRejectionPresentation(FIREARM_RECEIPT.rejectionDiagnostics, 'REJECT');
    assert.equal(rejection.compact, 'REJECT · UNKNOWN OCCURRENCE');
    assert.equal(rejection.reasonCodes[0], 'UNKNOWN_OCCURRENCE');
    assert.match(reasonCodeHint('UNKNOWN_OCCURRENCE'), /Occurrence time/);
  });

  it('surfaces temporal weakness for UNKNOWN_OCCURRENCE', () => {
    const temporal = deriveTemporalReliability(
      FIREARM_RECEIPT.candidates,
      {},
      FIREARM_RECEIPT.rejectionDiagnostics
    );
    assert.equal(temporal.display, 'TIME UNKNOWN');
    assert.equal(temporal.tone, 'warn');
  });

  it('shows missing integrity as unavailable', () => {
    const integrity = deriveIntegrityDisplay(FIREARM_RECEIPT.candidates, {});
    assert.equal(integrity.display, '—');
  });

  it('shows corroboration unavailable without governed lookup', () => {
    const corroboration = deriveCorroborationDisplay(FIREARM_RECEIPT.candidates, {});
    assert.equal(corroboration.display, '—');
  });

  it('uses minimum independent lineage when governed lookup is present', () => {
    const lookup = {
      'live-event_e3c9299fb28c0b99': {
        admissionDecision: {
          evidenceLineageFacts: { independentLineageCount: 1, lineageCount: 1 }
        }
      },
      'live-event_551dc6e978cbed8d': {
        admissionDecision: {
          evidenceLineageFacts: { independentLineageCount: 1, lineageCount: 1 }
        }
      }
    };
    assert.equal(deriveCorroborationDisplay(FIREARM_RECEIPT.candidates, lookup).display, 'SINGLE LINEAGE');
  });

  it('returns NO RUN when no receipt exists', () => {
    const model = buildReliabilityTopBarModel({ receipt: null, context: 'INTELLIGENCE' });
    assert.equal(model.mode, 'NO_RUN');
    assert.equal(model.pills[0].value, 'NO RUN');
  });

  it('hides intelligence metrics for deterministic GIS context', () => {
    const model = buildReliabilityTopBarModel({ receipt: FIREARM_RECEIPT, context: 'DETERMINISTIC_GIS' });
    assert.equal(model.mode, 'DETERMINISTIC_GIS');
    assert.equal(model.pills[0].value, 'GIS');
  });

  it('aggregates mixed governance outcomes', () => {
    assert.equal(aggregateGovernanceOutcome({ ADMIT: 1, REJECT: 1, HOLD: 0, ADMIT_WITH_CAUTION: 0 }), 'MIXED');
    assert.equal(aggregateGovernanceOutcome({ ADMIT: 0, REJECT: 0, HOLD: 0, ADMIT_WITH_CAUTION: 0 }), 'NO CANDIDATES');
  });

  it('rejects stale receipt overwrite by timestamp', () => {
    const older = { receiptId: 'a', persistedAt: '2026-08-11T10:00:00.000Z' };
    const newer = { receiptId: 'b', persistedAt: '2026-08-11T11:00:00.000Z' };
    assert.equal(shouldApplyReceiptUpdate(newer, older), true);
    assert.equal(shouldApplyReceiptUpdate(older, newer), false);
  });

  it('does not leak secret-like query tokens in model output', () => {
    const model = buildReliabilityTopBarModel({
      receipt: {
        ...FIREARM_RECEIPT,
        query: 'token=secret123 password=abc'
      },
      context: 'INTELLIGENCE'
    });
    assert.match(model.query, /token=secret123/);
    assert.doesNotMatch(JSON.stringify(model), /api_key|Bearer /i);
  });
});
