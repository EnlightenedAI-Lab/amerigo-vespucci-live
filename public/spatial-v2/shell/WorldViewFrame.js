/**
 * WorldView Frame V1 — multiple observation panes over one MapView.
 * Layout is host chrome. FocusRef and temporal.requested stay World State.
 * Live camera context is worldview-navigation.js, not FocusRef.
 * Does not construct MapView. Does not invent observation catalogs.
 */

import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import { getMapView } from '../map/map-foundation.js';
import { getWorldviewNavigation, seedWorldviewNavigationFromFocus } from '../map/worldview-navigation.js';
import { beginProgrammaticTraversal } from '../map/worldview-traversal.js';

export const WORLDVIEW_PANE = Object.freeze({
  MAP: 'MAP',
  STREET_360: 'STREET 360',
  VISUAL_3D: '3D VISUAL',
  IMAGERY: 'IMAGERY'
});

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

  function panesForLayout() {
    if (layout === 2) return [WORLDVIEW_PANE.MAP, pairView];
    return LAYOUT_PANES[layout] || LAYOUT_PANES[1];
  }

  function hasGeographicContext() {
    return Boolean(getActiveSpatialFocus() || getWorldviewNavigation());
  }

  function resizeMap() {
    beginProgrammaticTraversal(1200);
    const view = getMapView();
    view?.resize?.();
    view?.requestRender?.();
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
      imageryTruth.textContent = 'IMAGERY NOT CONNECTED · NOT MIGRATED';
    }
    for (const pane of paneEls()) {
      const sync = pane.querySelector('[data-iqai-pane-sync]');
      if (!sync) continue;
      const view = pane.getAttribute('data-iqai-pane');
      if (view === WORLDVIEW_PANE.IMAGERY) sync.textContent = 'TIME OFF';
      else if (view === WORLDVIEW_PANE.VISUAL_3D) sync.textContent = 'FOCUS · TIME OFF';
      else sync.textContent = 'FOCUS · TIME';
    }
  }

  function analyzeOpen() {
    const snap = analyze3d?.snapshot?.() || {};
    return snap.open === true
      || ['OPENING', 'OPEN', 'CLOSING', 'UNAVAILABLE'].includes(snap.stageState);
  }

  function paint() {
    if (well) {
      well.dataset.iqaiWorldviewLayout = String(layout);
      well.dataset.iqaiWorldviewMaximized = maximized || '';
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
    const visible = new Set(panesForLayout());
    for (const pane of paneEls()) {
      const view = pane.getAttribute('data-iqai-pane');
      const show = visible.has(view) && (!maximized || maximized === view);
      pane.hidden = !show;
      pane.classList.toggle('is-primary', view === WORLDVIEW_PANE.MAP && !maximized);
      pane.classList.toggle('is-maximized', maximized === view);
      const restore = pane.querySelector('[data-iqai-pane-restore]');
      const maximize = pane.querySelector('[data-iqai-pane-maximize]');
      if (restore) restore.hidden = maximized !== view;
      if (maximize) maximize.hidden = Boolean(maximized) && maximized !== view;
    }
    if (layoutRoot) {
      for (const button of layoutRoot.querySelectorAll('[data-iqai-layout]')) {
        button.classList.toggle('is-active', Number(button.getAttribute('data-iqai-layout')) === layout);
        button.setAttribute('aria-pressed', Number(button.getAttribute('data-iqai-layout')) === layout ? 'true' : 'false');
      }
    }
    paintTruth();
    requestAnimationFrame(resizeMap);
  }

  async function ensureStreet() {
    if (!hasGeographicContext()) return street360?.snapshot?.() || null;
    return street360.open();
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

  async function applyLayout(nextLayout, nextPair = pairView) {
    if (busy) return snapshot();
    const wanted = Math.max(1, Math.min(4, Number(nextLayout) || 1));
    busy = true;
    beginProgrammaticTraversal(3000);
    layout = wanted;
    pairView = nextPair === WORLDVIEW_PANE.VISUAL_3D
      ? WORLDVIEW_PANE.VISUAL_3D
      : WORLDVIEW_PANE.STREET_360;
    if (wanted === 1) maximized = null;
    paint();
    try {
      if (wanted === 1) {
        await closeStreet();
        await closeVisual();
        await closeAnalyze();
        options.onPrimaryMap?.();
      } else if (!hasGeographicContext()) {
        options.armDropPin?.();
      } else {
        const panes = panesForLayout();
        if (panes.includes(WORLDVIEW_PANE.STREET_360)) await ensureStreet();
        else await closeStreet();
        if (panes.includes(WORLDVIEW_PANE.VISUAL_3D)) await ensureVisual();
        else await closeVisual();
      }
    } finally {
      busy = false;
      beginProgrammaticTraversal(2500);
      paint();
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
    }
    paint();
    return snapshot();
  }

  async function setLayout(nextLayout) {
    return applyLayout(nextLayout, pairView);
  }

  async function openSupporting(viewId) {
    const view = String(viewId || '').trim();
    if (view === '3D ANALYZE') return snapshot();
    if (analyzeOpen() && view !== '3D ANALYZE') {
      await closeAnalyze();
    }
    if (view === WORLDVIEW_PANE.STREET_360) {
      if (layout === 1) return applyLayout(2, WORLDVIEW_PANE.STREET_360);
      if (layout === 2 && pairView === WORLDVIEW_PANE.VISUAL_3D) return applyLayout(3);
      if (layout >= 3) {
        await ensureStreet();
        paint();
        return snapshot();
      }
      return applyLayout(2, WORLDVIEW_PANE.STREET_360);
    }
    if (view === WORLDVIEW_PANE.VISUAL_3D || view === '3D') {
      if (layout === 1) return applyLayout(2, WORLDVIEW_PANE.VISUAL_3D);
      if (layout === 2 && pairView === WORLDVIEW_PANE.STREET_360) return applyLayout(3);
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
    const view = String(viewId || '').trim();
    if (view === WORLDVIEW_PANE.STREET_360) return applyLayout(Math.max(layout, 2), WORLDVIEW_PANE.VISUAL_3D);
    if (view === WORLDVIEW_PANE.VISUAL_3D) return applyLayout(Math.max(layout, 2), WORLDVIEW_PANE.STREET_360);
    return snapshot();
  }

  function snapshot() {
    return {
      layout,
      pairView,
      maximized,
      panes: panesForLayout(),
      busy,
      focus: getActiveSpatialFocus(),
      navigation: getWorldviewNavigation(),
      street360: street360?.snapshot?.() || null,
      google3d: google3d?.snapshot?.() || null,
      analyze3d: analyze3d?.snapshot?.() || null
    };
  }

  const onClick = (event) => {
    const layoutButton = event.target.closest('[data-iqai-layout]');
    if (layoutButton && layoutRoot?.contains(layoutButton)) {
      void setLayout(Number(layoutButton.getAttribute('data-iqai-layout')));
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
  root?.addEventListener('click', onClick);
  paint();

  return Object.freeze({
    setLayout,
    openSupporting,
    followFocus,
    maximize,
    restore,
    closePane,
    paint,
    snapshot
  });
}
