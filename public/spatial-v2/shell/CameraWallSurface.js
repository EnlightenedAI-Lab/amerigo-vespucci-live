/**
 * Compact production Camera Wall.
 * Presentation of ViewSlots over existing camera.query-relevant results.
 * Optional Google Street360 / Mapillary representations are not the planned Camera.
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
import {
  captureOffsetLabel,
  captureTimeLabel
} from '../camera/provider/provider-representation.js';
import {
  attachRepresentationsForWall,
  getSlotRepresentation,
  getSlotRepresentationSnapshot,
  resetSlotRepresentations,
  selectSlotProvider,
  subscribeSlotRepresentations
} from '../camera/provider/slot-representations.js';
import { activateWallHeavyViewer, parkWallHeavyViewer } from '../camera/provider/heavy-viewer.js';

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

function coordLabel(point) {
  if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) return '—';
  return `${Number(point.latitude).toFixed(5)}, ${Number(point.longitude).toFixed(5)}`;
}

function relevanceFor(cameraId) {
  const query = getLastCameraQuerySnapshot();
  const rows = [...(query?.relevant || []), ...(query?.results || [])];
  return rows.find((item) => item.cameraId === cameraId || item.cameraRef?.cameraId === cameraId) || null;
}

function providerLines(slot) {
  const pack = getSlotRepresentation(slot.slotId);
  const snap = getSlotRepresentationSnapshot().slots.find((item) => item.slotId === slot.slotId);
  const selected = snap?.representation || null;
  const googleOk = Boolean(pack?.google?.providerId);
  const mapillaryOk = Boolean(pack?.mapillary?.providerId);
  const mapillaryKind = pack?.mapillary?.isPano ? 'MAPILLARY 360' : 'MAPILLARY IMAGE';
  const selector = `
    <span class="iqai-v2-camera-wall__providers">
      <button type="button" data-iqai-camera-wall-provider="GOOGLE_STREET360" ${googleOk ? '' : 'disabled'}>GOOGLE STREET360</button>
      <button type="button" data-iqai-camera-wall-provider="MAPILLARY" ${mapillaryOk ? '' : 'disabled'}>${mapillaryKind}</button>
    </span>
  `;
  if (!selected) {
    const status = snap?.availability || 'REPRESENTATION NOT AVAILABLE';
    return `
      <span data-iqai-camera-wall-rep-status>${status}</span>
      <span>PROVIDER REPRESENTATION · NOT CAMERA FEED</span>
      ${selector}
    `;
  }
  const thumb = selected.thumbUrl
    ? `<img alt="PROVIDER REPRESENTATION" src="${selected.thumbUrl}" data-iqai-camera-wall-thumb>`
    : '';
  return `
    ${thumb}
    <span data-iqai-camera-wall-rep-status>${snap.availability}</span>
    <span>${selected.provider} · ${selected.providerId}</span>
    <span>${selected.representationType || selected.status || ''}</span>
    <span>CAMERA ${coordLabel(pack.cameraCoordinate)}</span>
    <span>CAPTURE ${coordLabel(selected.captureCoordinate)}</span>
    <span>${captureOffsetLabel(selected)}</span>
    <span>${captureTimeLabel(selected)}</span>
    <span>PROVIDER REPRESENTATION · NOT CAMERA FEED</span>
    ${selector}
  `;
}

function renderSlot(slot, index) {
  const camera = slot.cameraRef ? getAuthoredCamera(slot.cameraRef) : null;
  const item = relevanceFor(slot.cameraRef);
  const ordinal = String(index + 1).padStart(2, '0');
  const hfov = Number.isFinite(Number(camera?.horizontalFov))
    ? `${Math.round(camera.horizontalFov)}°`
    : (Number.isFinite(Number(item?.horizontalFov)) ? `${Math.round(item.horizontalFov)}°` : '—');
  const heavy = slot.active === true ? ' data-iqai-camera-wall-heavy-slot="true"' : '';
  return `
    <article class="iqai-v2-camera-wall__slot${slot.active ? ' is-active' : ''}" data-iqai-camera-wall-slot="${slot.slotId}"${heavy}>
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
      ${providerLines(slot)}
    </article>
  `;
}

function paintSlots(el, wall) {
  const slots = el.querySelector('[data-iqai-camera-wall-slots]');
  if (!slots) return;
  const open = wall?.open === true;
  const count = wall?.slotCount || 0;
  slots.style.setProperty('--iqai-camera-wall-cols', String(Math.max(1, wall?.layout || count || 1)));
  slots.innerHTML = open && count
    ? (wall.slots || []).map((slot, index) => renderSlot(slot, index)).join('')
    : '<p data-iqai-camera-wall-empty>NO RELEVANT CAMERAS</p>';
}

async function paintHeavy(el, wall) {
  const host = el.querySelector('[data-iqai-camera-wall-heavy]');
  const stage = el.querySelector('[data-iqai-camera-wall-heavy-stage]');
  const label = el.querySelector('[data-iqai-camera-wall-heavy-label]');
  if (!host || !stage) return;
  const snap = getSlotRepresentationSnapshot();
  const active = snap.slots.find((item) => item.slotId === wall.activeSlotId) || null;
  const representation = active?.representation || null;
  host.hidden = !(wall?.open === true);
  if (label) {
    label.textContent = representation
      ? `ACTIVE · ${representation.provider} · PROVIDER REPRESENTATION · NOT CAMERA FEED`
      : 'ACTIVE · NO PROVIDER REPRESENTATION';
  }
  if (!wall?.open || !representation?.providerId) {
    await parkWallHeavyViewer(stage);
    return;
  }
  await activateWallHeavyViewer(stage, representation);
}

function paintChrome(el, wall) {
  const open = wall?.open === true;
  el.hidden = !open;
  el.dataset.iqaiCameraWallOpen = open ? 'true' : 'false';
  const kicker = el.querySelector('[data-iqai-camera-wall-kicker]');
  const footer = el.querySelector('[data-iqai-camera-wall-honesty]');
  const count = wall?.slotCount || 0;
  if (kicker) kicker.textContent = `CAMERA WALL · ${count} RELEVANT`;
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
      <div class="iqai-v2-camera-wall__heavy" data-iqai-camera-wall-heavy hidden>
        <p data-iqai-camera-wall-heavy-label>ACTIVE · NO PROVIDER REPRESENTATION</p>
        <div class="iqai-v2-camera-wall__heavy-stage" data-iqai-camera-wall-heavy-stage></div>
      </div>
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
  let paintingHeavy = false;
  let pendingHeavy = false;

  function snapshot() {
    return {
      wall: getCameraWallSnapshot(),
      representations: getSlotRepresentationSnapshot()
    };
  }

  async function paint() {
    const wall = getCameraWallSnapshot();
    paintChrome(el, wall);
    paintSlots(el, wall);
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
    return wall;
  }

  async function build(querySnapshot) {
    const query = querySnapshot || getLastCameraQuerySnapshot();
    resetSlotRepresentations({ emit: false });
    const wall = buildRelevantCameraWall(query);
    paintChrome(el, wall);
    paintSlots(el, wall);
    try {
      await attachRepresentationsForWall();
    } catch (error) {
      console.warn('[IQAI CAMERA WALL] provider lookup failed; cameras preserved', error);
    }
    await paint();
    return snapshot();
  }

  async function close() {
    const stage = el.querySelector('[data-iqai-camera-wall-heavy-stage]');
    await parkWallHeavyViewer(stage);
    resetSlotRepresentations({ emit: false });
    const wall = closeCameraWall();
    await paint();
    return wall;
  }

  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-iqai-camera-wall-close]')) {
      event.preventDefault();
      void close();
      return;
    }
    const providerBtn = event.target.closest('[data-iqai-camera-wall-provider]');
    const slotEl = event.target.closest('[data-iqai-camera-wall-slot]');
    if (providerBtn && slotEl && el.contains(slotEl)) {
      event.preventDefault();
      event.stopPropagation();
      const slotId = slotEl.getAttribute('data-iqai-camera-wall-slot');
      setActiveSlot(slotId);
      selectSlotProvider(slotId, providerBtn.getAttribute('data-iqai-camera-wall-provider'));
      const slot = getCameraWallSnapshot().slots.find((item) => item.slotId === slotId);
      if (slot?.cameraRef) selectAuthoredCamera(slot.cameraRef);
      void paint();
      return;
    }
    if (!slotEl || !el.contains(slotEl)) return;
    const slotId = slotEl.getAttribute('data-iqai-camera-wall-slot');
    const slot = setActiveSlot(slotId);
    if (slot?.cameraRef) selectAuthoredCamera(slot.cameraRef);
    void paint();
  });

  const unsubWall = subscribeCameraWall(() => { void paint(); });
  const unsubRep = subscribeSlotRepresentations(() => { void paint(); });
  void paint();

  return Object.freeze({
    snapshot,
    build,
    close,
    paint,
    element: el,
    dispose() {
      unsubWall();
      unsubRep();
    }
  });
}
