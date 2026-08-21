/**
 * Camera Wall: visualization-first 3-UP provider views.
 * Presentation only. Occupies the STREET 360 pane. Does not mutate CameraPose.
 * TRI-VIEW heavy budget is evaluated at runtime; outside 3-UP budget returns to 1.
 */

import { PLAN_GEOMETRY_HONESTY, VISIBILITY_NOT_TESTED_LABEL } from '../camera/engine/relevance-constants.js';
import { getLastVisualCoverage, isVisualCoverageSearching, VISUAL_COVERAGE_HONESTY } from '../camera/engine/visual-coverage.js';
import {
  buildRelevantCameraWall,
  buildVisualCoverageWall,
  closeCameraWall,
  enlargeWallSlot,
  getCameraWallSnapshot,
  relevantCameraIdsFromQuery,
  restoreWallTriView,
  setActiveSlot,
  subscribeCameraWall
} from '../camera/engine/camera-wall.js';
import { getLastCameraQuerySnapshot } from '../camera/spatial-camera-adapter.js';
import { getAuthoredCamera, selectAuthoredCamera } from '../map/authored-cameras.js';
import { geodesicMeters } from '../camera/engine/geodesy.js';
import {
  captureOffsetLabel,
  captureTimeLabel
} from '../camera/provider/provider-representation.js';
import {
  attachRepresentationsForWall,
  attachVisualCoverageToWall,
  getRepresentationAttachStatus,
  getSlotRepresentation,
  getSlotRepresentationSnapshot,
  resetSlotRepresentations,
  selectSlotCaptureDate,
  selectSlotProvider,
  subscribeSlotRepresentations
} from '../camera/provider/slot-representations.js';
import {
  activateWallHeavyViewer,
  applyWallHeavyVirtualView,
  getLiveHeavyViewerCount,
  getTriViewHeavyReport,
  getViewerPaneStates,
  getWallHeavyVirtualView,
  parkAllWallHeavyViewers,
  parkWallHeavyViewer,
  recordTriViewHeavyReport,
  recoverWallHeavyViewers,
  resizeWallHeavyViewer,
  setViewerPaneState,
  subscribeWallHeavyVirtualView,
  VIEWER_PANE_STATE
} from '../camera/provider/heavy-viewer.js';
import {
  DATE_SEARCH_HONESTY,
  GOOGLE_DATE_LIMIT,
  calendarMonth,
  captureDay,
  captureYear
} from '../camera/provider/capture-catalog.js';
import { printCameraPlan } from '../camera/engine/plan-print.js';
import { markGuidedSlotInspected } from '../camera/guided-next.js';
import { CAMERA_OPERATOR_MODE, getCameraOperatorMode } from '../camera/operator-mode.js';
import { refreshGuidedNext } from './GuidedNextSurface.js';

function distanceLabel(item, slot = null) {
  const pack = slot?.slotId
    ? getSlotRepresentationSnapshot().slots.find((row) => row.slotId === slot.slotId)
    : null;
  const packMeters = Number(pack?.representation?.distanceMeters);
  if (Number.isFinite(packMeters)) return `${Math.round(packMeters)} m`;
  const meters = Number(item?.planDistanceM);
  if (!Number.isFinite(meters)) return '—';
  return `${Math.round(meters)} m`;
}

function relevanceFor(cameraId) {
  const query = getLastCameraQuerySnapshot();
  const rows = [...(query?.relevant || []), ...(query?.results || [])];
  return rows.find((item) => item.cameraId === cameraId || item.cameraRef?.cameraId === cameraId) || null;
}

function cameraOrdinal(index) {
  return `PLANNED CAMERA ${String(index + 1).padStart(2, '0')}`;
}

function viewOrdinal(index) {
  return `360 VIEW ${String(index + 1).padStart(2, '0')}`;
}

function slotOrdinal(index, wall) {
  return wall?.source === 'VISUAL_COVERAGE' ? viewOrdinal(index) : cameraOrdinal(index);
}

function emptyWallMessage() {
  const visual = getLastVisualCoverage();
  if (visual?.ok === false && visual.emptyMessage) return visual.emptyMessage;
  if (visual?.ok === false) return `NO STREET 360 REPRESENTATION FOUND WITHIN ${visual.chosenRadiusM || visual.maxRadiusM || 250} m`;
  return 'NO RELEVANT CAMERAS';
}

function formatVirtualView(view) {
  if (!view) return 'VIRTUAL VIEW · PAN / TILT / ZOOM';
  const heading = Number.isFinite(Number(view.heading)) ? `${Math.round(view.heading)}°` : '—';
  const pitch = Number.isFinite(Number(view.pitch)) ? `${Math.round(view.pitch)}°` : '—';
  const zoom = Number.isFinite(Number(view.zoom)) ? String(Math.round(Number(view.zoom) * 10) / 10) : '—';
  return `VIRTUAL VIEW · HDG ${heading} · PITCH ${pitch} · VIRTUAL ZOOM ${zoom}`;
}

function packFor(slot) {
  return getSlotRepresentationSnapshot().slots.find((item) => item.slotId === slot.slotId) || null;
}

function selectedRepresentation(slot) {
  const snap = packFor(slot);
  return snap?.representation || snap?.google || snap?.mapillary || null;
}

function compactProvider(slot) {
  const selected = selectedRepresentation(slot);
  if (selected?.provider === 'GOOGLE_STREET360') return 'GOOGLE 360 REPRESENTATION';
  if (selected?.provider === 'MAPILLARY') return selected.isPano ? 'MAPILLARY 360 REPRESENTATION' : 'MAPILLARY IMAGE REPRESENTATION';
  if (getRepresentationAttachStatus().inFlight) return 'LOADING';
  return 'UNAVAILABLE';
}

function captureOffsetMeters(slot) {
  const selected = selectedRepresentation(slot);
  const capture = selected?.captureCoordinate;
  const camera = slot?.cameraRef ? getAuthoredCamera(slot.cameraRef) : null;
  if (camera && capture) {
    const meters = geodesicMeters(camera, capture);
    if (Number.isFinite(meters)) return Math.round(meters);
  }
  const stored = Number(selected?.distanceMeters);
  return Number.isFinite(stored) ? Math.round(stored) : null;
}

function compactOffset(slot, wall) {
  if (wall?.source === 'VISUAL_COVERAGE') return '';
  const meters = captureOffsetMeters(slot);
  if (meters == null) return '';
  return `CAPTURE OFFSET: ${meters} m`;
}

function compactCapture(slot) {
  const selected = selectedRepresentation(slot);
  const label = selected ? captureTimeLabel(selected) : '';
  const match = String(label).match(/(\d{4}-\d{2}(?:-\d{2})?)/);
  return match ? match[1] : '—';
}

function paintDateChrome(pane, slot, wall) {
  const host = pane?.querySelector('[data-iqai-camera-date]');
  if (!host) return;
  const focused = document.activeElement;
  if (focused && host.contains(focused) && focused.matches('[data-iqai-camera-date-input]')) return;
  const pack = getSlotRepresentation(slot.slotId) || {};
  const catalog = pack.catalog || { dates: [], years: [], searchable: false };
  const selected = selectedRepresentation(slot);
  const current = pack.nearestDate || captureDay(selected?.capturedAt || selected?.capturedAtIso);
  const year = captureYear(current) || catalog.years?.[catalog.years.length - 1] || '';
  const searchable = catalog.searchable === true;
  const enlarged = wall?.enlargedSlotId === slot.slotId;
  if (!enlarged) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.hidden = false;
  const monthKey = current ? current.slice(0, 7) : (catalog.dates.at(-1)?.month || '');
  const cal = searchable && enlarged ? calendarMonth(catalog, monthKey) : null;
  const years = (catalog.years || []).map((item) => (
    `<button type="button" data-iqai-camera-date-year="${item}" data-iqai-camera-date-slot="${slot.slotId}" aria-pressed="${item === year ? 'true' : 'false'}">${item}</button>`
  )).join('');
  const days = (cal?.cells || []).map((cell) => {
    if (cell.empty) return '<span class="iqai-v2-camera-date__empty"></span>';
    if (!cell.available) return `<span class="iqai-v2-camera-date__muted">${cell.day}</span>`;
    return `<button type="button" data-iqai-camera-date-day="${cell.date}" data-iqai-camera-date-slot="${slot.slotId}" aria-pressed="${cell.date === current ? 'true' : 'false'}">${cell.day}</button>`;
  }).join('');
  const film = searchable && enlarged
    ? (catalog.dates || []).slice(-8).map((item) => `
        <button type="button" class="iqai-v2-camera-date__thumb" data-iqai-camera-date-day="${item.date}" data-iqai-camera-date-slot="${slot.slotId}" title="${item.date}">
          ${item.thumbUrl ? `<img alt="" src="${item.thumbUrl}">` : ''}
          <span>${item.year}</span>
        </button>
      `).join('')
    : '';
  const availableDays = !enlarged && searchable
    ? (catalog.dates || []).slice(-6).map((item) => (
      `<button type="button" data-iqai-camera-date-day="${item.date}" data-iqai-camera-date-slot="${slot.slotId}" aria-pressed="${item.date === current ? 'true' : 'false'}">${item.date}</button>`
    )).join('')
    : '';
  const nearest = pack.exactDate === false && pack.nearestDate ? `NEAREST AVAILABLE ${pack.nearestDate}` : '';
  host.innerHTML = `
    <p class="iqai-v2-camera-date__year">${year || 'YEAR —'}</p>
    <p class="iqai-v2-camera-date__honesty">${searchable ? DATE_SEARCH_HONESTY : (catalog.googleLimit || GOOGLE_DATE_LIMIT)}</p>
    <label class="iqai-v2-camera-date__go">DATE
      <input type="date" data-iqai-camera-date-input data-iqai-camera-date-slot="${slot.slotId}" value="${current || ''}" ${searchable ? '' : 'disabled'}>
    </label>
    <div class="iqai-v2-camera-date__years">${years || '<span>NO YEARS</span>'}</div>
    ${availableDays ? `<div class="iqai-v2-camera-date__years">${availableDays}</div>` : ''}
    ${cal ? `<div class="iqai-v2-camera-date__cal">${days}</div>` : ''}
    ${nearest ? `<p class="iqai-v2-camera-date__nearest">${nearest}</p>` : ''}
    ${film ? `<div class="iqai-v2-camera-date__film">${film}</div>` : ''}
  `;
}

function selectorState(slot, wall) {
  if (wall?.enlargedSlotId === slot.slotId) return 'ENLARGED';
  if (slot.active) return 'ACTIVE';
  return compactProvider(slot) === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
}

function renderPane(slot, index, wall) {
  const item = relevanceFor(slot.cameraRef);
  const ordinal = slotOrdinal(index, wall);
  const enlarged = wall?.enlargedSlotId === slot.slotId;
  return `
    <article class="iqai-v2-camera-wall__pane${slot.active ? ' is-active' : ''}${enlarged ? ' is-enlarged' : ''}" data-iqai-camera-wall-pane="${slot.slotId}" data-iqai-camera-wall-slot="${slot.slotId}" data-iqai-camera-wall-selector="${index + 1}" data-iqai-camera-wall-id="${slot.cameraRef || slot.visualViewpointId || ''}"${slot.active ? ' data-iqai-camera-wall-heavy-slot="true"' : ''} title="${ordinal}">
      <header class="iqai-v2-camera-wall__pane-head">
        <span data-iqai-camera-wall-selector-label>${String(index + 1).padStart(2, '0')}</span>
        <button type="button" class="iqai-v2-camera-wall__enlarge" data-iqai-camera-wall-enlarge="${slot.slotId}" title="Enlarge ${ordinal}" aria-label="Enlarge ${ordinal}">⛶</button>
      </header>
      <p data-iqai-camera-wall-selector-provider>${compactProvider(slot)}</p>
      <p data-iqai-camera-wall-selector-captured>${compactCapture(slot)}</p>
      <p data-iqai-camera-wall-selector-offset>${compactOffset(slot, wall)}</p>
      <span hidden data-iqai-camera-wall-selector-distance>${distanceLabel(item, slot)}</span>
      <span hidden data-iqai-camera-wall-selector-state>${selectorState(slot, wall)}</span>
      <div class="iqai-v2-camera-date" data-iqai-camera-date="${slot.slotId}"></div>
      <div class="iqai-v2-camera-wall__heavy-stage" data-iqai-camera-wall-heavy-stage data-iqai-camera-wall-pane-stage="${slot.slotId}">
        <p class="iqai-v2-camera-wall__viewer-state" data-iqai-viewer-state="LOADING">LOADING CAMERA VIEW</p>
      </div>
    </article>
  `;
}

function paintSlots(el, wall) {
  const slots = el.querySelector('[data-iqai-camera-wall-slots]');
  if (!slots) return;
  const open = wall?.open === true;
  const count = wall?.slotCount || 0;
  const ids = open ? (wall.slots || []).map((slot) => slot.slotId).join('|') : '';
  slots.style.setProperty('--iqai-camera-wall-cols', String(Math.max(1, wall?.layout || count || 1)));
  if (slots.dataset.iqaiCameraWallSlotIds === ids && ids) {
    (wall.slots || []).forEach((slot, index) => {
      const pane = slots.querySelector(`[data-iqai-camera-wall-pane="${slot.slotId}"]`);
      if (!pane) return;
      pane.classList.toggle('is-active', slot.active === true);
      pane.classList.toggle('is-enlarged', wall.enlargedSlotId === slot.slotId);
      pane.classList.toggle('is-parked', Boolean(wall.enlargedSlotId) && wall.enlargedSlotId !== slot.slotId);
      pane.hidden = false;
      const provider = pane.querySelector('[data-iqai-camera-wall-selector-provider]');
      const captured = pane.querySelector('[data-iqai-camera-wall-selector-captured]');
      const state = pane.querySelector('[data-iqai-camera-wall-selector-state]');
      if (provider) provider.textContent = compactProvider(slot);
      if (captured) captured.textContent = compactCapture(slot);
      const offset = pane.querySelector('[data-iqai-camera-wall-selector-offset]');
      if (offset) offset.textContent = compactOffset(slot, wall);
      if (state) state.textContent = selectorState(slot, wall);
      if (slot.active) pane.setAttribute('data-iqai-camera-wall-heavy-slot', 'true');
      else pane.removeAttribute('data-iqai-camera-wall-heavy-slot');
      const item = relevanceFor(slot.cameraRef);
      const distance = pane.querySelector('[data-iqai-camera-wall-selector-distance]');
      if (distance) distance.textContent = distanceLabel(item, slot);
      const label = pane.querySelector('[data-iqai-camera-wall-selector-label]');
      if (label) label.textContent = String(index + 1).padStart(2, '0');
      paintDateChrome(pane, slot, wall);
    });
    return;
  }
  slots.dataset.iqaiCameraWallSlotIds = ids;
  slots.innerHTML = open && count
    ? (wall.slots || []).map((slot, index) => renderPane(slot, index, wall)).join('')
    : `<div class="iqai-v2-camera-pane-recovery" data-iqai-camera-wall-empty>
        <p class="iqai-v2-camera-pane-recovery__state">NO CAMERA VIEW ACTIVE</p>
        <p class="iqai-v2-camera-pane-recovery__hint">${emptyWallMessage()}</p>
        <button type="button" class="iqai-v2-camera-pane-recovery__back" data-iqai-camera-back-main>← BACK TO MAIN VIEW</button>
      </div>`;
  (wall.slots || []).forEach((slot) => {
    const pane = slots.querySelector(`[data-iqai-camera-wall-pane="${slot.slotId}"]`);
    if (pane) {
      pane.hidden = false;
      pane.classList.toggle('is-parked', Boolean(wall.enlargedSlotId) && wall.enlargedSlotId !== slot.slotId);
      paintDateChrome(pane, slot, wall);
    }
  });
}

function paintSharedChrome(el, wall) {
  const snap = getSlotRepresentationSnapshot();
  const active = snap.slots.find((item) => item.slotId === (wall.enlargedSlotId || wall.activeSlotId)) || null;
  const representation = active?.representation || null;
  const pack = active ? getSlotRepresentation(active.slotId) : null;
  const camera = active?.cameraRef ? getAuthoredCamera(active.cameraRef) : null;
  const index = (wall.slots || []).findIndex((slot) => slot.slotId === (wall.enlargedSlotId || wall.activeSlotId));
  const ordinal = index >= 0 ? slotOrdinal(index, wall) : (wall?.source === 'VISUAL_COVERAGE' ? 'VIEW —' : 'CAMERA —');
  const item = relevanceFor(active?.cameraRef);
  const visual = wall?.source === 'VISUAL_COVERAGE';
  const footer = el.querySelector('[data-iqai-camera-wall-footer]');
  const truth = el.querySelector('[data-iqai-camera-wall-truth]');
  const line = el.querySelector('[data-iqai-camera-wall-active-line]');
  const title = el.querySelector('[data-iqai-camera-wall-active-title]');
  const cameraLine = el.querySelector('[data-iqai-camera-wall-active-camera]');
  const providerLine = el.querySelector('[data-iqai-camera-wall-active-provider]');
  const capturedLine = el.querySelector('[data-iqai-camera-wall-active-captured]');
  const offsetLine = el.querySelector('[data-iqai-camera-wall-active-offset]');
  const viewLine = el.querySelector('[data-iqai-camera-wall-virtual-view]');
  const truthLine = el.querySelector('[data-iqai-camera-wall-heavy-label]');
  const poseLine = el.querySelector('[data-iqai-camera-wall-pose-truth]');
  const providers = el.querySelector('[data-iqai-camera-wall-active-providers]');
  const restore = el.querySelector('[data-iqai-camera-wall-restore-tri]');
  const close = el.querySelector('[data-iqai-camera-wall-close]');
  if (restore) {
    restore.hidden = !wall?.enlargedSlotId;
    restore.textContent = `RESTORE ${countLayoutLabel(wall)}`;
  }
  if (close) close.hidden = getCameraOperatorMode() === CAMERA_OPERATOR_MODE.LOOK_AROUND;
  if (footer) {
    footer.textContent = visual
      ? 'SELECTED STREET VIEWPOINTS · PROVIDER REPRESENTATION · NOT CAMERA FEED · VIEW ORIENTED TOWARD TARGET · VISIBILITY NOT TESTED'
      : 'PLANNED · NOT INSTALLED · PROVIDER REPRESENTATION · NOT CAMERA FEED';
  }
  if (line) {
    line.textContent = `${ordinal} · ${compactProvider(active || {})} · ${compactCapture(active || {})} · ${distanceLabel(item, wall?.slots?.[index])}`;
  }
  if (truth) truth.textContent = representation
    ? 'PROVIDER REPRESENTATION · NOT CAMERA FEED'
    : 'NO PROVIDER REPRESENTATION';
  if (title) {
    const layoutLabel = countLayoutLabel(wall);
    title.textContent = wall?.enlargedSlotId ? `ENLARGED — ${ordinal}` : `${layoutLabel} — ${wall?.slotCount || 0}`;
  }
  if (cameraLine) {
    cameraLine.textContent = visual
      ? `VIEWPOINT: ${ordinal} · ${active?.visualViewpointId || 'UNASSIGNED'} · NO CAMERAREF`
      : `CAMERA: ${ordinal} · ${active?.cameraRef || 'UNASSIGNED'}`;
  }
  if (providerLine) {
    providerLine.textContent = representation?.providerId
      ? `PROVIDER: ${representation.provider} · ${representation.providerId}`
      : 'PROVIDER: NONE';
  }
  if (capturedLine) {
    capturedLine.textContent = representation ? captureTimeLabel(representation) : 'CAPTURE TIME UNKNOWN';
  }
  if (offsetLine) {
    const meters = captureOffsetMeters(active);
    offsetLine.textContent = meters != null
      ? `CAPTURE OFFSET: ${meters} m`
      : (representation ? captureOffsetLabel(representation) : 'CAPTURE OFFSET UNKNOWN');
  }
  if (viewLine) viewLine.textContent = formatVirtualView(getWallHeavyVirtualView());
  if (truthLine) {
    truthLine.textContent = representation
      ? `${representation.provider} · PROVIDER REPRESENTATION · NOT CAMERA FEED`
      : 'NO PROVIDER REPRESENTATION';
  }
  if (poseLine) {
    if (visual) {
      poseLine.textContent = 'VIEW ORIENTED TOWARD TARGET · VISIBILITY NOT TESTED · CAMERA POSE UNCHANGED';
    } else {
      const heading = Number.isFinite(Number(camera?.heading)) ? `${Math.round(camera.heading)}°` : '—';
      poseLine.textContent = `PLANNED CAMERA POSE HDG ${heading} · UNCHANGED BY VIRTUAL VIEW`;
    }
  }
  if (providers) {
    const googleOk = Boolean(pack?.google?.providerId);
    const mapillaryOk = Boolean(pack?.mapillary?.providerId);
    const mapillaryKind = pack?.mapillary?.isPano ? 'MAPILLARY 360' : 'MAPILLARY IMAGE';
    providers.innerHTML = `
      <button type="button" data-iqai-camera-wall-provider="GOOGLE_STREET360" ${googleOk ? '' : 'disabled'}>GOOGLE STREET360</button>
      <button type="button" data-iqai-camera-wall-provider="MAPILLARY" ${mapillaryOk ? '' : 'disabled'}>${mapillaryKind}</button>
    `;
  }
}

function paintPaneStatus(stage, slotId, kind, label) {
  const state = kind === 'LOADING' || kind === 'SEARCHING'
    ? (kind === 'SEARCHING' ? VIEWER_PANE_STATE.SEARCHING : VIEWER_PANE_STATE.LOADING)
    : VIEWER_PANE_STATE.UNAVAILABLE;
  setViewerPaneState(stage, slotId, state, label);
}

async function paintHeavy(el, wall) {
  paintSharedChrome(el, wall);
  if (!wall?.open) {
    await parkAllWallHeavyViewers();
    return;
  }
  const budget = Number(wall.maxHeavyViewers) || 0;
  const loaded = [];
  const failed = [];
  const lightweight = [];
  const attaching = getRepresentationAttachStatus().inFlight;
  const visibleSlots = (wall.slots || []).filter((slot) => !wall.enlargedSlotId || slot.slotId === wall.enlargedSlotId);
  for (const slot of visibleSlots) {
    const stage = el.querySelector(`[data-iqai-camera-wall-pane-stage="${slot.slotId}"]`);
    if (!stage) continue;
    const pack = getSlotRepresentation(slot.slotId);
    const representation = pack?.representation || pack?.google || pack?.mapillary || null;
    if (!representation?.providerId) {
      if (attaching || isVisualCoverageSearching()) {
        paintPaneStatus(stage, slot.slotId, attaching ? 'LOADING' : 'SEARCHING', attaching ? 'LOADING GOOGLE 360' : 'FINDING STREET VIEW');
        continue;
      }
      paintPaneStatus(stage, slot.slotId, 'UNAVAILABLE', 'VIEW UNAVAILABLE');
      failed.push(slot.slotId);
      continue;
    }
    let activated = await activateWallHeavyViewer(stage, representation, { slotId: slot.slotId, budget });
    if (
      representation.provider === 'GOOGLE_STREET360'
      && (activated?.status === 'GOOGLE_MAPS_JS_AUTH_FAILED' || activated?.status === 'GOOGLE_STREET_VIEW_UNAVAILABLE')
      && pack?.mapillary?.providerId
    ) {
      selectSlotProvider(slot.slotId, 'MAPILLARY');
      activated = await activateWallHeavyViewer(stage, pack.mapillary, { slotId: slot.slotId, budget });
    }
    if (activated?.heavy) loaded.push(slot.slotId);
    else if (activated?.lightweight) lightweight.push(slot.slotId);
    else failed.push(slot.slotId);
  }
  recordTriViewHeavyReport({
    requestedBudget: wall.enlargedSlotId ? 1 : wall.triViewBudget,
    actualHeavyCount: getLiveHeavyViewerCount(),
    viewerDomCount: el.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    loaded,
    failed,
    lightweight,
    fallback: lightweight.length > 0 || getLiveHeavyViewerCount() < visibleSlots.length
  });
  paintSharedChrome(el, getCameraWallSnapshot());
  resizeWallHeavyViewer();
}

function paintChrome(el, wall) {
  const open = wall?.open === true;
  el.hidden = !open;
  el.dataset.iqaiCameraWallOpen = open ? 'true' : 'false';
  el.dataset.iqaiCameraWallLayout = wallLayoutName(wall);
  el.dataset.iqaiCameraWallContained = 'true';
  el.dataset.iqaiCameraWallMode = wall?.mode || 'TRI_VIEW';
  const pane = el.closest('[data-iqai-pane="STREET 360"]');
  if (pane) pane.classList.toggle('has-camera-wall', open);
  const recovery = pane?.querySelector('[data-iqai-camera-pane-recovery]');
  if (open && recovery) recovery.hidden = true;
  const kicker = el.querySelector('[data-iqai-camera-wall-kicker]');
  const honesty = el.querySelector('[data-iqai-camera-wall-honesty]');
  const count = wall?.slotCount || 0;
  const visual = wall?.source === 'VISUAL_COVERAGE';
  const layoutLabel = countLayoutLabel(wall);
  if (kicker) {
    kicker.textContent = wall?.enlargedSlotId
      ? `${visual ? '360 WALL' : 'CAMERA WALL'} · ENLARGED`
      : `${visual ? '360 WALL' : 'CAMERA WALL'} · ${layoutLabel} · ${count}`;
  }
  if (honesty) {
    honesty.textContent = visual
      ? VISUAL_COVERAGE_HONESTY
      : `${PLAN_GEOMETRY_HONESTY.replace(/ — /g, ' · ')} · ${VISIBILITY_NOT_TESTED_LABEL}`;
  }
}

function countLayoutLabel(wall) {
  const n = Number(wall?.layout || wall?.slotCount || 0);
  if (n <= 1) return '1-UP';
  if (n === 2) return '2-UP';
  if (n === 4) return '4-UP';
  return '3-UP';
}

function wallLayoutName(wall) {
  if (wall?.enlargedSlotId) return 'enlarged';
  return Number(wall?.layout || wall?.slotCount || 0) >= 4 ? 'quad-view' : 'tri-view';
}

export function renderCameraWallSurface() {
  return `
    <aside class="iqai-v2-camera-wall" data-iqai-camera-wall data-iqai-camera-wall-layout="tri-view" data-iqai-camera-wall-contained="true" hidden aria-label="Relevant camera wall">
      <div class="iqai-v2-camera-wall__head">
        <p class="iqai-v2-camera-wall__kicker" data-iqai-camera-wall-kicker>CAMERA WALL · 0</p>
        <button type="button" data-iqai-camera-wall-restore-tri hidden>RESTORE 3-UP</button>
        <button type="button" data-iqai-camera-plan-print>PRINT PLAN</button>
        <button type="button" data-iqai-camera-wall-close>CLOSE WALL</button>
      </div>
      <div class="iqai-v2-camera-wall__slots" data-iqai-camera-wall-slots></div>
      <div class="iqai-v2-camera-wall__heavy" data-iqai-camera-wall-heavy hidden>
        <p class="iqai-v2-camera-wall__active-line" data-iqai-camera-wall-active-line>CAMERA —</p>
        <p class="iqai-v2-camera-wall__truth" data-iqai-camera-wall-truth>PROVIDER REPRESENTATION · NOT CAMERA FEED</p>
        <span class="iqai-v2-camera-wall__providers" data-iqai-camera-wall-active-providers></span>
        <div class="iqai-v2-camera-wall__heavy-stage" data-iqai-camera-wall-heavy-stage></div>
        <div class="iqai-v2-camera-wall__expert" data-iqai-camera-wall-expert hidden>
          <p class="iqai-v2-camera-wall__active-title" data-iqai-camera-wall-active-title>3-UP</p>
          <p data-iqai-camera-wall-active-camera>CAMERA: —</p>
          <p data-iqai-camera-wall-active-provider>PROVIDER: NONE</p>
          <p data-iqai-camera-wall-active-captured>CAPTURE TIME UNKNOWN</p>
          <p data-iqai-camera-wall-active-offset>CAPTURE OFFSET UNKNOWN</p>
          <p data-iqai-camera-wall-virtual-view>VIRTUAL VIEW · PAN / TILT / ZOOM</p>
          <p data-iqai-camera-wall-pose-truth>PLANNED CAMERA POSE · UNCHANGED BY VIRTUAL VIEW</p>
          <p data-iqai-camera-wall-heavy-label>ACTIVE · NO PROVIDER REPRESENTATION</p>
        </div>
      </div>
      <p class="iqai-v2-camera-wall__footer" data-iqai-camera-wall-footer>PLANNED · NOT INSTALLED · PROVIDER REPRESENTATION · NOT CAMERA FEED</p>
      <p class="iqai-v2-camera-wall__note" data-iqai-camera-wall-honesty hidden>2D PLAN-VIEW GEOMETRY · NOT LOS · NOT REAL VISIBILITY · NOT OBSERVATION</p>
    </aside>
  `;
}

function cameraPaneHost(root) {
  return root?.querySelector('[data-iqai-pane="STREET 360"] .iqai-v2-pane__body')
    || root?.querySelector('[data-iqai-camera-pane-host]')
    || root?.querySelector('.iqai-v2-stage__well')
    || root;
}

export function bindCameraWallSurface(root, options = {}) {
  const host = cameraPaneHost(root);
  if (!host) return null;
  let el = root.querySelector('[data-iqai-camera-wall]');
  if (!el) {
    host.insertAdjacentHTML('beforeend', renderCameraWallSurface());
    el = host.querySelector('[data-iqai-camera-wall]');
  } else if (el.parentElement !== host) {
    host.appendChild(el);
  }
  let paintingHeavy = false;
  let pendingHeavy = false;
  let buildGeneration = 0;
  let closed = true;

  function snapshot() {
    const wall = getCameraWallSnapshot();
    const stages = el.querySelectorAll('[data-iqai-camera-wall-pane-stage]');
    const first = stages[0]?.getBoundingClientRect?.();
    const pane = el.closest('[data-iqai-pane="STREET 360"]');
    const paneRect = pane?.getBoundingClientRect?.();
    const report = getTriViewHeavyReport();
    return {
      wall,
      representations: getSlotRepresentationSnapshot(),
      layout: wallLayoutName(wall),
      contained: true,
      pane: pane?.getAttribute('data-iqai-pane') || null,
      selectorCount: el.querySelectorAll('[data-iqai-camera-wall-selector]').length,
      paneCount: el.querySelectorAll('[data-iqai-camera-wall-pane]').length,
      heavyDomCount: el.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
      liveDecoders: getLiveHeavyViewerCount(),
      heavyReport: report,
      stageHeightPx: first?.height || null,
      paneWidthPx: paneRect?.width || null,
      overflowsPane: Boolean(first && paneRect && (
        first.right > paneRect.right + 2
        || first.left < paneRect.left - 2
        || first.bottom > paneRect.bottom + 2
      )),
      viewerStates: getViewerPaneStates(),
      mutatesCameraPose: false
    };
  }

  async function paint() {
    const wall = getCameraWallSnapshot();
    paintChrome(el, wall);
    paintSlots(el, wall);
    refreshGuidedNext();
    if (paintingHeavy) {
      pendingHeavy = true;
      return wall;
    }
    paintingHeavy = true;
    try {
      do {
        pendingHeavy = false;
        await paintHeavy(el, getCameraWallSnapshot());
      } while (pendingHeavy);
    } finally {
      paintingHeavy = false;
    }
    resizeWallHeavyViewer();
    requestAnimationFrame(() => resizeWallHeavyViewer());
    window.setTimeout(resizeWallHeavyViewer, 80);
    window.setTimeout(() => { void recoverWallHeavyViewers(); }, 250);
    refreshGuidedNext();
    return wall;
  }

  async function build(querySnapshot) {
    closed = false;
    const generation = ++buildGeneration;
    const incoming = querySnapshot || getLastCameraQuerySnapshot();
    const cameraIds = relevantCameraIdsFromQuery(incoming);
    const relevant = cameraIds.map((cameraId) => (
      incoming?.relevant?.find((item) => (item.cameraId || item.cameraRef) === cameraId)
      || { cameraId }
    ));
    const query = {
      ...incoming,
      relevantCount: relevant.length,
      relevant
    };
    resetSlotRepresentations({ emit: false });
    const wall = buildRelevantCameraWall(query);
    paintChrome(el, wall);
    paintSlots(el, wall);
    if (typeof options.enterCameraVisualization === 'function') {
      try { options.enterCameraVisualization(); } catch { /* layout best-effort */ }
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (typeof options.ensureCameraPane === 'function') {
      try {
        await options.ensureCameraPane();
      } catch (error) {
        console.warn('[IQAI CAMERA WALL] camera pane ensure failed; wall still builds', error);
      }
    }
    try {
      await attachRepresentationsForWall();
    } catch (error) {
      console.warn('[IQAI CAMERA WALL] provider lookup failed; cameras preserved', error);
    }
    if (closed || generation !== buildGeneration) {
      await parkAllWallHeavyViewers();
      return snapshot();
    }
    await paint();
    return snapshot();
  }

  async function buildVisual(coverage = getLastVisualCoverage()) {
    closed = false;
    const generation = ++buildGeneration;
    const selected = Array.isArray(coverage?.selected) ? coverage.selected : [];
    resetSlotRepresentations({ emit: false });
    const wall = buildVisualCoverageWall(selected);
    paintChrome(el, wall);
    paintSlots(el, wall);
    if (!wall.open) {
      await paint();
      return snapshot();
    }
    if (typeof options.enterCameraVisualization === 'function') {
      try { options.enterCameraVisualization(); } catch { /* layout best-effort */ }
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (typeof options.ensureCameraPane === 'function') {
      try {
        await options.ensureCameraPane();
      } catch (error) {
        console.warn('[IQAI CAMERA WALL] camera pane ensure failed; wall still builds', error);
      }
    }
    try {
      attachVisualCoverageToWall(selected);
    } catch (error) {
      console.warn('[IQAI CAMERA WALL] visual coverage attach failed', error);
    }
    if (closed || generation !== buildGeneration) {
      await parkAllWallHeavyViewers();
      return snapshot();
    }
    await paint();
    return snapshot();
  }

  async function close() {
    closed = true;
    buildGeneration += 1;
    el.hidden = true;
    el.dataset.iqaiCameraWallOpen = 'false';
    el.closest('[data-iqai-pane="STREET 360"]')?.classList.remove('has-camera-wall');
    if (typeof options.exitCameraVisualization === 'function') {
      try { await options.exitCameraVisualization(); } catch { /* restore best-effort */ }
    }
    await parkAllWallHeavyViewers();
    resetSlotRepresentations({ emit: false });
    const wall = closeCameraWall();
    await paint();
    return wall;
  }

  function restoreTri() {
    restoreWallTriView();
    void paint().then(() => recoverWallHeavyViewers());
  }

  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-iqai-camera-wall-close]')) {
      event.preventDefault();
      event.stopPropagation();
      void close();
      return;
    }
    if (event.target.closest('[data-iqai-camera-wall-restore-tri]')) {
      event.preventDefault();
      event.stopPropagation();
      restoreTri();
      return;
    }
    if (event.target.closest('[data-iqai-camera-plan-print]')) {
      event.preventDefault();
      event.stopPropagation();
      printCameraPlan();
      return;
    }
    const dateDay = event.target.closest('[data-iqai-camera-date-day]');
    if (dateDay && el.contains(dateDay)) {
      event.preventDefault();
      event.stopPropagation();
      selectSlotCaptureDate(dateDay.getAttribute('data-iqai-camera-date-slot'), dateDay.getAttribute('data-iqai-camera-date-day'));
      void paint();
      return;
    }
    const dateYear = event.target.closest('[data-iqai-camera-date-year]');
    if (dateYear && el.contains(dateYear)) {
      event.preventDefault();
      event.stopPropagation();
      const year = dateYear.getAttribute('data-iqai-camera-date-year');
      selectSlotCaptureDate(dateYear.getAttribute('data-iqai-camera-date-slot'), `${year}-06-15`);
      void paint();
      return;
    }
    if (event.target.closest('[data-iqai-camera-date]')) {
      event.stopPropagation();
      return;
    }
    const enlarge = event.target.closest('[data-iqai-camera-wall-enlarge]');
    if (enlarge && el.contains(enlarge)) {
      event.preventDefault();
      event.stopPropagation();
      const slotId = enlarge.getAttribute('data-iqai-camera-wall-enlarge');
      enlargeWallSlot(slotId);
      const slot = getCameraWallSnapshot().slots.find((item) => item.slotId === slotId);
      if (slot?.slotId) markGuidedSlotInspected(slot.slotId);
      if (slot?.cameraRef) selectAuthoredCamera(slot.cameraRef);
      void paint();
      return;
    }
    const providerBtn = event.target.closest('[data-iqai-camera-wall-provider]');
    if (providerBtn && el.contains(providerBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const slotId = getCameraWallSnapshot().enlargedSlotId || getCameraWallSnapshot().activeSlotId;
      if (!slotId) return;
      setActiveSlot(slotId);
      selectSlotProvider(slotId, providerBtn.getAttribute('data-iqai-camera-wall-provider'));
      const slot = getCameraWallSnapshot().slots.find((item) => item.slotId === slotId);
      if (slot?.cameraRef) selectAuthoredCamera(slot.cameraRef);
      void paint();
      return;
    }
    const slotEl = event.target.closest('[data-iqai-camera-wall-slot]');
    if (!slotEl || !el.contains(slotEl)) return;
    const slotId = slotEl.getAttribute('data-iqai-camera-wall-slot');
    const slot = setActiveSlot(slotId);
    if (slot?.slotId && slot.active === true) markGuidedSlotInspected(slot.slotId);
    if (slot?.cameraRef) selectAuthoredCamera(slot.cameraRef);
    void paint();
  });

  el.addEventListener('change', (event) => {
    const input = event.target?.closest?.('[data-iqai-camera-date-input]');
    if (!input || !el.contains(input)) return;
    event.stopPropagation();
    selectSlotCaptureDate(input.getAttribute('data-iqai-camera-date-slot'), input.value);
    void paint();
  });

  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const wall = getCameraWallSnapshot();
    if (wall?.enlargedSlotId) {
      event.preventDefault();
      event.stopPropagation();
      restoreTri();
      return;
    }
    if (wall?.open === true) {
      event.preventDefault();
      event.stopPropagation();
      void close();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  const unsubWall = subscribeCameraWall(() => { void paint(); });
  const unsubRep = subscribeSlotRepresentations(() => { void paint(); });
  const unsubView = subscribeWallHeavyVirtualView(() => {
    const viewLine = el.querySelector('[data-iqai-camera-wall-virtual-view]');
    if (viewLine) viewLine.textContent = formatVirtualView(getWallHeavyVirtualView());
  });
  void paint();

  return Object.freeze({
    snapshot,
    build,
    buildVisual,
    close,
    paint,
    applyVirtualView(input) {
      return applyWallHeavyVirtualView(input);
    },
    element: el,
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      unsubWall();
      unsubRep();
      unsubView();
    }
  });
}
