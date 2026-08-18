import { IQAI_SPATIAL_V2_SHELL_VERSION, SHELL_SLOTS } from './layout-registry.js';
import { bindAskIqaiDock, paintAskIqaiReceipt, renderAskIqaiDock } from './AskIqaiDock.js';
import { bindCapabilityRail, paintCapabilitySelection, renderCapabilityRail, setCapabilityStateLabel, setPluginStateLabel } from './CapabilityRail.js';
import {
  bindExperienceControls,
  bindSystemStatusControl,
  paintExperienceControl,
  paintSystemStatus,
  renderCommandHeader,
  startHeaderClock,
  updateHeaderStatus
} from './CommandHeader.js';
import { bindContextInspector, paintInspectorPane, renderContextInspector, setInspectorRegion } from './ContextInspector.js';
import { applyMapFoundationToStage, renderMapStage } from './MapStage.js';
import { bindGooglePhotorealistic3dControl } from './GooglePhotorealistic3dControl.js';
import { bindStreet360Control } from './Street360Control.js';
import { bindViewSwitcher } from './ViewSwitcher.js';
import { bindDropPinControl } from './DropPinControl.js';
import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import { bindOperatorGroundControl, paintOperatorGroundControl } from './OperatorGroundControl.js';
import { getMapFoundationController, initMapFoundation, subscribeMapFoundation } from '../map/map-foundation.js';
import { getGroundSnapshot, setGroundMode, subscribeGroundController } from '../imagery/ground-controller.js';
import { TIME_PROVIDER_FILTER } from '../imagery/imagery-contract.js';
import {
  activateObservation,
  discoverImageryTime,
  getTimeEngineSnapshot,
  nextObservation,
  previousObservation,
  selectObservation,
  setTimeEngineOptions,
  subscribeTimeEngine
} from '../imagery/time-engine.js';
import {
  bootImageryGround,
  isImageryDockOpen,
  setImageryDockOpen
} from './ImageryPanel.js';
import { createAskCapabilityBus } from './ask-capability-bus.js';
import {
  createCommandCenterState,
  createCommandCenterTruthSnapshot,
  EXPERIENCE_MODE,
  IMAGERY_VIEW
} from './command-center-state.js';
import {
  bindOperatorImageryExperience,
  paintOperatorImageryExperience
} from './OperatorImageryExperience.js';
import { paintWhatAmILookingAt } from './WhatAmILookingAt.js';
import { deriveGuidedNextAction, identityOfGuided, paintGuidedNextAction } from './guided-next-action.js';

function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height)
  };
}

export function measureShellComposition(root = document.getElementById('iqai-spatial-v2')) {
  const app = rectOf(root);
  const header = rectOf(root?.querySelector('[data-iqai-slot="command-header"]'));
  const rail = rectOf(root?.querySelector('[data-iqai-slot="capability-rail"]'));
  const stage = rectOf(root?.querySelector('[data-iqai-slot="map-stage"]'));
  const inspector = rectOf(root?.querySelector('[data-iqai-slot="context-inspector"]'));
  const ask = rectOf(root?.querySelector('[data-iqai-slot="ask-iqai-dock"]'));
  const appArea = app ? app.width * app.height : 0;
  const stageArea = stage ? stage.width * stage.height : 0;

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pageScroll: {
      x: window.scrollX,
      y: window.scrollY,
      documentOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
      bodyOverflowY: document.body.scrollHeight > window.innerHeight + 1
    },
    regions: { app, header, rail, stage, inspector, ask },
    mapStageShare: appArea ? Number((stageArea / appArea).toFixed(4)) : 0
  };
}

function unavailableCapability(id, label, aliases, quickActionIds, unavailableReason) {
  return {
    id,
    label,
    aliases,
    quickActionIds,
    isAvailable: false,
    unavailableReason,
    handle: () => null
  };
}

function createApplicationCapabilities(commandState) {
  return [
    {
      id: 'map',
      label: 'Operational map',
      aliases: ['map', 'show map', 'open map'],
      quickActionIds: ['map'],
      isAvailable: true,
      handle: () => {
        commandState.setActiveCapability('map');
        return {
          applicationAction: 'CONTEXT_SELECTED',
          engineExecuted: false,
          message: 'Operational map context selected. No GIS command was executed.'
        };
      }
    },
    {
      id: 'imagery',
      label: 'Imagery',
      aliases: [
        'imagery',
        'show imagery',
        'latest imagery',
        'show latest imagery',
        'imagery history',
        'show imagery history',
        'all imagery'
      ],
      quickActionIds: ['imagery'],
      isAvailable: true,
      handle: ({ normalizedText }) => {
        let imageryView = IMAGERY_VIEW.LATEST;
        if (normalizedText === 'imagery history' || normalizedText === 'show imagery history') {
          imageryView = IMAGERY_VIEW.HISTORY;
        }
        if (normalizedText === 'all imagery') imageryView = IMAGERY_VIEW.ALL;
        commandState.setImageryView(imageryView);
        return {
          applicationAction: 'IMAGERY_CONTEXT_SELECTED',
          engineExecuted: false,
          imageryView,
          message: `${imageryView === IMAGERY_VIEW.ALL ? 'All imagery' : imageryView} context opened. No imagery result was invented.`
        };
      }
    },
    unavailableCapability(
      'analysis',
      'Scientific analysis',
      [
        'analyze',
        'show vegetation health',
        'show water change',
        'show burn effects',
        'find new clearing',
        'what changed between these dates'
      ],
      ['analyze'],
      'Remote-sensing analysis is not connected. ArcGIS Master owns the computation.'
    ),
    unavailableCapability(
      'intelligence',
      'Open-world intelligence',
      ['intelligence', 'open world intelligence'],
      ['intelligence'],
      'Open-world intelligence is not connected.'
    ),
    unavailableCapability(
      'vision',
      'Vision',
      ['vision', 'analyze this image'],
      ['vision'],
      'Vision is not connected.'
    ),
    unavailableCapability(
      'build',
      'Build',
      ['build', 'build a map', 'create a map'],
      ['build'],
      'Build execution is not connected.'
    )
  ];
}

export function mountCommandCenter(root) {
  if (!root) return null;

  root.innerHTML = `
    ${renderCommandHeader()}
    ${renderCapabilityRail()}
    ${renderMapStage()}
    ${renderContextInspector()}
    ${renderAskIqaiDock()}
  `;

  startHeaderClock(root);
  const commandState = createCommandCenterState();
  const askBus = createAskCapabilityBus({
    capabilities: createApplicationCapabilities(commandState)
  });
  const mapController = getMapFoundationController();
  const specialists = {};
  const google3d = bindGooglePhotorealistic3dControl(root, {
    getSpatialFocus: () => getActiveSpatialFocus(),
    getPeerSelectedPoint: () => getActiveSpatialFocus()
  });
  const street360 = bindStreet360Control(root, {
    getSpatialFocus: () => getActiveSpatialFocus(),
    getPeerSelectedPoint: () => getActiveSpatialFocus(),
    isPeerSpecialistOpen: () => {
      const snap = google3d.snapshot();
      return snap.open === true || snap.stageState === 'OPENING' || snap.stageState === 'OPEN';
    },
    closePeerSpecialist: () => google3d.close({ restoreMap: false })
  });
  const dropPin = bindDropPinControl(root, {
    getActiveView: () => specialists.view?.snapshot?.().activeView || 'map',
    returnToMap: () => specialists.view?.setView('map'),
    onPlaced: (point) => {
      if (!point) return;
      street360.selectPoint(point.longitude, point.latitude, 'drop-pin');
      google3d.selectPoint(point.longitude, point.latitude, 'drop-pin');
      specialists.view?.onMapPointSelected(point);
    }
  });
  specialists.street360 = street360;
  specialists.view = bindViewSwitcher(root, {
    google3d,
    street360,
    armDropPin: () => dropPin.arm()
  });
  const viewSwitcher = specialists.view;
  let mapSnapshot = mapController.getSnapshot();
  let imageryBooted = false;

  const paintCommandCenter = () => {
    const state = commandState.getSnapshot();
    const ground = getGroundSnapshot();
    const time = getTimeEngineSnapshot();
    const observation = time.selected || ground.receipt?.observation;
    const guided = deriveGuidedNextAction({
      activeCapability: state.activeCapability,
      imageryView: state.imageryView,
      observationCount: time.observations?.length || 0,
      displayConfirmed: time.displayConfirmed === true,
      historyDateCommitted: state.historyDateCommitted
    });
    const sheetOpen = state.activeCapability !== 'map' || Boolean(state.lastAskReceipt);
    root.dataset.iqaiSheet = sheetOpen ? 'open' : 'closed';
    const begin = root.querySelector('[data-iqai-begin]');
    if (begin) begin.hidden = sheetOpen || mapSnapshot.state !== 'READY';

    paintExperienceControl(root, state.experience);
    paintSystemStatus(root, {
      mapState: mapSnapshot.state,
      open: state.systemStatusOpen
    });
    paintOperatorGroundControl(root, ground);
    paintCapabilitySelection(root, state.activeCapability);
    paintInspectorPane(root, state.inspectorPane || 'situation-slot');
    setImageryDockOpen(
      root,
      state.experience === EXPERIENCE_MODE.EXPERT && state.diagnosticsOpen
    );
    paintOperatorImageryExperience(root, {
      state,
      ground,
      time,
      mapState: mapSnapshot.state,
      guided
    });
    paintWhatAmILookingAt(root, { state, ground, time });
    paintGuidedNextAction(root, guided, state.experience);

    const provenanceLines = [
      `Ground: ${ground.label || ground.currentMode}`,
      `Ground state: ${ground.applyState}`,
      `Imagery time state: ${time.engineState}`,
      observation?.productName ? `Product: ${observation.productName}` : null,
      observation?.dateKindUsed ? `Date kind: ${observation.dateKindUsed}` : null,
      `requestedDate: ${time.requestedDate || 'null'}`,
      `acquisitionDate: ${observation?.acquisitionDate || 'null'}`,
      `releaseDate: ${observation?.releaseDate || 'null'}`,
      `onlineDate: ${observation?.firstPublicDate || 'null'}`,
      `vintage: ${observation?.vintageLabel || observation?.vintageYear || 'null'}`,
      `match: ${time.matchKind} deltaDays=${time.deltaDays == null ? 'null' : time.deltaDays}`,
      `displayState: ${time.displayState || 'NONE'}`,
      `displayConfirmed: ${time.displayConfirmed === true}`,
      'Imagery time is not OWI AS_OF, PI AT/RANGE, or Situation time.',
      'Map presence and engine READY do not prove imagery pixels.',
      observation?.limitation || null,
      observation?.establishes ? `Establishes: ${observation.establishes}` : null,
      observation?.doesNotEstablish ? `Does not establish: ${observation.doesNotEstablish}` : null
    ].filter(Boolean);
    setInspectorRegion(root, 'provenance-slot', {
      stateLabel: time.activeId
        ? 'IMAGERY TIME'
        : (ground.applyState === 'READY' ? 'GROUND' : (ground.applyState || 'RESERVED')),
      body: provenanceLines.join('\n')
    });

    const askReceipt = state.lastAskReceipt;
    const receiptLines = askReceipt
      ? [
          `askReceipt: ${askReceipt.receiptId}`,
          `state: ${askReceipt.state}`,
          `reason: ${askReceipt.reason}`,
          `capability: ${askReceipt.capabilityId || 'none'}`,
          `executed: ${askReceipt.executed}`,
          `input: ${askReceipt.input || '(empty)'}`,
          askReceipt.result?.applicationAction
            ? `applicationAction: ${askReceipt.result.applicationAction}`
            : null,
          askReceipt.result?.engineExecuted != null
            ? `engineExecuted: ${askReceipt.result.engineExecuted}`
            : null,
          askReceipt.error ? `error: ${askReceipt.error}` : null
        ].filter(Boolean)
      : ['Ask receipt: none'];
    const imageryReceiptLines = state.experience === EXPERIENCE_MODE.EXPERT
      ? [
          `groundMode: ${ground.currentMode}`,
          `timeActive: ${time.activeId || 'none'}`,
          `displayState: ${time.displayState || 'NONE'}`,
          `displayConfirmed: ${time.displayConfirmed === true}`,
          `wayback: ${time.entitlements.wayback}`,
          `nearmap: ${time.entitlements.nearmap}`,
          ground.error ? `groundError: ${ground.error}` : null,
          time.error ? `timeError: ${time.error}` : null
        ].filter(Boolean)
      : [
          `Imagery engine: ${time.engineState}`,
          `DISPLAY: ${time.displayConfirmed === true ? 'DISPLAY_CONFIRMED' : (time.displayState && time.displayState !== 'NONE' ? 'DISPLAY NOT CONFIRMED' : 'NONE')}`,
          'Engine receipts and provider diagnostics are available in Expert.'
        ];
    setInspectorRegion(root, 'execution-receipt-slot', {
      stateLabel: askReceipt?.state || time.engineState || ground.applyState || 'RECEIPT',
      body: [...receiptLines, ...imageryReceiptLines].join('\n')
    });

    let imageryState = ground.applyState || 'RESERVED';
    if (ground.applyState === 'READY' && time.engineState === 'READY') imageryState = 'READY';
    if (ground.applyState === 'APPLYING' || time.engineState === 'APPLYING' || time.engineState === 'DISCOVERING') {
      imageryState = 'APPLYING';
    }
    if (ground.applyState === 'ERROR' || time.engineState === 'ERROR') imageryState = 'ERROR';
    setPluginStateLabel(root, 'imagery', imageryState);
  };

  bindContextInspector(root, {
    onPane: (slot) => commandState.setInspectorPane(slot)
  });
  bindCapabilityRail(root, {
    onCapability: (capabilityId) => commandState.setActiveCapability(capabilityId),
    onPlugin: (pluginId) => commandState.setActiveCapability(pluginId)
  });
  bindExperienceControls(root, {
    onChange: (experience) => commandState.setExperience(experience)
  });
  bindSystemStatusControl(root, {
    onToggle: () => {
      const current = commandState.getSnapshot();
      commandState.setSystemStatusOpen(!current.systemStatusOpen);
    }
  });
  bindOperatorGroundControl(root, {
    onChange: (modeId) => setGroundMode(modeId)
  });
  bindOperatorImageryExperience(root, {
    onView: (imageryView) => commandState.setImageryView(imageryView),
    onRequestedDate: (requestedDate) => {
      commandState.commitHistoryDate();
      setTimeEngineOptions({ requestedDate });
    },
    onDiscover: () => {
      const state = commandState.getSnapshot();
      commandState.commitHistoryDate();
      const options = {
        providerFilter: TIME_PROVIDER_FILTER.ALL
      };
      if (state.imageryView === IMAGERY_VIEW.LATEST) {
        options.requestedDate = new Date().toISOString().slice(0, 10);
      }
      setTimeEngineOptions(options);
      void discoverImageryTime(options).catch(() => {});
    },
    onActivate: () => void activateObservation().catch(() => {}),
    onPrevious: () => void previousObservation().catch(() => {}),
    onNext: () => void nextObservation().catch(() => {}),
    onSelect: (observationId) => void selectObservation(observationId).catch(() => {}),
    onDiagnostics: () => commandState.setDiagnosticsOpen(!isImageryDockOpen(root))
  });
  bindAskIqaiDock(root, {
    onSubmit: (request) => askBus.execute(request)
  });
  askBus.subscribe((receipt) => {
    commandState.setAskReceipt(receipt);
    paintAskIqaiReceipt(root, receipt);
  });
  commandState.subscribe(paintCommandCenter);

  const mapHost = root.querySelector('[data-iqai-map-host]');
  const navHost = root.querySelector('[data-iqai-map-nav]');
  subscribeMapFoundation((snapshot) => {
    mapSnapshot = snapshot;
    applyMapFoundationToStage(root, snapshot);
    google3d.setMapReady(snapshot.state === 'READY');
    street360.setMapReady(snapshot.state === 'READY');
    dropPin.setMapReady(snapshot.state === 'READY');
    viewSwitcher.paint();
    setCapabilityStateLabel(root, 'map', snapshot.state === 'READY' ? 'READY' : snapshot.state);
    if (snapshot.state === 'READY') {
      updateHeaderStatus(
        root,
        'agol-portal',
        snapshot.portalUser || snapshot.webmapTitle || 'WEBMAP READY',
        'ready'
      );
      if (!imageryBooted) {
        imageryBooted = true;
        void bootImageryGround(root).catch(() => {
          setPluginStateLabel(root, 'imagery', 'ERROR');
        });
      }
    } else if (snapshot.state === 'ERROR') {
      updateHeaderStatus(root, 'agol-portal', 'NOT CONNECTED', 'disconnected');
    }
    paintCommandCenter();
  });
  subscribeGroundController(paintCommandCenter);
  subscribeTimeEngine(paintCommandCenter);
  void initMapFoundation(mapHost, { navHost }).catch(() => {});

  const api = {
    version: IQAI_SPATIAL_V2_SHELL_VERSION,
    applicationVersion: 'next-generation-shell-v1',
    slots: SHELL_SLOTS,
    measure: () => measureShellComposition(root),
    mapFoundation: mapController,
    google3d,
    street360,
    viewSwitcher,
    dropPin,
    spatialFocus: getActiveSpatialFocus,
    commandCenter: {
      getSnapshot: () => commandState.getSnapshot(),
      setExperience: (experience) => commandState.setExperience(experience),
      setActiveCapability: (capabilityId) => commandState.setActiveCapability(capabilityId),
      setImageryView: (imageryView) => commandState.setImageryView(imageryView),
      commitHistoryDate: () => commandState.commitHistoryDate(),
      setSystemStatusOpen: (open) => commandState.setSystemStatusOpen(open),
      guided: () => {
        const command = commandState.getSnapshot();
        const time = getTimeEngineSnapshot();
        return deriveGuidedNextAction({
          activeCapability: command.activeCapability,
          imageryView: command.imageryView,
          observationCount: time.observations?.length || 0,
          displayConfirmed: time.displayConfirmed === true,
          historyDateCommitted: command.historyDateCommitted
        });
      }
    },
    ask: {
      execute: (request) => askBus.execute(request),
      getLastReceipt: () => askBus.getLastReceipt(),
      getCapabilities: () => askBus.getCapabilities()
    },
    truth: () => {
      const command = commandState.getSnapshot();
      const time = getTimeEngineSnapshot();
      const guided = deriveGuidedNextAction({
        activeCapability: command.activeCapability,
        imageryView: command.imageryView,
        observationCount: time.observations?.length || 0,
        displayConfirmed: time.displayConfirmed === true,
        historyDateCommitted: command.historyDateCommitted
      });
      return createCommandCenterTruthSnapshot({
        map: {
          ...mapController.getSnapshot(),
          mapViewCreateCount: mapController.getMapViewCreateCount()
        },
        ground: getGroundSnapshot(),
        time,
        askReceipt: askBus.getLastReceipt(),
        command,
        guided: identityOfGuided(guided)
      });
    },
    ground: () => getGroundSnapshot(),
    time: () => getTimeEngineSnapshot(),
    setGroundMode,
    setTimeEngineOptions,
    discoverImageryTime,
    activateObservation,
    previousObservation,
    nextObservation,
    selectObservation
  };

  window.__iqaiSpatialV2 = api;
  return api;
}
