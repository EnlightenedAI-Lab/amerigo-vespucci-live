import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { isDropPinFocus } from '../map/spatial-focus.js';
import {
  getMapView,
  getMapViewCreateCount
} from '../map/map-foundation.js';
import {
  checkGoogleStreetView,
  closeGoogleStreetView,
  getGoogleStreetViewSnapshot,
  lookGoogleStreetView,
  moveGoogleStreetViewAlongCoverage,
  openGoogleStreetView,
  setGoogleStreetViewPov,
  STREET_360_OPERATOR_UNAVAILABLE,
  applyWorldviewNavigationToStreetView,
  subscribeGoogleStreetViewNavigation,
  zoomGoogleStreetView,
  aimGoogleStreetViewAtHydrant,
  isStreetHydrantAimLocked
} from '../map/google-street-view.js';
import {
  WORLDVIEW_NAV_SOURCE,
  armStreetOperatingScale,
  beginWorldviewNavigationApply,
  disarmStreetOperatingScale,
  endWorldviewNavigationApply,
  getStreet360LiveCapability,
  getWorldviewNavigation,
  isWorldviewNavigationApplying,
  noteStreetOperatingScaleApplied,
  proposeWorldviewNavigation,
  streetOperatingScalePatch,
  subscribeWorldviewNavigation
} from '../map/worldview-navigation.js';
import { observeStreetTraversal } from '../map/worldview-traversal.js';

const STAGE_STATE = Object.freeze({
  IDLE: 'IDLE',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
});

export function bindStreet360Control(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const stageHost = root?.querySelector('[data-iqai-street-360-stage]');
  const dateLabel = root?.querySelector('[data-iqai-street-360-date]');

  let stageState = STAGE_STATE.IDLE;
  let mapReady = false;
  let selectedPoint = null;
  let selectedFeature = null;
  let mapViewIdentity = null;
  let transition = 0;
  let streetNavUnsub = null;
  let worldNavUnsub = null;
  let bindMode = 'operator';
  let cameraTarget = null;
  let inventoryLook = null;

  const hasSelection = () => Boolean(
    selectedPoint
    && isGreaterMontrealLongitudeLatitude(
      selectedPoint.longitude,
      selectedPoint.latitude
    )
  );

  function peerPoint() {
    const point = options.getSpatialFocus?.() || options.getPeerSelectedPoint?.();
    if (!isDropPinFocus(point)) return null;
    if (!isGreaterMontrealLongitudeLatitude(point.longitude, point.latitude)) return null;
    return {
      longitude: Number(point.longitude),
      latitude: Number(point.latitude),
      spatialReferenceWkid: 4326,
      source: 'drop-pin'
    };
  }

  function applySpatialFocus() {
    const point = peerPoint();
    if (point) selectedPoint = point;
    return hasSelection();
  }

  function openTarget() {
    if (inventoryLook) return inventoryLook;
    if (bindMode === 'camera' && cameraTarget) {
      if (!isGreaterMontrealLongitudeLatitude(cameraTarget.longitude, cameraTarget.latitude)) {
        return null;
      }
      return {
        longitude: Number(cameraTarget.longitude),
        latitude: Number(cameraTarget.latitude),
        heading: Number(cameraTarget.heading),
        pitch: Number(cameraTarget.pitch),
        source: 'authored-camera',
        preferPosition: true
      };
    }
    const nav = getWorldviewNavigation();
    if (nav && isGreaterMontrealLongitudeLatitude(nav.longitude, nav.latitude)) {
      return {
        longitude: nav.longitude,
        latitude: nav.latitude,
        heading: nav.heading,
        source: 'worldview-navigation'
      };
    }
    return peerPoint();
  }

  function detachNavSync() {
    streetNavUnsub?.();
    worldNavUnsub?.();
    streetNavUnsub = null;
    worldNavUnsub = null;
    disarmStreetOperatingScale();
  }

  function attachNavSync() {
    detachNavSync();
    armStreetOperatingScale();
    const capability = getStreet360LiveCapability();
    if (capability.positionEvents) {
      const openingNavigation = getWorldviewNavigation();
      beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.STREET_360);
      try {
        streetNavUnsub = subscribeGoogleStreetViewNavigation((position) => {
          if (stageState !== STAGE_STATE.OPEN) return;
          if (isWorldviewNavigationApplying(WORLDVIEW_NAV_SOURCE.STREET_360)) return;
          const scalePatch = streetOperatingScalePatch(getWorldviewNavigation());
          const committed = proposeWorldviewNavigation(WORLDVIEW_NAV_SOURCE.STREET_360, {
            longitude: position.longitude,
            latitude: position.latitude,
            heading: capability.headingFromPov ? position.heading : undefined,
            ...scalePatch
          });
          if (committed?.accepted) noteStreetOperatingScaleApplied(committed.snapshot);
          observeStreetTraversal({
            ...position,
            programmatic: position.programmatic === true
          });
        });
      } finally {
        endWorldviewNavigationApply(
          WORLDVIEW_NAV_SOURCE.STREET_360,
          openingNavigation?.revision
        );
      }
    }
    worldNavUnsub = subscribeWorldviewNavigation((nav) => {
      if (!nav || stageState !== STAGE_STATE.OPEN) return;
      if (isStreetHydrantAimLocked()) return;
      if (nav.sourceView === WORLDVIEW_NAV_SOURCE.STREET_360) return;
      beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.STREET_360);
      try {
        applyWorldviewNavigationToStreetView(nav);
      } finally {
        endWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.STREET_360, nav.revision);
      }
    });
  }

  function specialistVisibleNow() {
    return [
      STAGE_STATE.OPENING,
      STAGE_STATE.OPEN,
      STAGE_STATE.CLOSING
    ].includes(stageState);
  }

  const keepMapVisible = options.keepMapVisible === true;

  function paint() {
    const specialistVisible = specialistVisibleNow();
    if (!keepMapVisible) {
      if (well) {
        if (specialistVisible) well.dataset.iqaiSpecialistView = 'street-360';
        else if (well.dataset.iqaiSpecialistView === 'street-360') well.dataset.iqaiSpecialistView = '2d';
      }
      if (root) {
        if (specialistVisible) root.dataset.iqaiSpatialView = 'street-360';
        else if (root.dataset.iqaiSpatialView === 'street-360') root.dataset.iqaiSpatialView = '2d';
      }
    }
    if (stageHost) stageHost.hidden = !specialistVisible;
    if (dateLabel) {
      dateLabel.hidden = true;
      dateLabel.textContent = '';
    }
  }

  function selectPoint(longitude, latitude, source = 'operator', feature = null) {
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!isGreaterMontrealLongitudeLatitude(lon, lat)) return false;
    selectedPoint = {
      longitude: lon,
      latitude: lat,
      spatialReferenceWkid: 4326,
      source: String(source || 'operator')
    };
    if (feature && typeof feature === 'object') {
      selectedFeature = { ...feature };
    }
    if (stageState === STAGE_STATE.ERROR || stageState === STAGE_STATE.UNAVAILABLE) {
      stageState = STAGE_STATE.IDLE;
    }
    options.onSelectPoint?.(selectedPoint);
    paint();
    return true;
  }

  function attachMapView(view) {
    if (!view) return false;
    if (!mapViewIdentity) mapViewIdentity = view;
    mapReady = true;
    applySpatialFocus();
    paint();
    return true;
  }

  function showSpecialistSurface() {
    if (!keepMapVisible && mapHost) {
      mapHost.style.visibility = 'hidden';
      mapHost.style.pointerEvents = 'none';
    }
    if (stageHost) {
      stageHost.hidden = false;
      stageHost.removeAttribute('hidden');
    }
  }

  function restoreMapSurface() {
    if (stageHost) {
      stageHost.hidden = true;
      stageHost.innerHTML = '';
    }
    if (!keepMapVisible && mapHost) {
      mapHost.style.visibility = 'visible';
      mapHost.style.pointerEvents = '';
    }
    const view = getMapView();
    view?.resize?.();
    view?.requestRender?.();
  }

  function waitForLaidOutStage() {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (stageHost && stageHost.offsetWidth > 8 && stageHost.offsetHeight > 8) {
          resolve(true);
          return;
        }
        if (Date.now() - started > 2000) {
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function snapshot() {
    const view = getMapView();
    const engine = getGoogleStreetViewSnapshot();
    return {
      ...engine,
      open: stageState === STAGE_STATE.OPEN && engine.open === true,
      stageState,
      selectedPoint: selectedPoint ? { ...selectedPoint } : engine.selectedPoint,
      selectedFeature: selectedFeature ? { ...selectedFeature } : null,
      mapViewCreateCount: getMapViewCreateCount(),
      mapViewExists: Boolean(view),
      mapViewPreserved: Boolean(mapViewIdentity && view === mapViewIdentity),
      mapHostHidden: mapHost ? mapHost.style.visibility === 'hidden' : null,
      viewLabel: 'STREET 360',
      operatorStatus: stageState === STAGE_STATE.UNAVAILABLE || stageState === STAGE_STATE.ERROR
        ? STREET_360_OPERATOR_UNAVAILABLE
        : stageState === STAGE_STATE.OPENING
          ? 'LOADING STREET 360…'
          : null,
      mapCenter: {
        longitude: view?.center?.longitude ?? null,
        latitude: view?.center?.latitude ?? null
      },
      bindMode,
      cameraTarget: cameraTarget ? { ...cameraTarget } : null,
      providerPixels: Boolean(stageHost?.querySelector?.('.gm-style canvas, .gm-style img'))
    };
  }

  async function open() {
    const view = getMapView();
    attachMapView(view);
    applySpatialFocus();
    const target = openTarget();
    if (!mapReady || !target) {
      return snapshot();
    }
    if (!keepMapVisible && options.isPeerSpecialistOpen?.() === true) {
      await options.closePeerSpecialist?.();
    }

    const token = ++transition;
    stageState = STAGE_STATE.OPENING;
    paint();

    try {
      const availability = await checkGoogleStreetView({
        longitude: target.longitude,
        latitude: target.latitude,
        source: target.source
      });
      if (token !== transition) return snapshot();
      if (!availability.available) {
        stageState = STAGE_STATE.UNAVAILABLE;
        paint();
        return snapshot();
      }

      showSpecialistSurface();
      paint();
      await waitForLaidOutStage();
      const engine = await openGoogleStreetView({
        container: stageHost,
        longitude: target.longitude,
        latitude: target.latitude,
        heading: Number.isFinite(Number(target.heading)) ? Number(target.heading) : undefined,
        pitch: Number.isFinite(Number(target.pitch)) ? Number(target.pitch) : undefined,
        source: target.source,
        preferPosition: target.preferPosition === true
          || target.source === 'worldview-navigation'
          || target.source === 'authored-camera'
      });
      if (token !== transition) return snapshot();
      if (engine.open !== true || engine.available !== true || engine.error) {
        throw new Error('Street 360 did not become ready.');
      }
      stageState = STAGE_STATE.OPEN;
      if (bindMode === 'camera') {
        if (Number.isFinite(Number(target.heading)) || Number.isFinite(Number(target.pitch))) {
          setGoogleStreetViewPov({ heading: target.heading, pitch: target.pitch });
        }
      } else {
        attachNavSync();
        if (engine.panoramaPosition) {
          observeStreetTraversal({
            longitude: engine.panoramaPosition.longitude,
            latitude: engine.panoramaPosition.latitude,
            heading: engine.pov?.heading,
            pitch: engine.pov?.pitch,
            zoom: engine.zoom,
            panoId: engine.panoId || null
          });
        }
      }
      paint();
      return snapshot();
    } catch (error) {
      if (token === transition) {
        detachNavSync();
        await closeGoogleStreetView().catch(() => {});
        restoreMapSurface();
        stageState = STAGE_STATE.ERROR;
        paint();
      }
      throw error;
    }
  }

  async function close(options = {}) {
    const restoreMap = options.restoreMap !== false;
    const token = ++transition;
    stageState = STAGE_STATE.CLOSING;
    paint();
    detachNavSync();
    await closeGoogleStreetView();
    if (token !== transition) return snapshot();
    if (restoreMap) restoreMapSurface();
    else if (stageHost) {
      stageHost.hidden = true;
      stageHost.innerHTML = '';
    }
    bindMode = 'operator';
    cameraTarget = null;
    stageState = STAGE_STATE.IDLE;
    paint();
    return snapshot();
  }

  function beginCameraBind(pose) {
    bindMode = 'camera';
    cameraTarget = pose ? {
      cameraId: pose.cameraId || null,
      longitude: Number(pose.longitude),
      latitude: Number(pose.latitude),
      heading: Number(pose.heading),
      pitch: Number(pose.pitch)
    } : null;
    return snapshot();
  }

  async function openForCamera(pose) {
    beginCameraBind(pose);
    return open();
  }

  function applyCameraPov(pose) {
    if (bindMode !== 'camera' || !pose) return snapshot();
    cameraTarget = {
      ...(cameraTarget || {}),
      cameraId: pose.cameraId || cameraTarget?.cameraId || null,
      longitude: Number(pose.longitude),
      latitude: Number(pose.latitude),
      heading: Number(pose.heading),
      pitch: Number(pose.pitch)
    };
    setGoogleStreetViewPov({ heading: pose.heading, pitch: pose.pitch });
    return snapshot();
  }

  async function releaseCameraBind() {
    const wasCamera = bindMode === 'camera';
    bindMode = 'operator';
    cameraTarget = null;
    if (wasCamera && (stageState === STAGE_STATE.OPEN || stageState === STAGE_STATE.OPENING || stageState === STAGE_STATE.UNAVAILABLE)) {
      return close({ restoreMap: false });
    }
    return snapshot();
  }

  async function lookAtHydrant(record) {
    let aimed = await aimGoogleStreetViewAtHydrant(record);
    if (!aimed?.available) return aimed;
    if (aimed.needsOpen || stageState !== STAGE_STATE.OPEN) {
      inventoryLook = {
        longitude: aimed.panorama.longitude,
        latitude: aimed.panorama.latitude,
        heading: aimed.heading,
        pitch: 0,
        source: 'hydrant-inventory',
        preferPosition: true
      };
      const opened = await open();
      inventoryLook = null;
      if (opened?.open !== true && stageState !== STAGE_STATE.OPEN) return aimed;
      aimed = await aimGoogleStreetViewAtHydrant(record);
    }
    paint();
    return aimed;
  }

  paint();
  return Object.freeze({
    attachMapView,
    setMapReady(ready) {
      mapReady = Boolean(ready);
      if (mapReady) attachMapView(getMapView());
      paint();
      return snapshot();
    },
    selectPoint,
    open,
    close,
    lookAtHydrant,
    beginCameraBind,
    openForCamera,
    applyCameraPov,
    releaseCameraBind,
    bindMode: () => bindMode,
    look: lookGoogleStreetView,
    zoom: zoomGoogleStreetView,
    moveAlongCoverage: moveGoogleStreetViewAlongCoverage,
    liveCapability: getStreet360LiveCapability,
    snapshot
  });
}
