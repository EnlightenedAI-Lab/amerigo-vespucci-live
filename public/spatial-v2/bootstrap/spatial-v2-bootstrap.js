/**
 * Spatial V2 composition root.
 * Instantiates stores, registries, hosts, and adapters. It wires; it does not decide.
 */

import { ACTION_SOURCE, POLICY_ACTION, createActionEnvelope, createId, failClosed, objectRefKey } from '../foundation/contracts/index.js';
import { looksLikeAskMap, parseAskMapIntent, ASK_MAP_OPERATIONS } from '../brain/ask-map-intent.js';
import { resolveHereContext } from '../brain/here-context.js';
import { hydrantInspectorBody } from '../map/woa/hydrant-object.js';
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
import { ASK_ROUTE_REASON, ASK_ROUTE_STATE, createAskCapabilityBus } from '../shell/ask-capability-bus.js';

function projectObjectInspector(world, acquiredInspect = null) {
  const refs = world.selection?.objectRefs || [];
  const primaryId = world.selection?.primaryObjectRefId || null;
  const primary = refs.find((ref) => objectRefKey(ref) === primaryId) || null;
  if (!primary) {
    return 'No ObjectRef acquired. Hover/candidate is not acquisition. DROP PIN remains WHERE.';
  }
  if (acquiredInspect?.body && (!acquiredInspect.key || acquiredInspect.key === primaryId)) {
    return acquiredInspect.body;
  }
  return [
    'OBJECT ACQUIRED',
    `KIND: ${String(primary.kind || '').toUpperCase()}`,
    `LABEL: ${primary.label || primary.id}`,
    `NAMESPACE: ${primary.namespace}`,
    `ID: ${primary.id}`,
    `DATASET: ${primary.datasetRef}`,
    `DATASET VERSION: ${primary.datasetVersion}`,
    `SOURCE: ${primary.sourceRef}`,
    'Primary ObjectRef is not an ArcGIS OBJECTID.'
  ].join('\n');
}

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

function createAskCapabilities(capabilityRegistry, executeChassis, { proposeGovernedMapAction } = {}) {
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
    {
      id: 'map.governed-action',
      label: 'Governed map action',
      aliases: [],
      quickActionIds: [],
      isAvailable: true,
      match: ({ text }) => looksLikeAskMap(text),
      handle: async ({ text }) => proposeGovernedMapAction(text)
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
  let mapActionExecutor = null;
  let lastMapAction = null;
  let selectedHydrantProvider = () => null;
  let hydrantStreetAimProvider = () => null;
  bindMapSurfaceAdapters({
    capabilityRegistry,
    idFactory,
    getMapActionExecutor: () => async (input) => {
      if (typeof mapActionExecutor !== 'function') {
        failClosed('MAP_ACTION_NOT_BOUND', 'Governed map action has no bound MapView executor.');
      }
      lastMapAction = await mapActionExecutor(input);
      return lastMapAction;
    }
  });

  const policyService = createPolicyService({
    now,
    idFactory,
    knownIdentities: ['operator:session']
  });
  const operatorConfirmationBoundary = policyService.takeOperatorConfirmationBoundary();
  let hereContextProvider = () => ({});
  let pendingMapAction = null;
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
    inspectorOpen: true,
    activeSystem: 'workspace',
    activeLauncher: 'layers',
    drawer: 'layers',
    mapState: 'INITIALIZING',
    layerGroups: [],
    lastAskReceipt: null,
    askOpen: false,
    timeDrawerOpen: false,
    addDataOpen: false,
    addDataResults: [],
    addDataStatus: null,
    acquiredInspect: null,
    discover: null
  };
  const listeners = new Set();
  let opsHost = null;

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
    const result = await capabilityRuntime.execute(action);
    if (capabilityId === 'focus.set') rebindPendingHereFromCurrentContext();
    return result;
  }

  function selectedHydrant() {
    return typeof selectedHydrantProvider === 'function' ? selectedHydrantProvider() : null;
  }

  function rebindPendingHereFromCurrentContext() {
    if (!pendingMapAction) return null;
    const operation = pendingMapAction.intent?.operation;
    if (operation !== ASK_MAP_OPERATIONS.WITHIN && operation !== ASK_MAP_OPERATIONS.NEAREST) return pendingMapAction;
    const here = resolveHereContext(hereContextProvider() || {});
    if (!here.ok) return pendingMapAction;
    pendingMapAction = Object.freeze({
      ...pendingMapAction,
      here,
      reboundAt: new Date().toISOString()
    });
    if (presentation.lastAskReceipt?.result?.needsConfirmation === true) {
      presentation.lastAskReceipt = {
        ...presentation.lastAskReceipt,
        result: {
          ...presentation.lastAskReceipt.result,
          here,
          confirmationDetail: `${here.label} · ${here.latitude.toFixed(5)}, ${here.longitude.toFixed(5)} · Nothing has been drawn.`
        }
      };
      notify();
    }
    return pendingMapAction;
  }

  function compactHydrantMarks(action) {
    if (!action) return [];
    const marks = [];
    const hereLon = Number(action.here?.longitude);
    const hereLat = Number(action.here?.latitude);
    if (Number.isFinite(hereLon) && Number.isFinite(hereLat)) {
      marks.push({ kind: 'here', longitude: hereLon, latitude: hereLat });
    }
    const nearestId = action.nearest?.sourceId || null;
    for (const hit of action.hits || []) {
      const coords = hit?.feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const longitude = Number(coords[0]);
      const latitude = Number(coords[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
      marks.push({
        kind: nearestId && hit.sourceId === nearestId ? 'nearest' : 'hydrant',
        sourceId: hit.sourceId != null ? String(hit.sourceId) : null,
        longitude,
        latitude
      });
    }
    return marks.slice(0, 400);
  }

  function snapshotGovernedMapAction() {
    return {
      pending: pendingMapAction
        ? {
            proposalId: pendingMapAction.proposalId,
            confirmationTitle: pendingMapAction.intent.confirmationTitle,
            operation: pendingMapAction.intent.operation,
            objectClass: pendingMapAction.intent.objectClass,
            radiusMeters: pendingMapAction.intent.radiusMeters,
            here: pendingMapAction.here
          }
        : null,
      last: lastMapAction
        ? {
            operation: lastMapAction.operation || null,
            count: lastMapAction.count,
            source: lastMapAction.source,
            confirmationTitle: lastMapAction.confirmationTitle,
            radiusMeters: lastMapAction.radiusMeters,
            here: lastMapAction.here,
            objectRef: lastMapAction.objectRef || null,
            nearest: lastMapAction.nearest || null,
            distanceMeters: lastMapAction.nearest?.distanceMeters
              ?? lastMapAction.hits?.[0]?.distanceMeters
              ?? null,
            paint: lastMapAction.paint || null,
            marks: compactHydrantMarks(lastMapAction)
          }
        : null
    };
  }

  function proposeGovernedMapAction(text) {
    const intent = parseAskMapIntent(text);
    pendingMapAction = null;
    lastMapAction = null;
    if (!intent.supported) {
      return {
        applicationAction: 'ASK_MAP_REJECTED',
        engineExecuted: false,
        mapExecuted: false,
        code: intent.code,
        message: intent.message
      };
    }
    if (intent.operation === ASK_MAP_OPERATIONS.DESCRIBE_SELECTED || intent.operation === ASK_MAP_OPERATIONS.STREET_VISIBILITY) {
      const selected = selectedHydrant();
      if (!selected?.objectRef) {
        return {
          applicationAction: 'ASK_MAP_NEEDS_OBJECT',
          engineExecuted: false,
          mapExecuted: false,
          needsObject: true,
          code: 'NO_SELECTED_HYDRANT',
          message: 'Select a hydrant on the map first. BRAIN does not mint hydrant coordinates.'
        };
      }
      if (intent.operation === ASK_MAP_OPERATIONS.DESCRIBE_SELECTED) {
        return {
          applicationAction: 'ASK_MAP_DESCRIBED',
          engineExecuted: false,
          mapExecuted: false,
          objectRef: selected.objectRef,
          message: hydrantInspectorBody(selected, resolveHereContext(hereContextProvider() || {}))
        };
      }
      const street = typeof hydrantStreetAimProvider === 'function' ? hydrantStreetAimProvider() : null;
      const pano = street?.available === true;
      return {
        applicationAction: 'ASK_MAP_STREET_VISIBILITY',
        engineExecuted: false,
        mapExecuted: false,
        objectRef: selected.objectRef,
        physicalVisibility: 'NOT CONFIRMED',
        panoAvailable: pano,
        message: pano
          ? `${street.message || 'INVENTORY POSITION PROJECTED INTO STREET VIEW'}. Physical hydrant visually confirmed: NOT CONFIRMED.`
          : `${street?.message || 'NO STREET CAPTURE NEAR THIS HYDRANT'}. Physical hydrant visually confirmed: NOT CONFIRMED.`
      };
    }
    if (intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_STREET || intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_ALL) {
      const selected = selectedHydrant();
      if (!selected?.objectRef) {
        return {
          applicationAction: 'ASK_MAP_NEEDS_OBJECT',
          engineExecuted: false,
          mapExecuted: false,
          needsObject: true,
          code: 'NO_SELECTED_HYDRANT',
          message: 'Select a hydrant on the map first. BRAIN does not mint hydrant coordinates.'
        };
      }
      const proposalId = createId('map-propose', idFactory);
      pendingMapAction = Object.freeze({
        proposalId,
        intent,
        here: null,
        selectedHydrant: {
          objectRef: selected.objectRef,
          idBi: selected.idBi,
          longitude: selected.longitude,
          latitude: selected.latitude
        },
        issuedAt: new Date().toISOString()
      });
      return {
        applicationAction: 'ASK_MAP_PROPOSED',
        engineExecuted: false,
        mapExecuted: false,
        needsConfirmation: true,
        confirmationTitle: intent.confirmationTitle,
        confirmationDetail: `HYDRANT ID_BI ${selected.idBi} · ${selected.address || 'VILLE INVENTORY POSITION'} · No coordinates will be minted.`,
        proposalId,
        objectRef: selected.objectRef,
        intent: {
          operation: intent.operation,
          verb: intent.verb,
          objectClass: intent.objectClass,
          radiusMeters: intent.radiusMeters
        },
        source: intent.source,
        message: intent.confirmationTitle
      };
    }
    const here = resolveHereContext(hereContextProvider() || {});
    if (!here.ok) {
      return {
        applicationAction: 'ASK_MAP_NEEDS_LOCATION',
        engineExecuted: false,
        mapExecuted: false,
        needsLocation: true,
        code: here.code,
        message: here.message
      };
    }
    const proposalId = createId('map-propose', idFactory);
    pendingMapAction = Object.freeze({
      proposalId,
      intent,
      here,
      issuedAt: new Date().toISOString()
    });
    return {
      applicationAction: 'ASK_MAP_PROPOSED',
      engineExecuted: false,
      mapExecuted: false,
      needsConfirmation: true,
      confirmationTitle: intent.confirmationTitle,
      confirmationDetail: `${here.label} · ${here.latitude.toFixed(5)}, ${here.longitude.toFixed(5)} · Nothing has been drawn.`,
      proposalId,
      here,
      intent: {
        operation: intent.operation,
        verb: intent.verb,
        objectClass: intent.objectClass,
        radiusMeters: intent.radiusMeters
      },
      source: intent.source,
      message: intent.confirmationTitle
    };
  }

  const askBus = createAskCapabilityBus({
    capabilities: createAskCapabilities(capabilityRegistry, executeChassis, { proposeGovernedMapAction })
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
      discover: presentation.discover,
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
        selectionState: world.selection.primaryObjectRefId ? 'ACQUIRED' : 'RESERVED',
        selection: projectObjectInspector(world, presentation.acquiredInspect),
        selectionHtml: presentation.acquiredInspect?.html || null,
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
    setAcquiredInspect(payload) {
      presentation.acquiredInspect = payload || null;
      if (payload?.html) {
        presentation.inspectorOpen = true;
        presentation.inspectorPane = 'selected-object-slot';
      }
      notify();
    },
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
        presentation.drawer = 'layers';
        presentation.activeLauncher = 'layers';
        void executeChassis('chassis.set-active-system', { systemId: 'layers' });
        void opsHost?.loadCatalog?.();
        notify();
        return;
      }
      presentation.activeLauncher = launcherId || 'layers';
      notify();
    },
    toggleAsk() {
      presentation.askOpen = !presentation.askOpen;
      notify();
    },
    closeAsk() {
      presentation.askOpen = false;
      notify();
    },
    closeTimeDrawer() {
      presentation.timeDrawerOpen = false;
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
    setDiscover(discover) {
      presentation.discover = discover || null;
      notify();
    },
    setOpsHost(host) {
      opsHost = host || null;
    },
    applyOpsScene(sceneId) { return opsHost?.applyScene?.(sceneId); },
    opsAllOff() { return opsHost?.allOff?.(); },
    opsRestore() { return opsHost?.restore?.(); },
    opsSolo() { return opsHost?.solo?.(); },
    opsSoloLayer(layerId) { return opsHost?.soloLayer?.(layerId); },
    opsConfigure() { return opsHost?.configure?.(); },
    opsConfigureClose() { return opsHost?.configureClose?.(); },
    opsConfigureSave(input) { return opsHost?.configureSave?.(input); },
    opsConfigureReset(sceneId) { return opsHost?.configureReset?.(sceneId); },
    opsConfigureScene(sceneId) { return opsHost?.configureScene?.(sceneId); },
    opsConfigureSaveCurrent() { return opsHost?.configureSaveCurrent?.(); },
    opsTimeWindow(input) { return opsHost?.setWindow?.(input); },
    opsCategory(input) { return opsHost?.setCategory?.(input); },
    opsRoute(input) { return opsHost?.setRoute?.(input); },
    opsCamerasInView(on) { return opsHost?.setCamerasInView?.(on); },
    opsLayerInfo(layerId) { return opsHost?.layerInfo?.(layerId); },
    async dispatchCapability(capabilityId, input = {}) {
      if (capabilityId === 'layers.set-visibility' && String(input?.instanceId || '').startsWith('ops-')) {
        await opsHost?.setVisible?.(String(input.instanceId).slice(4), input.visible === true);
        return;
      }
      if (capabilityId === 'layers.set-visibility' || capabilityId === 'layers.set-opacity' || capabilityId === 'layers.add-session' || capabilityId === 'focus.set' || capabilityId === 'selection.set' || capabilityId === 'layers.sync-authored' || capabilityId === 'map' || capabilityId === 'temporal.set-requested' || capabilityId === 'map.governed-action') {
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
    },
    async confirmGovernedMapAction() {
      if (!pendingMapAction) {
        const receipt = {
          state: ASK_ROUTE_STATE.FAILED,
          reason: ASK_ROUTE_REASON.CAPABILITY_FAILED,
          capabilityId: 'map.governed-action',
          executed: false,
          error: 'No pending governed map action. Ask first, then confirm.'
        };
        presentation.lastAskReceipt = receipt;
        notify();
        return receipt;
      }
      rebindPendingHereFromCurrentContext();
      const proposal = pendingMapAction;
      const world = stateStore.getSnapshot();
      const issuedAt = typeof now === 'function' ? now() : new Date().toISOString();
      const issuedMs = Date.parse(issuedAt);
      operatorConfirmationBoundary.recordConfirmationEvent({
        actorRef: 'operator:session',
        identityRef: 'operator:session',
        capabilityId: 'map.governed-action',
        policyAction: POLICY_ACTION.DISPLAY,
        resourceRefs: [],
        sessionId: world.context.sessionId,
        worldId: world.worlds.activeWorldId,
        expiresAt: new Date((Number.isFinite(issuedMs) ? issuedMs : Date.now()) + 5 * 60 * 1000).toISOString()
      });
      let executed;
      try {
        executed = await executeChassis('map.governed-action', {
          confirmed: true,
          proposalId: proposal.proposalId,
          intent: proposal.intent,
          here: proposal.here,
          selectedHydrant: proposal.selectedHydrant || null
        });
      } catch (error) {
        const receipt = {
          state: ASK_ROUTE_STATE.FAILED,
          reason: ASK_ROUTE_REASON.CAPABILITY_FAILED,
          capabilityId: 'map.governed-action',
          executed: false,
          error: String(error?.message || error),
          result: { mapExecuted: false, confirmationTitle: proposal.intent.confirmationTitle }
        };
        presentation.lastAskReceipt = receipt;
        notify();
        return receipt;
      }
      pendingMapAction = null;
      const painted = lastMapAction;
      const sourceLine = `${painted?.source?.provider || 'UNKNOWN'} · ${painted?.source?.dataset || 'UNKNOWN'}`;
      const nearestId = painted?.nearest?.assetId || painted?.nearest?.sourceId || painted?.hits?.[0]?.sourceId;
      const nearestDist = painted?.nearest?.distanceMeters ?? painted?.hits?.[0]?.distanceMeters;
      const selectedId = painted?.objectRef?.id || proposal.selectedHydrant?.idBi || nearestId;
      const selectedOp = proposal.intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_STREET
        || proposal.intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_ALL;
      const message = selectedOp
        ? `${proposal.intent.confirmationTitle} · ID_BI ${selectedId || 'UNKNOWN'} · ${sourceLine}`
        : proposal.intent.operation === 'NEAREST'
          ? `${proposal.intent.confirmationTitle} · ID_BI ${nearestId || 'UNKNOWN'} · ${Number.isFinite(Number(nearestDist)) ? `${Number(nearestDist).toFixed(1)} m` : 'UNKNOWN'} · ${sourceLine}`
        : `${proposal.intent.confirmationTitle} · ${painted?.count ?? 0} hydrants · ${sourceLine}`;
      const receipt = {
        state: executed?.ok === true ? ASK_ROUTE_STATE.ROUTED : ASK_ROUTE_STATE.FAILED,
        reason: executed?.ok === true ? ASK_ROUTE_REASON.ACCEPTED : ASK_ROUTE_REASON.CAPABILITY_FAILED,
        capabilityId: 'map.governed-action',
        capabilityLabel: 'Governed map action',
        executed: executed?.ok === true,
        result: {
          applicationAction: 'ASK_MAP_EXECUTED',
          engineExecuted: false,
          mapExecuted: executed?.ok === true,
          confirmationTitle: proposal.intent.confirmationTitle,
          message,
          count: painted?.count ?? 0,
          source: painted?.source || null,
          here: proposal.here,
          radiusMeters: proposal.intent.radiusMeters,
          nearest: painted?.nearest || null,
          objectRef: painted?.objectRef || proposal.selectedHydrant?.objectRef || null,
          distanceMeters: Number.isFinite(Number(nearestDist)) ? Number(nearestDist) : null
        }
      };
      presentation.lastAskReceipt = receipt;
      notify();
      return receipt;
    },
    cancelGovernedMapAction() {
      pendingMapAction = null;
      const receipt = {
        state: ASK_ROUTE_STATE.UNROUTED,
        reason: ASK_ROUTE_REASON.NO_CAPABILITY_MATCH,
        capabilityId: 'map.governed-action',
        executed: false,
        result: { message: 'Cancelled. No map action was executed.', mapExecuted: false }
      };
      presentation.lastAskReceipt = receipt;
      notify();
      return receipt;
    },
    setGovernedMapExecutor(fn) {
      mapActionExecutor = typeof fn === 'function' ? fn : null;
    },
    setHereContextProvider(fn) {
      hereContextProvider = typeof fn === 'function' ? fn : () => ({});
    },
    setSelectedHydrantProvider(fn) {
      selectedHydrantProvider = typeof fn === 'function' ? fn : () => null;
    },
    setHydrantStreetAimProvider(fn) {
      hydrantStreetAimProvider = typeof fn === 'function' ? fn : () => null;
    },
    snapshotGovernedMapAction
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
      getCapabilities: () => chassis.askBus.getCapabilities(),
      confirm: () => chassis.confirmGovernedMapAction(),
      cancel: () => chassis.cancelGovernedMapAction()
    },
    governedMapAction: {
      snapshot: () => chassis.snapshotGovernedMapAction(),
      confirm: () => chassis.confirmGovernedMapAction(),
      cancel: () => chassis.cancelGovernedMapAction()
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
      analyze3d: 'MIGRATED',
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
  chassis.setLauncher?.('layers');
  window.__iqaiSpatialV2 = api;
  return api;
}

export { ASK_ROUTE_STATE };
