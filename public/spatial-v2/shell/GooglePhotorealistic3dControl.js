import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { isDropPinFocus } from '../map/spatial-focus.js';
import {
  getMapView,
  getMapViewCreateCount
} from '../map/map-foundation.js';
import {
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
  setGoogleMapsJs3dTopView
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

  const hasSelection = () => Boolean(
    selectedPoint
    && isGreaterMontrealLongitudeLatitude(
      selectedPoint.longitude,
      selectedPoint.latitude
    )
  );

  function paint() {
    const specialistVisible = [
      STAGE_STATE.OPENING,
      STAGE_STATE.OPEN,
      STAGE_STATE.CLOSING
    ].includes(stageState);

    if (well) {
      if (specialistVisible) well.dataset.iqaiSpecialistView = 'google-3d';
      else if (well.dataset.iqaiSpecialistView === 'google-3d') well.dataset.iqaiSpecialistView = '2d';
    }
    if (root) {
      if (specialistVisible) root.dataset.iqaiSpatialView = 'google-3d';
      else if (root.dataset.iqaiSpatialView === 'google-3d') root.dataset.iqaiSpatialView = '2d';
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

  function applySpatialFocus() {
    const peer = options.getSpatialFocus?.() || options.getPeerSelectedPoint?.();
    if (!isDropPinFocus(peer)) return hasSelection();
    const lon = Number(peer.longitude);
    const lat = Number(peer.latitude);
    if (!isGreaterMontrealLongitudeLatitude(lon, lat)) return hasSelection();
    selectedPoint = {
      longitude: lon,
      latitude: lat,
      spatialReferenceWkid: 4326,
      source: 'drop-pin'
    };
    return hasSelection();
  }

  function selectPoint(longitude, latitude, source = 'operator') {
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!isGreaterMontrealLongitudeLatitude(lon, lat)) return false;
    selectedPoint = {
      longitude: lon,
      latitude: lat,
      spatialReferenceWkid: 4326,
      source: String(source || 'operator')
    };
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
    if (mapHost) {
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
    if (mapHost) {
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
      mapCenter: {
        longitude: view?.center?.longitude ?? null,
        latitude: view?.center?.latitude ?? null
      }
    };
  }

  async function open() {
    const view = getMapView();
    attachMapView(view);
    applySpatialFocus();
    if (!mapReady || !hasSelection()) {
      return snapshot();
    }

    const token = ++transition;
    stageState = STAGE_STATE.OPENING;
    showSpecialistSurface();
    paint();

    try {
      const engine = await openGoogleMapsJs3d({
        container: stageHost,
        longitude: selectedPoint.longitude,
        latitude: selectedPoint.latitude,
        source: selectedPoint.source
      });
      if (token !== transition) return snapshot();
      if (
        engine.open !== true
        || engine.maps3dLoaded !== true
        || engine.markerPresent !== true
        || engine.steady !== true
        || engine.error
      ) {
        throw new Error('Google Photorealistic 3D did not become ready.');
      }
      stageState = STAGE_STATE.OPEN;
      paint();
      return snapshot();
    } catch (error) {
      if (token === transition) {
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
    setTop: setGoogleMapsJs3dTopView,
    setOblique: setGoogleMapsJs3dObliqueView,
    resetView: resetGoogleMapsJs3dView,
    setReference: setGoogleMapsJs3dReference,
    snapshot
  });
}
