/**
 * Wrap the proven MapView / DROP PIN engines into the WorldView shell.
 * Does not rewrite map-foundation.js. Does not create a second MapView.
 */

import { VIEW_ID, failClosed } from '../foundation/contracts/index.js';
import {
  getMapFoundationController,
  getMapViewCreateCount,
  getMapView,
  initMapFoundation,
  listOperationalLayers,
  setOperationalLayerOpacity,
  setOperationalLayerVisibility,
  subscribeMapFoundation
} from '../map/map-foundation.js';
import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import {
  bindWorldviewPositionOverlay,
  resolveBeaconPose,
  WORLDVIEW_BEACON_LAYER_ID,
  WORLDVIEW_TRACE_LAYER_ID
} from '../map/worldview-position-overlay.js';
import {
  clearWorldviewTraversal,
  getWorldviewTraversal,
  observeStreetTraversal
} from '../map/worldview-traversal.js';
import { attachWorldviewMapAdapter } from '../map/worldview-map-adapter.js';
import {
  getStreet360LiveCapability,
  getWorldviewNavigation,
  proposeWorldviewNavigation,
  seedWorldviewNavigationFromFocus
} from '../map/worldview-navigation.js';
import { applyMapFoundationToStage } from '../shell/MapStage.js';
import { bindDropPinControl } from '../shell/DropPinControl.js';
import { bindPlaceCameraControl } from '../shell/PlaceCameraControl.js';
import { bindViewCameraControl } from '../shell/ViewCameraControl.js';
import { bindCameraRelevanceSurface } from '../shell/CameraRelevanceSurface.js';
import { bindCameraWallSurface } from '../shell/CameraWallSurface.js';
import { clearGeneratedPlan, generateCameraCoverage } from '../camera/engine/coverage-plan.js';
import { bindStreet360Control } from '../shell/Street360Control.js';
import { bindGooglePhotorealistic3dControl } from '../shell/GooglePhotorealistic3dControl.js';
import { bindAnalyze3dControl } from '../shell/Analyze3dControl.js';
import { bindViewSwitcher } from '../shell/ViewSwitcher.js';
import { bindWorldViewFrame } from '../shell/WorldViewFrame.js';
import { bindImageryCommandSurface } from '../shell/ImageryCommandSurface.js';
import { bindBasemapPicker } from '../shell/BasemapPicker.js';
import { projectLayerDrawerGroups } from '../shell/LayersDrawer.js';
import { bindFocusInstrument } from '../map/focus/instrument.js';
import { initGroundController } from '../imagery/ground-controller.js';
import * as opsLayers from '../ops-layers/controller.js';
import { bindHydrantSelection } from '../map/woa/hydrant-selection.js';
import { bindHydrantLink } from '../map/woa/hydrant-link.js';
import { clearHydrantRecords, getHydrantRecord, rememberHydrantHits } from '../map/woa/hydrant-object.js';
import { ASK_MAP_OPERATIONS, HYDRANT_SOURCE } from '../brain/ask-map-intent.js';
import { bindOpsSelection } from '../ops-layers/selection.js';
import { bindSolarIntelligence } from '../ops-layers/solar-ui.js';

async function paintIqaiGroundSurfaces() {
  await initGroundController();
}

function hideMapView(host) {
  if (!host) return;
  host.style.visibility = 'hidden';
  host.setAttribute('data-iqai-map-shown', 'false');
}

function showMapView(host) {
  if (!host) return;
  host.style.visibility = 'visible';
  host.setAttribute('data-iqai-map-shown', 'true');
  const controller = getMapFoundationController();
  const view = controller.getView?.();
  if (view && typeof view.resize === 'function') view.resize();
}

function refreshLayerGroups(chassis, focusInstrument) {
  const liveLayers = listOperationalLayers();
  const world = chassis.stateStore.getSnapshot();
  chassis.setDiscover?.(opsLayers.snapshot());
  chassis.setLayerGroups(projectLayerDrawerGroups({
    definitions: chassis.layerRegistry.list(),
    liveLayers,
    instances: world.layers?.byId || {},
    acquisitionLayers: []
  }));
}

export function attachWorldviewMapSession(root, chassis, api) {
  if (!root) return null;
  const mapHost = root.querySelector('[data-iqai-map-host]');
  const navHost = root.querySelector('[data-iqai-map-nav]');
  let mapMounted = false;
  let mapInstance = null;
  let mapNavAttached = false;
  let positionOverlay = null;

  function ensureWorldviewMapAdapter() {
    const view = getMapFoundationController().getView?.();
    if (!view || mapNavAttached) return;
    attachWorldviewMapAdapter(view);
    mapNavAttached = true;
  }

  chassis.viewRegistry.bindAdapter(VIEW_ID.MAP, {
    mount() {
      if (mapMounted) return mapInstance;
      mapMounted = true;
      mapInstance = Object.freeze({ viewId: VIEW_ID.MAP, retained: true });
      void initMapFoundation(mapHost, { navHost }).catch(() => {});
      return mapInstance;
    },
    hide() {
      hideMapView(mapHost);
    },
    show() {
      showMapView(mapHost);
    }
  });

  let hydrantSelection = null;
  let hydrantLink = null;
  const google3d = bindGooglePhotorealistic3dControl(root, {
    getSpatialFocus: () => getActiveSpatialFocus(),
    getPeerSelectedPoint: () => getActiveSpatialFocus(),
    keepMapVisible: true,
    getSelectedHydrant: () => hydrantSelection?.snapshot?.()?.selectedRecord
      || hydrantLink?.current?.()
      || null
  });
  const analyze3d = bindAnalyze3dControl(root, {
    getSpatialFocus: () => getActiveSpatialFocus(),
    getLocation: () => getWorldviewNavigation()
  });
  const street360 = bindStreet360Control(root, {
    getSpatialFocus: () => getActiveSpatialFocus(),
    getPeerSelectedPoint: () => getActiveSpatialFocus(),
    keepMapVisible: true,
    isPeerSpecialistOpen: () => false,
    closePeerSpecialist: async () => {},
    getSelectedHydrant: () => hydrantSelection?.snapshot?.()?.selectedRecord
      || hydrantLink?.current?.()
      || null
  });

  let worldViewFrame = null;
  let imageryCommand = null;
  let focusInstrument = null;
  let placeCamera = null;
  let opsSelection = null;
  let solarIntelligence = null;
  const dropPin = bindDropPinControl(root, {
    getActiveView: () => viewSwitcher?.snapshot?.().activeView || 'map',
    returnToMap: () => worldViewFrame?.setLayout(1) || viewSwitcher?.setView('MAP'),
    hasAcquiredObject: () => focusInstrument?.hasAcquired?.() === true,
    isPlaceCameraArmed: () => placeCamera?.snapshot()?.armed === true,
    disarmPlaceCamera: () => placeCamera?.disarm?.(),
    resolveProperty: (longitude, latitude) => focusInstrument?.propertyAt?.(latitude, longitude),
    onPlaced: (focus) => {
      if (!focus) return;
      seedWorldviewNavigationFromFocus(focus);
      street360.selectPoint(focus.longitude, focus.latitude, 'drop-pin');
      google3d.selectPoint(focus.longitude, focus.latitude, 'drop-pin');
      analyze3d.selectPoint(focus.longitude, focus.latitude, 'drop-pin');
      viewSwitcher?.onMapPointSelected(focus);
      void worldViewFrame?.followFocus?.();
      if (root.dataset.iqaiImageSurface !== 'HISTORY') {
        void worldViewFrame?.openSupporting?.('3D VISUAL');
      }
      void chassis.executeChassis('focus.set', {
        longitude: focus.longitude,
        latitude: focus.latitude,
        address: focus.resolvedAddress || null,
        sourceView: VIEW_ID.MAP
      });
    }
  });

  placeCamera = bindPlaceCameraControl(root, {
    getActiveView: () => viewSwitcher?.snapshot?.().activeView || 'map',
    returnToMap: () => worldViewFrame?.setLayout(1) || viewSwitcher?.setView('MAP'),
    disarmDropPin: () => dropPin.disarm()
  });

  focusInstrument = bindFocusInstrument(root, {
    chassis,
    isDropPinArmed: () => dropPin.snapshot().armed === true,
    isPlaceCameraArmed: () => placeCamera?.snapshot()?.armed === true
  });
  solarIntelligence = bindSolarIntelligence(root);
  opsSelection = bindOpsSelection(root, {
    chassis,
    isInteractionReserved: () => (
      dropPin.snapshot().armed === true
      || placeCamera?.snapshot()?.armed === true
      || focusInstrument?.isActive?.() === true
      || solarIntelligence?.isPlacePending?.() === true
    )
  });
  hydrantSelection = bindHydrantSelection({
    chassis,
    isInteractionReserved: () => (
      dropPin.snapshot().armed === true
      || placeCamera?.snapshot()?.armed === true
      || focusInstrument?.isActive?.() === true
      || solarIntelligence?.isPlacePending?.() === true
    ),
    onSelection: (record) => {
      void hydrantLink?.apply?.(record, { views: 'linked' });
    }
  });
  root.querySelector('[data-iqai-woa]')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (focusInstrument?.isActive?.()) {
      focusInstrument.deactivate();
      return;
    }
    const view = getMapFoundationController().getView?.();
    void focusInstrument.activate({ families: ['building'] }).then(() => {
      if (view) focusInstrument.attachView?.(view);
    });
  });

  const viewSwitcher = bindViewSwitcher(root, {
    google3d,
    street360,
    analyze3d,
    exclusive: false,
    armDropPin: () => dropPin.arm(),
    onRequestView: (viewId) => {
      if (root.dataset.iqaiImageSurface === 'HISTORY') return;
      ensureWorldviewMapAdapter();
      return worldViewFrame?.openSupporting(viewId);
    },
    onView: () => {
      void chassis.executeChassis('view.select', { viewId: VIEW_ID.MAP });
    }
  });

  worldViewFrame = bindWorldViewFrame(root, {
    google3d,
    street360,
    analyze3d,
    viewSwitcher,
    getTemporal: () => chassis.stateStore.getSnapshot().temporal,
    armDropPin: () => dropPin.arm(),
    imagerySnapshot: () => imageryCommand?.snapshot?.() || null,
    ensureImagery: (opts) => imageryCommand?.openWorldviewImagery?.(opts),
    leaveImagery: () => imageryCommand?.leaveWorldviewImagery?.(),
    onPrimaryMap: () => {
      void chassis.executeChassis('view.select', { viewId: VIEW_ID.MAP });
    }
  });
  const viewCamera = bindViewCameraControl(root, {
    street360,
    worldViewFrame
  });
  const cameraWall = bindCameraWallSurface(root, { chassis });
  const cameraRelevance = bindCameraRelevanceSurface(root, {
    chassis,
    buildWall: async () => {
      const world = chassis.stateStore.getSnapshot();
      const hasTarget = Boolean(world.activeFocus)
        || Boolean((world.selection?.objectRefs || []).length);
      if (hasTarget) await cameraRelevance?.query?.(true);
      return cameraWall?.build?.(cameraRelevance?.snapshot?.());
    },
    generateCoverage: async () => {
      const world = chassis.stateStore.getSnapshot();
      const result = generateCameraCoverage(world.activeFocus);
      if (!result.ok) return result;
      await cameraRelevance?.query?.(true);
      await cameraWall?.build?.(cameraRelevance?.snapshot?.());
      return result;
    },
    clearCoverage: async () => {
      const result = clearGeneratedPlan();
      await cameraRelevance?.query?.(true);
      await cameraWall?.close?.();
      return result;
    }
  });
  imageryCommand = bindImageryCommandSurface(root, {
    getMapViewCreateCount,
    isWorldviewImagery: () => Number(worldViewFrame?.snapshot?.()?.layout) === 4,
    hydrantMarks: () => chassis.snapshotGovernedMapAction()?.last?.marks || [],
    onImageryReady: () => worldViewFrame?.paint?.(),
    closeSpecialists: async () => {
      await street360.close?.({ restoreMap: false }).catch(() => {});
      await google3d.close?.({ restoreMap: false }).catch(() => {});
      await analyze3d.close?.({ restoreMap: false }).catch(() => {});
      await worldViewFrame?.setLayout?.(1);
    }
  });
  bindBasemapPicker(root, {
    setMapSurface: () => imageryCommand?.setMode?.('MAP')
  });
  positionOverlay = bindWorldviewPositionOverlay(root);

  const chassisSearch = typeof chassis.searchPlace === 'function'
    ? chassis.searchPlace.bind(chassis)
    : null;
  api.searchPlace = async (query) => {
    const mode = imageryCommand?.snapshot?.()?.mode;
    if (mode === 'HISTORY') {
      await imageryCommand.setMode('MAP').catch(() => {});
    }
    const result = chassisSearch ? await chassisSearch(query) : { ok: false };
    if (!result?.ok) return result;
    const view = getMapView();
    if (view && Number(view.zoom) < 17) view.zoom = 18;
    await dropPin.placeFromSearch({
      longitude: result.longitude,
      latitude: result.latitude,
      address: result.address
    });
    return result;
  };
  api.dropPin = dropPin;

  subscribeMapFoundation((snapshot) => {
    applyMapFoundationToStage(root, snapshot);
    chassis.setMapState(snapshot.state);
    api.mapViewCreateCount = snapshot.mapViewCreateCount || getMapViewCreateCount();
    api.mapFoundation = getMapFoundationController();
    api.portalWrites = 'NONE';
    if (snapshot.state === 'READY') {
      dropPin.setMapReady(true);
      placeCamera.setMapReady(true);
      street360.setMapReady(true);
      google3d.setMapReady(true);
      analyze3d.setMapReady(true);
      hydrantSelection?.attachView?.(getMapView());
      if (!positionOverlay) {
        positionOverlay = bindWorldviewPositionOverlay(root);
      }
      void positionOverlay.refresh();
      if (!chassis.viewHost.getMountedInstance(VIEW_ID.MAP)) {
        try {
          chassis.viewHost.mount(VIEW_ID.MAP);
        } catch {
          chassis.viewHost.show(VIEW_ID.MAP);
        }
      } else {
        chassis.viewHost.show(VIEW_ID.MAP);
      }
      void chassis.executeChassis('layers.sync-authored', {
        layers: []
      }).then(() => refreshLayerGroups(chassis, focusInstrument));
    }
  });

  chassis.setOpsHost?.({
    loadCatalog: () => opsLayers.loadCatalog(),
    applyScene: (sceneId) => opsLayers.applyScene(sceneId),
    allOff: () => opsLayers.allOff(),
    restore: () => opsLayers.restoreLayers(),
    solo: () => {
      const snap = opsLayers.snapshot();
      const target = snap.infoLayerId || snap.visible[0];
      return target ? opsLayers.soloLayer(target) : null;
    },
    soloLayer: (layerId) => opsLayers.soloLayer(layerId),
    configure: () => opsLayers.setConfigureOpen(!opsLayers.snapshot().configureOpen),
    configureClose: () => opsLayers.setConfigureOpen(false),
    configureSave: async ({ sceneId, layers }) => {
      opsLayers.saveConfiguredMembership(sceneId, layers);
      opsLayers.setConfigureOpen(false, sceneId);
      await opsLayers.applyScene(sceneId);
    },
    configureReset: async (sceneId) => {
      opsLayers.resetConfiguredMembership(sceneId);
      await opsLayers.applyScene(sceneId);
    },
    configureScene: (sceneId) => opsLayers.setConfigureOpen(true, sceneId),
    configureSaveCurrent: async () => {
      const result = opsLayers.saveCurrentScene();
      if (!result?.ok) return result;
      opsLayers.setConfigureOpen(false, result.id);
      await opsLayers.applyScene(result.id);
      return result;
    },
    setWindow: ({ layerId, window }) => opsLayers.setLayerWindow(layerId, window),
    setCategory: ({ layerId, category }) => opsLayers.setLayerCategory(layerId, category),
    setRoute: ({ layerId, route }) => opsLayers.setLayerRoute(layerId, route),
    setCamerasInView: (on) => opsLayers.setCamerasInView(on),
    layerInfo: (layerId) => {
      if (!layerId) {
        opsLayers.setInfoLayer(null);
        return;
      }
      const current = opsLayers.snapshot().infoLayerId;
      opsLayers.setInfoLayer(current === layerId ? null : layerId);
    },
    setVisible: (id, on) => opsLayers.setLayerVisible(id, on)
  });
  void opsLayers.loadCatalog();
  opsLayers.subscribeOpsLayers(() => refreshLayerGroups(chassis, focusInstrument));

  chassis.stateStore.subscribe(() => {
    const world = chassis.stateStore.getSnapshot();
    for (const instance of Object.values(world.layers?.byId || {})) {
      if (instance.layerId === 'authored-operational-map' || instance.layerId === 'session-agol') {
        setOperationalLayerVisibility(instance.instanceId, instance.visible !== false);
        if (Number.isFinite(Number(instance.opacity))) {
          setOperationalLayerOpacity(instance.instanceId, instance.opacity);
        }
      }
      if (instance.layerId === 'woa-acquisition') {
        focusInstrument?.setSourceVisible?.(instance.instanceId, instance.visible !== false);
      }
    }
    refreshLayerGroups(chassis, focusInstrument);
    worldViewFrame?.paint?.();
  });

  try {
    chassis.viewHost.mount(VIEW_ID.MAP);
  } catch {
    // mount adapter starts init; duplicate mount is fail-closed
  }
  chassis.viewRegistry.bindAdapter(VIEW_ID.STREET_360, {
    mount() {
      return Object.freeze({ viewId: VIEW_ID.STREET_360, retained: true });
    },
    hide() {},
    show() {}
  });
  chassis.viewRegistry.bindAdapter(VIEW_ID.VISUAL_3D, {
    mount() {
      return Object.freeze({ viewId: VIEW_ID.VISUAL_3D, retained: true });
    },
    hide() {},
    show() {}
  });
  chassis.viewRegistry.bindAdapter(VIEW_ID.ANALYZE_3D, {
    mount() {
      return Object.freeze({ viewId: VIEW_ID.ANALYZE_3D, retained: false });
    },
    hide() {
      void analyze3d.close();
    },
    show() {
      void analyze3d.open();
    }
  });

  showMapView(mapHost);
  api.dropPin = dropPin;
  api.placeCamera = placeCamera;
  api.viewCamera = viewCamera;
  api.cameraRelevance = cameraRelevance;
  api.cameraWall = cameraWall;
  api.cameraCoverage = Object.freeze({
    generate: () => generateCameraCoverage(chassis.stateStore.getSnapshot().activeFocus),
    clear: () => clearGeneratedPlan()
  });
  api.imageryCommand = imageryCommand;
  api.focusInstrument = focusInstrument;
  chassis.setHereContextProvider(() => ({
    pin: getActiveSpatialFocus(),
    incident: null,
    selectedPoint: null,
    eoAoi: imageryCommand?.snapshot?.()?.remoteSensing || null
  }));
  hydrantLink = bindHydrantLink({
    selection: hydrantSelection,
    street360,
    google3d,
    worldViewFrame,
    imageryCommand
  });
  chassis.setSelectedHydrantProvider(() => hydrantSelection?.snapshot?.()?.selectedRecord || hydrantLink?.current?.() || null);
  chassis.setHydrantStreetAimProvider(() => hydrantLink?.streetAim?.() || null);
  chassis.setGovernedMapExecutor(async (input) => {
    await imageryCommand?.setMode?.('MAP').catch(() => {});
    showMapView(mapHost);
    const intent = input?.intent || {};
    if (
      intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_STREET
      || intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_ALL
    ) {
      const record = hydrantSelection?.snapshot?.()?.selectedRecord
        || getHydrantRecord(input?.selectedHydrant?.idBi);
      if (!record?.objectRef) {
        failClosed('NO_SELECTED_HYDRANT', 'Select a hydrant first. BRAIN does not mint hydrant coordinates.');
      }
      const linked = intent.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_ALL
        ? await hydrantLink.showInAllViews(record)
        : hydrantLink.dispatchStreet(record);
      return {
        confirmationTitle: intent.confirmationTitle,
        operation: intent.operation,
        objectClass: 'hydrant',
        objectRef: record.objectRef,
        count: 1,
        source: HYDRANT_SOURCE,
        here: null,
        hits: [{
          sourceId: record.idBi,
          distanceMeters: record.distanceMeters,
          feature: record.feature
        }],
        street: linked.street || null,
        dispatched: linked.dispatched === true,
        representation: linked.representation || (linked.deferredPanes ? 'PENDING' : 'OPEN'),
        paint: { painted: linked.dispatched === true ? false : true, reason: linked.dispatched === true ? 'DISPATCHED' : 'OPEN' }
      };
    }
    const { executeGovernedHydrantAction } = await import('../map/woa/hydrant-within.js');
    const { paintGovernedMapAction } = await import('../map/governed-map-overlay.js');
    return executeGovernedHydrantAction({
      intent,
      here: input?.here,
      loadFamily: (objectClass) => focusInstrument?.ensureFamilyLoaded?.(objectClass),
      paint: async (result) => {
        rememberHydrantHits(result?.hits);
        const painted = await paintGovernedMapAction(result);
        hydrantSelection?.attachView?.(getMapView());
        imageryCommand?.overlayHydrantMarks?.();
        return painted;
      }
    });
  });
  api.viewSwitcher = viewSwitcher;
  api.worldViewFrame = worldViewFrame;
  api.street360 = street360;
  api.google3d = google3d;
  api.analyze3d = analyze3d;
  api.worldviewNavigation = {
    snapshot: getWorldviewNavigation,
    propose: proposeWorldviewNavigation,
    seedFromFocus: seedWorldviewNavigationFromFocus,
    streetLive: getStreet360LiveCapability
  };
  api.worldviewBeacon = {
    snapshot: () => {
      const overlay = positionOverlay?.snapshot?.() || {};
      const pose = resolveBeaconPose() || overlay.pose || overlay.beacon || null;
      return {
        pose,
        beacon: overlay.beacon || pose,
        look: overlay.look || null,
        north: overlay.north || null,
        camera: overlay.camera || null,
        traversal: overlay.traversal || getWorldviewTraversal(),
        beaconLayerId: overlay.beaconLayerId || WORLDVIEW_BEACON_LAYER_ID,
        traceLayerId: overlay.traceLayerId || WORLDVIEW_TRACE_LAYER_ID,
        kinds: overlay.kinds || null,
        render: overlay.render || null
      };
    },
    refresh: () => positionOverlay?.refresh?.(),
    resetNorth: () => positionOverlay?.resetNorth?.()
  };
  api.traversal = {
    snapshot: getWorldviewTraversal,
    observe: observeStreetTraversal,
    clear: () => {
      const next = clearWorldviewTraversal();
      void positionOverlay?.refresh?.();
      return next;
    }
  };
  api.opsLayers = {
    snapshot: () => opsLayers.snapshot(),
    loadCatalog: () => opsLayers.loadCatalog(),
    setVisible: (id, on) => opsLayers.setLayerVisible(id, on),
    applyScene: (id) => opsLayers.applyScene(id),
    allOff: () => opsLayers.allOff(),
    restore: () => opsLayers.restoreLayers(),
    solo: (id) => opsLayers.soloLayer(id),
    setSolarInstant: (value) => opsLayers.setSolarInstant(value),
    setSolarArea: (area) => opsLayers.setSolarArea(area),
    setSolarEmphasis: (value) => opsLayers.setSolarEmphasis(value),
    refreshSolar: () => opsLayers.refreshSolar(),
    saveConfigure: (sceneId, layers) => opsLayers.saveConfiguredMembership(sceneId, layers),
    resetConfigure: (sceneId) => opsLayers.resetConfiguredMembership(sceneId)
  };
  api.opsSelection = {
    snapshot: () => opsSelection?.snapshot?.() || null,
    clear: () => opsSelection?.clear?.()
  };
  api.hydrant = {
    snapshot: () => hydrantSelection?.snapshot?.() || null,
    selectById: (idBi, sourceView) => hydrantSelection?.selectById?.(idBi, sourceView),
    handleHit: (hit, sourceView) => hydrantSelection?.handleHit?.(hit, sourceView),
    attach: () => hydrantSelection?.attachView?.(getMapView()) === true,
    trace: () => (typeof globalThis !== 'undefined' && Array.isArray(globalThis.__iqaiHydrantTrace)
      ? globalThis.__iqaiHydrantTrace.slice()
      : []),
    clearRecords: () => {
      clearHydrantRecords();
      return true;
    },
    getRecord: (idBi) => getHydrantRecord(idBi),
    link: () => hydrantLink?.snapshot?.() || null
  };
  api.solarIntelligence = {
    snapshot: () => solarIntelligence?.snapshot?.() || null,
    runAction: (name) => solarIntelligence?.runAction?.(name)
  };

  return Object.freeze({
    dropPin,
    placeCamera,
    viewCamera,
    cameraRelevance,
    cameraWall,
    imageryCommand,
    focusInstrument,
    viewSwitcher,
    worldViewFrame,
    street360,
    google3d,
    analyze3d,
    opsSelection,
    solarIntelligence,
    getMapViewCreateCount
  });
}
