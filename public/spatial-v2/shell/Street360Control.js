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
  STREET_360_OPERATOR_UNAVAILABLE,
  zoomGoogleStreetView
} from '../map/google-street-view.js';

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

  function specialistVisibleNow() {
    return [
      STAGE_STATE.OPENING,
      STAGE_STATE.OPEN,
      STAGE_STATE.CLOSING
    ].includes(stageState);
  }

  function paint() {
    const specialistVisible = specialistVisibleNow();
    if (well) {
      if (specialistVisible) well.dataset.iqaiSpecialistView = 'street-360';
      else if (well.dataset.iqaiSpecialistView === 'street-360') well.dataset.iqaiSpecialistView = '2d';
    }
    if (root) {
      if (specialistVisible) root.dataset.iqaiSpatialView = 'street-360';
      else if (root.dataset.iqaiSpatialView === 'street-360') root.dataset.iqaiSpatialView = '2d';
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
    if (options.isPeerSpecialistOpen?.() === true) {
      await options.closePeerSpecialist?.();
    }

    const token = ++transition;
    stageState = STAGE_STATE.OPENING;
    paint();

    try {
      const availability = await checkGoogleStreetView({
        longitude: selectedPoint.longitude,
        latitude: selectedPoint.latitude,
        source: selectedPoint.source
      });
      if (token !== transition) return snapshot();
      if (!availability.available) {
        stageState = STAGE_STATE.UNAVAILABLE;
        paint();
        return snapshot();
      }

      showSpecialistSurface();
      paint();
      const engine = await openGoogleStreetView({
        container: stageHost,
        longitude: selectedPoint.longitude,
        latitude: selectedPoint.latitude,
        source: selectedPoint.source
      });
      if (token !== transition) return snapshot();
      if (engine.open !== true || engine.available !== true || engine.error) {
        throw new Error('Street 360 did not become ready.');
      }
      stageState = STAGE_STATE.OPEN;
      paint();
      return snapshot();
    } catch (error) {
      if (token === transition) {
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
    await closeGoogleStreetView();
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
    look: lookGoogleStreetView,
    zoom: zoomGoogleStreetView,
    moveAlongCoverage: moveGoogleStreetViewAlongCoverage,
    snapshot
  });
}
