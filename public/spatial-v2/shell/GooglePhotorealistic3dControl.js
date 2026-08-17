import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import {
  getMapView,
  getMapViewCreateCount
} from '../map/map-foundation.js';
import {
  closeGoogleMapsJs3d,
  getGoogleMapsJs3dSnapshot,
  nudgeGoogleMapsJs3dHeading,
  openGoogleMapsJs3d
} from '../map/google-maps-js-3d.js';

const STAGE_STATE = Object.freeze({
  IDLE: 'IDLE',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  ERROR: 'ERROR'
});

function pointFromView(view) {
  const longitude = Number(view?.center?.longitude);
  const latitude = Number(view?.center?.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) return null;
  return {
    longitude,
    latitude,
    spatialReferenceWkid: 4326,
    source: 'mapview-center'
  };
}

function pointFromMapEvent(event) {
  const longitude = Number(event?.mapPoint?.longitude);
  const latitude = Number(event?.mapPoint?.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) return null;
  return {
    longitude,
    latitude,
    spatialReferenceWkid: 4326,
    source: 'map-click'
  };
}

export function bindGooglePhotorealistic3dControl(root) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const stageHost = root?.querySelector('[data-iqai-google-3d-stage]');
  const openButton = root?.querySelector('[data-iqai-google-3d-open]');
  const returnButton = root?.querySelector('[data-iqai-google-3d-return]');
  const title = root?.querySelector('[data-iqai-google-3d-title]');
  const status = root?.querySelector('[data-iqai-google-3d-status]');

  let stageState = STAGE_STATE.IDLE;
  let mapReady = false;
  let selectedPoint = null;
  let mapViewIdentity = null;
  let mapClickHandle = null;
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
      well.dataset.iqaiSpecialistView = specialistVisible ? 'google-3d' : '2d';
    }
    if (root) {
      root.dataset.iqaiSpatialView = specialistVisible ? 'google-3d' : '2d';
    }
    if (stageHost) stageHost.hidden = !specialistVisible;
    if (title) title.hidden = !specialistVisible;
    if (openButton) {
      openButton.hidden = specialistVisible;
      openButton.disabled = !mapReady || !hasSelection();
    }
    if (returnButton) {
      returnButton.hidden = !specialistVisible;
      returnButton.disabled = stageState === STAGE_STATE.CLOSING;
    }
    if (status) {
      if (stageState === STAGE_STATE.OPENING) status.textContent = 'OPENING 3D';
      else if (stageState === STAGE_STATE.OPEN) status.textContent = 'POINT PRESERVED';
      else if (stageState === STAGE_STATE.CLOSING) status.textContent = 'RETURNING TO 2D';
      else if (stageState === STAGE_STATE.ERROR) status.textContent = '3D UNAVAILABLE';
      else if (!mapReady) status.textContent = 'MAP LOADING';
      else status.textContent = hasSelection() ? 'POINT SELECTED' : 'SELECT A MAP POINT';
    }
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
    paint();
    return true;
  }

  function attachMapView(view) {
    if (!view) return false;
    if (!mapViewIdentity) mapViewIdentity = view;
    mapReady = true;
    if (!hasSelection()) {
      const point = pointFromView(view);
      if (point) selectedPoint = point;
    }
    if (!mapClickHandle && typeof view.on === 'function') {
      mapClickHandle = view.on('click', (event) => {
        if (stageState !== STAGE_STATE.IDLE && stageState !== STAGE_STATE.ERROR) return;
        const point = pointFromMapEvent(event);
        if (point) selectPoint(point.longitude, point.latitude, point.source);
      });
    }
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
      mapCenter: {
        longitude: view?.center?.longitude ?? null,
        latitude: view?.center?.latitude ?? null
      }
    };
  }

  async function open() {
    const view = getMapView();
    attachMapView(view);
    if (!mapReady || !hasSelection()) {
      throw new Error('Select a Montréal map point before opening 3D.');
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

  async function close() {
    const token = ++transition;
    stageState = STAGE_STATE.CLOSING;
    paint();
    await closeGoogleMapsJs3d();
    if (token !== transition) return snapshot();
    restoreMapSurface();
    stageState = STAGE_STATE.IDLE;
    paint();
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
    }
  };
  root.addEventListener('click', onClick);
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
    snapshot
  });
}
