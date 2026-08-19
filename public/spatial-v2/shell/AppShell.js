/**
 * AppShell is composition only.
 * It renders stable slots, subscribes to host view models, and emits no domain
 * actions directly. Provider logic, imagery truth, AI reasoning, scenario
 * logic, Policy authority, source truth, and specialist engines are forbidden.
 */

import { IQAI_SPATIAL_V2_SHELL_VERSION, SHELL_SLOTS } from './layout-registry.js';
import {
  bindExperienceControls,
  bindSearchControl,
  bindSystemStatusControl,
  paintExperienceControl,
  paintSystemStatus,
  renderCommandHeader,
  startHeaderClock
} from './CommandHeader.js';
import { bindSystemsRail, paintSystemsRail, renderSystemsRail } from './SystemsRail.js';
import { bindLayersDrawer, paintLayersDrawer, renderLayersDrawer } from './LayersDrawer.js';
import { bindTimeDock, paintTimeDock, renderTimeDock } from './TimeDock.js';
import {
  bindAskIqaiDock,
  bindContextInspector,
  bindToolHost,
  paintAskIqaiDock,
  paintAskIqaiReceipt,
  paintBrainHost,
  paintInspectorHost,
  paintInspectorPane,
  paintMapStageHost,
  renderBrainHost,
  renderInspectorHost,
  renderMapStageHost
} from '../hosts/index.js';

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

export function renderAppShell() {
  return `
    ${renderCommandHeader()}
    ${renderSystemsRail()}
    ${renderMapStageHost()}
    ${renderLayersDrawer()}
    ${renderInspectorHost()}
    ${renderBrainHost()}
    ${renderTimeDock()}
  `;
}

export function mountAppShell(root, host = {}) {
  if (!root) return null;
  root.innerHTML = renderAppShell();
  root.dataset.iqaiChassis = 'platform-chassis-v1';
  root.dataset.iqaiSheet = 'closed';
  root.dataset.iqaiWorldview = 'map-first-v1';
  root.dataset.iqaiAsk = 'closed';
  startHeaderClock(root);

  const paint = () => {
    const model = typeof host.getViewModel === 'function' ? host.getViewModel() : {};
    paintExperienceControl(root, model.experience || 'NORMAL');
    paintSystemStatus(root, {
      mapState: model.mapState || 'SHELL_ONLY',
      open: model.systemStatusOpen === true
    });
    paintSystemsRail(root, {
      activeLauncher: model.activeLauncher,
      drawerOpen: model.drawer === 'layers'
    });
    paintLayersDrawer(root, {
      open: model.drawer === 'layers',
      groups: model.layerGroups || [],
      addDataOpen: model.addDataOpen === true,
      addDataResults: model.addDataResults || [],
      addDataStatus: model.addDataStatus || null,
      discover: model.discover || null
    });
    paintTimeDock(root, {
      open: model.timeDrawerOpen === true,
      temporal: model.temporal,
      streetCapture: model.streetCapture
        || (typeof window !== 'undefined'
          ? window.__iqaiSpatialV2?.street360?.snapshot?.()?.capture
          : null)
    });
    paintAskIqaiDock(root, { open: model.askOpen === true });
    paintMapStageHost(root, {
      activeViewId: model.activeViewId,
      view: model.activeView,
      mapState: model.mapState
    });
    paintInspectorPane(root, model.inspectorPane || 'situation-slot');
    paintInspectorHost(root, model.inspector || {
      situationState: 'RESERVED',
      situation: 'Chassis inspector is waiting for World State projection.',
      selectionState: 'RESERVED',
      selection: 'No ObjectRef selected.',
      evidenceState: 'RESERVED',
      evidence: 'No evidence.',
      provenanceState: 'RESERVED',
      provenance: 'No source.',
      receiptState: 'RESERVED',
      receipt: 'No receipts.'
    });
    paintBrainHost(root, {
      seam: model.brainSeam,
      localState: model.localModelState || 'NOT CONNECTED'
    });
    root.dataset.iqaiSheet = model.inspectorOpen === true ? 'open' : 'closed';
    if (model.askReceipt) paintAskIqaiReceipt(root, model.askReceipt);
  };

  bindContextInspector(root, {
    onPane: (slot) => host.setInspectorPane?.(slot)
  });
  bindSystemsRail(root, {
    onLauncher: (launcherId) => host.setLauncher?.(launcherId)
  });
  bindLayersDrawer(root, {
    onClose: () => host.setLauncher?.('layers'),
    onVisibility: (input) => host.dispatchCapability?.('layers.set-visibility', input),
    onOpacity: (input) => host.dispatchCapability?.('layers.set-opacity', input),
    onToggleAddData: () => host.toggleAddData?.(),
    onSearchAddData: (query) => host.searchAddData?.(query),
    onAddItem: (item) => host.addSessionItem?.(item),
    onScene: (sceneId) => host.applyOpsScene?.(sceneId),
    onAllOff: () => host.opsAllOff?.(),
    onRestore: () => host.opsRestore?.(),
    onSolo: () => host.opsSolo?.(),
    onConfigure: () => host.opsConfigure?.(),
    onConfigureSave: (input) => host.opsConfigureSave?.(input),
    onConfigureReset: (sceneId) => host.opsConfigureReset?.(sceneId),
    onConfigureScene: (sceneId) => host.opsConfigureScene?.(sceneId),
    onLayerInfo: (layerId) => host.opsLayerInfo?.(layerId)
  });
  bindTimeDock(root, {
    onToggle: () => host.toggleTimeDrawer?.(),
    onRequestedDay: (day) => host.setRequestedDay?.(day)
  });
  bindSearchControl(root, {
    onSearch: (query) => host.searchPlace?.(query)
  });
  bindExperienceControls(root, {
    onChange: (experience) => host.setExperience?.(experience)
  });
  bindSystemStatusControl(root, {
    onToggle: () => host.toggleSystemStatus?.()
  });
  bindToolHost(root, {
    onDispatch: (capabilityId, input) => host.dispatchCapability?.(capabilityId, input)
  });
  bindAskIqaiDock(root, {
    onSubmit: (request) => host.submitAsk?.(request),
    onToggle: () => host.toggleAsk?.()
  });

  if (typeof host.subscribe === 'function') host.subscribe(paint);
  paint();

  return {
    version: IQAI_SPATIAL_V2_SHELL_VERSION,
    slots: SHELL_SLOTS,
    measure: () => measureShellComposition(root),
    paint
  };
}
