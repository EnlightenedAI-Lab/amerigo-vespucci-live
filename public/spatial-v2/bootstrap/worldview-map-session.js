/**
 * Wrap the proven MapView / DROP PIN engines into the WorldView shell.
 * Does not rewrite map-foundation.js. Does not create a second MapView.
 */

import { VIEW_ID } from '../foundation/contracts/index.js';
import {
  getMapFoundationController,
  getMapViewCreateCount,
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
import { bindStreet360Control } from '../shell/Street360Control.js';
import { bindGooglePhotorealistic3dControl } from '../shell/GooglePhotorealistic3dControl.js';
import { bindAnalyze3dControl } from '../shell/Analyze3dControl.js';
import { bindViewSwitcher } from '../shell/ViewSwitcher.js';
import { bindWorldViewFrame } from '../shell/WorldViewFrame.js';
import { projectLayerDrawerGroups } from '../shell/LayersDrawer.js';
import { bindFocusInstrument } from '../map/focus/instrument.js';

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

function refreshLayerGroups(chassis) {
  const liveLayers = listOperationalLayers();
  const world = chassis.stateStore.getSnapshot();
  chassis.setLayerGroups(projectLayerDrawerGroups({
    definitions: chassis.layerRegistry.list(),
    liveLayers,
    instances: world.layers?.byId || {}
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

  const google3d = bindGooglePhotorealistic3dControl(root, {
    getSpatialFocus: () => getActiveSpatialFocus(),
    getPeerSelectedPoint: () => getActiveSpatialFocus(),
    keepMapVisible: true
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
    closePeerSpecialist: async () => {}
  });

  let worldViewFrame = null;
  let focusInstrument = null;
  const dropPin = bindDropPinControl(root, {
    getActiveView: () => viewSwitcher?.snapshot?.().activeView || 'map',
    returnToMap: () => worldViewFrame?.setLayout(1) || viewSwitcher?.setView('MAP'),
    hasAcquiredObject: () => focusInstrument?.hasAcquired?.() === true,
    onPlaced: (focus) => {
      if (!focus) return;
      seedWorldviewNavigationFromFocus(focus);
      street360.selectPoint(focus.longitude, focus.latitude, 'drop-pin');
      google3d.selectPoint(focus.longitude, focus.latitude, 'drop-pin');
      analyze3d.selectPoint(focus.longitude, focus.latitude, 'drop-pin');
      viewSwitcher?.onMapPointSelected(focus);
      void worldViewFrame?.followFocus?.();
      void chassis.executeChassis('focus.set', {
        longitude: focus.longitude,
        latitude: focus.latitude,
        address: focus.resolvedAddress || null,
        sourceView: VIEW_ID.MAP
      });
    }
  });

  focusInstrument = bindFocusInstrument(root, {
    chassis,
    isDropPinArmed: () => dropPin.snapshot().armed === true
  });

  const viewSwitcher = bindViewSwitcher(root, {
    google3d,
    street360,
    analyze3d,
    exclusive: false,
    armDropPin: () => dropPin.arm(),
    onRequestView: (viewId) => worldViewFrame?.openSupporting(viewId),
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
    onPrimaryMap: () => {
      void chassis.executeChassis('view.select', { viewId: VIEW_ID.MAP });
    }
  });
  positionOverlay = bindWorldviewPositionOverlay(root);

  subscribeMapFoundation((snapshot) => {
    applyMapFoundationToStage(root, snapshot);
    chassis.setMapState(snapshot.state);
    api.mapViewCreateCount = snapshot.mapViewCreateCount || getMapViewCreateCount();
    api.mapFoundation = getMapFoundationController();
    api.portalWrites = 'NONE';
    if (snapshot.state === 'READY') {
      dropPin.setMapReady(true);
      street360.setMapReady(true);
      google3d.setMapReady(true);
      analyze3d.setMapReady(true);
      const view = getMapFoundationController().getView?.();
      if (view && !mapNavAttached) {
        attachWorldviewMapAdapter(view);
        mapNavAttached = true;
      }
      if (view) focusInstrument?.attachView?.(view);
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
      const liveLayers = listOperationalLayers();
      void chassis.executeChassis('layers.sync-authored', {
        layers: liveLayers.map((layer, order) => ({
          instanceId: layer.id,
          layerId: layer.session ? 'session-agol' : 'authored-operational-map',
          visible: layer.visible !== false,
          opacity: layer.opacity,
          order,
          status: layer.session ? 'SESSION' : 'AUTHORED'
        }))
      }).then(() => refreshLayerGroups(chassis));
    }
  });

  chassis.stateStore.subscribe(() => {
    const world = chassis.stateStore.getSnapshot();
    for (const instance of Object.values(world.layers?.byId || {})) {
      if (instance.layerId === 'authored-operational-map' || instance.layerId === 'session-agol') {
        setOperationalLayerVisibility(instance.instanceId, instance.visible !== false);
        if (Number.isFinite(Number(instance.opacity))) {
          setOperationalLayerOpacity(instance.instanceId, instance.opacity);
        }
      }
    }
    refreshLayerGroups(chassis);
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
  api.focusInstrument = focusInstrument;
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

  return Object.freeze({
    dropPin,
    focusInstrument,
    viewSwitcher,
    worldViewFrame,
    street360,
    google3d,
    analyze3d,
    getMapViewCreateCount
  });
}
