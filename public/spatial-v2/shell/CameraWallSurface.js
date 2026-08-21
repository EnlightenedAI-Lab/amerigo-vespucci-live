/**
 * Compact production Camera Wall.
 * Presentation of ViewSlots over existing camera.query-relevant results.
 * Not Camera Planner. Not provider imagery. Session-only wall assignment.
 */

import { PIXEL_DENSITY_UNKNOWN, DESIGN_BAND_UNKNOWN } from '../camera/engine/dori.js';
import { PLAN_GEOMETRY_HONESTY, VISIBILITY_NOT_TESTED_LABEL } from '../camera/engine/relevance-constants.js';
import {
  buildRelevantCameraWall,
  closeCameraWall,
  getCameraWallSnapshot,
  setActiveSlot,
  subscribeCameraWall
} from '../camera/engine/camera-wall.js';
import { getLastCameraQuerySnapshot } from '../camera/spatial-camera-adapter.js';
import { getAuthoredCamera, selectAuthoredCamera } from '../map/authored-cameras.js';

function densityLine(item) {
  const known = item?.targetDesign?.known === true && Number.isFinite(Number(item.pixelDensityPxPerM));
  if (!known) return PIXEL_DENSITY_UNKNOWN;
  const px = Number(item.pixelDensityPxPerM);
  const shown = px >= 10 ? String(Math.round(px)) : String(Math.round(px * 10) / 10);
  const band = item.designBand && item.designBand !== 'UNKNOWN' ? item.designBand : null;
  return band ? `${shown} px/m · ${band}` : `${shown} px/m`;
}

function bandLine(item) {
  const known = item?.targetDesign?.known === true && item?.designBand && item.designBand !== 'UNKNOWN';
  return known ? `DESIGN BAND ${item.designBand}` : DESIGN_BAND_UNKNOWN;
}

function distanceLabel(item) {
  const meters = Number(item?.planDistanceM);
  if (!Number.isFinite(meters)) return '—';
  return `${Math.round(meters)} m`;
}

function bearingLabel(item) {
  return item?.targetBearingLabel || '—';
}

function headingLabel(item, camera) {
  if (item?.cameraHeadingLabel) return item.cameraHeadingLabel;
  const heading = Number(camera?.heading);
  return Number.isFinite(heading) ? `${Math.round(heading)}°` : '—';
}

function fovLabel(item) {
  return item?.fovIntersects ? 'FOV INTERSECTS' : 'FOV DOES NOT INTERSECT';
}

function relevanceFor(cameraId) {
  const query = getLastCameraQuerySnapshot();
  const rows = [...(query?.relevant || []), ...(query?.results || [])];
  return rows.find((item) => item.cameraId === cameraId || item.cameraRef?.cameraId === cameraId) || null;
}

function renderSlot(slot, index) {
  const camera = slot.cameraRef ? getAuthoredCamera(slot.cameraRef) : null;
  const item = relevanceFor(slot.cameraRef);
  const ordinal = String(index + 1).padStart(2, '0');
  const hfov = Number.isFinite(Number(camera?.horizontalFov))
    ? `${Math.round(camera.horizontalFov)}°`
    : (Number.isFinite(Number(item?.horizontalFov)) ? `${Math.round(item.horizontalFov)}°` : '—');
  return `
    <button type="button" class="iqai-v2-camera-wall__slot${slot.active ? ' is-active' : ''}" data-iqai-camera-wall-slot="${slot.slotId}">
      <span>CAMERA ${ordinal}</span>
      <span data-iqai-camera-wall-id>${slot.cameraRef || 'UNASSIGNED'}</span>
      <span>${item?.qualification || camera?.planningLabel || 'PLANNED · NOT INSTALLED'}</span>
      <span>${distanceLabel(item)}</span>
      <span>BEARING ${bearingLabel(item)}</span>
      <span>HDG ${headingLabel(item, camera)}</span>
      <span>HFOV ${hfov}</span>
      <span>${fovLabel(item)}</span>
      <span>${densityLine(item)}</span>
      <span>${bandLine(item)}</span>
      <span>${VISIBILITY_NOT_TESTED_LABEL}</span>
    </button>
  `;
}

function paintSurface(el, wall) {
  if (!el) return;
  const open = wall?.open === true;
  el.hidden = !open;
  el.dataset.iqaiCameraWallOpen = open ? 'true' : 'false';
  const kicker = el.querySelector('[data-iqai-camera-wall-kicker]');
  const slots = el.querySelector('[data-iqai-camera-wall-slots]');
  const footer = el.querySelector('[data-iqai-camera-wall-honesty]');
  const count = wall?.slotCount || 0;
  if (kicker) kicker.textContent = `CAMERA WALL · ${count} RELEVANT`;
  if (slots) {
    slots.style.setProperty('--iqai-camera-wall-cols', String(Math.max(1, wall?.layout || count || 1)));
    slots.innerHTML = open && count
      ? (wall.slots || []).map((slot, index) => renderSlot(slot, index)).join('')
      : '<p data-iqai-camera-wall-empty>NO RELEVANT CAMERAS</p>';
  }
  if (footer) footer.textContent = PLAN_GEOMETRY_HONESTY.replace(/ — /g, ' · ');
}

export function renderCameraWallSurface() {
  return `
    <aside class="iqai-v2-camera-wall" data-iqai-camera-wall hidden aria-label="Relevant camera wall">
      <div class="iqai-v2-camera-wall__head">
        <p class="iqai-v2-camera-wall__kicker" data-iqai-camera-wall-kicker>CAMERA WALL · 0 RELEVANT</p>
        <button type="button" data-iqai-camera-wall-close>CLOSE WALL</button>
      </div>
      <div class="iqai-v2-camera-wall__slots" data-iqai-camera-wall-slots></div>
      <p class="iqai-v2-camera-wall__note" data-iqai-camera-wall-honesty>2D PLAN-VIEW GEOMETRY · NOT LOS · NOT REAL VISIBILITY · NOT OBSERVATION</p>
    </aside>
  `;
}

export function bindCameraWallSurface(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well') || root;
  if (!well) return null;
  let el = well.querySelector('[data-iqai-camera-wall]');
  if (!el) {
    well.insertAdjacentHTML('beforeend', renderCameraWallSurface());
    el = well.querySelector('[data-iqai-camera-wall]');
  }

  function snapshot() {
    return getCameraWallSnapshot();
  }

  function paint() {
    paintSurface(el, snapshot());
  }

  function build(querySnapshot) {
    const query = querySnapshot || getLastCameraQuerySnapshot();
    const wall = buildRelevantCameraWall(query);
    paint();
    return wall;
  }

  function close() {
    const wall = closeCameraWall();
    paint();
    return wall;
  }

  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-iqai-camera-wall-close]')) {
      event.preventDefault();
      close();
      return;
    }
    const slotEl = event.target.closest('[data-iqai-camera-wall-slot]');
    if (!slotEl || !el.contains(slotEl)) return;
    const slotId = slotEl.getAttribute('data-iqai-camera-wall-slot');
    const slot = setActiveSlot(slotId);
    if (slot?.cameraRef) selectAuthoredCamera(slot.cameraRef);
  });

  const unsub = subscribeCameraWall(() => paint());
  paint();

  return Object.freeze({
    snapshot,
    build,
    close,
    paint,
    element: el,
    dispose() {
      unsub();
    }
  });
}
