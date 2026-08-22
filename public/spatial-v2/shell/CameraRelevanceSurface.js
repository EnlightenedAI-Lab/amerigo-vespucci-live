/**
 * Compact production Camera command surface.
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
import { COVERAGE_HONESTY, getLastCoveragePlan, listAutoPlanCameras, rememberedCoverageFocusRef, focusPointFromFocusRef } from '../camera/engine/coverage-plan.js';
import {
  TARGET_GEOMETRY,
  coverageSummaryLabel,
  getCoverageIntentSnapshot,
  setCoverageOrientation,
  setCoveragePattern,
  closeCoveragePolygon,
  undoCoveragePolygonVertex,
  clearCoveragePolygon,
  closePolygonRing,
  subscribeCoverageIntent
} from '../camera/engine/coverage-intent.js';
import {
  getLastVisualCoverage,
  isVisualCoverageSearching,
  subscribeVisualCoverage
} from '../camera/engine/visual-coverage.js';
import { printCameraPlan } from '../camera/engine/plan-print.js';
import { getCameraWallSnapshot, subscribeCameraWall } from '../camera/engine/camera-wall.js';
import { getSlotRepresentationSnapshot, subscribeSlotRepresentations } from '../camera/provider/slot-representations.js';
import { captureTimeLabel } from '../camera/provider/provider-representation.js';
import { recordGuidedGenerateResult } from '../camera/guided-next.js';
import { refreshGuidedNext } from './GuidedNextSurface.js';
import {
  CAMERA_OPERATOR_MODE,
  getCameraOperatorMode,
  setCameraOperatorMode,
  subscribeCameraOperatorMode
} from '../camera/operator-mode.js';

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

function cameraOrdinal(index) {
  return `CAMERA ${String(index + 1).padStart(2, '0')}`;
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
  return relevant.map((item, index) => `
    <button type="button" class="iqai-v2-camera-relevance__row" data-iqai-camera-relevance-row="${item.cameraId || ''}">
      <span>${cameraOrdinal(index)} · ${distanceLabel(item)}</span>
      <span>${item.qualification || 'PLANNED · NOT INSTALLED'}</span>
      <span>${item.compactReason || 'NEARBY'}</span>
      <span>${densityLine(item)}</span>
      <span>${item.cameraId || ''}</span>
    </button>
  `).join('');
}

function collapseCameraCommandPanel(el) {
  const panel = el || document.querySelector('[data-iqai-camera-relevance]');
  if (panel) panel.dataset.iqaiCameraPanelCollapsed = 'true';
}

function revealCameraCommandPanel(el) {
  const panel = el || document.querySelector('[data-iqai-camera-relevance]');
  if (panel) panel.dataset.iqaiCameraPanelCollapsed = 'false';
}

function coverageReasonLabel(reason) {
  if (reason === 'FOCUSREF_POINT_REQUIRED') return 'CLICK THE MAP FIRST';
  if (reason === 'POLYGON_TARGET_REQUIRED') return 'DRAW THE AREA, THEN CLOSE AREA';
  return reason || '';
}

function planHintText(intent, snapshot, plan) {
  if (plan?.ok && Number(plan.cameraCount) >= 3) {
    return `${plan.cameraCount} CAMERAS ON THE MAP — SELECT ONE TO SEE FOV`;
  }
  if (intent.pattern === TARGET_GEOMETRY.PERIMETER) {
    const count = Number(intent.vertexCount) || 0;
    if (closePolygonRing(intent.polygon || intent.vertices)) return 'AREA CLOSED — GENERATE PERIMETER PLAN';
    if (count < 1) return 'CLICK THE MAP — 3 POINTS MINIMUM';
    if (count < 3) return `${count} POINT${count === 1 ? '' : 'S'} — NEED ${3 - count} MORE TO CLOSE`;
    return `${count} POINTS — CLOSE AREA, THEN GENERATE`;
  }
  if (intent.pattern === TARGET_GEOMETRY.FOUR_DIRECTION) {
    return snapshot?.target && !snapshot.target.missing
      ? 'TARGET SET — GENERATE OR CLICK A NEW POINT'
      : 'CLICK ONE POINT ON THE MAP TO PLACE 4 CAMERAS';
  }
  return snapshot?.target && !snapshot.target.missing
    ? 'TARGET SET — GENERATE 3-CAMERA PLAN'
    : 'CLICK ONE POINT ON THE MAP TO PLACE 3 CAMERAS';
}

export function requestCameraCommandPanel() {
  revealCameraCommandPanel();
}

function paintCommand(el, snapshot) {
  const wall = getCameraWallSnapshot();
  const mode = getCameraOperatorMode();
  el.dataset.iqaiCameraOperatorMode = mode.toLowerCase().replaceAll('_', '-');
  const visual = wall.source === 'VISUAL_COVERAGE';
  const reps = getSlotRepresentationSnapshot();
  const active = reps.slots.find((item) => item.slotId === wall.activeSlotId) || null;
  const index = (wall.slots || []).findIndex((slot) => slot.slotId === wall.activeSlotId);
  const ordinal = index >= 0
    ? (visual ? `360 VIEW ${String(index + 1).padStart(2, '0')}` : `PLANNED CAMERA ${String(index + 1).padStart(2, '0')}`)
    : '—';
  const provider = active?.representation?.provider === 'GOOGLE_STREET360'
    ? 'GOOGLE STREET360'
    : (active?.representation?.provider === 'MAPILLARY' ? 'MAPILLARY' : '—');
  const capturedRaw = active?.representation ? captureTimeLabel(active.representation) : '';
  const captured = String(capturedRaw).match(/(\d{4}-\d{2}(?:-\d{2})?)/)?.[1] || '—';
  const activeEl = el.querySelector('[data-iqai-camera-command-active]');
  const providerEl = el.querySelector('[data-iqai-camera-command-provider]');
  const captureEl = el.querySelector('[data-iqai-camera-command-capture]');
  if (activeEl) activeEl.textContent = wall.open ? ordinal : '—';
  if (providerEl) providerEl.textContent = wall.open ? provider : '—';
  if (captureEl) captureEl.textContent = wall.open ? captured : '—';
  const chooser = el.querySelector('[data-iqai-camera-chooser]');
  const lookControls = el.querySelector('[data-iqai-camera-look-around-controls]');
  const planControls = el.querySelector('[data-iqai-camera-plan-controls]');
  const detailsBtn = el.querySelector('[data-iqai-camera-command-details]');
  if (chooser) chooser.hidden = mode !== CAMERA_OPERATOR_MODE.CHOOSER;
  if (lookControls) lookControls.hidden = mode !== CAMERA_OPERATOR_MODE.LOOK_AROUND;
  if (planControls) planControls.hidden = mode !== CAMERA_OPERATOR_MODE.PLAN_CAMERAS;
  if (detailsBtn) detailsBtn.hidden = mode === CAMERA_OPERATOR_MODE.CHOOSER;
  const build = el.querySelector('[data-iqai-camera-wall-build]');
  const close = el.querySelector('[data-iqai-camera-command-close]');
  const visualBuild = el.querySelector('[data-iqai-visual-coverage-build]');
  const retarget = el.querySelector('[data-iqai-visual-coverage-retarget]');
  const visualStatus = el.querySelector('[data-iqai-visual-coverage-status]');
  const relevantCount = Number(snapshot?.relevantCount) || 0;
  const canBuild = wall.open !== true && relevantCount > 0;
  const hasTarget = Boolean(snapshot?.target && !snapshot.target.missing);
  const coverage = getLastVisualCoverage();
  const searching = isVisualCoverageSearching();
  if (build) {
    build.hidden = wall.open === true || mode !== CAMERA_OPERATOR_MODE.PLAN_CAMERAS;
    build.disabled = !canBuild;
    build.setAttribute('aria-disabled', canBuild ? 'false' : 'true');
  }
  if (visualBuild) {
    visualBuild.hidden = true;
    visualBuild.disabled = searching || (wall.open === true);
    visualBuild.textContent = searching ? 'FINDING STREET VIEWS' : 'BUILD 360 COVERAGE';
  }
  if (retarget) retarget.hidden = true;
  if (visualStatus) {
    if (searching) visualStatus.textContent = 'FINDING STREET VIEWS';
    else if (coverage?.ok && coverage.selected?.length) {
      visualStatus.textContent = coverage.coverageSummary
        || `${coverage.selected.length} STREET VIEW${coverage.selected.length === 1 ? '' : 'S'}`;
      if (coverage.coverageLimitation) {
        visualStatus.dataset.iqaiCoverageLimitation = coverage.coverageLimitation;
      } else {
        delete visualStatus.dataset.iqaiCoverageLimitation;
      }
    } else if (coverage?.emptyMessage) visualStatus.textContent = coverage.emptyMessage;
    else visualStatus.textContent = hasTarget
      ? 'FINDING STREET VIEWS'
      : 'CLICK ONE POINT ON THE MAP';
  }
  if (close) close.hidden = true;
}

function paintSurface(el, snapshot) {
  if (!el) return;
  const available = Number(snapshot?.cameraCount) || 0;
  const relevant = Number(snapshot?.relevantCount) || 0;
  const kicker = el.querySelector('[data-iqai-camera-relevance-kicker]');
  const counts = el.querySelector('[data-iqai-camera-relevance-counts]');
  const rows = el.querySelector('[data-iqai-camera-relevance-list]');
  const footer = el.querySelector('[data-iqai-camera-relevance-honesty]');
  if (kicker) {
    kicker.textContent = getCameraOperatorMode() === CAMERA_OPERATOR_MODE.LOOK_AROUND
      ? 'LOOK AROUND'
      : (getCameraOperatorMode() === CAMERA_OPERATOR_MODE.PLAN_CAMERAS ? 'PLAN CAMERAS' : 'CAMERA');
  }
  if (counts) {
    counts.hidden = getCameraOperatorMode() !== CAMERA_OPERATOR_MODE.PLAN_CAMERAS;
    counts.textContent = `${available} AVAILABLE · ${relevant} RELEVANT`;
    counts.dataset.iqaiCameraRelevanceCount = String(available);
    counts.dataset.iqaiCameraRelevanceRelevant = String(relevant);
  }
  if (rows) rows.innerHTML = renderRows(snapshot);
  if (footer) footer.textContent = 'PLANNED · NOT INSTALLED · LOCAL PERSISTENCE · PLAN GEOMETRY · VISIBILITY NOT TESTED';
  const status = el.querySelector('[data-iqai-camera-coverage-status]');
  const plan = getLastCoveragePlan();
  const intent = getCoverageIntentSnapshot();
  if (status) {
    status.textContent = plan?.ok
      ? `${coverageSummaryLabel(plan.coverageIntent || intent)} · ${plan.planStatus || 'GENERATED'} · ${plan.honesty || COVERAGE_HONESTY}`
      : (el.dataset.iqaiCameraCoverageReason || '2D CANDIDATE PLACEMENT · NOT INSTALLATION SITING · VISIBILITY NOT TESTED');
  }
  const summary = el.querySelector('[data-iqai-coverage-summary]');
  if (summary) {
    summary.textContent = plan?.ok
      ? `${coverageSummaryLabel(plan.coverageIntent || intent)}${plan.operatorAdjusted ? ' · OPERATOR ADJUSTED' : ''}`
      : (coverageReasonLabel(el.dataset.iqaiCameraCoverageReason) || coverageSummaryLabel(intent));
  }
  const hint = el.querySelector('[data-iqai-camera-plan-hint]');
  if (hint) hint.textContent = planHintText(intent, snapshot, plan);
  const generateBtn = el.querySelector('[data-iqai-camera-coverage-generate]');
  if (generateBtn && generateBtn.getAttribute('aria-label') === 'GENERATE CAMERA COVERAGE') {
    generateBtn.textContent = intent.pattern === TARGET_GEOMETRY.FOUR_DIRECTION
      ? 'GENERATE 4-CAMERA PLAN'
      : (intent.pattern === TARGET_GEOMETRY.PERIMETER ? 'GENERATE PERIMETER PLAN' : 'GENERATE 3-CAMERA PLAN');
    const hasTarget = Boolean(snapshot?.target && !snapshot.target.missing);
    const perimeterReady = Boolean(closePolygonRing(intent.polygon || intent.vertices));
    const canGenerate = intent.pattern === TARGET_GEOMETRY.PERIMETER ? perimeterReady : hasTarget;
    generateBtn.disabled = !canGenerate;
    generateBtn.setAttribute('aria-disabled', canGenerate ? 'false' : 'true');
  }
  const closeArea = el.querySelector('[data-iqai-coverage-close-polygon]');
  if (closeArea) {
    const canClose = Number(intent.vertexCount) >= 3;
    closeArea.disabled = !canClose;
    closeArea.setAttribute('aria-disabled', canClose ? 'false' : 'true');
  }
  const undoVertex = el.querySelector('[data-iqai-coverage-undo-vertex]');
  if (undoVertex) {
    const canUndo = Number(intent.vertexCount) > 0;
    undoVertex.disabled = !canUndo;
  }
  const perimeterHint = el.querySelector('[data-iqai-coverage-perimeter-hint]');
  if (perimeterHint) {
    const count = Number(intent.vertexCount) || 0;
    perimeterHint.textContent = count < 1
      ? 'CLICK THE MAP TO DRAW A TARGET AREA'
      : `${count} POINT${count === 1 ? '' : 'S'} ON THE RING`;
  }
  const orientationRow = el.querySelector('[data-iqai-coverage-orientation-row]');
  if (orientationRow) orientationRow.hidden = intent.pattern === TARGET_GEOMETRY.POINT;
  const perimeterDraw = el.querySelector('[data-iqai-coverage-perimeter-draw]');
  if (perimeterDraw) perimeterDraw.hidden = intent.pattern !== TARGET_GEOMETRY.PERIMETER;
  for (const btn of el.querySelectorAll('[data-iqai-coverage-pattern]')) {
    btn.setAttribute('aria-pressed', btn.getAttribute('data-iqai-coverage-pattern') === intent.pattern ? 'true' : 'false');
  }
  for (const btn of el.querySelectorAll('[data-iqai-coverage-orientation]')) {
    btn.setAttribute('aria-pressed', btn.getAttribute('data-iqai-coverage-orientation') === intent.orientationIntent ? 'true' : 'false');
  }
  const list = el.querySelector('[data-iqai-plan-camera-list]');
  if (list) {
    const cameras = listAutoPlanCameras();
    list.hidden = cameras.length < 1;
    list.innerHTML = cameras.map((camera, index) => `
      <button type="button" class="iqai-v2-coverage-camera" data-iqai-plan-camera-select="${camera.cameraId}">
        CAMERA ${String(index + 1).padStart(2, '0')}
      </button>
    `).join('');
  }
  paintCommand(el, snapshot);
  const viz = document.getElementById('iqai-spatial-v2')?.dataset?.iqaiCameraViz === 'true';
  for (const btn of el.querySelectorAll('[data-iqai-camera-exit-mode]')) {
    btn.hidden = viz;
  }
  const clearAll = el.querySelector('[data-iqai-camera-clear-all]');
  if (clearAll) {
    clearAll.hidden = false;
    clearAll.textContent = available > 0 ? `DELETE ALL CAMERAS (${available})` : 'DELETE ALL CAMERAS';
  }
  el.hidden = false;
}

export function renderCameraRelevanceSurface() {
  return `
    <aside class="iqai-v2-camera-relevance" data-iqai-camera-relevance data-iqai-camera-command data-iqai-camera-operator-mode="chooser" aria-label="Camera command">
      <p class="iqai-v2-camera-relevance__kicker" data-iqai-camera-relevance-kicker>CAMERA</p>
      <p data-iqai-camera-relevance-counts hidden>0 AVAILABLE · 0 RELEVANT</p>
      <p class="iqai-v2-camera-command__label" data-iqai-camera-engineering-label hidden>ACTIVE</p>
      <p data-iqai-camera-command-active hidden>—</p>
      <p class="iqai-v2-camera-command__label" data-iqai-camera-engineering-label hidden>PROVIDER</p>
      <p data-iqai-camera-command-provider hidden>—</p>
      <p class="iqai-v2-camera-command__label" data-iqai-camera-engineering-label hidden>CAPTURE</p>
      <p data-iqai-camera-command-capture hidden>—</p>
      <section class="iqai-v2-camera-chooser" data-iqai-camera-chooser>
        <button type="button" class="iqai-v2-camera-chooser__choice" data-iqai-camera-look-around>
          <span class="iqai-v2-camera-chooser__title">LOOK AROUND A LOCATION</span>
          <span class="iqai-v2-camera-chooser__hint">Show real street imagery around here.</span>
        </button>
        <button type="button" class="iqai-v2-camera-chooser__choice" data-iqai-camera-plan-cameras>
          <span class="iqai-v2-camera-chooser__title">PLAN CAMERAS</span>
          <span class="iqai-v2-camera-chooser__hint">Engineer camera positions and fields of view.</span>
        </button>
      </section>
      <section class="iqai-v2-camera-workflow" data-iqai-camera-look-around-controls hidden>
        <p class="iqai-v2-camera-workflow__title">LOOK AROUND A LOCATION</p>
        <p class="iqai-v2-camera-workflow__hint">Show real street imagery around here.</p>
        <p class="iqai-v2-camera-relevance__note" data-iqai-visual-coverage-status>CLICK ONE POINT ON THE MAP</p>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-change-target>CHANGE TARGET</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-exit-mode>EXIT CAMERA MODE</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-visual-coverage-build hidden>BUILD 360 COVERAGE</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-visual-coverage-retarget hidden>CHOOSE NEW TARGET</button>
      </section>
      <section class="iqai-v2-camera-workflow" data-iqai-camera-plan-controls data-iqai-camera-workflow="plan" hidden>
        <p class="iqai-v2-camera-workflow__title">PLAN CAMERAS</p>
        <p class="iqai-v2-camera-workflow__hint" data-iqai-camera-plan-hint>CLICK ONE POINT ON THE MAP TO PLACE 4 CAMERAS</p>
        <p class="iqai-v2-coverage-label">WHAT ARE YOU COVERING?</p>
        <div class="iqai-v2-coverage-chooser" data-iqai-coverage-pattern-row>
          <button type="button" class="iqai-v2-coverage-chip" data-iqai-coverage-pattern="POINT" aria-pressed="false">POINT</button>
          <button type="button" class="iqai-v2-coverage-chip" data-iqai-coverage-pattern="FOUR_DIRECTION" aria-pressed="true">FOUR SIDES</button>
          <button type="button" class="iqai-v2-coverage-chip" data-iqai-coverage-pattern="PERIMETER" aria-pressed="false">PERIMETER</button>
        </div>
        <div class="iqai-v2-coverage-orientation" data-iqai-coverage-orientation-row hidden>
          <p class="iqai-v2-coverage-label">CAMERAS LOOK:</p>
          <div class="iqai-v2-coverage-chooser">
            <button type="button" class="iqai-v2-coverage-chip" data-iqai-coverage-orientation="INWARD" aria-pressed="true">INWARD</button>
            <button type="button" class="iqai-v2-coverage-chip" data-iqai-coverage-orientation="OUTWARD" aria-pressed="false">OUTWARD</button>
          </div>
        </div>
        <div class="iqai-v2-coverage-perimeter" data-iqai-coverage-perimeter-draw hidden>
          <p class="iqai-v2-camera-workflow__hint" data-iqai-coverage-perimeter-hint>CLICK THE MAP TO DRAW A TARGET AREA</p>
          <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-coverage-close-polygon>CLOSE AREA</button>
          <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-coverage-undo-vertex>UNDO POINT</button>
          <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-coverage-clear-polygon>CLEAR AREA</button>
        </div>
        <p class="iqai-v2-coverage-summary" data-iqai-coverage-summary>FOUR-DIRECTION · 4 CAMERAS · INWARD</p>
        <button type="button" class="iqai-v2-camera-relevance__build iqai-v2-camera-relevance__build--primary" data-iqai-camera-coverage-generate aria-label="GENERATE CAMERA COVERAGE">GENERATE 4-CAMERA PLAN</button>
        <div class="iqai-v2-coverage-cameras" data-iqai-plan-camera-list hidden></div>
        <div class="iqai-v2-camera-plan-more" data-iqai-camera-plan-more>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-plan-place>PLACE ONE CAMERA</button>
        <span hidden>GENERATE 3-CAMERA PLAN</span>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-plan-edit>EDIT PLANNED CAMERA</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-coverage-clear>CLEAR GENERATED PLAN</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-plan-print>PRINT PLAN</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-wall-build>BUILD RELEVANT WALL</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-exit-mode>EXIT CAMERA MODE</button>
        </div>
        <span hidden>GENERATE CAMERA COVERAGE</span>
        <span hidden>PLACE CAMERA</span>
      </section>
      <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-command-close hidden>CLOSE WALL</button>
      <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-command-details hidden aria-expanded="false">DETAILS</button>
      <div class="iqai-v2-camera-command__details" data-iqai-camera-command-details-panel hidden>
        <div data-iqai-camera-relevance-list>
          <p data-iqai-camera-relevance-empty>WAITING FOR FOCUS OR SELECTION</p>
        </div>
        <p class="iqai-v2-camera-relevance__note" data-iqai-camera-relevance-honesty>PLANNED · NOT INSTALLED · LOCAL PERSISTENCE · PLAN GEOMETRY · VISIBILITY NOT TESTED</p>
        <p class="iqai-v2-camera-relevance__note" data-iqai-camera-coverage-status>2D CANDIDATE PLACEMENT · NOT INSTALLATION SITING · VISIBILITY NOT TESTED</p>
      </div>
      <div class="iqai-v2-camera-panel-peek" data-iqai-camera-panel-show hidden>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-panel-look>LOOK</button>
        <button type="button" class="iqai-v2-camera-relevance__build" data-iqai-camera-panel-open>PLAN</button>
      </div>
      <button type="button" class="iqai-v2-camera-relevance__build iqai-v2-camera-relevance__clear-all" data-iqai-camera-clear-all>DELETE ALL CAMERAS</button>
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
  revealCameraCommandPanel(el);
  let lastKey = '';

  function snapshot() {
    return getLastCameraQuerySnapshot();
  }

  async function query(force = false) {
    const chassis = options.chassis;
    if (!chassis || typeof chassis.executeChassis !== 'function') return snapshot();
    const world = chassis.stateStore.getSnapshot();
    const objectRef = primaryObjectRef(world);
    const worldFocus = focusPointFromFocusRef(world.activeFocus) ? world.activeFocus : null;
    const rememberedFocus = worldFocus ? null : rememberedCoverageFocusRef();
    const focusRef = worldFocus || rememberedFocus;
    const rememberedPoint = rememberedFocus?.geometry?.coordinates;
    const key = [
      objectRef ? objectRefKey(objectRef) : '',
      worldFocus?.focusId || (rememberedPoint
        ? `plan:${rememberedPoint[0]},${rememberedPoint[1]}`
        : ''),
      world.revision
    ].join('::');
    if (!force && key === lastKey) return snapshot();
    try {
      await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
        focusRef,
        objectRef,
        radiusM: options.radiusM
      });
      lastKey = key;
      el.dataset.iqaiCameraQueryFailed = 'false';
      el.dataset.iqaiCameraQueryTarget = worldFocus
        ? 'WORLD_FOCUS'
        : (rememberedFocus ? 'AUTO_PLAN_TARGET' : 'NONE');
    } catch (error) {
      console.warn('[IQAI CAMERA] query-relevant failed; SelectionSet left unchanged', error);
      el.dataset.iqaiCameraQueryFailed = 'true';
      return snapshot();
    }
    paintSurface(el, snapshot());
    return snapshot();
  }

  paintSurface(el, snapshot());

  async function enterLookAround() {
    setCameraOperatorMode(CAMERA_OPERATOR_MODE.LOOK_AROUND);
    void options.disarmPlaceCamera?.();
    const snap = snapshot();
    const hasTarget = Boolean(snap?.target && !snap.target.missing);
    revealCameraCommandPanel(el);
    paintSurface(el, snap);
    refreshGuidedNext();
    if (hasTarget) {
      await options.buildVisualCoverage?.();
      paintSurface(el, snapshot());
      refreshGuidedNext();
      return;
    }
    void options.chooseNewTarget?.();
  }

  async function enterPlanCameras() {
    setCameraOperatorMode(CAMERA_OPERATOR_MODE.PLAN_CAMERAS);
    setCoveragePattern(TARGET_GEOMETRY.FOUR_DIRECTION);
    void options.disarmPlaceCamera?.();
    void options.chooseNewTarget?.();
    revealCameraCommandPanel(el);
    paintSurface(el, snapshot());
    refreshGuidedNext();
  }

  async function runGenerateCoverage() {
    const result = await options.generateCoverage?.();
    recordGuidedGenerateResult(result);
    el.dataset.iqaiCameraCoverageReason = result?.ok === false
      ? (result.reason || 'FOCUSREF_POINT_REQUIRED')
      : '';
    paintSurface(el, snapshot());
    refreshGuidedNext();
    return result;
  }

  async function changeTarget() {
    await options.closeWall?.();
    setCameraOperatorMode(CAMERA_OPERATOR_MODE.LOOK_AROUND);
    void options.chooseNewTarget?.();
    revealCameraCommandPanel(el);
    paintSurface(el, snapshot());
    refreshGuidedNext();
  }

  async function exitCameraMode() {
    await options.closeWall?.();
    setCameraOperatorMode(CAMERA_OPERATOR_MODE.CHOOSER);
    revealCameraCommandPanel(el);
    void options.disarmDropPin?.();
    void options.disarmPlaceCamera?.();
    paintSurface(el, snapshot());
    refreshGuidedNext();
  }

  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-iqai-camera-panel-open]')) {
      event.preventDefault();
      void enterPlanCameras();
      return;
    }
    if (event.target.closest('[data-iqai-camera-panel-look]')) {
      event.preventDefault();
      void enterLookAround();
      return;
    }
    if (event.target.closest('[data-iqai-camera-look-around]')) {
      event.preventDefault();
      void enterLookAround();
      return;
    }
    if (event.target.closest('[data-iqai-camera-plan-cameras]')) {
      event.preventDefault();
      void enterPlanCameras();
      return;
    }
    if (event.target.closest('[data-iqai-camera-change-target]')) {
      event.preventDefault();
      void changeTarget();
      return;
    }
    if (event.target.closest('[data-iqai-camera-exit-mode]')) {
      event.preventDefault();
      void exitCameraMode();
      return;
    }
    if (event.target.closest('[data-iqai-coverage-pattern]')) {
      event.preventDefault();
      const next = event.target.closest('[data-iqai-coverage-pattern]').getAttribute('data-iqai-coverage-pattern');
      setCoveragePattern(next);
      if (next === TARGET_GEOMETRY.PERIMETER) {
        void options.disarmPlaceCamera?.();
        void options.disarmDropPin?.();
        void options.armCoveragePolygon?.();
      } else {
        void options.disarmCoveragePolygon?.();
        void options.disarmPlaceCamera?.();
        void options.chooseNewTarget?.();
      }
      paintSurface(el, snapshot());
      refreshGuidedNext();
      return;
    }
    if (event.target.closest('[data-iqai-coverage-orientation]')) {
      event.preventDefault();
      setCoverageOrientation(event.target.closest('[data-iqai-coverage-orientation]').getAttribute('data-iqai-coverage-orientation'));
      paintSurface(el, snapshot());
      return;
    }
    if (event.target.closest('[data-iqai-coverage-close-polygon]')) {
      event.preventDefault();
      closeCoveragePolygon();
      paintSurface(el, snapshot());
      return;
    }
    if (event.target.closest('[data-iqai-coverage-undo-vertex]')) {
      event.preventDefault();
      undoCoveragePolygonVertex();
      paintSurface(el, snapshot());
      return;
    }
    if (event.target.closest('[data-iqai-coverage-clear-polygon]')) {
      event.preventDefault();
      clearCoveragePolygon();
      paintSurface(el, snapshot());
      return;
    }
    if (event.target.closest('[data-iqai-plan-camera-select]')) {
      event.preventDefault();
      const cameraId = event.target.closest('[data-iqai-plan-camera-select]').getAttribute('data-iqai-plan-camera-select');
      if (cameraId) selectAuthoredCamera(cameraId);
      return;
    }
    if (event.target.closest('[data-iqai-camera-plan-edit]')) {
      event.preventDefault();
      void options.armPlaceCamera?.();
      return;
    }
    if (event.target.closest('[data-iqai-camera-command-details]')) {
      event.preventDefault();
      const panel = el.querySelector('[data-iqai-camera-command-details-panel]');
      const open = panel?.hidden !== false ? true : panel.hidden === true;
      if (panel) panel.hidden = !panel.hidden;
      const btn = el.querySelector('[data-iqai-camera-command-details]');
      if (btn) btn.setAttribute('aria-expanded', panel?.hidden ? 'false' : 'true');
      void open;
      return;
    }
    if (event.target.closest('[data-iqai-camera-coverage-generate]')) {
      event.preventDefault();
      void runGenerateCoverage();
      return;
    }
    if (event.target.closest('[data-iqai-camera-coverage-clear]')) {
      event.preventDefault();
      void (async () => {
        await options.clearCoverage?.();
        recordGuidedGenerateResult({ ok: true });
        el.dataset.iqaiCameraCoverageReason = 'GENERATED PLAN CLEARED';
        revealCameraCommandPanel(el);
        paintSurface(el, snapshot());
        refreshGuidedNext();
      })();
      return;
    }
    if (event.target.closest('[data-iqai-camera-clear-all]')) {
      event.preventDefault();
      void (async () => {
        await options.clearAllCameras?.();
        recordGuidedGenerateResult({ ok: true });
        el.dataset.iqaiCameraCoverageReason = 'ALL CAMERAS DELETED';
        paintSurface(el, snapshot());
        refreshGuidedNext();
      })();
      return;
    }
    if (event.target.closest('[data-iqai-camera-plan-print]')) {
      event.preventDefault();
      printCameraPlan();
      return;
    }
    if (event.target.closest('[data-iqai-camera-plan-place]')) {
      event.preventDefault();
      void options.armPlaceCamera?.();
      return;
    }
    if (event.target.closest('[data-iqai-visual-coverage-build]')) {
      event.preventDefault();
      void (async () => {
        paintSurface(el, snapshot());
        const result = await options.buildVisualCoverage?.();
        paintSurface(el, snapshot());
        refreshGuidedNext();
        void result;
      })();
      return;
    }
    if (event.target.closest('[data-iqai-visual-coverage-retarget]')) {
      event.preventDefault();
      void options.chooseNewTarget?.();
      refreshGuidedNext();
      return;
    }
    if (event.target.closest('[data-iqai-camera-wall-build]')) {
      event.preventDefault();
      void options.buildWall?.();
      return;
    }
    if (event.target.closest('[data-iqai-camera-command-close]')) {
      event.preventDefault();
      void options.closeWall?.();
      return;
    }
    const row = event.target.closest('[data-iqai-camera-relevance-row]');
    if (!row || !el.contains(row)) return;
    const cameraId = row.getAttribute('data-iqai-camera-relevance-row');
    if (cameraId) selectAuthoredCamera(cameraId);
  });

  const onReveal = () => revealCameraCommandPanel(el);
  const rootEl = el.closest('#iqai-spatial-v2') || document.getElementById('iqai-spatial-v2');
  rootEl?.addEventListener('iqai-camera-command-reveal', onReveal);

  const unsubQuery = subscribeCameraQuery((next) => paintSurface(el, next));
  const unsubCameras = subscribeAuthoredCameras(() => { void query(true); });
  const unsubWall = subscribeCameraWall(() => paintCommand(el, snapshot()));
  const unsubRep = subscribeSlotRepresentations(() => paintCommand(el, snapshot()));
  const unsubVisual = subscribeVisualCoverage(() => paintCommand(el, snapshot()));
  const unsubWorld = typeof options.chassis?.stateStore?.subscribe === 'function'
    ? options.chassis.stateStore.subscribe(() => { void query(); })
    : () => {};

  const unsubMode = subscribeCameraOperatorMode(() => paintSurface(el, snapshot()));
  const unsubIntent = subscribeCoverageIntent(() => paintSurface(el, snapshot()));
  void query();

  return Object.freeze({
    snapshot,
    query,
    enterLookAround,
    enterPlanCameras,
    changeTarget,
    exitCameraMode,
    buildVisualCoverage: () => options.buildVisualCoverage?.(),
    generateCoverage: () => runGenerateCoverage(),
    element: el,
    dispose() {
      unsubQuery();
      unsubCameras();
      unsubWall();
      unsubRep();
      unsubVisual();
      unsubWorld();
      unsubMode();
      unsubIntent();
      rootEl?.removeEventListener('iqai-camera-command-reveal', onReveal);
    }
  });
}
