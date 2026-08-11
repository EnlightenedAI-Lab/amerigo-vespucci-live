import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProgressiveRunReceipt,
  buildCandidateDiagnostics,
  buildConciseRejectionSummary,
  formatDeterministicReasonCodes,
  persistLastAiMapRunReceipt,
  mergeLastAiMapRunReceipt,
  getLastAiMapRunReceipt,
  clearLastAiMapRunReceipt,
  computeSourceResultCount
} from '../src/spatial/ai-map-run-receipt.js';

describe('AI MAP durable run receipt', () => {
  it('builds redacted receipt with governance diagnostics', () => {
    const startedAt = '2026-08-11T10:00:00.000Z';
    const completedAt = '2026-08-11T10:00:45.000Z';
    const receipt = buildProgressiveRunReceipt({
      query: 'Find firearm incidents token=secret123',
      traceId: 'trace-abc',
      startedAt,
      completedAt,
      result: {
        traceId: 'trace-abc',
        finalState: 'FAILED',
        mappedCount: 0,
        taskGraphReceipt: { receiptId: 'rcpt-1', graphId: 'graph-1' },
        governedEvents: [
          {
            governedEventId: 'evt-1',
            admissionDecision: {
              outcome: 'REJECT',
              reasonCodes: ['NO_SOURCE_URL', 'MISSING_PROVENANCE']
            },
            candidate: { eventId: 'evt-1', title: 'Incident A' }
          },
          {
            governedEventId: 'evt-2',
            admissionDecision: {
              outcome: 'REJECT',
              reasonCodes: ['OUTSIDE_TIME_WINDOW']
            },
            candidate: { eventId: 'evt-2', title: 'Incident B' }
          }
        ],
        streamResult: {
          governanceStats: {
            admit: 0,
            admitWithCaution: 0,
            hold: 0,
            reject: 2,
            candidates: 2
          },
          corpusResult: { events: [{ eventId: 'c1' }] },
          liveResult: { candidates: [{ eventId: 'l1' }, { eventId: 'l2' }] }
        }
      }
    });

    assert.equal(receipt.receiptId, 'rcpt-1');
    assert.match(receipt.query, /\[REDACTED\]/);
    assert.equal(receipt.sourceResultCount, 3);
    assert.equal(receipt.governedCandidateCount, 2);
    assert.equal(receipt.governanceCounts.REJECT, 2);
    assert.equal(receipt.mappedCount, 0);
    assert.deepEqual(receipt.candidateIds, ['evt-1', 'evt-2']);
    assert.equal(receipt.rejectionDiagnostics.length, 2);
    assert.equal(
      receipt.rejectionDiagnostics[0].rejectionSummary,
      'NO_SOURCE_URL, MISSING_PROVENANCE'
    );
    assert.equal(receipt.elapsedMs, 45000);
  });

  it('formats deterministic reason codes without invention', () => {
    assert.equal(formatDeterministicReasonCodes(['NO_SOURCE_URL', 'HOLD']), 'NO_SOURCE_URL, HOLD');
    assert.equal(buildConciseRejectionSummary('REJECT', ['MISSING_PROVENANCE']), 'MISSING_PROVENANCE');
    assert.equal(buildConciseRejectionSummary('ADMIT', ['ADMITTED']), null);
  });

  it('persists and merges client completion fields', () => {
    clearLastAiMapRunReceipt();
    persistLastAiMapRunReceipt(buildProgressiveRunReceipt({
      query: 'test query',
      startedAt: '2026-08-11T10:00:00.000Z',
      completedAt: '2026-08-11T10:00:10.000Z',
      result: {
        mappedCount: 0,
        governedEvents: [],
        streamResult: { governanceStats: { admit: 0, admitWithCaution: 0, hold: 0, reject: 0 } }
      }
    }));

    mergeLastAiMapRunReceipt({
      mappedCount: 2,
      selectedEventId: 'evt-admit-1',
      statusMessage: 'Mapped 2 governed event(s)',
      streamed: true
    });

    const stored = getLastAiMapRunReceipt();
    assert.equal(stored.mappedCount, 2);
    assert.equal(stored.selectedEventId, 'evt-admit-1');
    assert.equal(stored.statusMessage, 'Mapped 2 governed event(s)');
    assert.equal(stored.streamed, true);
    assert.ok(stored.clientCompletedAt);
    clearLastAiMapRunReceipt();
  });

  it('computes source result count from corpus and live results', () => {
    assert.equal(computeSourceResultCount({
      corpusResult: { events: [{}, {}] },
      liveResult: { candidates: [{}] }
    }), 3);
    assert.equal(buildCandidateDiagnostics([]).length, 0);
  });
});
