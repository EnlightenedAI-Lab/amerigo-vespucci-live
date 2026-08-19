/**
 * 3D ANALYZE — deferred ArcGIS SceneView specialist.
 * Distinct from Google 3D VISUAL. Does not construct MapView.
 */

import { getMapView, getMapViewCreateCount } from '../map/map-foundation.js';
import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import {
  ANALYZE_3D_COVERAGE_LABEL,
  closeAnalyze3dScene,
  getAnalyze3dHits,
  getAnalyze3dMeasure,
  getAnalyze3dSceneViewCreateCount,
  getAnalyze3dSensorPose,
  getAnalyze3dSnapshot,
  hitTestScreen,
  pickAndRecord,
  isDowntownMontrealAnalyticalCoverage,
  openAnalyze3dScene
} from '../map/arcgis-scene-analyze.js';

const STAGE_STATE = Object.freeze({
  IDLE: 'IDLE',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
});

function formatMeters(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 1000) return `${number.toFixed(1)} m`;
  return `${number.toFixed(2)} m`;
}

function formatHit(hit, index) {
  if (!hit) return '';
  const ids = [
    hit.objectId != null ? `OID ${hit.objectId}` : null,
    hit.buildingFID ? `FID ${hit.buildingFID}` : null,
    hit.buildingShellFID ? `SHELL ${hit.buildingShellFID}` : null
  ].filter(Boolean).join(' · ');
  const z = Number.isFinite(hit.z) ? `${hit.z.toFixed(2)} m` : 'Z UNAVAILABLE';
  return `HIT ${index}  ${hit.longitude.toFixed(6)}, ${hit.latitude.toFixed(6)}  ${z}${ids ? `  ${ids}` : ''}`;
}

export function bindAnalyze3dControl(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well') || root?.querySelector('[data-iqai-view-host]');
  const stageHost = root?.querySelector('[data-iqai-analyze-3d-stage]')
    || root?.querySelector('[data-iqai-view-anchor="3D ANALYZE"]');
  const canvas = root?.querySelector('[data-iqai-analyze-3d-canvas]');
  const status = root?.querySelector('[data-iqai-analyze-3d-status]');
  const hitReadout = root?.querySelector('[data-iqai-analyze-3d-hit]');
  const measureReadout = root?.querySelector('[data-iqai-analyze-3d-measure]');

  let stageState = STAGE_STATE.IDLE;
  let selectedPoint = null;
  let mapReady = false;

  function specialistVisible() {
    return [
      STAGE_STATE.OPENING,
      STAGE_STATE.OPEN,
      STAGE_STATE.CLOSING,
      STAGE_STATE.UNAVAILABLE,
      STAGE_STATE.ERROR
    ].includes(stageState);
  }

  function paintOverlay() {
    const visible = specialistVisible();
    if (well) {
      if (visible) well.dataset.iqaiSpecialistView = 'analyze-3d';
      else if (well.dataset.iqaiSpecialistView === 'analyze-3d') well.dataset.iqaiSpecialistView = '2d';
    }
    if (root) {
      if (visible) root.dataset.iqaiSpatialView = 'analyze-3d';
      else if (root.dataset.iqaiSpatialView === 'analyze-3d') {
        root.dataset.iqaiSpatialView = root.dataset.iqaiWorldviewLayout && root.dataset.iqaiWorldviewLayout !== '1'
          ? 'worldview'
          : '2d';
      }
    }
    if (stageHost) stageHost.hidden = !visible;
  }

  function paintReadout() {
    const engine = getAnalyze3dSnapshot();
    const hits = getAnalyze3dHits();
    const measured = getAnalyze3dMeasure();
    if (status) {
      if (stageState === STAGE_STATE.OPENING) status.textContent = 'LOADING 3D ANALYZE…';
      else if (stageState === STAGE_STATE.UNAVAILABLE) status.textContent = ANALYZE_3D_COVERAGE_LABEL;
      else if (stageState === STAGE_STATE.ERROR) status.textContent = '3D ANALYZE NOT AVAILABLE';
      else if (stageState === STAGE_STATE.OPEN && engine.coverageAvailable === false) {
        status.textContent = ANALYZE_3D_COVERAGE_LABEL;
      } else if (stageState === STAGE_STATE.OPEN) {
        status.textContent = engine.buildingsReady
          ? '3D ANALYZE  DOWNTOWN MONTRÉAL  CLICK A BUILDING'
          : 'LOADING BUILDING_MONTREAL…';
      } else {
        status.textContent = '';
      }
    }
    if (hitReadout) {
      hitReadout.textContent = hits.map((hit, index) => formatHit(hit, index + 1)).join('  |  ');
    }
    if (measureReadout) {
      measureReadout.textContent = measured
        ? `Δ3D ${formatMeters(measured.direct3dMeters)}  ΔH ${formatMeters(measured.horizontalMeters)}  ΔZ ${formatMeters(measured.verticalMeters)}`
        : (hits.length === 1 ? 'CLICK A SECOND BUILDING SURFACE TO MEASURE' : '');
    }
  }

  function paint() {
    paintOverlay();
    paintReadout();
  }

  function resolveLocation() {
    if (selectedPoint && Number.isFinite(selectedPoint.longitude) && Number.isFinite(selectedPoint.latitude)) {
      return selectedPoint;
    }
    const focus = getActiveSpatialFocus();
    if (Number.isFinite(Number(focus?.longitude)) && Number.isFinite(Number(focus?.latitude))) {
      return {
        longitude: Number(focus.longitude),
        latitude: Number(focus.latitude),
        heading: null,
        source: 'FOCUS'
      };
    }
    return options.getLocation?.() || null;
  }

  function snapshot() {
    const engine = getAnalyze3dSnapshot();
    return {
      ...engine,
      open: specialistVisible() && stageState !== STAGE_STATE.CLOSING,
      stageState,
      selectedPoint: selectedPoint ? { ...selectedPoint } : engine.location,
      mapReady,
      mapViewCreateCount: getMapViewCreateCount(),
      mapViewExists: Boolean(getMapView()),
      sceneViewCreateCount: getAnalyze3dSceneViewCreateCount(),
      sensorPose: getAnalyze3dSensorPose() || engine.sensorPose,
      hits: getAnalyze3dHits(),
      measure: getAnalyze3dMeasure(),
      coverageAvailable: stageState === STAGE_STATE.UNAVAILABLE ? false : engine.coverageAvailable,
      coverageLabel: stageState === STAGE_STATE.UNAVAILABLE || engine.coverageAvailable === false
        ? ANALYZE_3D_COVERAGE_LABEL
        : engine.coverageLabel
    };
  }

  function selectPoint(longitude, latitude, source = 'operator') {
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return snapshot();
    selectedPoint = { longitude: lon, latitude: lat, heading: null, source };
    paint();
    return snapshot();
  }

  async function open() {
    if (stageState === STAGE_STATE.OPEN || stageState === STAGE_STATE.UNAVAILABLE) {
      paint();
      return snapshot();
    }
    stageState = STAGE_STATE.OPENING;
    paint();
    const location = resolveLocation();
    const covered = isDowntownMontrealAnalyticalCoverage(location?.longitude, location?.latitude);
    if (!covered) {
      stageState = STAGE_STATE.UNAVAILABLE;
      paint();
      return snapshot();
    }
    try {
      const host = canvas || stageHost;
      await openAnalyze3dScene({ container: host, location });
      const engine = getAnalyze3dSnapshot();
      stageState = engine.coverageAvailable === false ? STAGE_STATE.UNAVAILABLE : STAGE_STATE.OPEN;
      paint();
      getMapView()?.resize?.();
      return snapshot();
    } catch (error) {
      stageState = STAGE_STATE.ERROR;
      paint();
      return snapshot();
    }
  }

  async function close() {
    if (stageState === STAGE_STATE.IDLE) return snapshot();
    stageState = STAGE_STATE.CLOSING;
    paint();
    try {
      await closeAnalyze3dScene();
    } finally {
      stageState = STAGE_STATE.IDLE;
      paint();
      getMapView()?.resize?.();
    }
    return snapshot();
  }

  paint();

  return Object.freeze({
    setMapReady(ready) {
      mapReady = Boolean(ready);
      paint();
      return snapshot();
    },
    selectPoint,
    open,
    close,
    hitTestScreen,
    pickAndRecord,
    snapshot,
    paint
  });
}
