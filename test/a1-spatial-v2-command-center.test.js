import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASK_ROUTE_REASON,
  ASK_ROUTE_STATE,
  createAskCapabilityBus
} from '../public/spatial-v2/shell/ask-capability-bus.js';
import {
  createCommandCenterState,
  createCommandCenterTruthSnapshot,
  EXPERIENCE_MODE,
  IMAGERY_VIEW
} from '../public/spatial-v2/shell/command-center-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function availableCapability(overrides = {}) {
  return {
    id: 'imagery',
    label: 'Imagery',
    aliases: ['show imagery'],
    quickActionIds: ['imagery'],
    isAvailable: true,
    handle: () => ({ message: 'Imagery context opened.', engineExecuted: false }),
    ...overrides
  };
}

test('Ask bus exposes only the four application routing outcomes', () => {
  assert.deepEqual(ASK_ROUTE_STATE, {
    ROUTED: 'ROUTED',
    UNROUTED: 'UNROUTED',
    UNAVAILABLE: 'UNAVAILABLE',
    FAILED: 'FAILED'
  });
});

test('empty Ask invokes no capability and records an UNROUTED receipt', async () => {
  let calls = 0;
  const bus = createAskCapabilityBus({
    capabilities: [availableCapability({ handle: () => { calls += 1; } })]
  });
  const receipt = await bus.execute({ text: '   ', quickActionId: 'imagery' });
  assert.equal(receipt.state, ASK_ROUTE_STATE.UNROUTED);
  assert.equal(receipt.reason, ASK_ROUTE_REASON.EMPTY_INPUT);
  assert.equal(receipt.executed, false);
  assert.equal(receipt.capabilityId, null);
  assert.equal(calls, 0);
  assert.equal(bus.getLastReceipt().receiptId, receipt.receiptId);
});

test('unknown language fails closed instead of defaulting to GIS', async () => {
  const bus = createAskCapabilityBus({ capabilities: [availableCapability()] });
  const receipt = await bus.execute({ text: 'please do something unrelated' });
  assert.equal(receipt.state, ASK_ROUTE_STATE.UNROUTED);
  assert.equal(receipt.reason, ASK_ROUTE_REASON.NO_CAPABILITY_MATCH);
  assert.equal(receipt.executed, false);
  assert.equal(receipt.capabilityId, null);
});

test('routing uses exact declared aliases or an explicit quick action', async () => {
  let calls = 0;
  const bus = createAskCapabilityBus({
    capabilities: [availableCapability({ handle: () => {
      calls += 1;
      return { message: 'Accepted.', engineExecuted: false };
    } })]
  });
  const nearMatch = await bus.execute({ text: 'please show imagery' });
  const alias = await bus.execute({ text: '  SHOW   IMAGERY ' });
  const explicit = await bus.execute({ text: 'open the imagery context', quickActionId: 'imagery' });
  assert.equal(nearMatch.state, ASK_ROUTE_STATE.UNROUTED);
  assert.equal(alias.state, ASK_ROUTE_STATE.ROUTED);
  assert.equal(explicit.state, ASK_ROUTE_STATE.ROUTED);
  assert.equal(alias.capabilityId, 'imagery');
  assert.equal(explicit.result.engineExecuted, false);
  assert.equal(calls, 2);
});

test('recognized unavailable capabilities do not simulate a response', async () => {
  const bus = createAskCapabilityBus({
    capabilities: [availableCapability({
      id: 'analysis',
      label: 'Scientific analysis',
      aliases: ['show vegetation health'],
      quickActionIds: ['analyze'],
      isAvailable: false,
      unavailableReason: 'Remote-sensing analysis is not connected.'
    })]
  });
  const receipt = await bus.execute({ text: 'show vegetation health' });
  assert.equal(receipt.state, ASK_ROUTE_STATE.UNAVAILABLE);
  assert.equal(receipt.reason, ASK_ROUTE_REASON.CAPABILITY_UNAVAILABLE);
  assert.equal(receipt.executed, false);
  assert.match(receipt.result.message, /not connected/i);
});

test('capability failures settle as FAILED receipts', async () => {
  const bus = createAskCapabilityBus({
    capabilities: [availableCapability({
      handle: () => {
        throw new Error('bounded failure');
      }
    })]
  });
  const receipt = await bus.execute({ text: 'show imagery' });
  assert.equal(receipt.state, ASK_ROUTE_STATE.FAILED);
  assert.equal(receipt.reason, ASK_ROUTE_REASON.CAPABILITY_FAILED);
  assert.equal(receipt.executed, false);
  assert.equal(receipt.error, 'bounded failure');
});

test('a stale asynchronous attempt cannot overwrite the newer canonical receipt', async () => {
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const bus = createAskCapabilityBus({
    capabilities: [
      availableCapability({
        id: 'slow',
        aliases: ['slow'],
        quickActionIds: [],
        handle: async () => {
          await slow;
          return { message: 'slow finished' };
        }
      }),
      availableCapability({
        id: 'fast',
        aliases: ['fast'],
        quickActionIds: [],
        handle: () => ({ message: 'fast finished' })
      })
    ]
  });
  const slowAttempt = bus.execute({ text: 'slow' });
  const fastReceipt = await bus.execute({ text: 'fast' });
  releaseSlow();
  const slowReceipt = await slowAttempt;
  assert.equal(slowReceipt.attempt, 1);
  assert.equal(fastReceipt.attempt, 2);
  assert.equal(bus.getLastReceipt().receiptId, fastReceipt.receiptId);
  assert.equal(bus.getHistory().length, 2);
});

test('Normal and Expert are projections over one retained application state', () => {
  const state = createCommandCenterState();
  state.setImageryView(IMAGERY_VIEW.HISTORY);
  state.setAskReceipt({
    receiptId: 'ask-v2-000001',
    state: ASK_ROUTE_STATE.ROUTED,
    input: 'imagery history'
  });
  const before = state.getSnapshot();
  state.setExperience(EXPERIENCE_MODE.EXPERT);
  state.setDiagnosticsOpen(true);
  const expert = state.getSnapshot();
  state.setExperience(EXPERIENCE_MODE.NORMAL);
  const after = state.getSnapshot();
  assert.equal(before.activeCapability, 'imagery');
  assert.equal(expert.imageryView, before.imageryView);
  assert.equal(after.imageryView, before.imageryView);
  assert.equal(expert.lastAskReceipt.receiptId, before.lastAskReceipt.receiptId);
  assert.equal(after.lastAskReceipt.receiptId, before.lastAskReceipt.receiptId);
  assert.equal(expert.diagnosticsOpen, true);
  assert.equal(after.diagnosticsOpen, false);
});

test('experience is absent from the canonical truth snapshot', () => {
  const input = {
    map: { state: 'READY', mapViewCreateCount: 1 },
    ground: { currentMode: 'AUTHORED_WEBMAP', applyState: 'READY' },
    time: {
      engineState: 'READY',
      requestedDate: '2026-08-17',
      selectedId: 'scene-1',
      activeId: null,
      matchKind: 'nearest',
      deltaDays: -2,
      selected: {
        acquisitionDate: '2026-08-15',
        releaseDate: '2026-08-16',
        firstPublicDate: '2026-08-16',
        vintageLabel: null
      }
    },
    askReceipt: { receiptId: 'ask-v2-000001', state: 'ROUTED' }
  };
  const truth = createCommandCenterTruthSnapshot(input);
  assert.equal('experience' in truth, false);
  assert.equal(truth.mapViewCreateCount, 1);
  assert.equal(truth.imageryCaptureDate, '2026-08-15');
  assert.equal(truth.imageryReleaseDate, '2026-08-16');
  assert.equal(truth.imageryRequestedDate, '2026-08-17');
});

test('operator imagery surface keeps clocks and future controls honest', () => {
  const source = read('shell', 'OperatorImageryExperience.js');
  for (const field of [
    'LATEST',
    'HISTORY',
    'ALL IMAGERY',
    'REQUESTED',
    'SELECTED',
    'OBSERVED / DISPLAYED',
    'CAPTURE DATE',
    'RELEASE DATE',
    'SOURCE',
    'RESOLUTION',
    'QUALITY / LIMIT'
  ]) {
    assert.match(source, new RegExp(field.replace('/', '\\/')));
  }
  for (const action of ['COMPARE', 'SWIPE', 'PLAY', 'ACQUIRE']) {
    assert.match(source, new RegExp(`\\['COMPARE', 'SWIPE', 'PLAY', 'ACQUIRE'\\]|${action}`));
  }
  assert.match(source, /disabled data-iqai-future-imagery-action/);
  assert.match(source, /COMING LATER/);
  assert.match(source, /ENTITLEMENT REQUIRED/);
  assert.match(source, /NOT AVAILABLE/);
  assert.match(source, /selected\?\.acquisitionDate \|\| 'UNKNOWN'/);
  assert.match(source, /selected\?\.releaseDate \|\| 'UNKNOWN'/);
  assert.doesNotMatch(source, /releaseDate\s*\|\|\s*selected\?\.acquisitionDate/);
});

test('source-grounded explanation remains explicit about disconnected AI and limits', () => {
  const source = read('shell', 'WhatAmILookingAt.js');
  for (const heading of [
    'WHAT AM I LOOKING AT?',
    'QUESTION',
    'IQAI SELECTED',
    'WHY',
    'WHAT IT SHOWS',
    'WHAT IT DOES NOT PROVE',
    'SOURCE',
    'DATE',
    'QUALITY',
    'EXPERT DETAILS'
  ]) {
    assert.match(source, new RegExp(heading.replace('?', '\\?')));
  }
  assert.match(source, /AI EXPLANATION · NOT CONNECTED/);
  assert.match(source, /pixel proof remains PARTIAL/);
  assert.match(source, /No AI rationale was generated/);
});

test('command-center wiring preserves the ArcGIS subsystem and diagnostic harness', () => {
  const app = read('shell', 'AppShell.js');
  const map = read('map', 'map-foundation.js');
  const imagery = read('shell', 'ImageryPanel.js');
  const operator = read('shell', 'OperatorImageryExperience.js');
  assert.equal((map.match(/new MapView\(/g) || []).length, 1);
  assert.match(app, /createAskCapabilityBus/);
  assert.match(app, /createCommandCenterTruthSnapshot/);
  assert.doesNotMatch(app, /spatial-capability-router/);
  assert.doesNotMatch(app, /\.save\(/);
  assert.match(imagery, /data-iqai-imagery-panel/);
  assert.match(imagery, /bootImageryGround/);
  assert.match(operator, /ENGINEERING DIAGNOSTICS/);
  assert.match(app, /EXPERIENCE_MODE\.EXPERT && state\.diagnosticsOpen/);
});
