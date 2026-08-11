import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PI_TIME_MODE,
  normalizeTemporalState,
  validateTemporalState,
  parseTemporalInstant,
  formatTemporalInstantForDisplay,
  formatTemporalStateSummary,
  localDateTimeInputToUtcIso,
  toLocalDateTimeInputValue,
  getCurrentTemporalContext
} from '../public/spatial/point-intelligence-temporal-state.js';
import {
  getPointIntelligenceTemporalSupportModel,
  isTemporalModeExecutable
} from '../public/spatial/point-intelligence-temporal-support.js';
import {
  canExecutePointIntelligenceTemporalRequest,
  buildPointIntelligenceTemporalIntentPayload
} from '../public/spatial/point-intelligence-temporal-gate.js';
import {
  buildPointIntelligenceBundleRequest,
  buildPointIntelligenceBundleRequestModel
} from '../public/spatial/point-intelligence-request.js';
import { buildSafeQueryReceiptInspectorModel } from '../public/spatial/point-intelligence-inspector-model.js';

const MONTREAL_GEOM = { type: 'Point', coordinates: [-73.5673, 45.5017] };

test('LATEST is default temporal state', () => {
  const state = normalizeTemporalState({});
  assert.equal(state.mode, PI_TIME_MODE.LATEST);
  assert.equal(state.valid, true);
  assert.equal(state.at, null);
});

test('AT stores normalized UTC instant', () => {
  const at = localDateTimeInputToUtcIso('2026-08-03T21:00', 'America/Toronto');
  const state = normalizeTemporalState({ mode: PI_TIME_MODE.AT, at });
  assert.equal(state.valid, true);
  assert.equal(state.at, '2026-08-04T01:00:00.000Z');
});

test('RANGE validates start <= end', () => {
  const valid = normalizeTemporalState({
    mode: PI_TIME_MODE.RANGE,
    rangeStart: '2026-08-04T01:00:00.000Z',
    rangeEnd: '2026-08-04T10:00:00.000Z'
  });
  assert.equal(valid.valid, true);

  const invalid = normalizeTemporalState({
    mode: PI_TIME_MODE.RANGE,
    rangeStart: '2026-08-04T10:00:00.000Z',
    rangeEnd: '2026-08-04T01:00:00.000Z'
  });
  assert.equal(invalid.valid, false);
});

test('deterministic timezone display for stored instant', () => {
  const iso = '2026-08-04T01:00:00.000Z';
  const display = formatTemporalInstantForDisplay(iso, 'America/Toronto');
  assert.match(display, /Aug 3, 2026/);
  assert.match(display, /9:00|21:00/);
  assert.match(display, /EDT|EST/);
  const roundTrip = toLocalDateTimeInputValue(iso, 'America/Toronto');
  assert.equal(roundTrip, '2026-08-03T21:00');
  assert.equal(localDateTimeInputToUtcIso(roundTrip, 'America/Toronto'), iso);
});

test('capability temporal support truth', () => {
  const model = getPointIntelligenceTemporalSupportModel();
  assert.equal(model.LATEST, 'SUPPORTED_NOW');
  assert.equal(model.AT, 'FUTURE_READY');
  assert.equal(model.RANGE, 'FUTURE_READY');
  assert.equal(isTemporalModeExecutable(PI_TIME_MODE.LATEST), true);
  assert.equal(isTemporalModeExecutable(PI_TIME_MODE.AT), false);
});

test('execution gate blocks AT and RANGE', () => {
  const at = canExecutePointIntelligenceTemporalRequest(normalizeTemporalState({
    mode: PI_TIME_MODE.AT,
    at: '2026-08-04T01:00:00.000Z'
  }));
  assert.equal(at.status, 'UNSUPPORTED');

  const range = canExecutePointIntelligenceTemporalRequest(normalizeTemporalState({
    mode: PI_TIME_MODE.RANGE,
    rangeStart: '2026-08-04T01:00:00.000Z',
    rangeEnd: '2026-08-04T10:00:00.000Z'
  }));
  assert.equal(range.status, 'UNSUPPORTED');

  const latest = canExecutePointIntelligenceTemporalRequest(normalizeTemporalState({ mode: PI_TIME_MODE.LATEST }));
  assert.equal(latest.status, 'EXECUTABLE');
});

test('request model represents LATEST AT RANGE', () => {
  const latest = buildPointIntelligenceBundleRequestModel({
    geometry: MONTREAL_GEOM,
    temporalIntent: { mode: 'LATEST' }
  });
  assert.equal(latest.ok, true);
  assert.equal(latest.payload.temporalIntent.mode, 'LATEST');

  const at = buildPointIntelligenceBundleRequestModel({
    geometry: MONTREAL_GEOM,
    temporalIntent: { mode: 'AT', at: '2026-08-04T01:00:00.000Z' }
  });
  assert.equal(at.ok, true);
  assert.equal(at.payload.temporalIntent.at, '2026-08-04T01:00:00.000Z');

  const range = buildPointIntelligenceBundleRequestModel({
    geometry: MONTREAL_GEOM,
    temporalIntent: { mode: 'RANGE', start: '2026-08-04T01:00:00.000Z', end: '2026-08-04T10:00:00.000Z' }
  });
  assert.equal(range.ok, true);
  assert.equal(range.payload.temporalIntent.start, '2026-08-04T01:00:00.000Z');
});

test('network bundle builder still enforces LATEST-only execution', () => {
  const blocked = buildPointIntelligenceBundleRequest({
    geometry: MONTREAL_GEOM,
    temporalIntent: { mode: 'AT', at: '2026-08-04T01:00:00.000Z' }
  });
  assert.equal(blocked.ok, false);
});

test('temporal intent payload builder', () => {
  const atPayload = buildPointIntelligenceTemporalIntentPayload(normalizeTemporalState({
    mode: PI_TIME_MODE.AT,
    at: parseTemporalInstant('2026-08-04T01:00:00.000Z')
  }));
  assert.equal(atPayload.ok, true);
  assert.equal(atPayload.temporalIntent.mode, 'AT');
});

test('future Agent 2 temporal context seam', () => {
  const ctx = getCurrentTemporalContext();
  assert.ok('mode' in ctx);
  assert.ok('interpretation' in ctx);
  assert.ok('temporalGeneration' in ctx);
});

test('receipt model temporal field readiness without fabrication', () => {
  const latestReceipt = buildSafeQueryReceiptInspectorModel({
    request: { temporalIntent: { mode: 'LATEST' } },
    families: { weather: { informationFamily: 'weather', queryState: 'SUCCESS', results: [] } },
    queryReceipts: [{ informationFamily: 'weather', queryReceiptId: 'r1', queryState: 'SUCCESS' }]
  }, 'weather');
  assert.equal(latestReceipt.temporalIntent, 'LATEST');
  assert.equal(latestReceipt.temporalRequest?.mode, 'LATEST');
  assert.equal(latestReceipt.temporalRequest?.at, null);

  const atReceipt = buildSafeQueryReceiptInspectorModel({
    request: {
      temporalIntent: {
        mode: 'AT',
        at: '2026-08-04T01:00:00.000Z',
        providerTemporalSupport: 'FUTURE_READY'
      }
    },
    families: { weather: { informationFamily: 'weather', queryState: 'SUCCESS', results: [] } },
    queryReceipts: [{ informationFamily: 'weather', queryReceiptId: 'r2', queryState: 'SUCCESS' }]
  }, 'weather');
  assert.equal(atReceipt.temporalRequest?.at, '2026-08-04T01:00:00.000Z');
  assert.equal(atReceipt.temporalRequest?.providerTemporalSupport, 'FUTURE_READY');
});

test('format temporal state summary', () => {
  const latest = formatTemporalStateSummary({ mode: PI_TIME_MODE.LATEST });
  assert.match(latest.headline, /LATEST/);
  const at = formatTemporalStateSummary({
    mode: PI_TIME_MODE.AT,
    at: '2026-08-04T01:00:00.000Z',
    displayTimezone: 'America/Toronto'
  });
  assert.match(at.headline, /AT/);
});

test('invalid AT rejected by validation', () => {
  const invalid = validateTemporalState({ mode: PI_TIME_MODE.AT, at: null });
  assert.equal(invalid.valid, false);
});
