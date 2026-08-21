/**
 * Bounded interactive 360 viewers for the Camera Wall.
 * TRI-VIEW may host up to TRI_VIEW_HEAVY_BUDGET live decoders.
 * Outside 3-UP, budget returns to 1. Token is never written into visible DOM.
 */

import { VISUAL_PROVIDER } from './provider-representation.js';
import { HEAVY_VIEWER_LIMIT, TRI_VIEW_HEAVY_BUDGET } from '../engine/view-slot.js';

const MAPILLARY_JS = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js';
const MAPILLARY_CSS = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.min.css';

let assetsPromise = null;
const instances = new Map();
const virtualViewListeners = new Set();

let lastVirtualView = Object.freeze({
  source: null,
  kind: 'VIRTUAL VIEW',
  heading: null,
  pitch: null,
  zoom: null,
  zoomKind: 'VIRTUAL ZOOM',
  opticalZoom: false,
  mutatesCameraPose: false
});

let lastTriViewReport = Object.freeze({
  requestedBudget: TRI_VIEW_HEAVY_BUDGET,
  actualHeavyCount: 0,
  viewerDomCount: 0,
  loaded: Object.freeze([]),
  failed: Object.freeze([]),
  lightweight: Object.freeze([]),
  fallback: false,
  mutatesCameraPose: false
});

function emptyVirtualView(source = null) {
  return Object.freeze({
    source,
    kind: 'VIRTUAL VIEW',
    heading: null,
    pitch: null,
    zoom: null,
    zoomKind: 'VIRTUAL ZOOM',
    opticalZoom: false,
    mutatesCameraPose: false
  });
}

export const VIEWER_PANE_STATE = Object.freeze({
  SEARCHING: 'SEARCHING',
  LOADING: 'LOADING',
  READY: 'READY',
  RETRYING: 'RETRYING',
  UNAVAILABLE: 'UNAVAILABLE'
});

const MAX_VIEWER_RECOVERIES = 2;
const MIN_HOST_PX = 24;

function paneStateLabel(state, provider) {
  if (state === VIEWER_PANE_STATE.SEARCHING) return 'FINDING STREET VIEW';
  if (state === VIEWER_PANE_STATE.LOADING) {
    if (provider === VISUAL_PROVIDER.MAPILLARY) return 'LOADING MAPILLARY';
    if (provider) return 'LOADING GOOGLE 360';
    return 'LOADING CAMERA VIEW';
  }
  if (state === VIEWER_PANE_STATE.RETRYING) return 'RECONNECTING VIEW';
  if (state === VIEWER_PANE_STATE.UNAVAILABLE) return 'VIEW UNAVAILABLE';
  return 'CAMERA MODE READY';
}

export function setViewerPaneState(stage, slotId, state, label = null, provider = null) {
  if (!stage) return null;
  let overlay = stage.querySelector('[data-iqai-viewer-state]');
  if (!overlay) {
    overlay = document.createElement('p');
    overlay.setAttribute('data-iqai-viewer-state', state);
    overlay.className = 'iqai-v2-camera-wall__viewer-state';
    stage.appendChild(overlay);
  }
  overlay.setAttribute('data-iqai-viewer-state', state);
  overlay.setAttribute('data-iqai-viewer-slot', String(slotId || ''));
  overlay.textContent = label || paneStateLabel(state, provider);
  const inst = instances.get(String(slotId || ''));
  if (inst) inst.paneState = state;
  return state;
}

export function getViewerPaneStates() {
  return Object.freeze([...instances.entries()].map(([slotId, inst]) => Object.freeze({
    slotId,
    state: inst.paneState || VIEWER_PANE_STATE.LOADING,
    recoveries: Number(inst.recoveries) || 0,
    provider: inst.provider || null,
    key: inst.key || null
  })));
}

function hostHasTiles(host) {
  return Boolean(host?.querySelector?.('.gm-style, canvas, iframe, .mapillary-js'));
}

function measurableBox(el) {
  const box = el?.getBoundingClientRect?.();
  const width = Number(box?.width) || 0;
  const height = Number(box?.height) || 0;
  return { width, height, ok: width >= MIN_HOST_PX && height >= MIN_HOST_PX };
}

async function waitForMeasurableBox(el, timeoutMs = 900) {
  const started = Date.now();
  let box = measurableBox(el);
  while (!box.ok && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    box = measurableBox(el);
  }
  return box;
}

function rememberPov(inst) {
  try {
    if (inst.google) {
      const pov = inst.google.getPov?.() || {};
      inst.savedPov = {
        heading: Number.isFinite(Number(pov.heading)) ? Number(pov.heading) : null,
        pitch: Number.isFinite(Number(pov.pitch)) ? Number(pov.pitch) : null,
        zoom: Number.isFinite(Number(inst.google.getZoom?.())) ? Number(inst.google.getZoom()) : null
      };
    }
  } catch { /* keep last */ }
}

function restorePov(inst) {
  const pov = inst.savedPov;
  if (!pov || !inst.google) return;
  try {
    if (Number.isFinite(pov.heading) || Number.isFinite(pov.pitch)) {
      inst.google.setPov?.({
        heading: Number.isFinite(pov.heading) ? pov.heading : 0,
        pitch: Number.isFinite(pov.pitch) ? pov.pitch : 0
      });
    }
    if (Number.isFinite(pov.zoom)) inst.google.setZoom?.(pov.zoom);
  } catch { /* view-only */ }
}

async function recoverGoogleViewer(inst) {
  if (!inst?.google || !inst.host) return false;
  rememberPov(inst);
  await waitForMeasurableBox(inst.host, 600);
  try { inst.google.setVisible?.(true); } catch { /* ignore */ }
  try { window.google?.maps?.event?.trigger?.(inst.google, 'resize'); } catch { /* ignore */ }
  restorePov(inst);
  await new Promise((resolve) => setTimeout(resolve, 90));
  return hostHasTiles(inst.host) && !mapsJsAuthFailed(inst.host);
}

function observeHostSize(inst) {
  if (inst.ro || typeof ResizeObserver !== 'function' || !inst.host) return;
  inst.lastBox = measurableBox(inst.host);
  inst.ro = new ResizeObserver(() => {
    const box = measurableBox(inst.host);
    const grew = box.ok && (!inst.lastBox?.ok);
    inst.lastBox = box;
    if (grew && inst.google) {
      setViewerPaneState(inst.stage, inst.slotId, VIEWER_PANE_STATE.RETRYING, null, inst.provider);
      void recoverGoogleViewer(inst).then((ok) => {
        setViewerPaneState(
          inst.stage,
          inst.slotId,
          ok ? VIEWER_PANE_STATE.READY : VIEWER_PANE_STATE.RETRYING,
          null,
          inst.provider
        );
      });
    }
  });
  inst.ro.observe(inst.host);
}

function disconnectHostSize(inst) {
  try { inst.ro?.disconnect?.(); } catch { /* parked */ }
  inst.ro = null;
}

function mapsJsAuthFailed(root) {
  const node = root?.querySelector?.('.gm-err-container, .gm-err-message, .gm-err-title');
  if (!node) return false;
  return /didn't load Google Maps correctly|Oops! Something went wrong/i.test(node.textContent || '');
}

function representationKey(representation) {
  if (!representation?.providerId) return null;
  return `${representation.provider}::${representation.providerId}`;
}

function publishVirtualView(view) {
  lastVirtualView = view || lastVirtualView;
  for (const listener of virtualViewListeners) {
    try { listener(lastVirtualView); } catch { /* ignore */ }
  }
}

function readInstanceVirtualView(inst) {
  try {
    if (inst?.google) {
      const pov = inst.google.getPov?.() || {};
      const zoom = Number(inst.google.getZoom?.());
      return Object.freeze({
        source: VISUAL_PROVIDER.GOOGLE_STREET360,
        kind: 'VIRTUAL VIEW',
        heading: Number.isFinite(Number(pov.heading)) ? Number(pov.heading) : null,
        pitch: Number.isFinite(Number(pov.pitch)) ? Number(pov.pitch) : null,
        zoom: Number.isFinite(zoom) ? zoom : null,
        zoomKind: 'VIRTUAL ZOOM',
        opticalZoom: false,
        mutatesCameraPose: false
      });
    }
  } catch { /* unread */ }
  try {
    if (inst?.mapillary) {
      const heading = Number(inst.mapillary.getBearing?.());
      const pitch = Number(inst.mapillary.getTilt?.() ?? inst.mapillary.getPitch?.());
      const zoom = Number(inst.mapillary.getZoom?.());
      return Object.freeze({
        source: VISUAL_PROVIDER.MAPILLARY,
        kind: 'VIRTUAL VIEW',
        heading: Number.isFinite(heading) ? heading : null,
        pitch: Number.isFinite(pitch) ? pitch : null,
        zoom: Number.isFinite(zoom) ? zoom : null,
        zoomKind: 'VIRTUAL ZOOM',
        opticalZoom: false,
        mutatesCameraPose: false
      });
    }
  } catch { /* unread */ }
  return emptyVirtualView();
}

function bindVirtualListeners(inst) {
  const listeners = [];
  try {
    if (inst.google) {
      const povListener = inst.google.addListener?.('pov_changed', () => publishVirtualView(readInstanceVirtualView(inst)));
      const zoomListener = inst.google.addListener?.('zoom_changed', () => publishVirtualView(readInstanceVirtualView(inst)));
      if (povListener) listeners.push(() => povListener.remove?.());
      if (zoomListener) listeners.push(() => zoomListener.remove?.());
    }
  } catch { /* view controls remain */ }
  try {
    if (inst.mapillary) {
      const offBearing = inst.mapillary.on?.('bearing', () => publishVirtualView(readInstanceVirtualView(inst)));
      const offFov = inst.mapillary.on?.('fov', () => publishVirtualView(readInstanceVirtualView(inst)));
      const offPitch = inst.mapillary.on?.('pitch', () => publishVirtualView(readInstanceVirtualView(inst)));
      if (typeof offBearing === 'function') listeners.push(offBearing);
      if (typeof offFov === 'function') listeners.push(offFov);
      if (typeof offPitch === 'function') listeners.push(offPitch);
    }
  } catch { /* Mapillary still supports pointer pan/zoom */ }
  inst.listeners = listeners;
}

function clearInstanceListeners(inst) {
  for (const remove of inst.listeners || []) {
    try { remove(); } catch { /* parked */ }
  }
  inst.listeners = [];
}

async function parkInstance(slotId) {
  const inst = instances.get(slotId);
  if (!inst) return;
  disconnectHostSize(inst);
  clearInstanceListeners(inst);
  try { inst.google?.setVisible?.(false); } catch { /* parked */ }
  inst.google = null;
  try { inst.mapillary?.remove?.(); } catch { /* parked */ }
  inst.mapillary = null;
  if (inst.stage) inst.stage.replaceChildren();
  instances.delete(slotId);
}

function paintUnavailable(stage, status) {
  if (!stage) return;
  stage.replaceChildren();
  const p = document.createElement('p');
  p.setAttribute('data-iqai-camera-wall-unavailable', status || 'UNAVAILABLE');
  p.textContent = status === 'NO_PROVIDER'
    ? 'UNAVAILABLE'
    : 'UNAVAILABLE';
  stage.appendChild(p);
}

function paintLightweight(stage, representation) {
  if (!stage) return;
  stage.replaceChildren();
  if (representation?.thumbUrl) {
    const img = document.createElement('img');
    img.alt = 'PROVIDER REPRESENTATION';
    img.src = representation.thumbUrl;
    img.setAttribute('data-iqai-camera-wall-preview', representation.provider || 'provider');
    stage.appendChild(img);
    return { heavy: false, liveDecoders: instances.size, lightweight: true };
  }
  paintUnavailable(stage, representation?.providerId ? 'PREVIEW_UNAVAILABLE' : 'NO_PROVIDER');
  return { heavy: false, liveDecoders: instances.size, lightweight: true, status: 'PREVIEW_UNAVAILABLE' };
}

function loadMapillaryAssets() {
  if (window.mapillary) return Promise.resolve(window.mapillary);
  if (assetsPromise) return assetsPromise;
  assetsPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-iqai-wall-mapillary-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPILLARY_CSS;
      link.setAttribute('data-iqai-wall-mapillary-css', 'true');
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = MAPILLARY_JS;
    script.async = true;
    script.onload = () => resolve(window.mapillary || null);
    script.onerror = () => reject(new Error('MAPILLARY_JS_LOAD_FAILED'));
    document.head.appendChild(script);
  });
  return assetsPromise;
}

async function streetViewPanoramaCtor() {
  const google = window.google;
  if (typeof google?.maps?.StreetViewPanorama === 'function') return google.maps.StreetViewPanorama;
  try {
    const lib = await google?.maps?.importLibrary?.('streetView');
    return lib?.StreetViewPanorama || google?.maps?.StreetViewPanorama || null;
  } catch {
    return google?.maps?.StreetViewPanorama || null;
  }
}

export function getWallHeavyVirtualView() {
  return lastVirtualView;
}

export function subscribeWallHeavyVirtualView(listener) {
  if (typeof listener !== 'function') return () => {};
  virtualViewListeners.add(listener);
  return () => virtualViewListeners.delete(listener);
}

export function applyWallHeavyVirtualView(input = {}) {
  const heading = Number.isFinite(Number(input.heading)) ? Number(input.heading) : lastVirtualView.heading;
  const pitch = Number.isFinite(Number(input.pitch)) ? Number(input.pitch) : lastVirtualView.pitch;
  const zoom = Number.isFinite(Number(input.zoom)) ? Number(input.zoom) : lastVirtualView.zoom;
  let applied = lastVirtualView;
  for (const inst of instances.values()) {
    if (inst.google) {
      try {
        if (Number.isFinite(heading) || Number.isFinite(pitch)) {
          inst.google.setPov?.({
            heading: Number.isFinite(heading) ? heading : 0,
            pitch: Number.isFinite(pitch) ? pitch : 0
          });
        }
      } catch { /* view-only */ }
      if (Number.isFinite(zoom)) {
        try { inst.google.setZoom?.(zoom); } catch { /* view-only */ }
      }
      applied = Object.freeze({
        source: VISUAL_PROVIDER.GOOGLE_STREET360,
        kind: 'VIRTUAL VIEW',
        heading: Number.isFinite(heading) ? heading : null,
        pitch: Number.isFinite(pitch) ? pitch : null,
        zoom: Number.isFinite(zoom) ? zoom : null,
        zoomKind: 'VIRTUAL ZOOM',
        opticalZoom: false,
        mutatesCameraPose: false
      });
    } else if (inst.mapillary) {
      if (Number.isFinite(zoom)) {
        try { inst.mapillary.setZoom?.(zoom); } catch { /* view-only */ }
      }
      applied = Object.freeze({
        source: VISUAL_PROVIDER.MAPILLARY,
        kind: 'VIRTUAL VIEW',
        heading: Number.isFinite(heading) ? heading : null,
        pitch: Number.isFinite(pitch) ? pitch : null,
        zoom: Number.isFinite(zoom) ? zoom : null,
        zoomKind: 'VIRTUAL ZOOM',
        opticalZoom: false,
        mutatesCameraPose: false
      });
    }
  }
  publishVirtualView(applied);
  return lastVirtualView;
}

export function getLiveHeavyViewerCount() {
  return instances.size;
}

export function getTriViewHeavyReport() {
  return lastTriViewReport;
}

export function recordTriViewHeavyReport(report = {}) {
  lastTriViewReport = Object.freeze({
    requestedBudget: Number(report.requestedBudget) || TRI_VIEW_HEAVY_BUDGET,
    actualHeavyCount: Number(report.actualHeavyCount) || 0,
    viewerDomCount: Number(report.viewerDomCount) || 0,
    loaded: Object.freeze([...(report.loaded || [])]),
    failed: Object.freeze([...(report.failed || [])]),
    lightweight: Object.freeze([...(report.lightweight || [])]),
    fallback: report.fallback === true,
    mutatesCameraPose: false
  });
  return lastTriViewReport;
}

export function resizeWallHeavyViewer() {
  for (const inst of instances.values()) {
    if (inst.google) void recoverGoogleViewer(inst);
    try { inst.mapillary?.resize?.(); } catch { /* ignore */ }
  }
}

export async function recoverWallHeavyViewers() {
  const results = [];
  for (const inst of instances.values()) {
    if (inst.google) {
      const alreadyReady = inst.paneState === VIEWER_PANE_STATE.READY && hostHasTiles(inst.host);
      if (!alreadyReady) {
        setViewerPaneState(inst.stage, inst.slotId, VIEWER_PANE_STATE.RETRYING, null, inst.provider);
      }
      const ok = await recoverGoogleViewer(inst);
      setViewerPaneState(
        inst.stage,
        inst.slotId,
        ok ? VIEWER_PANE_STATE.READY : VIEWER_PANE_STATE.RETRYING,
        null,
        inst.provider
      );
      results.push({ slotId: inst.slotId, ok, recoveries: Number(inst.recoveries) || 0 });
    } else if (inst.mapillary) {
      try { inst.mapillary.resize?.(); } catch { /* ignore */ }
      setViewerPaneState(inst.stage, inst.slotId, VIEWER_PANE_STATE.READY, null, inst.provider);
      results.push({ slotId: inst.slotId, ok: true, recoveries: 0 });
    }
  }
  return Object.freeze(results);
}

export async function parkWallHeavyViewer(stage) {
  if (stage) {
    const found = [...instances.entries()].find(([, inst]) => inst.stage === stage);
    if (found) {
      await parkInstance(found[0]);
      return;
    }
  }
  for (const slotId of [...instances.keys()]) {
    await parkInstance(slotId);
  }
  if (stage) stage.replaceChildren();
  publishVirtualView(emptyVirtualView());
}

export async function parkAllWallHeavyViewers() {
  for (const slotId of [...instances.keys()]) {
    await parkInstance(slotId);
  }
  publishVirtualView(emptyVirtualView());
}

export async function activateWallHeavyViewer(stage, representation, options = {}) {
  const slotId = String(options.slotId || 'active');
  const budget = Math.max(0, Number(options.budget ?? HEAVY_VIEWER_LIMIT) || 0);
  const key = representationKey(representation);
  if (!stage || !key) {
    await parkInstance(slotId);
    setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE);
    paintUnavailable(stage, 'NO_PROVIDER');
    return { liveDecoders: instances.size, heavy: false, status: 'NO_PROVIDER', slotId };
  }

  async function reuseExisting(inst) {
    if (inst.host && inst.host.parentElement !== stage) {
      stage.appendChild(inst.host);
      const overlay = stage.querySelector('[data-iqai-viewer-state]');
      if (overlay) stage.appendChild(overlay);
      inst.stage = stage;
    }
    inst.stage = stage;
    if (inst.mapillary) {
      try { inst.mapillary.resize?.(); } catch { /* ignore */ }
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.READY, null, inst.provider);
      return { liveDecoders: instances.size, heavy: true, provider: representation.provider, slotId, recovered: true };
    }
    if (!inst.google) return null;
    const recovered = await recoverGoogleViewer(inst);
    if (recovered) {
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.READY, null, inst.provider);
      return { liveDecoders: instances.size, heavy: true, provider: representation.provider, slotId, recovered: true };
    }
    return null;
  }

  const existing = instances.get(slotId);
  if (existing && existing.key === key && !mapsJsAuthFailed(stage) && !mapsJsAuthFailed(existing.host)) {
    const reused = await reuseExisting(existing);
    if (reused) return reused;
    const recoveries = Number(existing.recoveries) || 0;
    if (recoveries >= MAX_VIEWER_RECOVERIES) {
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, existing.provider);
      return { liveDecoders: instances.size, heavy: false, status: 'RECOVERY_FAILED', slotId };
    }
    existing.recoveries = recoveries + 1;
    setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.RETRYING, null, existing.provider);
    rememberPov(existing);
    await parkInstance(slotId);
  } else if (!existing && instances.size >= budget) {
    paintLightweight(stage, representation);
    setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.READY, null, representation.provider);
    return {
      liveDecoders: instances.size,
      heavy: false,
      lightweight: true,
      status: 'HEAVY_BUDGET',
      slotId
    };
  } else if (existing && existing.key !== key) {
    await parkInstance(slotId);
  }

  setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.LOADING, null, representation.provider);
  await waitForMeasurableBox(stage, 900);

  if (representation.provider === VISUAL_PROVIDER.GOOGLE_STREET360) {
    const Panorama = await streetViewPanoramaCtor();
    if (typeof Panorama !== 'function') {
      paintLightweight(stage, representation);
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, representation.provider);
      return { liveDecoders: instances.size, heavy: false, lightweight: true, status: 'GOOGLE_STREET_VIEW_UNAVAILABLE', slotId };
    }
    const host = document.createElement('div');
    host.className = 'iqai-v2-camera-wall__pano';
    host.setAttribute('data-iqai-camera-wall-heavy-kind', 'google');
    host.setAttribute('data-iqai-camera-wall-heavy-slot', slotId);
    stage.appendChild(host);
    setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.LOADING, null, representation.provider);
    await waitForMeasurableBox(host, 900);
    const heading = Number.isFinite(Number(representation.compassDeg)) ? Number(representation.compassDeg) : 0;
    const google = new Panorama(host, {
      pano: representation.providerId,
      pov: { heading, pitch: 0 },
      zoom: 1,
      visible: true,
      disableDefaultUI: true,
      addressControl: false,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
      clickToGo: true,
      linksControl: true,
      panControl: true,
      zoomControl: true,
      scrollwheel: true,
      imageDateControl: true,
      showRoadLabels: false
    });
    const inst = {
      slotId,
      key,
      provider: representation.provider,
      google,
      mapillary: null,
      host,
      stage,
      listeners: [],
      recoveries: Number(options.recoveries) || Number(existing?.recoveries) || 0,
      paneState: VIEWER_PANE_STATE.LOADING,
      savedPov: { heading, pitch: 0, zoom: 1 }
    };
    instances.set(slotId, inst);
    bindVirtualListeners(inst);
    observeHostSize(inst);
    try {
      google.addListener?.('status_changed', () => {
        const status = String(google.getStatus?.() || '');
        if (status === 'OK' || hostHasTiles(host)) {
          setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.READY, null, inst.provider);
        } else if (status && status !== 'OK') {
          setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, inst.provider);
        }
      });
    } catch { /* overlay remains until tiles */ }
    try { window.google?.maps?.event?.trigger?.(google, 'resize'); } catch { /* ignore */ }
    publishVirtualView(Object.freeze({
      source: VISUAL_PROVIDER.GOOGLE_STREET360,
      kind: 'VIRTUAL VIEW',
      heading,
      pitch: 0,
      zoom: 1,
      zoomKind: 'VIRTUAL ZOOM',
      opticalZoom: false,
      mutatesCameraPose: false
    }));
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (mapsJsAuthFailed(host) || mapsJsAuthFailed(stage)) {
        await parkInstance(slotId);
        paintLightweight(stage, representation);
        setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, representation.provider);
        return { liveDecoders: instances.size, heavy: false, lightweight: true, status: 'GOOGLE_MAPS_JS_AUTH_FAILED', slotId };
      }
      if (hostHasTiles(host)) break;
    }
    const ready = hostHasTiles(host) && !mapsJsAuthFailed(host);
    if (!ready && inst.recoveries < MAX_VIEWER_RECOVERIES) {
      inst.recoveries += 1;
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.RETRYING, null, representation.provider);
      await recoverGoogleViewer(inst);
    }
    const recovered = hostHasTiles(host) && !mapsJsAuthFailed(host);
    if (!recovered) {
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, representation.provider);
      return { liveDecoders: instances.size, heavy: false, status: 'GOOGLE_ATTACH_FAILED', slotId };
    }
    setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.READY, null, representation.provider);
    return { liveDecoders: instances.size, heavy: true, provider: representation.provider, slotId };
  }
  if (representation.provider === VISUAL_PROVIDER.MAPILLARY) {
    const config = await fetch('/spatial-v2/api/camera-providers/mapillary-viewer-config', { cache: 'no-store' })
      .then((res) => res.json())
      .catch(() => ({ configured: false }));
    if (!config?.configured || !config.accessToken) {
      paintLightweight(stage, representation);
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, representation.provider);
      return {
        liveDecoders: instances.size,
        heavy: false,
        lightweight: true,
        status: 'MAPILLARY_CREDENTIAL_REQUIRED',
        slotId
      };
    }
    try {
      const lib = await loadMapillaryAssets();
      const Viewer = lib?.Viewer;
      if (!Viewer) throw new Error('MAPILLARY_JS_UNAVAILABLE');
      const host = document.createElement('div');
      host.className = 'iqai-v2-camera-wall__pano';
      host.setAttribute('data-iqai-camera-wall-heavy-kind', 'mapillary');
      host.setAttribute('data-iqai-camera-wall-heavy-slot', slotId);
      stage.appendChild(host);
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.LOADING, null, representation.provider);
      await waitForMeasurableBox(host, 900);
      const mapillary = new Viewer({
        accessToken: config.accessToken,
        container: host,
        imageId: String(representation.providerId)
      });
      const inst = {
        slotId,
        key,
        provider: representation.provider,
        google: null,
        mapillary,
        host,
        stage,
        listeners: [],
        recoveries: 0,
        paneState: VIEWER_PANE_STATE.LOADING
      };
      instances.set(slotId, inst);
      bindVirtualListeners(inst);
      observeHostSize(inst);
      try { mapillary.resize?.(); } catch { /* ignore */ }
      publishVirtualView(Object.freeze({
        source: VISUAL_PROVIDER.MAPILLARY,
        kind: 'VIRTUAL VIEW',
        heading: Number.isFinite(Number(representation.compassDeg)) ? Number(representation.compassDeg) : null,
        pitch: 0,
        zoom: 1,
        zoomKind: 'VIRTUAL ZOOM',
        opticalZoom: false,
        mutatesCameraPose: false
      }));
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.READY, null, representation.provider);
      return { liveDecoders: instances.size, heavy: true, provider: representation.provider, slotId };
    } catch {
      paintLightweight(stage, representation);
      setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE, null, representation.provider);
      return { liveDecoders: instances.size, heavy: false, lightweight: true, status: 'MAPILLARY_JS_UNAVAILABLE', slotId };
    }
  }
  await parkInstance(slotId);
  setViewerPaneState(stage, slotId, VIEWER_PANE_STATE.UNAVAILABLE);
  paintUnavailable(stage, 'NO_PROVIDER');
  return { liveDecoders: instances.size, heavy: false, slotId };
}
