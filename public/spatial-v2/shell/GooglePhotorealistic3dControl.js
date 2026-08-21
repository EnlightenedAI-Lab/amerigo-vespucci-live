import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { isDropPinFocus } from '../map/spatial-focus.js';
import {
  getMapView,
  getMapViewCreateCount
} from '../map/map-foundation.js';
import {
  WORLDVIEW_NAV_SOURCE,
  beginWorldviewNavigationApply,
  endWorldviewNavigationApply,
  getWorldviewNavigation,
  isWorldviewNavigationApplying,
  proposeWorldviewNavigation,
  subscribeWorldviewNavigation
} from '../map/worldview-navigation.js';
import {
  applyWorldviewNavigationToMap3d,
  closeGoogleMapsJs3d,
  flyGoogleMapsJs3dToSelectedPoint,
  getGoogleMapsJs3dSnapshot,
  isGoogleMapsJs3dReferenceEnabled,
  nudgeGoogleMapsJs3dHeading,
  nudgeGoogleMapsJs3dTilt,
  openGoogleMapsJs3d,
  orbitGoogleMapsJs3d,
  resetGoogleMapsJs3dNorth,
  resetGoogleMapsJs3dView,
  setGoogleMapsJs3dObliqueView,
  setGoogleMapsJs3dReference,
  setGoogleMapsJs3dTopView,
  subscribeGoogleMapsJs3dCamera,
  updateGoogleMapsJs3dFocusMarker,
  setGoogleMapsJs3dHydrantMarker,
  flyGoogleMapsJs3dTowardHydrant
} from '../map/google-maps-js-3d.js';

const STAGE_STATE = Object.freeze({
  IDLE: 'IDLE',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  ERROR: 'ERROR'
});

export function bindGooglePhotorealistic3dControl(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const stageHost = root?.querySelector('[data-iqai-google-3d-stage]');
  const controlsRoot = root?.querySelector('[data-iqai-google-3d-controls]');
  const openButton = root?.querySelector('[data-iqai-google-3d-open]');
  const returnButton = root?.querySelector('[data-iqai-google-3d-return]');
  const nav = root?.querySelector('[data-iqai-google-3d-nav]');
  const layers = root?.querySelector('[data-iqai-google-3d-layers]');
  const reference = root?.querySelector('[data-iqai-google-3d-reference]');
  const title = root?.querySelector('[data-iqai-google-3d-title]');
  const status = root?.querySelector('[data-iqai-google-3d-status]');

  let stageState = STAGE_STATE.IDLE;
  let mapReady = false;
  let selectedPoint = null;
  let mapViewIdentity = null;
  let transition = 0;
  let cameraUnsub = null;
  let navUnsub = null;

  const hasSelection = () => Boolean(
    selectedPoint
    && isGreaterMontrealLongitudeLatitude(
      selectedPoint.longitude,
      selectedPoint.latitude
    )
  );

  const keepMapVisible = options.keepMapVisible === true;

  function paint() {
    const specialistVisible = [
      STAGE_STATE.OPENING,
      STAGE_STATE.OPEN,
      STAGE_STATE.CLOSING
    ].includes(stageState);

    if (!keepMapVisible) {
      if (well) {
        if (specialistVisible) well.dataset.iqaiSpecialistView = 'google-3d';
        else if (well.dataset.iqaiSpecialistView === 'google-3d') well.dataset.iqaiSpecialistView = '2d';
      }
      if (root) {
        if (specialistVisible) root.dataset.iqaiSpatialView = 'google-3d';
        else if (root.dataset.iqaiSpatialView === 'google-3d') root.dataset.iqaiSpatialView = '2d';
      }
    }
    if (stageHost) stageHost.hidden = !specialistVisible;
    if (controlsRoot) controlsRoot.hidden = !specialistVisible;
    if (title) title.hidden = !specialistVisible;
    if (openButton) {
      openButton.hidden = specialistVisible;
      openButton.disabled = !mapReady || !hasSelection();
    }
    if (returnButton) {
      returnButton.hidden = !specialistVisible;
      returnButton.disabled = stageState === STAGE_STATE.CLOSING;
    }
    if (nav) {
      nav.hidden = !specialistVisible;
      for (const button of nav.querySelectorAll('button')) {
        button.disabled = stageState !== STAGE_STATE.OPEN;
      }
    }
    if (layers) layers.hidden = !specialistVisible;
    if (reference) {
      reference.disabled = stageState !== STAGE_STATE.OPEN;
      reference.checked = specialistVisible && isGoogleMapsJs3dReferenceEnabled();
    }
    if (status) {
      if (stageState === STAGE_STATE.OPENING) status.textContent = 'LOADING 3D VISUAL…';
      else if (stageState === STAGE_STATE.ERROR) status.textContent = '3D VISUAL NOT AVAILABLE HERE';
      else status.textContent = '';
    }
  }

  function canonicalFocusPoint() {
    const peer = options.getSpatialFocus?.() || options.getPeerSelectedPoint?.();
    if (!isDropPinFocus(peer)) return null;
    const lon = Number(peer.longitude);
    const lat = Number(peer.latitude);
    if (!isGreaterMontrealLongitudeLatitude(lon, lat)) return null;
    return {
      longitude: lon,
      latitude: lat,
      spatialReferenceWkid: 4326,
      source: 'drop-pin',
      label: String(peer.resolvedAddress || peer.address || '').trim() || 'FOCUS'
    };
  }

  function applySpatialFocus() {
    const point = canonicalFocusPoint();
    if (point) selectedPoint = point;
    return hasSelection();
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

  function openCameraTarget() {
    const nav = getWorldviewNavigation();
    if (nav && isGreaterMontrealLongitudeLatitude(nav.longitude, nav.latitude)) {
      return {
        longitude: nav.longitude,
        latitude: nav.latitude,
        range: nav.rangeMeters,
        heading: nav.heading,
        source: 'worldview-navigation'
      };
    }
    return canonicalFocusPoint();
  }

  function cameraMissesFocus(engine, target) {
    const camera = engine?.camera || {};
    const lat = Number(camera.lat);
    const lng = Number(camera.lng);
    const aim = target || selectedPoint;
    if (!aim || !Number.isFinite(lat) || !Number.isFinite(lng)) return true;
    const offset = Number(engine?.cameraFocusOffsetMeters);
    if (aim.source === 'drop-pin' && Number.isFinite(offset)) return offset > 25;
    return Math.abs(lat - aim.latitude) > 0.0002
      || Math.abs(lng - aim.longitude) > 0.0002;
  }

  function selectPoint(longitude, latitude, source = 'operator') {
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!isGreaterMontrealLongitudeLatitude(lon, lat)) return false;
    const focus = options.getSpatialFocus?.() || options.getPeerSelectedPoint?.();
    selectedPoint = {
      longitude: lon,
      latitude: lat,
      spatialReferenceWkid: 4326,
      source: String(source || 'operator'),
      label: String(focus?.resolvedAddress || focus?.address || '').trim() || 'FOCUS'
    };
    if (stageState === STAGE_STATE.OPEN) {
      updateGoogleMapsJs3dFocusMarker(selectedPoint);
      void flyGoogleMapsJs3dToSelectedPoint().catch(() => {});
    }
    if (stageState === STAGE_STATE.ERROR) stageState = STAGE_STATE.IDLE;
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

  function snapshot() {
    const view = getMapView();
    const engine = getGoogleMapsJs3dSnapshot();
    return {
      ...engine,
      open: stageState === STAGE_STATE.OPEN && engine.open === true,
      stageState,
      selectedPoint: selectedPoint ? { ...selectedPoint } : engine.selectedPoint,
      mapViewCreateCount: getMapViewCreateCount(),
      mapViewExists: Boolean(view),
      mapViewPreserved: Boolean(mapViewIdentity && view === mapViewIdentity),
      mapHostHidden: mapHost ? mapHost.style.visibility === 'hidden' : null,
      openActionVisible: Boolean(openButton && !openButton.hidden),
      returnActionVisible: Boolean(returnButton && !returnButton.hidden),
      viewLabel: title?.textContent?.trim() || null,
      referenceEnabled: isGoogleMapsJs3dReferenceEnabled(),
      navVisible: Boolean(nav && !nav.hidden),
      layersVisible: Boolean(layers && !layers.hidden),
      temporalMode: 'CURRENT_ONLY',
      displayedAcquisitionLabel: 'CURRENT ONLY',
      mapCenter: {
        longitude: view?.center?.longitude ?? null,
        latitude: view?.center?.latitude ?? null
      }
    };
  }

  async function applySelectedHydrant({ fly = true } = {}) {
    const record = typeof options.getSelectedHydrant === 'function'
      ? options.getSelectedHydrant()
      : null;
    const engine = getGoogleMapsJs3dSnapshot().hydrantMarker;
    const pending = record || (
      engine?.sourceId
      && Number.isFinite(Number(engine.longitude))
      && Number.isFinite(Number(engine.latitude))
        ? {
            idBi: engine.sourceId,
            sourceId: engine.sourceId,
            longitude: engine.longitude,
            latitude: engine.latitude,
            objectRef: engine.objectRef
          }
        : null
    );
    if (!pending) return snapshot();
    try {
      const snap = await setGoogleMapsJs3dHydrantMarker(pending);
      if (fly !== false && stageState === STAGE_STATE.OPEN) {
        await flyGoogleMapsJs3dTowardHydrant(pending).catch(() => {});
      }
      return snap;
    } catch (error) {
      return {
        available: false,
        error: String(error?.message || error),
        hydrantMarker: getGoogleMapsJs3dSnapshot().hydrantMarker
      };
    }
  }

  function detachNavSync() {
    cameraUnsub?.();
    navUnsub?.();
    cameraUnsub = null;
    navUnsub = null;
  }

  function attachNavSync() {
    detachNavSync();
    const openingNavigation = getWorldviewNavigation();
    beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.VISUAL_3D);
    try {
      cameraUnsub = subscribeGoogleMapsJs3dCamera((camera) => {
        if (stageState !== STAGE_STATE.OPEN) return;
        if (isWorldviewNavigationApplying(WORLDVIEW_NAV_SOURCE.VISUAL_3D)) return;
        if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lng)) return;
        const current = getWorldviewNavigation();
        if (
          current
          && current.sourceView !== WORLDVIEW_NAV_SOURCE.VISUAL_3D
          && Math.abs(camera.lat - current.latitude) < 0.0002
          && Math.abs(camera.lng - current.longitude) < 0.0002
        ) {
          return;
        }
        proposeWorldviewNavigation(WORLDVIEW_NAV_SOURCE.VISUAL_3D, {
          longitude: camera.lng,
          latitude: camera.lat,
          rangeMeters: camera.range,
          heading: camera.heading
        });
      });
    } finally {
      endWorldviewNavigationApply(
        WORLDVIEW_NAV_SOURCE.VISUAL_3D,
        openingNavigation?.revision
      );
    }
    navUnsub = subscribeWorldviewNavigation((nav) => {
      if (!nav || stageState !== STAGE_STATE.OPEN) return;
      if (nav.sourceView === WORLDVIEW_NAV_SOURCE.VISUAL_3D) return;
      beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.VISUAL_3D);
      try {
        applyWorldviewNavigationToMap3d(nav);
      } finally {
        endWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.VISUAL_3D, nav.revision);
      }
    });
  }

  async function open() {
    const view = getMapView();
    attachMapView(view);
    applySpatialFocus();
    const target = openCameraTarget();
    if (!mapReady || !target) {
      return snapshot();
    }
    if (stageState === STAGE_STATE.OPEN) {
      const markerPoint = canonicalFocusPoint() || selectedPoint || target;
      selectedPoint = {
        longitude: markerPoint.longitude,
        latitude: markerPoint.latitude,
        spatialReferenceWkid: 4326,
        source: markerPoint.source || 'drop-pin',
        label: String(markerPoint.label || markerPoint.resolvedAddress || '').trim() || 'FOCUS'
      };
      updateGoogleMapsJs3dFocusMarker(selectedPoint);
      void flyGoogleMapsJs3dToSelectedPoint().catch(() => {});
      await applySelectedHydrant({ fly: false });
      paint();
      return snapshot();
    }

    const token = ++transition;
    stageState = STAGE_STATE.OPENING;
    showSpecialistSurface();
    paint();

    try {
      await waitForLaidOutStage();
      applySpatialFocus();
      const cameraTarget = openCameraTarget();
      if (!cameraTarget) {
        throw new Error('ACTIVE SPATIAL FOCUS or WorldView navigation is required for 3D VISUAL.');
      }
      const markerPoint = canonicalFocusPoint() || cameraTarget;
      selectedPoint = {
        longitude: markerPoint.longitude,
        latitude: markerPoint.latitude,
        spatialReferenceWkid: 4326,
        source: markerPoint.source || 'drop-pin',
        label: String(markerPoint.label || markerPoint.resolvedAddress || '').trim() || 'FOCUS'
      };
      let engine = await openGoogleMapsJs3d({
        container: stageHost,
        longitude: cameraTarget.longitude,
        latitude: cameraTarget.latitude,
        range: cameraTarget.range,
        heading: cameraTarget.heading,
        markerLongitude: selectedPoint.longitude,
        markerLatitude: selectedPoint.latitude,
        source: selectedPoint.source,
        label: selectedPoint.label
      });
      if (token !== transition) return snapshot();
      if (
        engine.open !== true
        || engine.maps3dLoaded !== true
        || engine.markerPresent !== true
      ) {
        throw new Error(engine.error || 'Google Photorealistic 3D did not become ready.');
      }
      if (engine.error && !/did not become steady/i.test(String(engine.error))) {
        throw new Error(String(engine.error));
      }
      if (cameraMissesFocus(engine, cameraTarget) && cameraTarget.source === 'drop-pin') {
        engine = await resetGoogleMapsJs3dView();
      } else if (cameraMissesFocus(engine, cameraTarget)) {
        applyWorldviewNavigationToMap3d({
          latitude: cameraTarget.latitude,
          longitude: cameraTarget.longitude,
          rangeMeters: cameraTarget.range,
          heading: cameraTarget.heading
        });
        engine = getGoogleMapsJs3dSnapshot();
      }
      if (token !== transition) return snapshot();
      stageState = STAGE_STATE.OPEN;
      attachNavSync();
      await applySelectedHydrant({ fly: true });
      paint();
      return snapshot();
    } catch (error) {
      if (token === transition) {
        detachNavSync();
        await closeGoogleMapsJs3d().catch(() => {});
        restoreMapSurface();
        stageState = STAGE_STATE.ERROR;
        paint();
      }
      throw error;
    }
  }

  async function close(closeOptions = {}) {
    const restoreMap = closeOptions.restoreMap !== false;
    const token = ++transition;
    stageState = STAGE_STATE.CLOSING;
    paint();
    detachNavSync();
    await closeGoogleMapsJs3d();
    if (token !== transition) return snapshot();
    if (restoreMap) restoreMapSurface();
    else if (stageHost) {
      stageHost.hidden = true;
      stageHost.innerHTML = '';
    }
    stageState = STAGE_STATE.IDLE;
    paint();
    return snapshot();
  }

  async function runNav(action) {
    if (stageState !== STAGE_STATE.OPEN) return snapshot();
    if (action === 'tilt-minus') return nudgeGoogleMapsJs3dTilt(-12);
    if (action === 'tilt-plus') return nudgeGoogleMapsJs3dTilt(12);
    if (action === 'rotate-left') return nudgeGoogleMapsJs3dHeading(-30);
    if (action === 'rotate-right') return nudgeGoogleMapsJs3dHeading(30);
    if (action === 'top') return setGoogleMapsJs3dTopView();
    if (action === 'oblique') return setGoogleMapsJs3dObliqueView();
    if (action === 'north') return resetGoogleMapsJs3dNorth();
    if (action === 'fly') return flyGoogleMapsJs3dToSelectedPoint();
    if (action === 'orbit') return orbitGoogleMapsJs3d();
    if (action === 'reset') return resetGoogleMapsJs3dView();
    return snapshot();
  }

  const onClick = (event) => {
    const openControl = event.target.closest('[data-iqai-google-3d-open]');
    if (openControl && root.contains(openControl)) {
      void open().catch(() => {});
      return;
    }
    const returnControl = event.target.closest('[data-iqai-google-3d-return]');
    if (returnControl && root.contains(returnControl)) {
      void close().catch(() => {});
      return;
    }
    const navControl = event.target.closest('[data-iqai-google-3d-nav-action]');
    if (navControl && root.contains(navControl)) {
      void runNav(navControl.getAttribute('data-iqai-google-3d-nav-action'))
        .then(() => paint())
        .catch(() => paint());
    }
  };
  const onChange = (event) => {
    const referenceControl = event.target.closest('[data-iqai-google-3d-reference]');
    if (!referenceControl || !root.contains(referenceControl)) return;
    void setGoogleMapsJs3dReference(referenceControl.checked).then(() => paint()).catch(() => {
      paint();
    });
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
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
    nudgeHeading: nudgeGoogleMapsJs3dHeading,
    nudgeTilt: nudgeGoogleMapsJs3dTilt,
    orbit: orbitGoogleMapsJs3d,
    resetNorth: resetGoogleMapsJs3dNorth,
    flyToPoint: flyGoogleMapsJs3dToSelectedPoint,
    lookAtHydrant: async (record, options = {}) => {
      try {
        const snap = await setGoogleMapsJs3dHydrantMarker(record);
        const engineOpen = getGoogleMapsJs3dSnapshot().open === true;
        if (record && engineOpen && options.fly !== false) {
          await flyGoogleMapsJs3dTowardHydrant(record).catch(() => {});
        }
        paint();
        return snap;
      } catch (error) {
        paint();
        return {
          available: false,
          error: String(error?.message || error),
          hydrantMarker: getGoogleMapsJs3dSnapshot().hydrantMarker
        };
      }
    },
    setTop: setGoogleMapsJs3dTopView,
    setOblique: setGoogleMapsJs3dObliqueView,
    resetView: resetGoogleMapsJs3dView,
    setReference: setGoogleMapsJs3dReference,
    snapshot
  });
}
