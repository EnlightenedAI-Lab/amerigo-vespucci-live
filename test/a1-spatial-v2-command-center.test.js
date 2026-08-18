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
import {
  GUIDED_ACTION,
  GUIDED_STEP,
  GUIDED_WORKFLOW,
  deriveGuidedNextAction,
  identityOfGuided
} from '../public/spatial-v2/shell/guided-next-action.js';
import { projectImageryDisplayTruth } from '../public/spatial-v2/shell/imagery-display-truth.js';

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
      displayConfirmed: false,
      displayState: 'SELECTED',
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
  assert.equal('systemStatusOpen' in truth, false);
  assert.equal(truth.mapViewCreateCount, 1);
  assert.equal(truth.imageryCaptureDate, '2026-08-15');
  assert.equal(truth.imageryReleaseDate, '2026-08-16');
  assert.equal(truth.imageryRequestedDate, '2026-08-17');
  assert.equal(truth.displayConfirmed, false);
  assert.equal(truth.groundDisplayConfirmed, false);
  assert.equal(truth.displayState, 'SELECTED');
  assert.equal(truth.imagerySelectedId, 'scene-1');
});

test('operator imagery surface keeps clocks and future controls honest', () => {
  const source = read('shell', 'OperatorImageryExperience.js');
  const display = read('shell', 'imagery-display-truth.js');
  for (const field of [
    'LATEST',
    'HISTORY',
    'ALL IMAGERY',
    'REQUESTED',
    'SELECTED',
    'ACTIVATED',
    'DISPLAY',
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
  assert.match(source, /formatCaptureLine/);
  assert.match(source, /formatReleaseLine/);
  assert.doesNotMatch(source, /matchDate \|\| observation\.acquisitionDate \|\| observation\.releaseDate/);
  assert.match(source, /projectImageryDisplayTruth/);
  assert.match(display, /DISPLAY_CONFIRMED/);
  assert.match(display, /DISPLAY NOT CONFIRMED/);
  assert.doesNotMatch(source, /OBSERVED \/ DISPLAYED/);
  assert.doesNotMatch(source, /NOT DISPLAYED/);
  assert.doesNotMatch(source, /releaseDate\s*\|\|\s*selected\?\.acquisitionDate/);
});

test('source-grounded explanation remains explicit about disconnected AI and limits', () => {
  const source = read('shell', 'WhatAmILookingAt.js');
  for (const heading of [
    'WHAT AM I LOOKING AT?',
    'QUESTION',
    'IQAI SELECTED',
    'WHY',
    'DISPLAY',
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
  assert.match(source, /ArcGIS-owned/);
  assert.match(source, /No AI rationale was generated/);
  assert.match(source, /displayConfirmed/);
  assert.match(source, /projectImageryDisplayTruth/);
  assert.match(read('shell', 'imagery-display-truth.js'), /DISPLAY NOT CONFIRMED/);
  assert.match(read('shell', 'imagery-display-truth.js'), /DISPLAY_CONFIRMED/);
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
  assert.match(operator, /data-iqai-guided-next-action/);
  assert.match(operator, /formatBestImageActionLabel/);
  assert.match(read('imagery', 'imagery-capture-receipt.js'), /SHOW BEST IMAGE/);
  assert.match(operator, /EXPERT DEPTH/);
  assert.match(operator, /data-iqai-display-label/);
  assert.match(app, /EXPERIENCE_MODE\.EXPERT && state\.diagnosticsOpen/);
  assert.match(app, /displayConfirmed: time\.displayConfirmed === true/);
  assert.match(app, /bindOperatorGroundControl/);
  assert.match(app, /bindSystemStatusControl/);
  assert.match(app, /onChange: \(modeId\) => setGroundMode\(modeId\)/);
  assert.match(read('shell', 'guided-next-action.js'), /displayConfirmed === true/);
});

test('Guided Next Action is derived once and ignores experience', () => {
  const input = {
    activeCapability: 'imagery',
    imageryView: IMAGERY_VIEW.HISTORY,
    observationCount: 0,
    selectedId: null,
    historyDateCommitted: false
  };
  const normal = deriveGuidedNextAction(input);
  const expert = deriveGuidedNextAction(input);
  assert.equal(normal.workflowId, GUIDED_WORKFLOW.IMAGERY_HISTORY);
  assert.equal(normal.currentStep, GUIDED_STEP.CHOOSE_DATE);
  assert.equal(normal.recommendedAction, GUIDED_ACTION.CHOOSE_DATE);
  assert.deepEqual(identityOfGuided(normal), identityOfGuided(expert));
});

test('Normal and Expert keep the same History next action across mode changes', () => {
  const state = createCommandCenterState();
  state.setImageryView(IMAGERY_VIEW.HISTORY);
  const before = deriveGuidedNextAction(state.getSnapshot());
  state.setExperience(EXPERIENCE_MODE.EXPERT);
  state.setDiagnosticsOpen(true);
  const expert = deriveGuidedNextAction(state.getSnapshot());
  state.setExperience(EXPERIENCE_MODE.NORMAL);
  const after = deriveGuidedNextAction(state.getSnapshot());
  assert.equal(before.currentStep, GUIDED_STEP.CHOOSE_DATE);
  assert.deepEqual(identityOfGuided(expert), identityOfGuided(before));
  assert.deepEqual(identityOfGuided(after), identityOfGuided(before));
  assert.equal(state.getSnapshot().diagnosticsOpen, false);
});

test('canonical truth includes guided identity and excludes experience', () => {
  const guided = deriveGuidedNextAction({
    activeCapability: 'imagery',
    imageryView: IMAGERY_VIEW.HISTORY
  });
  const truth = createCommandCenterTruthSnapshot({
    map: { state: 'READY', mapViewCreateCount: 1 },
    command: {
      activeCapability: 'imagery',
      imageryView: IMAGERY_VIEW.HISTORY,
      historyDateCommitted: false
    },
    time: {
      selectedId: 'scene-1',
      displayConfirmed: false,
      displayState: 'SELECTED'
    },
    guided: identityOfGuided(guided)
  });
  assert.equal('experience' in truth, false);
  assert.equal('systemStatusOpen' in truth, false);
  assert.equal(truth.guidedWorkflowId, GUIDED_WORKFLOW.IMAGERY_HISTORY);
  assert.equal(truth.guidedCurrentStep, GUIDED_STEP.CHOOSE_DATE);
  assert.equal(truth.guidedRecommendedAction, GUIDED_ACTION.CHOOSE_DATE);
  assert.equal(truth.displayConfirmed, false);
  assert.equal(truth.displayState, 'SELECTED');
});

test('SHOW_BEST_IMAGE completes only when displayConfirmed is true', () => {
  const selectedOnly = {
    activeCapability: 'imagery',
    imageryView: IMAGERY_VIEW.HISTORY,
    observationCount: 3,
    selectedId: 'scene-1',
    historyDateCommitted: true,
    displayConfirmed: false
  };
  const selected = deriveGuidedNextAction(selectedOnly);
  assert.equal(selected.currentStep, GUIDED_STEP.SHOW_BEST_IMAGE);
  assert.equal(selected.recommendedAction, GUIDED_ACTION.SHOW_BEST_IMAGE);
  assert.equal(selected.completedSteps.includes(GUIDED_STEP.SHOW_BEST_IMAGE), false);

  const confirmedInput = { ...selectedOnly, displayConfirmed: true };
  const confirmed = deriveGuidedNextAction(confirmedInput);
  assert.equal(confirmed.currentStep, GUIDED_STEP.REVIEW_OBSERVATIONS);
  assert.equal(confirmed.completedSteps.includes(GUIDED_STEP.SHOW_BEST_IMAGE), true);
  assert.deepEqual(identityOfGuided(confirmed), identityOfGuided(deriveGuidedNextAction(confirmedInput)));
});

test('Normal and Expert keep the same guided identity when display is unconfirmed', () => {
  const input = {
    activeCapability: 'imagery',
    imageryView: IMAGERY_VIEW.LATEST,
    selectedId: 'scene-1',
    displayConfirmed: false
  };
  const normal = deriveGuidedNextAction(input);
  const expert = deriveGuidedNextAction(input);
  assert.equal(normal.currentStep, GUIDED_STEP.SHOW_BEST_IMAGE);
  assert.deepEqual(identityOfGuided(normal), identityOfGuided(expert));
});

test('missing display-truth stays missing in the canonical snapshot', () => {
  const truth = createCommandCenterTruthSnapshot({
    time: { selectedId: 'scene-1' }
  });
  assert.equal(truth.displayConfirmed, false);
  assert.equal(truth.displayState, null);
  assert.equal(truth.imagerySelectedId, 'scene-1');
  assert.equal('experience' in truth, false);
});

test('operator display chrome distinguishes SELECTED, ACTIVATED, and DISPLAY_CONFIRMED', () => {
  const none = projectImageryDisplayTruth({});
  assert.equal(none.displayLabel, 'NONE');
  assert.equal(none.displayConfirmed, false);
  assert.equal(none.selectedLabel, 'NO OBSERVATION SELECTED');
  assert.equal(none.activatedLabel, 'NOT ACTIVATED');

  const selected = projectImageryDisplayTruth({
    selectedId: 'scene-1',
    selected: { id: 'scene-1', productName: 'Wayback 2024' },
    displayConfirmed: false,
    displayState: 'SELECTED'
  });
  assert.equal(selected.displayLabel, 'DISPLAY NOT CONFIRMED');
  assert.equal(selected.selectedLabel, 'Wayback 2024');
  assert.equal(selected.displayedLabel, null);
  assert.notEqual(selected.displayLabel, 'DISPLAYED');

  const activated = projectImageryDisplayTruth({
    selectedId: 'scene-1',
    activeId: 'scene-1',
    activatedId: 'scene-1',
    selected: { id: 'scene-1', productName: 'Wayback 2024' },
    activated: { id: 'scene-1', productName: 'Wayback 2024' },
    displayConfirmed: false,
    displayState: 'ACTIVATED'
  });
  assert.equal(activated.displayLabel, 'DISPLAY NOT CONFIRMED');
  assert.equal(activated.activatedLabel, 'Wayback 2024');
  assert.equal(activated.displayedLabel, null);

  const confirmed = projectImageryDisplayTruth({
    selectedId: 'scene-1',
    activeId: 'scene-1',
    activatedId: 'scene-1',
    selected: { id: 'scene-1', productName: 'Wayback 2024' },
    activated: { id: 'scene-1', productName: 'Wayback 2024' },
    displayConfirmed: true,
    displayState: 'DISPLAY_CONFIRMED'
  });
  assert.equal(confirmed.displayLabel, 'DISPLAY_CONFIRMED');
  assert.equal(confirmed.displayedLabel, 'Wayback 2024');

  const stateWithoutFlag = projectImageryDisplayTruth({
    selectedId: 'scene-1',
    displayConfirmed: false,
    displayState: 'DISPLAY_CONFIRMED'
  });
  assert.equal(stateWithoutFlag.displayLabel, 'DISPLAY NOT CONFIRMED');
  assert.equal(stateWithoutFlag.displayedLabel, null);

  const noPin = projectImageryDisplayTruth({ pool: 'LATEST' }, {
    imageryView: 'LATEST',
    ground: { currentMode: 'AUTHORED_WEBMAP' },
    focus: null
  });
  assert.equal(noPin.selectedLabel, 'NO PLACE SELECTED');
  assert.match(noPin.operatorMessage, /DROP PIN/);

  const latestNearmap = projectImageryDisplayTruth({ pool: 'LATEST' }, {
    imageryView: 'LATEST',
    focus: { longitude: -73.5673, latitude: 45.5017, sourceType: 'DROP_PIN' },
    ground: {
      currentMode: 'NEARMAP',
      applyState: 'READY',
      displayConfirmed: true,
      receipt: { observation: { id: 'nearmap-wms-latest', providerId: 'nearmap-wms-latest' } }
    }
  });
  assert.equal(latestNearmap.selectedLabel, 'NEARMAP · CURRENT');
  assert.equal(latestNearmap.activatedLabel, 'NEARMAP · CURRENT');
  assert.equal(latestNearmap.displayLabel, 'DISPLAY_CONFIRMED');

  const historyIdle = projectImageryDisplayTruth({ pool: 'HISTORY', selectedId: null }, {
    imageryView: 'HISTORY'
  });
  assert.match(historyIdle.operatorMessage, /Click a row to activate/);
});
