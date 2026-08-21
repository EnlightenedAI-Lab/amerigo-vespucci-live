/**
 * Compact production Camera relevance surface.
 * Spatial presentation only. Camera math stays in camera.query-relevant.
 * Not the Camera lab. Not Camera Wall.
 */

import { objectRefKey } from '../foundation/contracts/index.js';
import { selectAuthoredCamera, subscribeAuthoredCameras } from '../map/authored-cameras.js';
import {
  getLastCameraQuerySnapshot,
  subscribeCameraQuery
} from '../camera/spatial-camera-adapter.js';
import { PIXEL_DENSITY_UNKNOWN } from '../camera/engine/dori.js';
import { CAMERA_QUERY_CAPABILITY } from '../camera/engine/relevance-constants.js';
import { NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION } from '../camera/donor-population.js';
import { COVERAGE_HONESTY, getLastCoveragePlan } from '../camera/engine/coverage-plan.js';

function primaryObjectRef(world) {
  const refs = world?.selection?.objectRefs || [];
  const primaryId = world?.selection?.primaryObjectRefId || null;
  return refs.find((ref) => objectRefKey(ref) === primaryId) || refs[0] || null;
}

function densityLine(item) {
  const known = item?.targetDesign?.known === true && Number.isFinite(Number(item.pixelDensityPxPerM));
  if (!known) return PIXEL_DENSITY_UNKNOWN;
  const px = Number(item.pixelDensityPxPerM);
  const shown = px >= 10 ? String(Math.round(px)) : String(Math.round(px * 10) / 10);
  const band = item.designBand && item.designBand !== 'UNKNOWN' ? item.designBand : null;
  return band ? `${shown} px/m · ${band}` : `${shown} px/m`;
}

function distanceLabel(item) {
  const meters = Number(item?.planDistanceM);
  if (!Number.isFinite(meters)) return '—';
  return `${Math.round(meters)} m`;
}

function renderRows(snapshot) {
  const relevant = snapshot?.relevant || [];
  if (snapshot?.empty && (
    snapshot.emptyReason === NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION
    || snapshot.emptyReason === 'NO AUTHORED CAMERAS IN QUERY AREA'
  )) {
    return `<p data-iqai-camera-relevance-empty>${snapshot.emptyReason}</p>`;
  }
  if (!snapshot?.target || snapshot.target.missing) {
    return `<p data-iqai-camera-relevance-empty>${snapshot?.emptyReason || 'WAITING FOR FOCUS OR SELECTION'}</p>`;
  }
  if (!relevant.length) {
    return `<p data-iqai-camera-relevance-empty>NO RELEVANT CAMERAS</p>`;
  }
  return relevant.map((item) => `
    <button type="button" class="iqai-v2-camera-relevance__row" data-iqai-camera-relevance-row="${item.cameraId || ''}">
      <span>${item.displayLabel} · ${distanceLabel(item)}</span>
      <span>${item.qualification || 'PLANNED · NOT INSTALLED'}</span>
      <span>${item.compactReason || 'NEARBY'}</span>
      <span>${densityLine(item)}</span>
    </button>
  `).join('');
}

function paintSurface(el, snapshot) {
  if (!el) return;
  const available = Number(snapshot?.cameraCount) || 0;
  const relevant = Number(snapshot?.relevantCount) || 0;
  const kicker = el.querySelector('[data-iqai-camera-relevance-kicker]');
  const counts = el.querySelector('[data-iqai-camera-relevance-counts]');
  const rows = el.querySelector('[data-iqai-camera-relevance-list]');
  const footer = el.querySelector('[data-iqai-camera-relevance-honesty]');
  if (kicker) kicker.textContent = 'CAMERAS';
  if (counts) {
    counts.textContent = `${available} AVAILABLE · ${relevant} RELEVANT`;
    counts.dataset.iqaiCameraRelevanceCount = String(available);
    counts.dataset.iqaiCameraRelevanceRelevant = String(relevant);
  }
  if (rows) rows.innerHTML = renderRows(snapshot);
  if (footer) footer.textContent = 'PLANNED · NOT INSTALLED · LOCAL PERSISTENCE · PLAN GEOMETRY · VISIBILITY NOT TESTED';
  const status = el.querySelector('[data-iqai-camera-coverage-status]');
  const plan = getLastCoveragePlan();
  if (status) {
    status.textContent = plan?.ok
      ? `CAMERA COVERAGE PLAN · ${plan.cameraCount} PLANNED · ${relevant} RELEVANT · AUTO-AIMED AT TARGET · ${COVERAGE_HONESTY}`
      : (el.dataset.iqaiCameraCoverageReason || '2D CANDIDATE PLACEMENT · NOT INSTALLATION SITING · VISIBILITY NOT TESTED');
  }
  el.hidden = false;
}

export function renderCameraRelevanceSurface() {
  return `
    <aside class="iqai-v2-camera-relevance" data-iqai-camera-relevance aria-label="Relevant cameras">
      <p class="iqai-v2-camera-relevance__kicker" data-iqai-camera-relevance-kicker>CAMERAS</p>
      <p data-iqai-camera-relevance-counts>0 AVAILABLE · 0 RELEVANT</p>
      <div data-iqai-camera-relevance-list>
        <p data-iqai-camera-relevance-empty>WAITING FOR FOCUS OR SELECTION</p>
      </div>
      <p class="iqai-v2-camera-relevance__note" data-iqai-camera-relevance-honesty>PLANNED · NOT INSTALLED · LOCAL PERSISTENCE · PLAN GEOMETRY · VISIBILITY NOT TESTED</p>
      <p class="iqai-v2-camera-relevance__note" data-iqai-camera-coverage-status>2D CANDIDATE PLACEMENT · NOT INSTALLATION SITING · VISIBILITY NOT TESTED</p>
      <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-coverage-generate>GENERATE CAMERA COVERAGE</button>
      <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-coverage-clear>CLEAR GENERATED PLAN</button>
      <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-wall-build>BUILD RELEVANT WALL</button>
    </aside>
  `;
}

export function bindCameraRelevanceSurface(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well') || root;
  if (!well) return null;
  let el = well.querySelector('[data-iqai-camera-relevance]');
  if (!el) {
    well.insertAdjacentHTML('beforeend', renderCameraRelevanceSurface());
    el = well.querySelector('[data-iqai-camera-relevance]');
  }
  let querying = false;
  let lastKey = '';

  function snapshot() {
    return getLastCameraQuerySnapshot();
  }

  async function query(force = false) {
    const chassis = options.chassis;
    if (!chassis || typeof chassis.executeChassis !== 'function') return snapshot();
    const world = chassis.stateStore.getSnapshot();
    const objectRef = primaryObjectRef(world);
    const focusRef = world.activeFocus || null;
    const key = [
      objectRef ? objectRefKey(objectRef) : '',
      focusRef?.focusId || '',
      world.revision
    ].join('::');
    if (!force && key === lastKey) return snapshot();
    querying = true;
    try {
      await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
        focusRef,
        objectRef,
        radiusM: options.radiusM
      });
      lastKey = key;
      el.dataset.iqaiCameraQueryFailed = 'false';
    } catch (error) {
      console.warn('[IQAI CAMERA] query-relevant failed; SelectionSet left unchanged', error);
      el.dataset.iqaiCameraQueryFailed = 'true';
      return snapshot();
    } finally {
      querying = false;
    }
    paintSurface(el, snapshot());
    return snapshot();
  }

  paintSurface(el, snapshot());
  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-iqai-camera-coverage-generate]')) {
      event.preventDefault();
      void (async () => {
        const result = await options.generateCoverage?.();
        if (result?.ok === false) {
          el.dataset.iqaiCameraCoverageReason = result.reason || 'FOCUSREF_POINT_REQUIRED';
        } else {
          el.dataset.iqaiCameraCoverageReason = '';
        }
        paintSurface(el, snapshot());
      })();
      return;
    }
    if (event.target.closest('[data-iqai-camera-coverage-clear]')) {
      event.preventDefault();
      void (async () => {
        await options.clearCoverage?.();
        el.dataset.iqaiCameraCoverageReason = 'GENERATED PLAN CLEARED';
        paintSurface(el, snapshot());
      })();
      return;
    }
    if (event.target.closest('[data-iqai-camera-wall-build]')) {
      event.preventDefault();
      void options.buildWall?.();
      return;
    }
    const row = event.target.closest('[data-iqai-camera-relevance-row]');
    if (!row || !el.contains(row)) return;
    const cameraId = row.getAttribute('data-iqai-camera-relevance-row');
    if (cameraId) selectAuthoredCamera(cameraId);
  });

  const unsubQuery = subscribeCameraQuery((next) => paintSurface(el, next));
  const unsubCameras = subscribeAuthoredCameras(() => { void query(true); });
  const unsubWorld = typeof options.chassis?.stateStore?.subscribe === 'function'
    ? options.chassis.stateStore.subscribe(() => { void query(); })
    : () => {};

  void query();

  return Object.freeze({
    snapshot,
    query,
    element: el,
    dispose() {
      unsubQuery();
      unsubCameras();
      unsubWorld();
    }
  });
}
