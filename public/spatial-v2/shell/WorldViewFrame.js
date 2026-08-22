/**
 * WorldView Frame V1 — multiple observation panes over one MapView.
 * Layout is host chrome. FocusRef and temporal.requested stay World State.
 * Live camera context is worldview-navigation.js, not FocusRef.
 * Does not construct MapView. Does not invent observation catalogs.
 */

import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import { getMapView } from '../map/map-foundation.js';
import { resizeGoogleStreetView } from '../map/google-street-view.js';
import { getWorldviewNavigation, seedWorldviewNavigationFromFocus } from '../map/worldview-navigation.js';
import { beginProgrammaticTraversal } from '../map/worldview-traversal.js';

export const WORLDVIEW_PANE = Object.freeze({
  MAP: 'MAP',
  STREET_360: 'STREET 360',
  VISUAL_3D: '3D VISUAL',
  IMAGERY: 'IMAGERY'
});

export const CAMERA_MODE_LOCK_TITLE = 'CAMERA MODE ACTIVE — USE BACK TO MAIN VIEW';

const LAYOUT_PANES = Object.freeze({
  1: [WORLDVIEW_PANE.MAP],
  2: [WORLDVIEW_PANE.MAP, WORLDVIEW_PANE.STREET_360],
  3: [WORLDVIEW_PANE.MAP, WORLDVIEW_PANE.VISUAL_3D, WORLDVIEW_PANE.STREET_360],
  4: [WORLDVIEW_PANE.MAP, WORLDVIEW_PANE.VISUAL_3D, WORLDVIEW_PANE.STREET_360, WORLDVIEW_PANE.IMAGERY]
});

function formatTargetDay(iso) {
  if (!iso) return 'NOW';
  const day = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'NOW';
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(utc).toUpperCase();
}

export function bindWorldViewFrame(root, options = {}) {
  const well = root?.querySelector('[data-iqai-view-host]');
  const frame = root?.querySelector('[data-iqai-worldview-frame]');
  const layoutRoot = root?.querySelector('[data-iqai-layout-switcher]');
  const street360 = options.street360;
  const google3d = options.google3d;
  const analyze3d = options.analyze3d;
  const viewSwitcher = options.viewSwitcher;

  let layout = 1;
  let pairView = WORLDVIEW_PANE.STREET_360;
  let maximized = null;
  let busy = false;
  let splitTop = 62;
  let splitLeft = 63;
  let dragging = null;
  let cameraViz = false;
  let cameraVizRestore = null;

  function panesFor(wantedLayout = layout, wantedPair = pairView) {
    if (wantedLayout === 2) return [WORLDVIEW_PANE.MAP, wantedPair];
    return LAYOUT_PANES[wantedLayout] || LAYOUT_PANES[1];
  }

  function panesForLayout() {
    return panesFor(layout, pairView);
  }

  function hasGeographicContext() {
    return Boolean(
      getActiveSpatialFocus()
      || getWorldviewNavigation()
      || street360?.bindMode?.() === 'camera'
    );
  }

  function seedFromMapIfNeeded() {
    if (getActiveSpatialFocus() || getWorldviewNavigation()) return;
    const view = getMapView();
    const longitude = Number(view?.center?.longitude);
    const latitude = Number(view?.center?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    seedWorldviewNavigationFromFocus({ longitude, latitude });
  }

  function resizeMap() {
    beginProgrammaticTraversal(1200);
    const mapHost = root?.querySelector('[data-iqai-map-host]');
    if (mapHost) {
      mapHost.style.visibility = 'visible';
      mapHost.setAttribute('data-iqai-map-shown', 'true');
    }
    const view = getMapView();
    view?.resize?.();
    view?.requestRender?.();
    resizeGoogleStreetView();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applySplitVars() {
    if (!frame) return;
    frame.style.setProperty('--iqai-split-top', `${splitTop}%`);
    frame.style.setProperty('--iqai-split-left', `${splitLeft}%`);
  }

  function paintSplitters() {
    const host = well?.querySelector('[data-iqai-splitters]');
    const row = host?.querySelector('[data-iqai-split="row"]');
    const col = host?.querySelector('[data-iqai-split="col"]');
    if (!host) return;
    const show = layout >= 2 && !maximized && !analyzeOpen() && !cameraViz;
    host.hidden = !show;
    if (row) {
      row.hidden = layout < 3;
      row.style.top = `${splitTop}%`;
    }
    if (col) {
      col.hidden = false;
      col.style.left = `${splitLeft}%`;
      col.style.top = layout >= 3 ? `${splitTop}%` : '0';
      col.style.height = layout >= 3 ? `${100 - splitTop}%` : '100%';
    }
    applySplitVars();
  }

  function paneEls() {
    return [...(frame?.querySelectorAll('[data-iqai-pane]') || [])];
  }

  function paintTruth() {
    const focus = getActiveSpatialFocus();
    const temporal = options.getTemporal?.() || null;
    const target = formatTargetDay(temporal?.requested?.instantOrInterval);
    const street = street360?.snapshot?.() || {};
    const visual = google3d?.snapshot?.() || {};
    const mapTruth = root.querySelector('[data-iqai-pane-truth="MAP"]');
    const streetTruth = root.querySelector('[data-iqai-pane-truth="STREET 360"]');
    const visualTruth = root.querySelector('[data-iqai-pane-truth="3D VISUAL"]');
    const imageryTruth = root.querySelector('[data-iqai-pane-truth="IMAGERY"]');
    const imagery = options.imagerySnapshot?.() || null;
    if (mapTruth) {
      mapTruth.textContent = focus
        ? `TARGET ${target}`
        : 'NO FOCUS';
    }
    if (streetTruth) {
      const captured = street.capture?.text && street.capture.precision !== 'UNKNOWN'
        ? `CAPTURED ${street.capture.text}`
        : (street.open ? 'CAPTURE DATE UNKNOWN' : 'NOT OPEN');
      streetTruth.textContent = `TARGET ${target} · STREET 360 ${captured}`;
    }
    if (visualTruth) {
      visualTruth.textContent = `TARGET ${target} · GOOGLE 3D CURRENT ONLY`;
    }
    if (imageryTruth) {
      const history = imagery?.history || null;
      const source = history?.receipt?.provider || history?.status || '';
      imageryTruth.textContent = history?.open
        ? (source ? String(source).toUpperCase() : 'IMAGERY')
        : 'NEARMAP / LIBRARY';
    }
    for (const pane of paneEls()) {
      const sync = pane.querySelector('[data-iqai-pane-sync]');
      if (!sync) continue;
      const view = pane.getAttribute('data-iqai-pane');
      if (view === WORLDVIEW_PANE.IMAGERY) sync.textContent = 'FOCUS';
      else if (view === WORLDVIEW_PANE.VISUAL_3D) sync.textContent = 'FOCUS · TIME OFF';
      else sync.textContent = 'FOCUS · TIME';
    }
  }

  function analyzeOpen() {
    const snap = analyze3d?.snapshot?.() || {};
    return snap.open === true
      || ['OPENING', 'OPEN', 'CLOSING', 'UNAVAILABLE'].includes(snap.stageState);
  }

  function paintCameraPaneRecovery() {
    const recovery = root?.querySelector('[data-iqai-camera-pane-recovery]');
    const stateEl = recovery?.querySelector('[data-iqai-camera-pane-state]');
    if (!recovery) return;
    const wall = root?.querySelector('[data-iqai-camera-wall]');
    const wallOpen = wall && wall.hidden !== true && wall.getAttribute('data-iqai-camera-wall-open') === 'true';
    const hint = recovery.querySelector('.iqai-v2-camera-pane-recovery__hint');
    if (!cameraViz) {
      recovery.hidden = true;
      recovery.setAttribute('data-iqai-camera-pane-kind', 'idle');
      return;
    }
    if (wallOpen) {
      recovery.hidden = true;
      recovery.setAttribute('data-iqai-camera-pane-kind', 'wall');
      return;
    }
    recovery.hidden = false;
    recovery.setAttribute('data-iqai-camera-pane-kind', 'empty');
    if (stateEl) stateEl.textContent = 'NO CAMERA VIEW ACTIVE';
    if (hint) hint.textContent = 'RETURN TO MAIN VIEW — this pane has no camera view.';
  }

  function paint() {
    if (well) {
      well.dataset.iqaiWorldviewLayout = String(layout);
      if (maximized) well.dataset.iqaiWorldviewMaximized = maximized;
      else delete well.dataset.iqaiWorldviewMaximized;
      if (cameraViz) well.dataset.iqaiCameraViz = 'true';
      else delete well.dataset.iqaiCameraViz;
      if (!analyzeOpen()) {
        well.dataset.iqaiSpecialistView = layout === 1 ? '2d' : 'worldview';
      }
    }
    if (root && !analyzeOpen()) {
      root.dataset.iqaiWorldviewLayout = String(layout);
      root.dataset.iqaiSpatialView = layout === 1 ? '2d' : 'worldview';
    } else if (root) {
      root.dataset.iqaiWorldviewLayout = String(layout);
    }
    if (root) {
      if (maximized) root.dataset.iqaiWorldviewMaximized = maximized;
      else delete root.dataset.iqaiWorldviewMaximized;
      if (cameraViz) root.dataset.iqaiCameraViz = 'true';
      else delete root.dataset.iqaiCameraViz;
    }
    const visible = new Set(panesForLayout());
    for (const pane of paneEls()) {
      const view = pane.getAttribute('data-iqai-pane');
      let show = visible.has(view) && (!maximized || maximized === view);
      if (cameraViz) {
        if (view === WORLDVIEW_PANE.VISUAL_3D || view === WORLDVIEW_PANE.IMAGERY) show = false;
        if (view === WORLDVIEW_PANE.MAP || view === WORLDVIEW_PANE.STREET_360) show = true;
      }
      pane.hidden = !show;
      pane.classList.toggle('is-primary', view === WORLDVIEW_PANE.MAP && !maximized);
      pane.classList.toggle('is-maximized', maximized === view);
      const restore = pane.querySelector('[data-iqai-pane-restore]');
      const maximize = pane.querySelector('[data-iqai-pane-maximize]');
      if (restore) restore.hidden = cameraViz || maximized !== view;
      if (maximize) maximize.hidden = cameraViz || (Boolean(maximized) && maximized !== view);
      const close = pane.querySelector('[data-iqai-pane-close]');
      const change = pane.querySelector('[data-iqai-pane-change]');
      if (close) close.hidden = cameraViz;
      if (change) change.hidden = cameraViz;
    }
    paintCameraPaneRecovery();
    for (const button of root?.querySelectorAll('[data-iqai-view]') || []) {
      if (cameraViz) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = CAMERA_MODE_LOCK_TITLE;
        button.dataset.iqaiCameraLock = 'true';
      } else if (button.dataset.iqaiCameraLock === 'true') {
        button.disabled = false;
        button.removeAttribute('aria-disabled');
        button.removeAttribute('title');
        delete button.dataset.iqaiCameraLock;
      }
    }
    if (layoutRoot) {
      layoutRoot.classList.toggle('is-camera-mode-locked', cameraViz);
      for (const button of layoutRoot.querySelectorAll('[data-iqai-layout]')) {
        button.classList.toggle('is-active', Number(button.getAttribute('data-iqai-layout')) === layout);
        button.setAttribute('aria-pressed', Number(button.getAttribute('data-iqai-layout')) === layout ? 'true' : 'false');
        button.disabled = cameraViz;
        button.setAttribute('aria-disabled', cameraViz ? 'true' : 'false');
        button.tabIndex = cameraViz ? -1 : 0;
        if (cameraViz) {
          button.title = CAMERA_MODE_LOCK_TITLE;
        } else {
          button.removeAttribute('title');
        }
      }
    }
    const modeBar = root?.querySelector('[data-iqai-camera-mode-bar]');
    if (modeBar) {
      modeBar.hidden = !cameraViz;
      modeBar.setAttribute('aria-hidden', cameraViz ? 'false' : 'true');
    }
    dockHistoryStage();
    paintTruth();
    paintSplitters();
    requestAnimationFrame(() => {
      resizeMap();
      options.onWorkspacePaint?.();
    });
  }

  function dockHistoryStage() {
    const stage = root?.querySelector('[data-iqai-history-stage]');
    const library = root?.querySelector('[data-iqai-history-library]');
    const slot = root?.querySelector('[data-iqai-imagery-pane-stage]');
    const mapBody = root?.querySelector('[data-iqai-pane="MAP"] > .iqai-v2-pane__body');
    if (!stage) return;
    if (layout === 4 && slot) {
      if (stage.parentElement !== slot) slot.append(stage);
      if (library && library.parentElement !== slot) slot.append(library);
      return;
    }
    if (!mapBody) return;
    if (stage.parentElement !== mapBody) mapBody.append(stage);
    if (library && library.parentElement !== mapBody) mapBody.append(library);
  }

  function streetStageEl() {
    return frame?.querySelector('[data-iqai-view-anchor="STREET 360"]')
      || root?.querySelector('[data-iqai-view-anchor="STREET 360"]')
      || root?.querySelector('[data-iqai-street-360-stage]');
  }

  function waitStreetPaneLaidOut() {
    const pane = frame?.querySelector('[data-iqai-pane="STREET 360"]');
    const stage = streetStageEl();
    return new Promise((resolve) => {
      const started = Date.now();
      const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 16);
      const tick = () => {
        const visiblePane = pane && pane.hidden !== true;
        const width = Number(pane?.offsetWidth) || Number(stage?.offsetWidth) || 0;
        const height = Number(pane?.offsetHeight) || Number(stage?.offsetHeight) || 0;
        if (visiblePane && width > 8 && height > 8) {
          resolve(true);
          return;
        }
        if (Date.now() - started > 2000) {
          resolve(false);
          return;
        }
        raf(tick);
      };
      raf(tick);
    });
  }

  async function syncSpecialistPanes() {
    const panes = panesForLayout();
    if (panes.includes(WORLDVIEW_PANE.STREET_360)) {
      await waitStreetPaneLaidOut();
      await ensureStreet();
    } else if (layout === 1) {
      await closeStreet();
    } else {
      await concealStreet();
    }
    if (panesForLayout().includes(WORLDVIEW_PANE.VISUAL_3D)) {
      await ensureVisual();
    } else {
      void closeVisual();
    }
  }

  async function ensureStreet() {
    if (!hasGeographicContext()) return street360?.snapshot?.() || null;
    try {
      if (street360?.snapshot?.()?.concealed === true) {
        return await street360.reveal?.() || street360.open();
      }
      return await street360.open();
    } catch (error) {
      return street360?.snapshot?.() || {
        open: false,
        error: String(error?.message || error)
      };
    }
  }

  async function ensureVisual() {
    if (!hasGeographicContext()) return google3d?.snapshot?.() || null;
    beginProgrammaticTraversal(4000);
    try {
      return await google3d.open();
    } finally {
      beginProgrammaticTraversal(4000);
    }
  }

  async function concealStreet() {
    const snap = street360?.snapshot?.() || {};
    if (snap.retained === true || snap.stageState === 'OPEN' || snap.stageState === 'OPENING' || snap.concealed === true) {
      if (typeof street360.conceal === 'function') {
        await street360.conceal();
      } else {
        await street360.close?.({ conceal: true });
      }
    }
  }

  async function closeStreet() {
    const snap = street360?.snapshot?.() || {};
    if (snap.stageState && snap.stageState !== 'IDLE') {
      await street360.close({ restoreMap: false });
    }
  }

  async function closeVisual() {
    const snap = google3d?.snapshot?.() || {};
    if (snap.stageState && snap.stageState !== 'IDLE' && snap.stageState !== 'ERROR') {
      beginProgrammaticTraversal(4000);
      try {
        await google3d.close({ restoreMap: false });
      } finally {
        beginProgrammaticTraversal(2500);
      }
    }
  }

  async function closeAnalyze() {
    const snap = analyze3d?.snapshot?.() || {};
    if (snap.stageState && snap.stageState !== 'IDLE') {
      await analyze3d.close({ restoreMap: false });
    }
  }

  let pendingSpecialists = false;

  async function applyLayout(nextLayout, nextPair = pairView) {
    if (cameraViz) return snapshot();
    const wanted = Math.max(1, Math.min(4, Number(nextLayout) || 1));
    const wantedPair = nextPair === WORLDVIEW_PANE.VISUAL_3D
      ? WORLDVIEW_PANE.VISUAL_3D
      : WORLDVIEW_PANE.STREET_360;
    const streetLeaving = panesForLayout().includes(WORLDVIEW_PANE.STREET_360)
      && !panesFor(wanted, wantedPair).includes(WORLDVIEW_PANE.STREET_360);
    if (streetLeaving && wanted > 1) {
      await concealStreet();
    }
    layout = wanted;
    pairView = wantedPair;
    if (wanted === 1) maximized = null;
    paint();
    if (busy) {
      pendingSpecialists = true;
      return snapshot();
    }
    busy = true;
    beginProgrammaticTraversal(3000);
    try {
      if (wanted === 1) {
        options.leaveImagery?.();
        await closeStreet();
        await closeVisual();
        await closeAnalyze();
        options.onPrimaryMap?.();
      } else {
        seedFromMapIfNeeded();
        if (!hasGeographicContext()) {
          options.armDropPin?.();
        } else {
          await syncSpecialistPanes();
        }
        if (layout === 4) await options.ensureImagery?.();
        else options.leaveImagery?.();
      }
    } finally {
      try {
        while (pendingSpecialists && layout > 1) {
          pendingSpecialists = false;
          await syncSpecialistPanes();
        }
      } finally {
        busy = false;
        beginProgrammaticTraversal(2500);
        paint();
      }
    }
    return snapshot();
  }

  async function followFocus() {
    const focus = getActiveSpatialFocus();
    if (focus) seedWorldviewNavigationFromFocus(focus);
    const panes = panesForLayout();
    if (layout > 1 && hasGeographicContext()) {
      if (panes.includes(WORLDVIEW_PANE.STREET_360)) await ensureStreet();
      if (panes.includes(WORLDVIEW_PANE.VISUAL_3D)) await ensureVisual();
      if (layout === 4) await options.ensureImagery?.();
    }
    paint();
    return snapshot();
  }

  async function setLayout(nextLayout) {
    if (cameraViz) return snapshot();
    return applyLayout(nextLayout, pairView);
  }

  async function openSupporting(viewId) {
    if (cameraViz) return snapshot();
    const view = String(viewId || '').trim();
    if (view === '3D ANALYZE') return snapshot();
    if (analyzeOpen() && view !== '3D ANALYZE') {
      await closeAnalyze();
    }
    if (view === WORLDVIEW_PANE.STREET_360) {
      if (layout >= 3) {
        await waitStreetPaneLaidOut();
        await ensureStreet();
        paint();
        return snapshot();
      }
      return applyLayout(2, WORLDVIEW_PANE.STREET_360);
    }
    if (view === WORLDVIEW_PANE.VISUAL_3D || view === '3D') {
      if (layout >= 3) {
        await ensureVisual();
        paint();
        return snapshot();
      }
      return applyLayout(2, WORLDVIEW_PANE.VISUAL_3D);
    }
    if (view === WORLDVIEW_PANE.MAP) return applyLayout(1);
    return snapshot();
  }

  async function maximize(viewId) {
    if (cameraViz) return snapshot();
    beginProgrammaticTraversal(2500);
    maximized = String(viewId || '') || null;
    paint();
    return snapshot();
  }

  async function restore() {
    beginProgrammaticTraversal(2500);
    maximized = null;
    paint();
    return snapshot();
  }

  async function closePane(viewId) {
    if (cameraViz) return snapshot();
    const view = String(viewId || '').trim();
    if (view === WORLDVIEW_PANE.MAP) return applyLayout(1);
    if (layout === 4 && view === WORLDVIEW_PANE.IMAGERY) return applyLayout(3);
    if (view === WORLDVIEW_PANE.STREET_360 && layout === 3) {
      pairView = WORLDVIEW_PANE.VISUAL_3D;
      return applyLayout(2, WORLDVIEW_PANE.VISUAL_3D);
    }
    if (view === WORLDVIEW_PANE.VISUAL_3D && layout === 3) {
      pairView = WORLDVIEW_PANE.STREET_360;
      return applyLayout(2, WORLDVIEW_PANE.STREET_360);
    }
    if (layout === 2) return applyLayout(1);
    return snapshot();
  }

  async function changePaneView(viewId) {
    if (cameraViz) return snapshot();
    const view = String(viewId || '').trim();
    if (view === WORLDVIEW_PANE.STREET_360) return applyLayout(Math.max(layout, 2), WORLDVIEW_PANE.VISUAL_3D);
    if (view === WORLDVIEW_PANE.VISUAL_3D) return applyLayout(Math.max(layout, 2), WORLDVIEW_PANE.STREET_360);
    return snapshot();
  }

  function enterCameraVisualization() {
    if (!cameraViz) {
      cameraVizRestore = Object.freeze({
        layout,
        pairView,
        maximized,
        splitTop,
        splitLeft
      });
    }
    cameraViz = true;
    maximized = null;
    paint();
    requestAnimationFrame(resizeMap);
    window.setTimeout(resizeMap, 60);
    return snapshot();
  }

  async function exitCameraVisualization() {
    if (!cameraViz) {
      paint();
      return snapshot();
    }
    const saved = cameraVizRestore;
    cameraViz = false;
    cameraVizRestore = null;
    if (saved) {
      splitTop = saved.splitTop;
      splitLeft = saved.splitLeft;
      maximized = saved.maximized;
      await applyLayout(saved.layout, saved.pairView);
      maximized = saved.maximized;
      paint();
    } else {
      paint();
    }
    requestAnimationFrame(resizeMap);
    window.setTimeout(resizeMap, 60);
    return snapshot();
  }

  function snapshot() {
    const panes = panesForLayout();
    const streetSnap = street360?.snapshot?.() || null;
    const visualSnap = google3d?.snapshot?.() || null;
    return {
      layout,
      pairView,
      maximized,
      cameraViz,
      cameraVizRestore: cameraVizRestore
        ? Object.freeze({ ...cameraVizRestore })
        : null,
      panes,
      busy,
      activePresentation: layout <= 1
        ? WORLDVIEW_PANE.MAP
        : (maximized || pairView),
      streetOperatorVisible: streetSnap?.operatorVisible === true,
      focus: getActiveSpatialFocus(),
      navigation: getWorldviewNavigation(),
      street360: streetSnap,
      google3d: visualSnap,
      analyze3d: analyze3d?.snapshot?.() || null
    };
  }

  async function backToMainView() {
    if (typeof options.backToMainView === 'function') {
      await options.backToMainView();
      return snapshot();
    }
    return exitCameraVisualization();
  }

  async function returnToMainScreen() {
    maximized = null;
    if (cameraViz) {
      cameraViz = false;
      cameraVizRestore = null;
    }
    await closeAnalyze();
    await closeStreet();
    await closeVisual();
    return applyLayout(1);
  }

  const onClick = (event) => {
    const backMain = event.target.closest('[data-iqai-camera-back-main]');
    if (backMain) {
      event.preventDefault();
      void backToMainView();
      return;
    }
    const layoutButton = event.target.closest('[data-iqai-layout]');
    if (layoutButton && layoutRoot?.contains(layoutButton)) {
      event.preventDefault();
      event.stopPropagation();
      if (cameraViz) return;
      void setLayout(Number(layoutButton.getAttribute('data-iqai-layout')));
      return;
    }
    if (cameraViz && event.target.closest('[data-iqai-pane-maximize], [data-iqai-pane-restore], [data-iqai-pane-close], [data-iqai-pane-change], [data-iqai-view]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const maximizeButton = event.target.closest('[data-iqai-pane-maximize]');
    if (maximizeButton && frame?.contains(maximizeButton)) {
      void maximize(maximizeButton.getAttribute('data-iqai-pane-maximize'));
      return;
    }
    const restoreButton = event.target.closest('[data-iqai-pane-restore]');
    if (restoreButton && frame?.contains(restoreButton)) {
      void restore();
      return;
    }
    const closeButton = event.target.closest('[data-iqai-pane-close]');
    if (closeButton && frame?.contains(closeButton)) {
      void closePane(closeButton.getAttribute('data-iqai-pane-close'));
      return;
    }
    const changeButton = event.target.closest('[data-iqai-pane-change]');
    if (changeButton && frame?.contains(changeButton)) {
      void changePaneView(changeButton.getAttribute('data-iqai-pane-change'));
    }
  };

  const onPointerDown = (event) => {
    const handle = event.target.closest('[data-iqai-split]');
    const host = well?.querySelector('[data-iqai-splitters]');
    if (!handle || !host?.contains(handle) || host.hidden) return;
    event.preventDefault();
    dragging = handle.getAttribute('data-iqai-split');
    handle.setPointerCapture?.(event.pointerId);
    well?.classList.add('is-splitting');
  };

  const onPointerMove = (event) => {
    if (!dragging || !frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    if (dragging === 'row') {
      splitTop = clamp(((event.clientY - rect.top) / rect.height) * 100, 28, 78);
    } else {
      splitLeft = clamp(((event.clientX - rect.left) / rect.width) * 100, 22, 78);
    }
    paintSplitters();
    requestAnimationFrame(resizeMap);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = null;
    well?.classList.remove('is-splitting');
    requestAnimationFrame(resizeMap);
    window.setTimeout(resizeMap, 60);
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (cameraViz) {
      event.preventDefault();
      void backToMainView();
      return;
    }
    if (!maximized) return;
    event.preventDefault();
    void restore();
  };

  root?.addEventListener('click', onClick);
  well?.addEventListener('pointerdown', onPointerDown);
  well?.addEventListener('pointermove', onPointerMove);
  well?.addEventListener('pointerup', onPointerUp);
  well?.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  paint();

  return Object.freeze({
    setLayout,
    openSupporting,
    followFocus,
    maximize,
    restore,
    closePane,
    paint,
    snapshot,
    enterCameraVisualization,
    exitCameraVisualization,
    backToMainView,
    returnToMainScreen
  });
}
