import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyIntelligenceLayerTemporalGate,
  evaluateTemporalAdmission,
  isWithinRange,
  resolveEventTemporalInstant,
  TEMPORAL_FIELD
} from '../src/spatial/intelligence-layer-temporal-gate.js';

const WINDOW = {
  from: '2026-07-11T00:00:00.000Z',
  to: '2026-08-10T23:59:59.999Z',
  temporalField: 'OCCURRED'
};

describe('intelligence-layer temporal gate', () => {
  it('admits in-window occurredAt for OCCURRED basis', () => {
    const decision = evaluateTemporalAdmission({
      title: 'In-window shooting',
      occurredAt: '2026-07-30T19:30:00Z',
      publishedAt: '2026-07-31T10:00:00Z'
    }, WINDOW);
    assert.equal(decision.admitted, true);
    assert.equal(decision.basis, 'occurredAt');
  });

  it('rejects out-of-window occurredAt even when publishedAt is in window', () => {
    const decision = evaluateTemporalAdmission({
      title: 'Old incident, recent article',
      occurredAt: '2026-06-22T11:35:00Z',
      publishedAt: '2026-07-06T00:00:00Z'
    }, WINDOW);
    assert.equal(decision.admitted, false);
    assert.equal(decision.reason, 'OUT_OF_RANGE');
  });

  it('does not substitute publishedAt when occurredAt is unknown for OCCURRED', () => {
    const instant = resolveEventTemporalInstant({
      occurredAt: null,
      publishedAt: '2026-07-30T19:30:00Z'
    }, TEMPORAL_FIELD.OCCURRED);
    assert.equal(instant.instant, null);
    assert.equal(instant.basis, 'occurredAt');

    const decision = evaluateTemporalAdmission({
      title: 'Publication only',
      occurredAt: null,
      publishedAt: '2026-07-30T19:30:00Z'
    }, WINDOW);
    assert.equal(decision.admitted, false);
    assert.equal(decision.reason, 'UNKNOWN_OCCURRENCE');
  });

  it('filters mixed event set and reports rejection counts', () => {
    const { events, temporalGate } = applyIntelligenceLayerTemporalGate([
      {
        title: 'In window',
        occurredAt: '2026-07-30T19:30:00Z',
        publishedAt: '2026-07-31T10:00:00Z'
      },
      {
        title: 'Out of window',
        occurredAt: '2026-06-22T11:35:00Z',
        publishedAt: '2026-07-06T00:00:00Z'
      },
      {
        title: 'Unknown occurrence',
        occurredAt: null,
        publishedAt: '2026-08-01T10:00:00Z'
      }
    ], WINDOW);

    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'In window');
    assert.equal(temporalGate.rejected, 2);
    assert.equal(temporalGate.rejectedOutOfWindow, 1);
    assert.equal(temporalGate.rejectedUnknownOccurrence, 1);
  });

  it('uses publishedAt when temporal basis is PUBLISHED', () => {
    const decision = evaluateTemporalAdmission({
      title: 'Recent report',
      occurredAt: null,
      publishedAt: '2026-08-01T10:00:00Z'
    }, { ...WINDOW, temporalField: 'PUBLISHED' });
    assert.equal(decision.admitted, true);
    assert.equal(decision.basis, 'publishedAt');
  });

  it('normalizes unicode dash occurredAt values before range checks', () => {
    const decision = evaluateTemporalAdmission({
      title: 'Unicode date',
      occurredAt: '2026‑07‑30T19:30:00',
      publishedAt: '2026-07-31T10:00:00Z'
    }, WINDOW);
    assert.equal(decision.admitted, true);
    assert.equal(decision.reason, 'IN_RANGE');
  });
});
