/**
 * Focus V4.6 instrument on the long-lived MapView.
 * Candidate/hover is ephemeral. Only acquire writes WorldState.selection.
 * DROP PIN remains WHERE. This instrument is WHAT.
 */

import { getMapView, getMapViewCreateCount } from '../map-foundation.js';
import { createSelectionSet, objectRefKey } from '../../foundation/contracts/index.js';
import { deriveObject, indexBuildings } from './objects.js';
import { createFocusFootprintPainter } from './footprints.js';
import { objectRefFromNrcanFeature, NRCAN_EXPECTED_FOOTPRINTS, sourceIdOf } from './nrcan-object-ref.js';
import {
  addToCollectedSet,
  collectedSetToCsv,
  createCollectedSet
} from './collected.js';

const ORIGIN = { lat: 45.50169, lng: -73.56832 };
const LOCK_MS = 420;
const DWELL_MS = 480;
const DATA_BUILDINGS = '/spatial-v2/data/focus/nrcan-buildings.geojson';
const DATA_CATALOG = '/spatial-v2/data/focus/features.json';

export function bindFocusInstrument(root, options = {}) {
  const footprints = createFocusFootprintPainter(() => getMapView());
  let buildings = null;
  let catalog = { features: [] };
  let hoverHit = null;
  let acquired = null;
  let derivedAcquired = null;
  let collected = createCollectedSet();
  let locking = false;
  let dwellTimer = 0;
  let pointer = null;
  let ready = false;
  let viewHandles = [];
  let watchedView = null;
  let loadError = null;

  function isArmed() {
    return options.isDropPinArmed?.() === true;
  }

  function sensing() {
    return footprints.sensing();
  }

  function inspectorBody() {
    if (!acquired?.objectRef) {
      return 'No ObjectRef acquired. Hover/candidate is not acquisition. DROP PIN remains WHERE.';
    }
    const src = derivedAcquired?.sourceAttributes || {};
    const ref = acquired.objectRef;
    return [
      'OBJECT ACQUIRED',
      `KIND: ${ref.kind.toUpperCase()}`,
      `LABEL: ${ref.label || derivedAcquired?.name || 'Building'}`,
      `NAMESPACE: ${ref.namespace}`,
      `ID: ${ref.id}`,
      `DATASET: ${ref.datasetRef}`,
      `DATASET VERSION: ${ref.datasetVersion}`,
      `SOURCE: ${derivedAcquired?.source || ref.sourceRef}`,
      `PROVENANCE: vector-selection · inference no`,
      `AREA SOURCE: ${src.buildingArea != null ? `${Number(src.buildingArea).toFixed(1)} m²` : 'NOT IN SOURCE'}`,
      `AREA DERIVED: ${derivedAcquired?.derived?.area != null ? `${derivedAcquired.derived.area.toFixed(1)} m²` : '—'}`,
      `HEIGHT MAX SOURCE: ${src.heightMax != null ? `${src.heightMax} m` : 'NOT IN SOURCE'}`,
      `COLLECTED SET: ${collected.items.length}`,
      'Primary ObjectRef is not an ArcGIS OBJECTID.'
    ].join('\n');
  }

  function paintInspector() {
    options.chassis?.setAcquiredInspect?.({
      id: acquired?.objectRef?.id || null,
      key: acquired?.objectRef ? objectRefKey(acquired.objectRef) : null,
      body: inspectorBody()
    });
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

  function syncCollected() {
    const features = collected.items
      .map((item) => buildings?.findBySourceId(item.sourceId)?.feature)
      .filter(Boolean);
    footprints.setCollected(features, { excludeId: footprints.selectedId() });
  }

  function cancelDwell() {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = 0;
    }
  }

  function samplePointer(longitude, latitude, screen) {
    if (!ready || locking || !buildings) return;
    if (isArmed()) {
      footprints.setPointer(0, 0, { hidden: true });
      return;
    }
    pointer = { longitude, latitude, x: screen?.x, y: screen?.y };
    hoverHit = buildings.findAt(latitude, longitude, 32);
    const derived = hoverHit ? deriveObject(hoverHit.item.feature, null, catalog.features) : null;
    footprints.setPointer(screen?.x, screen?.y, {
      hidden: false,
      state: hoverHit?.relation === 'inside' ? 'hover' : 'idle'
    });
    footprints.setHover(hoverHit?.item.feature || null, {
      inside: hoverHit?.relation === 'inside',
      name: derived && derived.name !== 'Building' ? derived.name : null,
      sourceId: sourceIdOf(hoverHit?.item.feature),
      from: { lat: latitude, lng: longitude },
      heightMax: derived?.sourceAttributes?.heightMax ?? null
    });
    cancelDwell();
    if (hoverHit?.relation === 'inside') {
      dwellTimer = setTimeout(() => {
        const still = buildings.findAt(latitude, longitude, 32);
        if (still?.relation !== 'inside') return;
        const next = deriveObject(still.item.feature, null, catalog.features);
        footprints.setDwell(still.item.feature, {
          name: next && next.name !== 'Building' ? next.name : null,
          sourceId: sourceIdOf(still.item.feature),
          heightMax: next?.sourceAttributes?.heightMax ?? null,
          from: { lat: latitude, lng: longitude }
        });
        footprints.setPointer(screen?.x, screen?.y, { hidden: false, state: 'dwell' });
      }, DWELL_MS);
    }
  }

  async function acquireFromLonLat(longitude, latitude) {
    if (!ready || locking || isArmed() || !buildings) return snapshot();
    const hit = buildings.findAt(latitude, longitude, 10);
    if (!hit?.item) return snapshot();
    locking = true;
    cancelDwell();
    const feature = hit.item.feature;
    const derived = deriveObject(feature, null, catalog.features);
    const objectRef = objectRefFromNrcanFeature(feature, {
      label: derived?.name && derived.name !== 'Building' ? derived.name : 'Building'
    });
    if (!objectRef) {
      locking = false;
      return snapshot();
    }
    acquired = { feature, objectRef, acquiredAt: new Date().toISOString() };
    derivedAcquired = derived;
    footprints.acquire(feature, {
      name: derived?.name && derived.name !== 'Building' ? derived.name : null,
      heightMax: derived?.sourceAttributes?.heightMax ?? null
    });
    footprints.setPointer(pointer?.x, pointer?.y, { hidden: true });
    syncCollected();
    await commitSelection('SELECT_FEATURE');
    paintInspector();
    await new Promise((resolve) => setTimeout(resolve, LOCK_MS));
    locking = false;
    return snapshot();
  }

  function restoreAcquiredPaint() {
    if (!acquired?.feature) return;
    if (footprints.selectedId()) {
      footprints.paint();
      syncCollected();
      return;
    }
    footprints.acquire(acquired.feature, {
      name: derivedAcquired?.name && derivedAcquired.name !== 'Building' ? derivedAcquired.name : null,
      heightMax: derivedAcquired?.sourceAttributes?.heightMax ?? null
    });
    syncCollected();
  }

  function addAcquiredToSet() {
    const result = addToCollectedSet(collected, acquired?.objectRef, derivedAcquired);
    if (!result.ok) return result;
    collected = result.set;
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
    derivedAcquired = null;
    hoverHit = null;
    footprints.clear();
    syncCollected();
    void commitSelection('CLEAR_OBJECT');
    paintInspector();
    return snapshot();
  }

  function modeOf() {
    if (locking) return 'locking';
    if (acquired) return 'acquired';
    if (hoverHit?.relation === 'inside') return 'hover';
    if (hoverHit?.relation === 'near') return 'approaching';
    return 'sensing';
  }

  function snapshot() {
    const sense = sensing();
    const hover = hoverHit ? {
      sourceId: sourceIdOf(hoverHit.item.feature),
      relation: hoverHit.relation,
      range: hoverHit.range
    } : null;
    return {
      version: '4.6',
      ready,
      loadError,
      mode: modeOf(),
      footprintCount: buildings?.count ?? 0,
      nrcanFeatureCount: buildings?.count ?? 0,
      expectedFootprints: NRCAN_EXPECTED_FOOTPRINTS,
      hover,
      candidate: hover,
      objectRef: acquired?.objectRef || null,
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

  function watchView(view) {
    if (!view) return;
    if (view === watchedView) {
      footprints.paint();
      return;
    }
    for (const handle of viewHandles) {
      try { handle.remove?.(); } catch { /* gone */ }
    }
    viewHandles = [];
    watchedView = view;
    const refresh = () => footprints.paint();
    if (typeof view.watch === 'function') {
      viewHandles.push(view.watch('stationary', (stationary) => { if (stationary) refresh(); }));
      viewHandles.push(view.watch('extent', () => footprints.paint()));
      viewHandles.push(view.watch('rotation', () => footprints.paint()));
      viewHandles.push(view.watch('scale', () => footprints.paint()));
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
      }));
      viewHandles.push(view.on('click', (event) => {
        if (isArmed()) return;
        const point = event.mapPoint;
        if (!point) return;
        void acquireFromLonLat(point.longitude, point.latitude);
      }));
    }
    restoreAcquiredPaint();
  }

  async function start() {
    try {
      const [buildingRes, catalogRes] = await Promise.all([
        fetch(DATA_BUILDINGS),
        fetch(DATA_CATALOG)
      ]);
      if (!buildingRes.ok) throw new Error('NRCan optimized building clip is missing.');
      const collection = await buildingRes.json();
      catalog = catalogRes.ok ? await catalogRes.json() : { features: [] };
      buildings = indexBuildings(collection);
      ready = buildings.count > 0;
      watchView(getMapView());
      options.onReady?.({
        count: buildings.count,
        expected: NRCAN_EXPECTED_FOOTPRINTS,
        source: collection.attribution || collection.source
      });
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
    hoverAt: (lat, lng, screen) => {
      samplePointer(lng, lat, screen || { x: 0, y: 0 });
      return snapshot();
    },
    dwellAt: (lat, lng, screen) => {
      samplePointer(lng, lat, screen || { x: 0, y: 0 });
      cancelDwell();
      const hit = buildings?.findAt(lat, lng, 32);
      if (hit?.relation === 'inside') {
        const derived = deriveObject(hit.item.feature, null, catalog.features);
        footprints.setDwell(hit.item.feature, {
          name: derived && derived.name !== 'Building' ? derived.name : null,
          sourceId: sourceIdOf(hit.item.feature),
          heightMax: derived?.sourceAttributes?.heightMax ?? null,
          from: { lat, lng }
        });
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
    detach() {
      cancelDwell();
      for (const handle of viewHandles) {
        try { handle.remove?.(); } catch { /* gone */ }
      }
      footprints.detach();
    }
  };
}
