import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpatialLatencyTrace,
  buildCriticalPathSummary,
  buildTraceSummary,
  mergeClientServerTrace
} from '../src/spatial/spatial-latency-trace.js';

describe('spatial latency trace', () => {
  it('records spans and milestones without secret values', () => {
    const trace = createSpatialLatencyTrace('trace-test-1', { strategy: 'FAST' });
    trace.mark('serverReceipt');
    const span = trace.startSpan('GEMINI_RESEARCH', { executionMode: 'PARALLEL', criticalPath: true });
    trace.recordProviderInvoked('GEMINI');
    trace.recordProviderMilestone('GEMINI', 'firstGroundedSource');
    trace.endSpan(span, { provider: 'GEMINI' });
    trace.recordGeocode({ durationMs: 120, success: true, mappable: true, resolver: 'quebec-geocoder' });
    trace.recordAgent2Call({ name: 'live-intelligence-search', durationMs: 80 });
    trace.mark('firstMappableEvent');
    trace.mark('researchComplete');
    const payload = trace.toPayload();
    assert.equal(payload.traceId, 'trace-test-1');
    assert.equal(payload.strategy, 'FAST');
    assert.ok(payload.milestones.timeToFirstMappableEventMs >= 0);
    assert.ok(payload.spans.some((s) => s.name === 'GEMINI_RESEARCH'));
    assert.equal(payload.providers.GEMINI.invoked, true);
    assert.equal(payload.agent2.callCount, 1);
    assert.equal(payload.geocoding.calls.length, 1);
  });

  it('merges client render milestones with server trace', () => {
    const server = createSpatialLatencyTrace('trace-merge', { strategy: 'FAST' });
    server.mark('firstMappableEvent', Date.now());
    server.mark('researchComplete', Date.now() + 1000);
    const merged = mergeClientServerTrace(server.toPayload(), {
      milestones: {
        browserReceipt: 5000,
        graphicsLayerInsert: 5200,
        firstRenderedFeature: 5400,
        initialLayerReady: 6100
      },
      spans: []
    });
    assert.equal(merged.milestones.timeToFirstRenderedFeatureMs, 5400);
    assert.equal(merged.milestones.timeToInitialLayerReadyMs, 6100);
    assert.ok(merged.humanSummary.firstMapPoint);
  });

  it('ranks critical path spans by duration', () => {
    const summary = buildCriticalPathSummary([
      { name: 'GEMINI_RESEARCH', durationMs: 3100, criticalPath: true },
      { name: 'EVIDENCE_GEOCODING', durationMs: 2400, criticalPath: true }
    ], { serverReceipt: 10, firstMappableEvent: 5500, researchComplete: 9000 });
    assert.equal(summary.fullResearch[0].name, 'GEMINI_RESEARCH');
    assert.ok(buildTraceSummary({ firstMappableEvent: 5500, researchComplete: 9000 }, summary.fullResearch).topBottleneck);
  });
});
