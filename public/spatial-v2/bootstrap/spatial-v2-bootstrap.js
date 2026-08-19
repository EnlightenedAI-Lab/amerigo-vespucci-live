/**
 * Spatial V2 composition root.
 * Instantiates stores, registries, hosts, and adapters. It wires; it does not decide.
 */

import { ACTION_SOURCE, createActionEnvelope, createId } from '../foundation/contracts/index.js';
import { createStateStore } from '../state/index.js';
import {
  createCapabilityRegistry,
  createLayerRegistry,
  createModelProviderRegistry,
  createViewRegistry
} from '../registries/index.js';
import { createPolicyGuard, createPolicyService } from '../policy/index.js';
import { createJobManager } from '../jobs/index.js';
import { createCapabilityRuntime, createResultCommitter } from '../runtime/index.js';
import { createBrainSeam } from '../brain/seams.js';
import { createViewHost } from '../hosts/view-host.js';
import { createPanelHost } from '../hosts/panel-host.js';
import { CHASSIS_SYSTEMS, registerChassisCatalog } from './chassis-catalog.js';
import { bindChassisAdapters } from './chassis-adapters.js';
import { bindMapSurfaceAdapters } from './map-surface-adapters.js';
import { attachWorldviewMapSession } from './worldview-map-session.js';
import { mountAppShell } from '../shell/AppShell.js';
import { createAskCapabilityBus } from '../shell/ask-capability-bus.js';
import { ASK_ROUTE_STATE } from '../shell/ask-capability-bus.js';

function unavailableAsk(id, label, aliases, quickActionIds, unavailableReason) {
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

function createAskCapabilities(capabilityRegistry, executeChassis) {
  const inspect = capabilityRegistry.get('chassis.inspect-world');
  return [
    {
      id: inspect.id,
      label: inspect.title,
      aliases: ['workspace', 'inspect world', 'world state'],
      quickActionIds: [],
      isAvailable: true,
      handle: async () => {
        const result = await executeChassis('chassis.inspect-world', {});
        return {
          applicationAction: 'WORLD_INSPECTED',
          engineExecuted: false,
          message: 'World State diagnostic read. No specialist engine ran.'
        };
      }
    },
    {
      id: 'map',
      label: 'Operational map',
      aliases: ['map', 'show map', 'open map'],
      quickActionIds: ['map'],
      isAvailable: true,
      handle: async () => {
        await executeChassis('map', {});
        return {
          applicationAction: 'CONTEXT_SELECTED',
          engineExecuted: false,
          message: 'Operational map context selected. No GIS command was executed.'
        };
      }
    },
    unavailableAsk(
      'imagery',
      'Imagery',
      ['imagery', 'show imagery', 'latest imagery', 'show latest imagery', 'imagery history', 'show imagery history', 'all imagery'],
      ['imagery'],
      'Imagery remains at the proven baseline and is not migrated.'
    ),
    unavailableAsk(
      'analysis',
      'Analyze',
      ['analyze', 'show vegetation health', 'show water change', 'show burn effects', 'find new clearing', 'what changed between these dates'],
      ['analyze'],
      'Analysis engines are not connected.'
    ),
    unavailableAsk(
      'intelligence',
      'Open-world intelligence',
      ['intelligence', 'open world intelligence'],
      ['intelligence'],
      'Open-world intelligence is not connected.'
    ),
    unavailableAsk(
      'vision',
      'Vision',
      ['vision', 'analyze this image'],
      ['vision'],
      'Vision is not connected.'
    ),
    unavailableAsk(
      'build',
      'Build',
      ['build', 'build a map', 'create a map'],
      ['build'],
      'Build execution is not connected.'
    )
  ];
}

export function createSpatialV2Chassis(options = {}) {
  const now = options.now;
  const idFactory = options.idFactory;
  const stateStore = createStateStore({ now, idFactory });
  const capabilityRegistry = createCapabilityRegistry();
  const chassisRegistrar = capabilityRegistry.takeChassisRegistrar();
  const layerRegistry = createLayerRegistry();
  const viewRegistry = createViewRegistry();
  const modelProviderRegistry = createModelProviderRegistry();
  registerChassisCatalog({
    viewRegistry,
    layerRegistry,
    capabilityRegistry,
    modelProviderRegistry,
    chassisRegistrar
  });
  bindChassisAdapters({ chassisRegistrar, capabilityRegistry, stateStore, idFactory });
  bindMapSurfaceAdapters({ capabilityRegistry, idFactory });

  const policyService = createPolicyService({
    now,
    idFactory,
    knownIdentities: ['operator:session']
  });
  const operatorConfirmationBoundary = policyService.takeOperatorConfirmationBoundary();
  const getExecutableAdapter = capabilityRegistry.takeRuntimeAdapterLookup();
  const policyGuard = createPolicyGuard(policyService);
  const jobManager = createJobManager({ now, idFactory });
  const resultCommitter = createResultCommitter({ stateStore, policyService });
  const capabilityRuntime = createCapabilityRuntime({
    capabilityRegistry,
    getExecutableAdapter,
    policyGuard,
    resultCommitter,
    jobManager,
    stateStore,
    now,
    idFactory
  });
  const viewHost = createViewHost({ viewRegistry });
  const panelHost = createPanelHost();
  const brainSeam = createBrainSeam({ modelProviderRegistry });

  const presentation = {
    experience: 'NORMAL',
    systemStatusOpen: false,
    inspectorPane: 'situation-slot',
    inspectorOpen: false,
    activeSystem: 'workspace',
    activeLauncher: null,
    drawer: null,
    mapState: 'INITIALIZING',
    layerGroups: [],
    lastAskReceipt: null,
    askOpen: false,
    timeDrawerOpen: false,
    addDataOpen: false,
    addDataResults: [],
    addDataStatus: null
  };
  const listeners = new Set();

  async function executeChassis(capabilityId, input = {}) {
    const world = stateStore.getSnapshot();
    const action = createActionEnvelope({
      actionId: createId('action', idFactory),
      source: ACTION_SOURCE.OPERATOR,
      actorRef: 'operator:session',
      capabilityId,
      input,
      worldId: world.worlds.activeWorldId,
      baseWorldRevision: world.revision,
      traceId: createId('trace', idFactory)
    }, { now });
    return capabilityRuntime.execute(action);
  }

  const askBus = createAskCapabilityBus({
    capabilities: createAskCapabilities(capabilityRegistry, executeChassis)
  });

  function notify() {
    const snapshot = getViewModel();
    for (const listener of listeners) listener(snapshot);
  }

  function getViewModel() {
    const world = stateStore.getSnapshot();
    const activeViewId = world.views.activeViewIds[0] || 'MAP';
    const view = viewRegistry.get(activeViewId);
    const activeSystem = world.workspace.activeToolIds[0] || presentation.activeSystem;
    const system = CHASSIS_SYSTEMS.find((item) => item.id === activeSystem) || CHASSIS_SYSTEMS[0];
    return {
      experience: presentation.experience,
      systemStatusOpen: presentation.systemStatusOpen,
      inspectorPane: presentation.inspectorPane,
      inspectorOpen: presentation.inspectorOpen === true,
      activeSystem,
      activeLauncher: presentation.activeLauncher,
      drawer: presentation.drawer,
      mapState: presentation.mapState,
      layerGroups: presentation.layerGroups,
      askOpen: presentation.askOpen === true,
      timeDrawerOpen: presentation.timeDrawerOpen === true,
      addDataOpen: presentation.addDataOpen === true,
      addDataResults: presentation.addDataResults,
      addDataStatus: presentation.addDataStatus,
      temporal: world.temporal,
      activeViewId,
      activeView: viewHost.project(activeViewId, world),
      streetCapture: null,
      localModelState: 'NOT CONNECTED',
      brainSeam,
      askReceipt: presentation.lastAskReceipt,
      inspector: {
        situationState: 'CHASSIS',
        situation: [
          `SYSTEM: ${system.label}`,
          `STATE: ${system.migrationState}`,
          system.detail,
          `Workspace: ${world.workspace.kind}`,
          `View: ${activeViewId} · ${view.availability}`,
          `World revision: ${world.revision}`
        ].join('\n'),
        selectionState: world.activeFocus ? 'ACTIVE SPATIAL FOCUS' : (world.selection.objectRefs.length ? 'SELECTED' : 'RESERVED'),
        selection: world.activeFocus
          ? [
              'ACTIVE SPATIAL FOCUS',
              `ADDRESS / PLACE: ${world.activeFocus.address || 'ADDRESS NOT RESOLVED'}`,
              `sourceView: ${world.activeFocus.sourceView}`,
              `sourceAction: ${world.activeFocus.sourceAction}`
            ].join('\n')
          : (world.selection.objectRefs.length
            ? `${world.selection.objectRefs.length} ObjectRef(s)`
            : 'No ObjectRef selected. Use DROP PIN to establish focus.'),
        evidenceState: 'RESERVED',
        evidence: 'No evidence envelopes. Proven specialist results are not migrated.',
        provenanceState: 'CHASSIS',
        provenance: [
          'PolicyService remains authority.',
          'World State security is snapshot-only.',
          `TIME lens: ${world.temporal.lens} — Time Engine unmigrated.`,
          'No Portal write path is registered.'
        ].join('\n'),
        receiptState: presentation.lastAskReceipt?.state || 'RESERVED',
        receipt: presentation.lastAskReceipt
          ? [
              `askReceipt: ${presentation.lastAskReceipt.receiptId}`,
              `state: ${presentation.lastAskReceipt.state}`,
              `reason: ${presentation.lastAskReceipt.reason}`,
              `capability: ${presentation.lastAskReceipt.capabilityId || 'none'}`,
              `executed: ${presentation.lastAskReceipt.executed}`
            ].join('\n')
          : 'No Ask receipt.'
      }
    };
  }

  askBus.subscribe((receipt) => {
    presentation.lastAskReceipt = receipt;
    notify();
  });
  stateStore.subscribe(() => notify());

  return Object.freeze({
    stateStore,
    capabilityRegistry,
    layerRegistry,
    viewRegistry,
    modelProviderRegistry,
    policyService,
    jobManager,
    capabilityRuntime,
    viewHost,
    panelHost,
    brainSeam,
    askBus,
    executeChassis,
    getViewModel,
    subscribe(listener) {
      listeners.add(listener);
      listener(getViewModel());
      return () => listeners.delete(listener);
    },
    setExperience(experience) {
      presentation.experience = experience;
      notify();
    },
    toggleSystemStatus() {
      presentation.systemStatusOpen = !presentation.systemStatusOpen;
      notify();
    },
    setInspectorPane(slot) {
      presentation.inspectorPane = slot;
      notify();
    },
    setLauncher(launcherId) {
      if (launcherId === 'layers') {
        presentation.drawer = presentation.drawer === 'layers' ? null : 'layers';
        presentation.activeLauncher = presentation.drawer === 'layers' ? 'layers' : null;
        if (presentation.drawer !== 'layers') presentation.addDataOpen = false;
        if (presentation.drawer === 'layers') {
          void executeChassis('chassis.set-active-system', { systemId: 'layers' });
        }
        notify();
        return;
      }
      presentation.drawer = null;
      presentation.activeLauncher = launcherId || null;
      notify();
    },
    toggleAsk() {
      presentation.askOpen = !presentation.askOpen;
      notify();
    },
    toggleTimeDrawer() {
      presentation.timeDrawerOpen = !presentation.timeDrawerOpen;
      notify();
    },
    toggleAddData() {
      presentation.addDataOpen = !presentation.addDataOpen;
      notify();
    },
    async setRequestedDay(day) {
      await executeChassis('temporal.set-requested', { instant: day || null });
    },
    async searchPlace(query) {
      const { searchAndGoTo } = await import('../map/map-foundation.js');
      return searchAndGoTo(query);
    },
    async searchAddData(query) {
      const { searchPortalItems } = await import('../map/map-foundation.js');
      const result = await searchPortalItems(query);
      presentation.addDataResults = result.results || [];
      presentation.addDataStatus = result.status || (result.ok ? null : 'Search failed.');
      presentation.addDataOpen = true;
      notify();
    },
    async addSessionItem(item) {
      const { addSessionPortalItem } = await import('../map/map-foundation.js');
      const result = await addSessionPortalItem(item);
      if (result.ok && result.layerId) {
        await executeChassis('layers.add-session', { instanceId: result.layerId });
      } else if (result.reason === 'WEBMAP_NOT_SESSION_OVERLAY') {
        presentation.addDataStatus = 'Web Map items cannot replace the authored WebMap. Session overlay is limited to Feature, Map Image, and Imagery layers.';
        notify();
      }
    },
    setMapState(mapState) {
      presentation.mapState = mapState || presentation.mapState;
      notify();
    },
    setLayerGroups(layerGroups) {
      presentation.layerGroups = Array.isArray(layerGroups) ? layerGroups : [];
      notify();
    },
    async dispatchCapability(capabilityId, input = {}) {
      if (capabilityId === 'layers.set-visibility' || capabilityId === 'layers.set-opacity' || capabilityId === 'layers.add-session' || capabilityId === 'focus.set' || capabilityId === 'layers.sync-authored' || capabilityId === 'map' || capabilityId === 'temporal.set-requested') {
        await executeChassis(capabilityId, input);
        return;
      }
      if (capabilityId === 'chassis.set-active-system' && input.systemId) {
        await executeChassis('chassis.set-active-system', { systemId: input.systemId });
        const system = CHASSIS_SYSTEMS.find((item) => item.id === input.systemId);
        if (system?.id === 'view' && input.viewId) {
          await executeChassis('view.select', { viewId: input.viewId });
        }
        return;
      }
      if (capabilityId === 'view.select' && input.viewId) {
        await executeChassis('view.select', { viewId: input.viewId });
        await executeChassis('chassis.set-active-system', { systemId: 'view' });
        return;
      }
      if (capabilityId === 'chassis.set-active-system') {
        const systemId = input.systemId;
        if (systemId) await executeChassis('chassis.set-active-system', { systemId });
      }
    },
    submitAsk(request) {
      return askBus.execute(request);
    }
  });
}

export function bootSpatialV2(root, options = {}) {
  const chassis = createSpatialV2Chassis(options);
  const shell = mountAppShell(root, chassis);
  const api = {
    version: 'worldview-shell-v1',
    applicationVersion: 'worldview-map-first-v1',
    chassis: true,
    measure: () => shell.measure(),
    diagnostic: () => chassis.stateStore.getDiagnostic(),
    world: () => chassis.stateStore.getSnapshot(),
    execute: (capabilityId, input) => chassis.executeChassis(capabilityId, input),
    ask: {
      execute: (request) => chassis.submitAsk(request),
      getLastReceipt: () => chassis.askBus.getLastReceipt(),
      getCapabilities: () => chassis.askBus.getCapabilities()
    },
    registries: {
      capabilities: () => chassis.capabilityRegistry.list(),
      layers: () => chassis.layerRegistry.list(),
      views: () => chassis.viewRegistry.list(),
      models: () => chassis.modelProviderRegistry.list()
    },
    jobs: () => chassis.jobManager.list(),
    mapViewCreateCount: 0,
    portalWrites: 'NONE',
    migration: Object.freeze({
      map: 'MIGRATED',
      street360: 'MIGRATED',
      visual3d: 'MIGRATED',
      analyze3d: 'UNAVAILABLE',
      dropPin: 'MIGRATED',
      layers: 'MIGRATED',
      nearmap: 'UNMIGRATED',
      wayback: 'UNMIGRATED',
      timeEngine: 'UNMIGRATED',
      askIqaiExisting: 'UNMIGRATED',
      brain: 'SEAM ONLY'
    })
  };
  attachWorldviewMapSession(root, chassis, api);
  window.__iqaiSpatialV2 = api;
  return api;
}

export { ASK_ROUTE_STATE };
