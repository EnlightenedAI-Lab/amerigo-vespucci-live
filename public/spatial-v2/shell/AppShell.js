import { IQAI_SPATIAL_V2_SHELL_VERSION, SHELL_SLOTS } from './layout-registry.js';
import { bindAskIqaiDock, renderAskIqaiDock } from './AskIqaiDock.js';
import { bindCapabilityRail, renderCapabilityRail, setCapabilityStateLabel, setPluginStateLabel } from './CapabilityRail.js';
import { renderCommandHeader, startHeaderClock, updateHeaderStatus } from './CommandHeader.js';
import { renderContextInspector, setInspectorRegion } from './ContextInspector.js';
import { applyMapFoundationToStage, renderMapStage } from './MapStage.js';
import { getMapFoundationController, initMapFoundation, subscribeMapFoundation } from '../map/map-foundation.js';
import { getGroundSnapshot, setGroundMode, subscribeGroundController } from '../imagery/ground-controller.js';
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
import { bootImageryGround, setImageryDockOpen } from './ImageryPanel.js';

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
  bindCapabilityRail(root, {
    onCapability: () => setImageryDockOpen(root, false),
    onPlugin: (pluginId) => setImageryDockOpen(root, pluginId === 'imagery')
  });
  bindAskIqaiDock(root);

  const mapHost = root.querySelector('[data-iqai-map-host]');
  const navHost = root.querySelector('[data-iqai-map-nav]');
  let imageryBooted = false;
  subscribeMapFoundation((snapshot) => {
    applyMapFoundationToStage(root, snapshot);
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
  });
  const paintImageryProvenance = () => {
    const ground = getGroundSnapshot();
    const time = getTimeEngineSnapshot();
    const observation = time.selected || ground.receipt?.observation;
    const lines = [
      `Ground: ${ground.label || ground.currentMode}`,
      `Ground state: ${ground.applyState}`,
      `Imagery time state: ${time.engineState}`,
      observation?.productName ? `Product: ${observation.productName}` : null,
      observation?.dateKindUsed ? `Date kind: ${observation.dateKindUsed}` : null,
      `requestedDate: ${time.requestedDate || 'null'}`,
      `releaseDate: ${observation?.releaseDate || 'null'}`,
      `acquisitionDate: ${observation?.acquisitionDate || 'null'}`,
      `firstPublicDate: ${observation?.firstPublicDate || 'null'}`,
      `match: ${time.matchKind} deltaDays=${time.deltaDays == null ? 'null' : time.deltaDays}`,
      'Imagery time is not OWI AS_OF, PI AT/RANGE, or Situation time.',
      observation?.limitation || null,
      observation?.establishes ? `Establishes: ${observation.establishes}` : null,
      observation?.doesNotEstablish ? `Does not establish: ${observation.doesNotEstablish}` : null
    ].filter(Boolean);
    setInspectorRegion(root, 'provenance-slot', {
      stateLabel: time.activeId ? 'IMAGERY TIME' : (ground.applyState === 'READY' ? 'GROUND' : (ground.applyState || 'RESERVED')),
      body: lines.join('\n')
    });
    setInspectorRegion(root, 'execution-receipt-slot', {
      stateLabel: time.engineState || ground.applyState || 'RECEIPT',
      body: [
        `groundMode: ${ground.currentMode}`,
        `timeActive: ${time.activeId || 'none'}`,
        `wayback: ${time.entitlements.wayback}`,
        `nearmap: ${time.entitlements.nearmap}`,
        ground.error ? `groundError: ${ground.error}` : null,
        time.error ? `timeError: ${time.error}` : null
      ].filter(Boolean).join('\n')
    });
    setPluginStateLabel(
      root,
      'imagery',
      time.activeId ? 'TIME' : (ground.applyState === 'READY' ? 'GROUND' : ground.applyState)
    );
  };
  subscribeGroundController(paintImageryProvenance);
  subscribeTimeEngine(paintImageryProvenance);
  void initMapFoundation(mapHost, { navHost }).catch(() => {});

  const api = {
    version: IQAI_SPATIAL_V2_SHELL_VERSION,
    slots: SHELL_SLOTS,
    measure: () => measureShellComposition(root),
    mapFoundation: getMapFoundationController(),
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
