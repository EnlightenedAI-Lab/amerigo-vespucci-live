/**
 * World Object Acquisition V1.4 on the long-lived MapView.
 * Candidate/hover is ephemeral. Only acquire writes WorldState.selection.
 * DROP PIN remains WHERE. This instrument is WHAT.
 * Layers / Discover owns visibility. PLACE CAMERA owns camera-placement clicks.
 */

import { getMapView, getMapViewCreateCount } from '../map-foundation.js';
import { createSelectionSet, objectRefKey } from '../../foundation/contracts/index.js';
import { deriveObject } from './objects.js';
import { createFocusFootprintPainter } from './footprints.js';
import { NRCAN_EXPECTED_FOOTPRINTS, sourceIdOf } from './nrcan-object-ref.js';
import {
  addToCollectedSet,
  collectedSetToCsv,
  createCollectedSet
} from './collected.js';
import { createSelectableRegistry, registerManifest } from '../woa/sources.js';
import { createLayerSession } from '../woa/layer-session.js';
import {
  choosePreview,
  containerSources,
  insideHits,
  resolveCandidates,
  specificSources
} from '../woa/resolve.js';
import {
  classLabel,
  displayName,
  labMeta,
  toAcquiredObject,
  wrapNrcanBuilding,
  wrapUevFeature
} from '../woa/adapter.js';
import { indexCollection } from '../woa/index.js';
import { createRemoteUevIndex } from '../woa/uev-index.js';
import { createEvaluationUnitSource } from '../woa/vendor/evaluation-units-source.js';
import { inspectorHtml } from '../woa/inspector.js';
import { createWoaAssetOverlay } from '../woa/assets-overlay.js';
import { padBbox, viewBbox } from '../woa/view-bbox.js';

const ORIGIN = { lat: 45.50169, lng: -73.56832 };
const LOCK_MS = 420;
const DWELL_MS = 480;
const DATA_CATALOG = '/spatial-v2/data/focus/features.json';
const DATA_SOURCES = '/spatial-v2/data/woa/sources.json';

export function bindFocusInstrument(root, options = {}) {
  const footprints = createFocusFootprintPainter(() => getMapView());
  const assets = createWoaAssetOverlay(() => getMapView());
  let registry = createSelectableRegistry();
  let sources = [];
  let layerSession = createLayerSession([]);
  let indexes = {};
  let uevRuntime = null;
  let catalog = { features: [] };
  let hoverHits = [];
  let preview = null;
  let overlapAvailable = false;
  let chosenClass = null;
  let acquired = null;
  let collected = createCollectedSet();
  let locking = false;
  let dwellTimer = 0;
  let pointer = null;
  let ready = false;
  let viewHandles = [];
  let watchedView = null;
  let loadError = null;
  let chooser = null;
  let uevRefreshTimer = 0;

  function clickOwner() {
    if (options.isPlaceCameraArmed?.() === true) return 'place-camera';
    if (options.isDropPinArmed?.() === true) return 'drop-pin';
    return 'woa';
  }

  function isArmed() {
    return clickOwner() !== 'woa';
  }

  function sensing() {
    return footprints.sensing();
  }

  function ensureChooser() {
    const host = getMapView()?.container;
    if (!host) return null;
    if (chooser && host.contains(chooser)) return chooser;
    chooser = document.createElement('div');
    chooser.className = 'iqai-v2-woa-chooser';
    chooser.hidden = true;
    chooser.setAttribute('data-iqai-woa-chooser', 'true');
    chooser.addEventListener('click', (event) => {
      const button = event.target.closest('[data-iqai-woa-class]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      chosenClass = button.getAttribute('data-iqai-woa-class');
      const hit = hoverHits.find((row) => row.objectClass === chosenClass);
      if (hit?.item?.feature) void acquireFeature(hit.item.feature);
    });
    host.appendChild(chooser);
    return chooser;
  }

  function hideChooser() {
    if (chooser) chooser.hidden = true;
  }

  function placeChooser() {
    const node = ensureChooser();
    if (!node || node.hidden || !pointer) return;
    node.style.left = `${Math.round(pointer.x + 16)}px`;
    node.style.top = `${Math.round(pointer.y - 8)}px`;
  }

  function renderChooser(hits, previewHit, { force = false } = {}) {
    const node = ensureChooser();
    if (!node) return;
    const inside = insideHits(hits);
    if (!force || inside.length < 2) {
      hideChooser();
      return;
    }
    node.hidden = false;
    node.innerHTML = inside.map((hit) => {
      const active = previewHit?.objectClass === hit.objectClass;
      return `<button type="button" data-iqai-woa-class="${hit.objectClass}" data-active="${active ? 'true' : 'false'}">${hit.label || classLabel(hit.objectClass)}</button>`;
    }).join('');
    placeChooser();
  }

  function paintInspector() {
    options.chassis?.setAcquiredInspect?.({
      id: acquired?.objectRef?.id || null,
      key: acquired?.objectRef ? objectRefKey(acquired.objectRef) : null,
      body: acquired
        ? `OBJECT ACQUIRED\nKIND: ${String(acquired.objectRef?.kind || '').toUpperCase()}\nLABEL: ${displayName(acquired)}\nID: ${acquired.sourceId}`
        : 'No ObjectRef acquired. Hover/candidate is not acquisition. DROP PIN remains WHERE.',
      html: acquired ? inspectorHtml(acquired, { collectedCount: collected.items.length }) : null,
      rawCollapsed: true
    });
    const bodyEl = root?.querySelector?.('[data-iqai-slot="selected-object-slot"] .iqai-v2-region__body');
    if (bodyEl) {
      if (acquired) bodyEl.innerHTML = inspectorHtml(acquired, { collectedCount: collected.items.length });
      else bodyEl.textContent = 'No ObjectRef acquired. Hover/candidate is not acquisition. DROP PIN remains WHERE.';
    }
  }

  async function commitSelection(sourceAction) {
    if (!options.chassis?.executeChassis) return;
    const objectRefs = [
      ...(acquired?.objectRef ? [acquired.objectRef] : []),
      ...collected.items.map((item) => item.objectRef).filter((ref) => ref.id !== acquired?.objectRef?.id)
    ];
    const selection = createSelectionSet({
      selectionSetId: collected.setId,
      objectRefs,
      primaryObjectRefId: acquired?.objectRef ? objectRefKey(acquired.objectRef) : null,
      sourceView: 'MAP',
      sourceAction,
      revision: 1,
      selectedAt: new Date().toISOString()
    });
    await options.chassis.executeChassis('selection.set', {
      selectionSetId: selection.selectionSetId,
      objectRefs: selection.objectRefs,
      primaryObjectRefId: selection.primaryObjectRefId,
      sourceView: selection.sourceView,
      sourceAction: selection.sourceAction
    });
  }

  function featureForCollected(item) {
    for (const index of Object.values(indexes)) {
      const found = index.findBySourceId?.(item.sourceId);
      if (found?.feature && (labMeta(found.feature).objectClass || item.objectRef?.kind) === (item.objectRef?.kind || labMeta(found.feature).objectClass)) {
        return found.feature;
      }
    }
    return item.feature || null;
  }

  function syncCollected() {
    const features = collected.items.map((item) => featureForCollected(item)).filter(Boolean);
    footprints.setCollected(features, { excludeId: footprints.selectedId() });
  }

  function syncAssets() {
    assets.setVisibleClasses(
      sources.filter((source) => source.kind === 'urban-asset' && layerSession.isVisible(source.objectClass))
        .map((source) => source.objectClass)
    );
    const hoverFeat = preview?.item?.feature;
    const hoverLab = hoverFeat ? labMeta(hoverFeat) : null;
    assets.setStates({
      hover: hoverLab?.sourceId ? `${hoverLab.objectClass}:${hoverLab.sourceId}` : null,
      acquired: acquired?.sourceId ? `${acquired.objectClass}:${acquired.sourceId}` : null
    });
  }

  function cancelDwell() {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = 0;
    }
  }

  function selectableNow(list) {
    return layerSession.allow(list);
  }

  function sampleHits(lat, lng, { includeContainers = 'auto' } = {}) {
    const specificHits = resolveCandidates(indexes, lat, lng, selectableNow(specificSources(sources)));
    const queryContainers = includeContainers === true
      || (includeContainers !== false && specificHits.length === 0);
    hoverHits = queryContainers
      ? specificHits.concat(resolveCandidates(indexes, lat, lng, selectableNow(containerSources(sources))))
      : specificHits;
    if (chosenClass && !hoverHits.some((hit) => hit.objectClass === chosenClass)) {
      chosenClass = null;
    }
    const choice = choosePreview(hoverHits, { chosenClass });
    preview = choice.preview;
    overlapAvailable = Boolean(choice.overlapAvailable);
    return choice;
  }

  function catalogName(feature) {
    if (labMeta(feature).objectClass !== 'building') return labMeta(feature).sourceName || null;
    const derived = deriveObject({
      ...feature,
      properties: {
        ...(feature.properties?.source || {}),
        feature_id: labMeta(feature).sourceId
      }
    }, null, catalog.features);
    return derived && derived.name && derived.name !== 'Building' ? derived.name : labMeta(feature).sourceName;
  }

  function samplePointer(longitude, latitude, screen) {
    if (!ready || locking) return;
    if (isArmed()) {
      footprints.setPointer(0, 0, { hidden: true });
      hideChooser();
      return;
    }
    pointer = { longitude, latitude, x: screen?.x, y: screen?.y };
    sampleHits(latitude, longitude, { includeContainers: 'auto' });
    const feature = preview?.item?.feature || null;
    const name = feature ? catalogName(feature) : null;
    footprints.setPointer(screen?.x, screen?.y, {
      hidden: false,
      state: preview?.relation === 'inside' ? 'hover' : 'idle'
    });
    footprints.setHover(feature, {
      inside: preview?.relation === 'inside',
      name,
      sourceId: sourceIdOf(feature) || labMeta(feature).sourceId,
      from: { lat: latitude, lng: longitude },
      heightMax: feature?.properties?.source?.heightmax ?? null,
      objectClass: preview?.objectClass || null
    });
    syncAssets();
    cancelDwell();
    if (preview?.relation !== 'inside') {
      hideChooser();
      return;
    }
    dwellTimer = setTimeout(() => {
      sampleHits(latitude, longitude, { includeContainers: true });
      if (preview?.relation !== 'inside') {
        hideChooser();
        return;
      }
      const next = preview.item.feature;
      footprints.setDwell(next, {
        name: catalogName(next),
        sourceId: labMeta(next).sourceId,
        heightMax: next?.properties?.source?.heightmax ?? null,
        from: { lat: latitude, lng: longitude },
        objectClass: preview.objectClass
      });
      footprints.setPointer(screen?.x, screen?.y, { hidden: false, state: 'dwell' });
      renderChooser(hoverHits, preview, { force: overlapAvailable });
    }, DWELL_MS);
  }

  async function acquireFeature(feature) {
    if (!ready || locking || isArmed() || !feature) return snapshot();
    const lab = labMeta(feature);
    const source = registry.get(lab.objectClass);
    if (!source?.selectable || !layerSession.isSelectable(lab.objectClass) || !lab.sourceId) {
      return snapshot();
    }
    locking = true;
    cancelDwell();
    hideChooser();
    let lockedFeature = feature;
    if (lab.objectClass === 'evaluation_unit' && uevRuntime) {
      try {
        const resolved = await uevRuntime.getById(lab.sourceId);
        if (resolved?.feature) {
          const manifest = await uevRuntime.getManifest();
          lockedFeature = wrapUevFeature(resolved.feature, {
            fabric: 'exact',
            provenance: resolved.provenance,
            manifest,
            source
          });
        }
      } catch {
        // Same-origin display geometry remains acquireable when exact lookup is unavailable.
      }
    }
    const name = catalogName(lockedFeature);
    acquired = toAcquiredObject(lockedFeature, name);
    footprints.acquire(lockedFeature, {
      name,
      heightMax: lockedFeature?.properties?.source?.heightmax ?? null,
      objectClass: acquired.objectClass
    });
    footprints.setPointer(pointer?.x, pointer?.y, { hidden: true });
    syncCollected();
    syncAssets();
    await commitSelection('SELECT_FEATURE');
    paintInspector();
    options.chassis?.setInspectorPane?.('selected-object-slot');
    await new Promise((resolve) => setTimeout(resolve, LOCK_MS));
    locking = false;
    return snapshot();
  }

  async function acquireFromLonLat(longitude, latitude) {
    if (!ready || locking || isArmed()) return snapshot();
    await ensureUevAround(latitude, longitude);
    sampleHits(latitude, longitude, { includeContainers: 'auto' });
    if (preview?.relation !== 'inside' || !preview?.item?.feature) return snapshot();
    return acquireFeature(preview.item.feature);
  }

  function restoreAcquiredPaint() {
    if (!acquired?.feature) return;
    footprints.acquire(acquired.feature, {
      name: acquired.overlay?.name,
      heightMax: acquired.attributes?.source?.heightmax ?? null,
      objectClass: acquired.objectClass
    });
    syncCollected();
    syncAssets();
  }

  function addAcquiredToSet() {
    const result = addToCollectedSet(collected, acquired?.objectRef, {
      name: displayName(acquired),
      centroid: acquired?.anchor,
      sourceAttributes: acquired?.attributes?.source,
      derived: {
        area: acquired?.attributes?.derived?.area_m2,
        perimeter: acquired?.attributes?.derived?.perimeter_m
      },
      feature: acquired?.feature
    });
    if (!result.ok) return result;
    collected = result.set;
    if (result.set.items.at(-1)) result.set.items.at(-1).feature = acquired.feature;
    syncCollected();
    void commitSelection('COLLECT_OBJECT');
    paintInspector();
    return result;
  }

  function exportCsv() {
    if (!collected.items.length) return { ok: false, reason: 'empty' };
    const csv = collectedSetToCsv(collected);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${collected.setId}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { ok: true, csv, header: csv.split('\n')[0].split(',') };
  }

  function clear() {
    cancelDwell();
    acquired = null;
    hoverHits = [];
    preview = null;
    chosenClass = null;
    footprints.clear();
    hideChooser();
    syncCollected();
    syncAssets();
    void commitSelection('CLEAR_OBJECT');
    paintInspector();
    return snapshot();
  }

  function modeOf() {
    if (locking) return 'locking';
    if (acquired) return 'acquired';
    if (preview?.relation === 'inside') return 'hover';
    if (preview?.relation === 'near') return 'approaching';
    return 'sensing';
  }

  function counts() {
    const out = {};
    for (const source of sources) {
      out[source.objectClass] = indexes[source.objectClass]?.count || 0;
    }
    return out;
  }

  function snapshot() {
    const sense = sensing();
    const hover = preview ? {
      sourceId: preview.item?.sourceId || labMeta(preview.item?.feature).sourceId,
      objectClass: preview.objectClass,
      relation: preview.relation,
      range: preview.range
    } : null;
    return {
      version: 'woa-1.4',
      ready,
      loadError,
      mode: modeOf(),
      clickOwner: clickOwner(),
      footprintCount: indexes.building?.count ?? 0,
      nrcanFeatureCount: indexes.building?.count ?? 0,
      expectedFootprints: NRCAN_EXPECTED_FOOTPRINTS,
      counts: counts(),
      uev: indexes.evaluation_unit?.stats?.() || null,
      layerSession: layerSession.snapshot(),
      hover,
      candidate: hover,
      objectRef: acquired?.objectRef || null,
      acquiredClass: acquired?.objectClass || null,
      inspector: {
        html: acquired ? inspectorHtml(acquired, { collectedCount: collected.items.length }) : null,
        rawCollapsed: true
      },
      overlap: {
        available: overlapAvailable,
        inside: insideHits(hoverHits).map((hit) => hit.objectClass)
      },
      collected: {
        setId: collected.setId,
        count: collected.items.length,
        sourceIds: collected.items.map((item) => item.sourceId)
      },
      collectedSet: {
        setId: collected.setId,
        count: collected.items.length,
        sourceIds: collected.items.map((item) => item.sourceId)
      },
      sensing: sense,
      locking,
      mapViewCreateCount: getMapViewCreateCount()
    };
  }

  async function ensureUevAround(lat, lng, { force = false } = {}) {
    const index = indexes.evaluation_unit;
    if (!index?.refresh) return null;
    const hit = index.findAt?.(lat, lng, 8);
    if (hit?.relation === 'inside') return index.stats?.();
    if (!force) {
      const specific = resolveCandidates(
        indexes,
        lat,
        lng,
        selectableNow(specificSources(sources))
      );
      if (specific.some((row) => row.relation === 'inside')) return index.stats?.();
    }
    try {
      await index.refresh(padBbox(lng, lat, 0.004));
    } catch (error) {
      return { error: String(error?.message || error), ...(index.stats?.() || {}) };
    }
    return index.stats?.();
  }

  async function refreshUev(around = null) {
    const index = indexes.evaluation_unit;
    if (!index?.refresh) return null;
    const bbox = around && Number.isFinite(around.lat) && Number.isFinite(around.lng)
      ? padBbox(around.lng, around.lat, 0.004)
      : viewBbox(getMapView());
    try {
      await index.refresh(bbox);
    } catch (error) {
      return { error: String(error?.message || error), ...(index.stats?.() || {}) };
    }
    return index.stats?.();
  }

  function scheduleUevRefresh() {
    clearTimeout(uevRefreshTimer);
    uevRefreshTimer = setTimeout(() => {
      void refreshUev();
    }, 220);
  }

  function watchView(view) {
    if (!view) return;
    if (view === watchedView) {
      footprints.paint();
      assets.paint();
      return;
    }
    for (const handle of viewHandles) {
      try { handle.remove?.(); } catch { /* gone */ }
    }
    viewHandles = [];
    watchedView = view;
    const refresh = () => {
      footprints.paint();
      assets.paint();
    };
    if (typeof view.watch === 'function') {
      viewHandles.push(view.watch('stationary', (stationary) => {
        if (stationary) {
          refresh();
          scheduleUevRefresh();
        }
      }));
      viewHandles.push(view.watch('extent', () => refresh()));
      viewHandles.push(view.watch('rotation', () => refresh()));
      viewHandles.push(view.watch('scale', () => refresh()));
    }
    if (typeof view.on === 'function') {
      viewHandles.push(view.on('pointer-move', (event) => {
        const mapPoint = view.toMap?.({ x: event.x, y: event.y });
        if (!mapPoint) {
          footprints.setPointer(0, 0, { hidden: true });
          return;
        }
        samplePointer(mapPoint.longitude, mapPoint.latitude, { x: event.x, y: event.y });
      }));
      viewHandles.push(view.on('pointer-leave', () => {
        cancelDwell();
        footprints.setPointer(0, 0, { hidden: true });
        footprints.setHover(null);
        hideChooser();
      }));
      viewHandles.push(view.on('click', (event) => {
        if (isArmed()) return;
        const point = event.mapPoint;
        if (!point) return;
        void acquireFromLonLat(point.longitude, point.latitude);
      }));
    }
    restoreAcquiredPaint();
    scheduleUevRefresh();
  }

  function setSourceVisible(objectClassOrInstance, visible) {
    const objectClass = String(objectClassOrInstance || '').replace(/^woa-/, '');
    const row = layerSession.setVisible(objectClass, visible);
    if (preview && !layerSession.isSelectable(preview.objectClass)) {
      preview = null;
      footprints.setHover(null);
      hideChooser();
    }
    if (acquired && !layerSession.isSelectable(acquired.objectClass)) {
      // Visibility change does not silently clear an already acquired lock.
    }
    syncAssets();
    options.onLayerSession?.(layerSession.snapshot());
    return row;
  }

  async function start() {
    try {
      const [sourcesRes, catalogRes] = await Promise.all([
        fetch(DATA_SOURCES),
        fetch(DATA_CATALOG)
      ]);
      if (!sourcesRes.ok) throw new Error('WOA selectable source manifest is missing.');
      const manifest = await sourcesRes.json();
      registry = createSelectableRegistry();
      registerManifest(registry, manifest);
      sources = registry.list();
      layerSession = createLayerSession(sources);
      catalog = catalogRes.ok ? await catalogRes.json() : { features: [] };
      indexes = {};
      for (const source of sources) {
        if (source.kind === 'uev-fabric') {
          uevRuntime = createEvaluationUnitSource({
            baseUrl: source.browserBaseUrl || source.baseUrl
          });
          indexes[source.objectClass] = createRemoteUevIndex({ runtime: uevRuntime, source });
          continue;
        }
        const res = await fetch(source.dataUrl);
        if (!res.ok) throw new Error(`${source.label} clip is missing.`);
        const collection = await res.json();
        const features = source.objectClass === 'building'
          ? (collection.features || []).map(wrapNrcanBuilding)
          : (collection.features || []);
        indexes[source.objectClass] = indexCollection({ type: 'FeatureCollection', features }, source.objectClass);
      }
      assets.setFeatures([
        ...(indexes.hydrant?.items || []).map((item) => item.feature),
        ...(indexes.traffic_signal?.items || []).map((item) => item.feature)
      ]);
      syncAssets();
      ready = (indexes.building?.count || 0) > 0;
      watchView(getMapView());
      options.onReady?.({
        count: indexes.building?.count,
        expected: NRCAN_EXPECTED_FOOTPRINTS,
        counts: counts(),
        layerSession: layerSession.snapshot()
      });
      options.onLayerSession?.(layerSession.snapshot());
    } catch (error) {
      loadError = error?.message || String(error);
      ready = false;
    }
    return snapshot();
  }

  root?.querySelector('[data-iqai-add-set]')?.addEventListener('click', (event) => {
    event.preventDefault();
    addAcquiredToSet();
  });
  root?.querySelector('[data-iqai-export-csv]')?.addEventListener('click', (event) => {
    event.preventDefault();
    exportCsv();
  });

  void start();

  return {
    snapshot,
    getState: snapshot,
    sensing,
    acquireAt: (lat, lng) => acquireFromLonLat(lng, lat),
    hoverAt: async (lat, lng, screen) => {
      await ensureUevAround(lat, lng);
      samplePointer(lng, lat, screen || { x: 0, y: 0 });
      return snapshot();
    },
    dwellAt: async (lat, lng, screen) => {
      await ensureUevAround(lat, lng, { force: true });
      samplePointer(lng, lat, screen || { x: 0, y: 0 });
      cancelDwell();
      sampleHits(lat, lng, { includeContainers: true });
      if (preview?.relation === 'inside') {
        const next = preview.item.feature;
        footprints.setDwell(next, {
          name: catalogName(next),
          sourceId: labMeta(next).sourceId,
          heightMax: next?.properties?.source?.heightmax ?? null,
          from: { lat, lng },
          objectClass: preview.objectClass
        });
        renderChooser(hoverHits, preview, { force: overlapAvailable });
      }
      return snapshot();
    },
    addToSet: addAcquiredToSet,
    exportCsv,
    exportCollectedCsv: exportCsv,
    clear,
    hasAcquired: () => Boolean(acquired?.objectRef),
    origin: ORIGIN,
    attachView: watchView,
    setSourceVisible,
    layerSnapshot: () => layerSession.snapshot(),
    drawerRows: () => layerSession.drawerRows(),
    refreshUev,
    ensureUevAround,
    detach() {
      cancelDwell();
      clearTimeout(uevRefreshTimer);
      for (const handle of viewHandles) {
        try { handle.remove?.(); } catch { /* gone */ }
      }
      footprints.detach();
      assets.detach();
      chooser?.remove?.();
    }
  };
}
