/**
 * Compact MAP / AERIAL / HISTORY command surface.
 * HISTORY chrome appears only while HISTORY is active.
 * Providers stay behind the system.
 */

import {
  listGroundModes
} from '../imagery/ground-controller.js';
import { GROUND_MODE } from '../imagery/imagery-contract.js';
import { getIqaiGroundSurface, getMapView, setIqaiGroundSurface } from '../map/map-foundation.js';
import { AERIAL_CURRENT_LABEL } from '../map/iqai-public-basemap.js';
import {
  HISTORY_SURFACE_HELD,
  IMAGE_SURFACE,
  IMAGE_SURFACE_FAILURE,
  canonicalizeImageSurface,
  projectImageSurface
} from '../imagery/command/image-surface-mode.js';
import { formatImageDate, IMAGE_DATE_UNKNOWN } from '../imagery/command/image-date.js';
import { bindHistoryHost } from './HistoryHost.js';
import { bindRemoteSensingHost, renderRemoteSensingPanel } from './RemoteSensingHost.js';

function readViewpoint(view) {
  const center = view?.center;
  const longitude = Number(center?.longitude);
  const latitude = Number(center?.latitude);
  const zoom = Number(view?.zoom);
  const rotation = Number(view?.rotation);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return {
    longitude,
    latitude,
    zoom: Number.isFinite(zoom) ? zoom : 15,
    scale: Number(view?.scale) || null,
    rotation: Number.isFinite(rotation) ? rotation : 0
  };
}

async function restoreViewpoint(view, viewpoint) {
  if (!view || !viewpoint) return;
  const target = {
    center: [viewpoint.longitude, viewpoint.latitude],
    zoom: viewpoint.zoom,
    rotation: Number.isFinite(Number(viewpoint.rotation)) ? Number(viewpoint.rotation) : 0
  };
  if (typeof view.goTo === 'function') {
    await Promise.race([
      view.goTo(target, { animate: false }),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]);
    return;
  }
  if (view.center && Number.isFinite(viewpoint.longitude)) {
    view.center = { longitude: viewpoint.longitude, latitude: viewpoint.latitude };
  }
  if (Number.isFinite(viewpoint.zoom)) view.zoom = viewpoint.zoom;
  if (Number.isFinite(Number(viewpoint.rotation))) view.rotation = Number(viewpoint.rotation);
}

async function refreshAerialCaptureLabel(view) {
  const longitude = Number(view?.center?.longitude);
  const latitude = Number(view?.center?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return AERIAL_CURRENT_LABEL;
  try {
    const url = `/api/spatial-v2/imagery/nearmap/coverage?aoi=point&longitude=${encodeURIComponent(String(longitude))}&latitude=${encodeURIComponent(String(latitude))}`;
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    const capture = payload?.surveys?.[0]?.captureDate || payload?.surveys?.[0]?.acquisitionDate;
    const formatted = formatImageDate({ captureDate: capture, acquisitionDate: capture });
    if (formatted && formatted !== IMAGE_DATE_UNKNOWN) return `IMAGE DATE ${formatted}`;
  } catch {
    // Coverage is optional. AERIAL still shows Nearmap current.
  }
  return AERIAL_CURRENT_LABEL;
}

function aerialCandidate() {
  const modes = listGroundModes();
  const nearmap = modes.find((item) => item.id === GROUND_MODE.NEARMAP && item.enabled);
  if (nearmap) return GROUND_MODE.NEARMAP;
  return GROUND_MODE.NEARMAP;
}

export function renderImageryCommandSurface() {
  return `
    <div class="iqai-v2-imagery-command" data-iqai-imagery-command>
      <div class="iqai-v2-imagery-command__modes" role="radiogroup" aria-label="Imagery surface">
        <button type="button" data-iqai-image-surface="MAP" aria-pressed="true">MAP</button>
        <button type="button" data-iqai-image-surface="AERIAL" aria-pressed="false">AERIAL</button>
        <button type="button" data-iqai-image-surface="HISTORY" aria-pressed="false">HISTORY</button>
        <button type="button" data-iqai-library-toggle aria-pressed="false">LIBRARY</button>
        <button type="button" data-iqai-remote-sensing-toggle aria-pressed="false">REMOTE SENSING</button>
      </div>
      <p class="iqai-v2-imagery-command__aerial" data-iqai-aerial-badge hidden>NEARMAP CURRENT</p>
      <div class="iqai-v2-imagery-command__history" data-iqai-history-chrome hidden>
        <button type="button" class="iqai-v2-imagery-command__date" data-iqai-image-date aria-expanded="false">DATE UNKNOWN</button>
        <button type="button" class="iqai-v2-imagery-command__cal" data-iqai-history-calendar-toggle aria-label="Open calendar">CAL</button>
        <p class="iqai-v2-imagery-command__status" data-iqai-history-status hidden></p>
        <div class="iqai-v2-imagery-command__play">
          <button type="button" data-iqai-history-action="previous">PREVIOUS</button>
          <button type="button" data-iqai-history-action="play">PLAY</button>
          <button type="button" data-iqai-history-action="next">NEXT</button>
          <button type="button" data-iqai-history-action="compare">COMPARE</button>
        </div>
        <div class="iqai-v2-imagery-command__compare" data-iqai-history-compare hidden>
          <label>A
            <select data-iqai-compare-a></select>
          </label>
          <label>B
            <select data-iqai-compare-b></select>
          </label>
          <p data-iqai-compare-labels></p>
        </div>
        <button type="button" class="iqai-v2-imagery-command__source" data-iqai-source-details-toggle aria-expanded="false">SOURCE DETAILS</button>
        <dl class="iqai-v2-imagery-command__details" data-iqai-source-details hidden></dl>
        <button type="button" data-iqai-history-capture>CAPTURE</button>
        <p class="iqai-v2-imagery-command__export" data-iqai-export-status hidden></p>
      </div>
      ${renderRemoteSensingPanel()}
      <div class="iqai-v2-imagery-calendar" data-iqai-history-calendar hidden></div>
      <div class="iqai-v2-imagery-timeline" data-iqai-history-timeline hidden></div>
    </div>
  `;
}

export function renderHistoricalStage() {
  return `
    <div class="iqai-v2-history-stage" data-iqai-history-stage hidden aria-label="Historical overhead">
      <div class="iqai-v2-history-bar" data-iqai-history-bar hidden>
        <p data-iqai-history-now>HISTORY</p>
        <p data-iqai-history-date hidden>DATE UNKNOWN</p>
        <button type="button" data-iqai-history-source hidden></button>
        <p data-iqai-history-resolution hidden></p>
        <button type="button" data-iqai-history-step="-1">PREV</button>
        <button type="button" data-iqai-history-step="1">NEXT</button>
        <button type="button" data-iqai-history-compare aria-pressed="false">COMPARE</button>
        <button type="button" data-iqai-library-toggle aria-pressed="false">LIBRARY</button>
        <button type="button" data-iqai-history-remove>REMOVE FROM VIEW</button>
        <label class="iqai-v2-history-swipe" data-iqai-history-swipe hidden>
          <input type="range" min="0" max="100" value="50" data-iqai-history-swipe-input>
        </label>
        <p data-iqai-history-status hidden></p>
      </div>
      <div class="iqai-v2-history-canvas" data-iqai-history-canvas-host></div>
      <aside class="iqai-v2-history-library" data-iqai-history-library hidden>
        <header class="iqai-v2-history-library__chrome">
          <p>IMAGERY FOR THIS VIEW</p>
          <button type="button" data-iqai-history-remove hidden>REMOVE FROM VIEW</button>
          <button type="button" data-iqai-history-library-close>CLOSE</button>
        </header>
        <p class="iqai-v2-history-library__place" data-iqai-history-library-place></p>
        <div class="iqai-v2-history-library__list" data-iqai-history-library-list></div>
        <a class="iqai-v2-history-library__research" data-iqai-history-catalogue href="/temporal-catalog/" target="_blank" rel="noopener">RESEARCH CATALOGUE — LEAVES SPATIAL</a>
      </aside>
      <div class="iqai-v2-history-caption" data-iqai-history-caption="a" hidden>
        <p data-iqai-history-caption-date></p>
        <p data-iqai-history-caption-source></p>
        <p data-iqai-history-caption-place></p>
      </div>
      <div class="iqai-v2-history-caption iqai-v2-history-caption--b" data-iqai-history-caption="b" hidden>
        <p data-iqai-history-caption-date></p>
        <p data-iqai-history-caption-source></p>
        <p data-iqai-history-caption-place></p>
      </div>
    </div>
  `;
}

export function bindImageryCommandSurface(root, options = {}) {
  const command = root.querySelector('[data-iqai-imagery-command]');
  const stage = root.querySelector('[data-iqai-history-stage]');
  const mapHost = root.querySelector('[data-iqai-map-host]');
  if (!command) return null;

  const historyHooks = { onUseOnView: null };
  const historyHost = bindHistoryHost(root, {
    onUseOnView: (id) => historyHooks.onUseOnView?.(id)
  });
  let mode = IMAGE_SURFACE.MAP;
  let liveMode = IMAGE_SURFACE.MAP;
  let pendingKeepId = null;
  let pendingLibraryOpen = false;
  let preserved = null;
  let aerialProvider = null;
  let aerialMessage = null;
  let calendarOpen = false;
  let detailsOpen = false;
  let compareOpen = false;
  let busy = false;
  let pendingMode = null;

  function projection() {
    return projectImageSurface(mode);
  }

  function paintModes() {
    const proj = projection();
    root.dataset.iqaiImageSurface = mode;
    document.getElementById('iqai-spatial-v2')?.setAttribute('data-iqai-image-surface', mode);
    const buttons = [
      ...command.querySelectorAll('[data-iqai-image-surface]'),
      ...root.querySelectorAll('[data-iqai-image-surface]')
    ];
    for (const button of buttons) {
      const id = canonicalizeImageSurface(button.getAttribute('data-iqai-image-surface'));
      const heldHistory = id === IMAGE_SURFACE.HISTORY && HISTORY_SURFACE_HELD === true;
      const active = id === mode && !heldHistory;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
      if (heldHistory) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = 'HISTORY unavailable';
      } else if (id === IMAGE_SURFACE.HISTORY) {
        button.disabled = false;
        button.removeAttribute('aria-disabled');
        if (button.title === 'HISTORY unavailable') button.removeAttribute('title');
      }
    }
    const aerial = command.querySelector('[data-iqai-aerial-badge]');
    if (aerial) {
      aerial.hidden = mode !== IMAGE_SURFACE.AERIAL;
      aerial.textContent = aerialMessage || AERIAL_CURRENT_LABEL;
    }
    const chrome = command.querySelector('[data-iqai-history-chrome]');
    const timeline = command.querySelector('[data-iqai-history-timeline]');
    const calendar = command.querySelector('[data-iqai-history-calendar]');
    if (chrome) chrome.hidden = true;
    if (timeline) timeline.hidden = true;
    if (calendar) {
      calendar.hidden = true;
      calendarOpen = false;
    }
    if (stage) stage.hidden = !proj.historicalSurfaceVisible;
    if (mapHost) {
      mapHost.style.visibility = proj.mapViewVisible ? 'visible' : 'hidden';
      mapHost.setAttribute('data-iqai-map-shown', proj.mapViewVisible ? 'true' : 'false');
    }
    const libraryOpen = historyHost?.snapshot()?.libraryOpen === true;
    for (const button of root.querySelectorAll('[data-iqai-library-toggle]')) {
      button.setAttribute('aria-pressed', libraryOpen ? 'true' : 'false');
    }
  }

  function paintHistory() {
    historyHost?.paint?.();
  }

  async function closeSpecialists() {
    await options.closeSpecialists?.();
  }

  async function enterHistory() {
    const view = getMapView();
    preserved = readViewpoint(view) || preserved;
    await closeSpecialists();
    if (stage) stage.hidden = false;
    if (mapHost) {
      mapHost.style.visibility = 'hidden';
      mapHost.setAttribute('data-iqai-map-shown', 'false');
    }
    if (!historyHost) throw new Error(IMAGE_SURFACE_FAILURE.SOURCE_UNAVAILABLE);
    await historyHost.enter(preserved, {
      keepId: pendingKeepId,
      libraryOpen: pendingLibraryOpen === true
    });
    pendingKeepId = null;
    pendingLibraryOpen = false;
  }

  async function leaveHistory() {
    const last = historyHost?.snapshot()?.viewpoint || preserved;
    if (last) preserved = { ...preserved, ...last };
    historyHost?.leave?.();
    if (stage) stage.hidden = true;
    if (mapHost) {
      mapHost.style.visibility = 'visible';
      mapHost.setAttribute('data-iqai-map-shown', 'true');
    }
    const view = getMapView();
    await restoreViewpoint(view, preserved);
    if (view && typeof view.resize === 'function') view.resize();
  }

  async function enterAerial() {
    aerialMessage = AERIAL_CURRENT_LABEL;
    const candidate = aerialCandidate();
    try {
      await setIqaiGroundSurface('aerial');
      if (getIqaiGroundSurface() !== 'aerial') {
        throw new Error('Aerial surface did not attach.');
      }
      aerialProvider = candidate;
      aerialMessage = AERIAL_CURRENT_LABEL;
      const view = getMapView();
      void refreshAerialCaptureLabel(view).then((label) => {
        if (label) {
          aerialMessage = label;
          paintModes();
        }
      });
      if (view && typeof view.resize === 'function') view.resize();
    } catch (error) {
      aerialProvider = null;
      aerialMessage = IMAGE_SURFACE_FAILURE.SOURCE_UNAVAILABLE;
      console.warn('[IQAI V2] aerial surface failed', error);
      throw error;
    }
  }

  async function enterMap() {
    aerialProvider = null;
    aerialMessage = null;
    await setIqaiGroundSurface('map');
  }

  async function setMode(nextMode) {
    const next = canonicalizeImageSurface(nextMode);
    if (next === IMAGE_SURFACE.HISTORY && HISTORY_SURFACE_HELD === true) {
      paintModes();
      return snapshot();
    }
    if (next === IMAGE_SURFACE.MAP || next === IMAGE_SURFACE.AERIAL) {
      liveMode = next;
    }
    if (busy) {
      pendingMode = next;
      return snapshot();
    }
    if (next === mode) {
      if (next === IMAGE_SURFACE.MAP && getIqaiGroundSurface() !== 'map') {
        await setIqaiGroundSurface('map');
      }
      paintModes();
      return snapshot();
    }
    busy = true;
    pendingMode = null;
    const previous = mode;
    if (previous !== IMAGE_SURFACE.HISTORY) {
      preserved = readViewpoint(getMapView()) || preserved;
    }
    mode = next;
    calendarOpen = false;
    detailsOpen = false;
    compareOpen = false;
    paintModes();
    try {
      if (previous === IMAGE_SURFACE.HISTORY && next !== IMAGE_SURFACE.HISTORY) {
        await leaveHistory();
      }
      if (next === IMAGE_SURFACE.HISTORY) {
        await enterHistory();
      } else if (next === IMAGE_SURFACE.AERIAL) {
        await enterAerial();
        await restoreViewpoint(getMapView(), preserved);
      } else {
        await enterMap();
        await restoreViewpoint(getMapView(), preserved);
        const mapView = getMapView();
        if (mapView && typeof mapView.resize === 'function') mapView.resize();
      }
    } catch (error) {
      mode = previous;
      try {
        if (previous === IMAGE_SURFACE.MAP) await setIqaiGroundSurface('map');
        else if (previous === IMAGE_SURFACE.AERIAL) await setIqaiGroundSurface('aerial');
      } catch {
        /* keep the command state honest even if the surface revert races */
      }
      paintModes();
      console.warn('[IQAI V2] imagery command failed', error);
    }
    busy = false;
    paintModes();
    paintHistory();
    options.onMode?.(mode, snapshot());
    if (pendingMode) {
      const queued = pendingMode;
      pendingMode = null;
      const ground = getIqaiGroundSurface();
      const groundMatches = queued === IMAGE_SURFACE.MAP
        ? ground === 'map'
        : queued === IMAGE_SURFACE.AERIAL
          ? ground === 'aerial'
          : true;
      if (queued !== mode || !groundMatches) {
        return setMode(queued);
      }
    }
    return snapshot();
  }

  async function toggleLibraryPanel() {
    if (!historyHost) return snapshot();
    if (mode === IMAGE_SURFACE.HISTORY) {
      historyHost.toggleLibrary();
      paintModes();
      return snapshot();
    }
    if (historyHost.snapshot()?.libraryOpen) {
      historyHost.toggleLibrary(false);
      paintModes();
      return snapshot();
    }
    await historyHost.browse();
    paintModes();
    return snapshot();
  }

  function snapshot() {
    return {
      mode,
      projection: projection(),
      preserved,
      aerialProvider,
      aerialMessage,
      history: historyHost?.snapshot?.() || null,
      liveMode,
      remoteSensing: remoteSensing?.snapshot?.() || null,
      googleNonGoogleSeparated: projection().googlePixelsAllowed !== projection().historicalPixelsAllowed,
      mapViewCreateCount: options.getMapViewCreateCount?.() || null
    };
  }

  historyHooks.onUseOnView = async (id) => {
    pendingKeepId = id;
    pendingLibraryOpen = true;
    await setMode(IMAGE_SURFACE.HISTORY);
  };

  root.addEventListener('click', (event) => {
    const libraryToggle = event.target.closest('[data-iqai-library-toggle]');
    if (libraryToggle && root.contains(libraryToggle)) {
      void toggleLibraryPanel();
      return;
    }
    const remove = event.target.closest('[data-iqai-history-remove]');
    if (remove && root.contains(remove)) {
      void setMode(liveMode);
      return;
    }
    const surface = event.target.closest('[data-iqai-image-surface]');
    if (surface && root.contains(surface)) {
      void setMode(surface.getAttribute('data-iqai-image-surface'));
    }
  });

  const remoteSensing = bindRemoteSensingHost(root, {
    ensureMapVisible: async () => {
      if (mode === IMAGE_SURFACE.HISTORY) await setMode(IMAGE_SURFACE.MAP);
    }
  });

  paintModes();
  return Object.freeze({
    setMode,
    snapshot,
    previous: () => historyHost?.step(-1),
    next: () => historyHost?.step(1),
    play: () => historyHost?.snapshot?.(),
    pause: () => historyHost?.snapshot?.(),
    paint: () => {
      paintModes();
      paintHistory();
    }
  });
}
