import { describeCoordinates, formatElevationMeters } from './coordinates.js';
import {
  ddDigitsForZoom,
  formatBearing,
  formatRange,
  haversineMeters,
  initialBearing,
  mapScaleDenominator,
  snapRadiusMeters
} from './geodesy.js';
import { interpolateElevation, nearestFeature } from './features.js';
import { cancelDwell, resolveContext, scheduleDwell } from './context.js';
import { deriveObject, formatArea, formatMeters, indexBuildings, objectLabel } from './objects.js';
import { createFootprintController } from './footprints.js';
import {
  attachAnchor,
  createObjectRef,
  createSelectionState,
  serializeSelection
} from './object-ref.js';
import {
  mountMarks,
  paintChip,
  paintFocusPlate,
  rebuildReticle,
  setMarkPosition,
  setPointerState
} from './pointer.js';

const ORIGIN = { lat: 45.50169, lng: -73.56832 };
const LOCK_MS = 860;
const STATES = {
  idle: 'IDLE',
  hover: 'HOVER',
  targeted: 'TARGETED',
  acquired: 'ACQUIRED',
  inspecting: 'INSPECTING',
  cleared: 'CLEARED'
};

const overlay = document.getElementById('instrument-overlay');
const modePill = document.getElementById('mode-pill');
const inspector = document.getElementById('inspector');
const toast = document.getElementById('toast');
const btnRef = document.getElementById('btn-ref');
const btnInspect = document.getElementById('btn-inspect');
const sourceLine = document.getElementById('source-line');

const catalog = await fetch('./data/features.json').then((r) => r.json());
const buildingResponse = await fetch('./data/nrcan-buildings.geojson');
if (!buildingResponse.ok) {
  throw new Error('NRCan optimized building clip is missing. OSM was not used.');
}
const buildingCollection = await buildingResponse.json();
const buildings = indexBuildings(buildingCollection);
const marks = mountMarks(overlay);

if (sourceLine) {
  sourceLine.textContent = `SOURCE  NRCan Optimized Buildings  ·  ${buildings.count} FOOTPRINTS`;
}

const map = L.map('map', {
  center: [ORIGIN.lat, ORIGIN.lng],
  zoom: 17,
  zoomControl: false,
  attributionControl: true,
  keyboard: true,
  boxZoom: false
});

const chromeHost = map.getContainer();
for (const node of [
  overlay,
  document.querySelector('.fi-tools'),
  inspector,
  toast
]) {
  if (!node) continue;
  chromeHost.appendChild(node);
  L.DomEvent.disableClickPropagation(node);
  L.DomEvent.disableScrollPropagation(node);
}

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles © Esri'
}).addTo(map);

L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  opacity: 0.38,
  attribution: 'Labels © Esri'
}).addTo(map);

const footprints = createFootprintController(map);

const rangeLine = L.polyline([], {
  color: '#f4f0ea',
  weight: 1,
  opacity: 0.38,
  dashArray: '2 5',
  interactive: false
}).addTo(map);

let mode = 'idle';
let pointerGeo = null;
let pointerPx = null;
let focus = null;
let reference = null;
let lastSnap = null;
let lastContext = null;
let hoverHit = null;
let acquiredObject = null;
let selectionState = null;
let activeView = 'MAP';
let identityPath = null;
let lastZoom = map.getZoom();
let locking = false;
let armReference = false;
let inspectorOpen = false;
let drag = false;
let toastTimer = 0;
let refMarker = null;

function showToast(message) {
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1600);
}

function setMode(next) {
  mode = next;
  const inspecting = next === 'inspecting' || (inspectorOpen && acquiredObject && next === 'acquired');
  const key = inspecting && next !== 'cleared' && next !== 'idle' && inspectorOpen ? 'inspecting' : next;
  modePill.dataset.mode = key;
  modePill.textContent = STATES[key] || String(key).toUpperCase();
}

function currentScale() {
  const lat = pointerGeo?.lat ?? map.getCenter().lat;
  return mapScaleDenominator(lat, map.getZoom());
}

function formatsFor(lat, lng, extras = {}) {
  return describeCoordinates(lat, lng, {
    ddDigits: ddDigitsForZoom(map.getZoom()),
    ...extras
  });
}

function bearingRange(from, to) {
  if (!from || !to) return { brg: null, rng: null, brgText: null, rngText: null };
  const brg = initialBearing(from.lat, from.lng, to.lat, to.lng);
  const rng = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return {
    brg,
    rng,
    brgText: formatBearing(brg),
    rngText: formatRange(rng)
  };
}

function paintRange(to) {
  if (!reference || !to) {
    rangeLine.setLatLngs([]);
    return;
  }
  rangeLine.setLatLngs([
    [reference.lat, reference.lng],
    [to.lat, to.lng]
  ]);
}

function placeRefMarker() {
  if (refMarker) {
    map.removeLayer(refMarker);
    refMarker = null;
  }
  if (!reference) return;
  refMarker = L.marker([reference.lat, reference.lng], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: 'fi-ref-dot',
      iconSize: [9, 9],
      iconAnchor: [4.5, 4.5]
    })
  }).addTo(map);
}

function currentObject() {
  return acquiredObject
    ? deriveObject(acquiredObject.feature, reference, catalog.features)
    : null;
}

function measurementsFor(derived) {
  if (!reference || !derived?.nav) return null;
  return {
    kind: 'bearing-range',
    from: { lat: reference.lat, lng: reference.lng },
    brg: derived.nav.brg,
    rng: derived.nav.rng
  };
}

function bindAcquiredFeature(feature, { path, view = activeView, acquiredAt = new Date().toISOString() } = {}) {
  const derived = deriveObject(feature, reference, catalog.features);
  acquiredObject = { feature, relation: path === 'source-id-restore' ? 'identity' : (acquiredObject?.relation || 'inside') };
  identityPath = path;
  const objectRef = attachAnchor(
    createObjectRef(feature, {
      catalogName: derived?.name || null,
      measurements: measurementsFor(derived)
    }),
    derived?.centroid || derived?.derived?.centroid
  );
  selectionState = createSelectionState(objectRef, { acquiredAt, activeView: view });
  activeView = view;
  footprints.acquire(feature, {
    name: derived?.name && derived.name !== 'Building' ? derived.name : null
  });
  return { derived, objectRef };
}

function hoverObject() {
  return hoverHit
    ? deriveObject(hoverHit.item.feature, reference, catalog.features)
    : null;
}

function inspectorFields() {
  return {
    kind: inspector.querySelector('[data-field="kind"]'),
    name: inspector.querySelector('[data-field="name"]'),
    address: inspector.querySelector('[data-field="address"]'),
    status: inspector.querySelector('[data-field="status"]'),
    className: inspector.querySelector('[data-field="class"]'),
    objectKey: inspector.querySelector('[data-field="object-key"]'),
    featureId: inspector.querySelector('[data-field="feature-id"]'),
    source: inspector.querySelector('[data-field="source"]'),
    sourceLayer: inspector.querySelector('[data-field="source-layer"]'),
    datasetUuid: inspector.querySelector('[data-field="dataset-uuid"]'),
    areaSource: inspector.querySelector('[data-field="area-source"]'),
    areaDerived: inspector.querySelector('[data-field="area-derived"]'),
    perim: inspector.querySelector('[data-field="perim"]'),
    heightMin: inspector.querySelector('[data-field="height-min"]'),
    heightMax: inspector.querySelector('[data-field="height-max"]'),
    elevMin: inspector.querySelector('[data-field="elev-min"]'),
    elevMax: inspector.querySelector('[data-field="elev-max"]'),
    quality: inspector.querySelector('[data-field="quality"]'),
    acqtech: inspector.querySelector('[data-field="acqtech"]'),
    provider: inspector.querySelector('[data-field="provider"]'),
    dateMin: inspector.querySelector('[data-field="date-min"]'),
    dateMax: inspector.querySelector('[data-field="date-max"]'),
    hacc: inspector.querySelector('[data-field="hacc"]'),
    vacc: inspector.querySelector('[data-field="vacc"]'),
    comment: inspector.querySelector('[data-field="comment"]'),
    anchor: inspector.querySelector('[data-field="anchor"]'),
    dd: inspector.querySelector('[data-field="dd"]'),
    utm: inspector.querySelector('[data-field="utm"]'),
    mgrs: inspector.querySelector('[data-field="mgrs"]'),
    epsg: inspector.querySelector('[data-field="epsg"]'),
    provenance: inspector.querySelector('[data-field="provenance"]'),
    provenanceMethod: inspector.querySelector('[data-field="provenance-method"]')
  };
}

function sourceOrMissing(value, suffix = 'SOURCE') {
  return value ? `${value}  ${suffix}` : 'NOT IN SOURCE';
}

function paintInspector() {
  if (!inspector) return;
  inspector.hidden = !inspectorOpen;
  if (!inspectorOpen) return;
  const fields = inspectorFields();
  const object = currentObject();
  const objectRef = selectionState?.objectRef || null;
  const src = object?.sourceAttributes;
  const anchor = objectRef?.anchor || object?.centroid;
  const formats = anchor
    ? formatsFor(anchor.lat, anchor.lng, focus || {})
    : (focus ? formatsFor(focus.lat, focus.lng, focus) : null);
  inspector.dataset.hasObject = object ? 'true' : 'false';
  if (fields.kind) fields.kind.textContent = object ? 'BUILDING' : 'NO OBJECT';
  if (fields.status) {
    fields.status.textContent = object ? 'OBJECT ACQUIRED' : 'NO ACQUIRED OBJECT';
  }
  if (fields.name) {
    fields.name.textContent = object
      ? (object.name || 'Building')
      : 'No acquired object';
  }
  if (fields.address) {
    const line = object?.address || null;
    fields.address.hidden = !line;
    fields.address.textContent = line
      ? `${line}  ·  IQAI catalog overlay / geocode  ·  not NRCan identity`
      : '';
  }
  if (fields.className) fields.className.textContent = object ? (object.objectKind || 'building').toUpperCase() : '—';
  if (fields.objectKey) fields.objectKey.textContent = objectRef?.objectKey || '—';
  if (fields.featureId) {
    fields.featureId.textContent = src?.featureId || objectRef?.sourceId || 'NOT IN SOURCE';
  }
  if (fields.source) {
    fields.source.textContent = object
      ? object.source
      : 'No acquired ObjectRef';
  }
  if (fields.sourceLayer) {
    fields.sourceLayer.textContent = object
      ? `${object.sourceLayer}${object.multipart ? `  ·  multipart ×${object.partCount}` : ''}`
      : '';
  }
  if (fields.datasetUuid) {
    fields.datasetUuid.textContent = object?.sourceUuid || objectRef?.authority?.datasetUuid
      ? `uuid  ${object?.sourceUuid || objectRef.authority.datasetUuid}`
      : '';
  }
  if (fields.areaSource) {
    fields.areaSource.textContent = sourceOrMissing(src?.buildingArea != null ? formatArea(src.buildingArea) : null);
  }
  if (fields.areaDerived) {
    fields.areaDerived.textContent = object?.derived.area != null
      ? `${formatArea(object.derived.area)}  DERIVED`
      : '—';
  }
  if (fields.perim) {
    fields.perim.textContent = object?.derived.perimeter != null
      ? `${object.derived.perimeter.toFixed(1)} m  DERIVED`
      : '—';
  }
  if (fields.heightMin) fields.heightMin.textContent = sourceOrMissing(formatMeters(src?.heightMin));
  if (fields.heightMax) fields.heightMax.textContent = sourceOrMissing(formatMeters(src?.heightMax));
  if (fields.elevMin) fields.elevMin.textContent = sourceOrMissing(formatMeters(src?.elevMin));
  if (fields.elevMax) fields.elevMax.textContent = sourceOrMissing(formatMeters(src?.elevMax));
  if (fields.quality) {
    fields.quality.textContent = src?.quality
      ? `${src.quality}${src.qualityCode != null ? `  (${src.qualityCode})` : ''}  SOURCE`
      : 'NOT IN SOURCE';
  }
  if (fields.acqtech) fields.acqtech.textContent = sourceOrMissing(src?.acquisition);
  if (fields.provider) fields.provider.textContent = sourceOrMissing(src?.provider);
  if (fields.dateMin) fields.dateMin.textContent = sourceOrMissing(src?.dateMin);
  if (fields.dateMax) fields.dateMax.textContent = sourceOrMissing(src?.dateMax);
  if (fields.hacc) {
    fields.hacc.textContent = (src?.hAccMin != null || src?.hAccMax != null)
      ? `${formatMeters(src.hAccMin) || '—'} – ${formatMeters(src.hAccMax) || '—'}  SOURCE`
      : 'NOT IN SOURCE';
  }
  if (fields.vacc) {
    fields.vacc.textContent = (src?.vAccMin != null || src?.vAccMax != null)
      ? `${formatMeters(src.vAccMin) || '—'} – ${formatMeters(src.vAccMax) || '—'}  SOURCE`
      : 'NOT IN SOURCE';
  }
  if (fields.comment) {
    fields.comment.hidden = !src?.comment;
    fields.comment.textContent = src?.comment || '';
  }
  if (fields.anchor) {
    fields.anchor.textContent = anchor
      ? `${anchor.lat.toFixed(6)}° N  ${Math.abs(anchor.lng).toFixed(6)}° W  DERIVED`
      : '—';
  }
  if (fields.dd) fields.dd.textContent = formats?.dd || '—';
  if (fields.utm) fields.utm.textContent = formats?.utm || '—';
  if (fields.mgrs) fields.mgrs.textContent = formats?.mgrs || '—';
  if (fields.epsg) fields.epsg.textContent = formats?.epsg || 'EPSG:4326';
  if (fields.provenance) {
    fields.provenance.textContent = objectRef?.authority?.dataset || 'NRCan Automatically Extracted Buildings';
  }
  if (fields.provenanceMethod) {
    fields.provenanceMethod.textContent = objectRef
      ? `method  ${objectRef.provenance?.method || 'vector-selection'}  ·  inference  ${objectRef.provenance?.inference ? 'yes' : 'no'}`
      : '';
  }
}

function setInspectorOpen(open) {
  inspectorOpen = Boolean(open);
  btnInspect.setAttribute('aria-pressed', inspectorOpen ? 'true' : 'false');
  paintInspector();
  if (inspectorOpen && acquiredObject) setMode('inspecting');
  else if (acquiredObject) setMode('acquired');
}

function enrichContext(geo, resolved) {
  const snap = nearestFeature(catalog.features, geo.lat, geo.lng, snapRadiusMeters(map.getZoom()));
  lastSnap = snap;
  const hit = hoverHit || buildings.findAt(geo.lat, geo.lng, 12);
  let place = resolved?.place || null;
  let placeSource = resolved?.placeSource || null;
  if (hit?.item) {
    const derived = deriveObject(hit.item.feature, reference, catalog.features);
    const label = objectLabel(derived);
    const line = derived?.address;
    if (derived?.overlay) {
      place = [label, line].filter(Boolean).join(' — ');
      placeSource = 'iqai-catalog-overlay';
    } else if (place) {
      placeSource = `${placeSource || 'geocode'}+nrcan-building`;
    } else if (label) {
      place = label;
      placeSource = 'nrcan-building';
    }
  } else if (snap) {
    place = snap.feature.address
      ? `${snap.feature.name} — ${snap.feature.address}`
      : snap.feature.name;
    placeSource = resolved?.place ? `${resolved.placeSource}+mapped-object` : 'mapped-object';
  }
  let elevationMeters = resolved?.elevationMeters ?? null;
  let elevationSource = resolved?.elevationSource || null;
  if (elevationMeters == null) {
    const demo = interpolateElevation(catalog.elevationSamples, geo.lat, geo.lng);
    if (demo) {
      elevationMeters = demo.meters;
      elevationSource = demo.source;
    }
  }
  lastContext = { place, placeSource, elevationMeters, elevationSource, snap, building: hit?.item?.feature || null };
  return lastContext;
}

function paintPointerReadout(geo, state) {
  if (!geo) return;
  const ctx = lastContext && state !== 'move' && state !== 'object' ? lastContext : { snap: lastSnap };
  const formats = formatsFor(geo.lat, geo.lng, {
    place: ctx.place,
    elevationMeters: ctx.elevationMeters
  });
  const nav = bearingRange(reference, geo);
  const metaParts = [];
  if (state !== 'move' && state !== 'object' && formats.elevation) metaParts.push(`EL  ${formats.elevation}`);
  if (nav.brgText) metaParts.push(`${nav.brgText}  ${nav.rngText}`);
  const snapText = ctx.snap
    ? `SNAP  ${ctx.snap.feature.name}  ${formatRange(ctx.snap.range)}`
    : '';
  let objectText = '';
  if (hoverHit) {
    if (state === 'targeted' || state === 'dwell') objectText = 'BUILDING FOOTPRINT';
    else if (state === 'acquired' || state === 'inspecting' || state === 'lock') objectText = 'OBJECT ACQUIRED';
    else objectText = 'BUILDING FOOTPRINT';
  }
  paintChip(marks.pointer, {
    coords: formats.dd,
    place: state === 'move' || state === 'object' ? '' : (ctx.place || ''),
    meta: metaParts.join('   ·   '),
    snap: state === 'move' || state === 'object' ? '' : snapText,
    object: objectText
  });
  marks.pointer.classList.toggle('is-snap', Boolean(ctx.snap) && state !== 'move' && state !== 'object');
}

function syncFocusMark() {
  if (!focus) {
    marks.focus.hidden = true;
    setPointerState(marks.focus, 'hidden');
    return;
  }
  const pt = map.latLngToContainerPoint([focus.lat, focus.lng]);
  marks.focus.hidden = false;
  setPointerState(marks.focus, 'calm');
  setMarkPosition(marks.focus, pt.x, pt.y);
  const formats = formatsFor(focus.lat, focus.lng, {
    place: focus.place,
    elevationMeters: focus.elevationMeters
  });
  const object = currentObject();
  paintFocusPlate(marks.focus, {
    kicker: object ? 'BUILDING' : 'FOCUS',
    place: object ? (object.name || object.address || 'Building') : (focus.place || 'Unnamed location'),
    coords: formats.dd,
    elev: formatElevationMeters(focus.elevationMeters),
    object: Boolean(object)
  });
}

function onPointerSample(latlng, containerPoint) {
  if (locking || drag) return;
  pointerGeo = { lat: latlng.lat, lng: latlng.lng };
  pointerPx = { x: containerPoint.x, y: containerPoint.y };
  setMarkPosition(marks.pointer, pointerPx.x, pointerPx.y);
  hoverHit = buildings.findAt(pointerGeo.lat, pointerGeo.lng, 14);
  lastSnap = nearestFeature(catalog.features, pointerGeo.lat, pointerGeo.lng, snapRadiusMeters(map.getZoom()));
  lastContext = { snap: lastSnap };
  const pointerState = hoverHit ? 'hover' : 'idle';
  if (inspectorOpen && acquiredObject) setMode('inspecting');
  else if (acquiredObject) setMode('acquired');
  else setMode(hoverHit ? 'hover' : 'idle');
  setPointerState(marks.pointer, hoverHit ? 'hover' : 'move');
  const derived = hoverObject();
  footprints.setHover(hoverHit?.item.feature || null, {
    inside: hoverHit?.relation === 'inside',
    name: derived && derived.name !== 'Building' ? derived.name : null
  });
  paintPointerReadout(pointerGeo, pointerState);
  paintRange(pointerGeo);
  scheduleDwell(pointerGeo.lng, pointerGeo.lat, (resolved) => {
    if (!pointerGeo) return;
    hoverHit = buildings.findAt(pointerGeo.lat, pointerGeo.lng, 14);
    if (!acquiredObject) setMode('targeted');
    setPointerState(marks.pointer, 'dwell');
    enrichContext(pointerGeo, resolved);
    const derived = hoverObject();
    if (hoverHit) {
      footprints.setDwell(hoverHit.item.feature, {
        name: derived && derived.name !== 'Building' ? derived.name : null
      });
    }
    paintPointerReadout(pointerGeo, 'targeted');
  });
}

async function acquire(latlng) {
  const geo = { lat: latlng.lat, lng: latlng.lng };
  const hit = buildings.findAt(geo.lat, geo.lng, 10);
  hoverHit = hit;
  if (!hit?.item) {
    if (acquiredObject) return;
    locking = true;
    cancelDwell();
    pointerGeo = geo;
    const pt = map.latLngToContainerPoint(latlng);
    pointerPx = { x: pt.x, y: pt.y };
    setMarkPosition(marks.pointer, pt.x, pt.y);
    setPointerState(marks.pointer, 'lock');
    const resolved = await resolveContext(geo.lat, geo.lng).catch(() => null);
    const ctx = enrichContext(geo, resolved);
    paintPointerReadout(geo, 'idle');
    await new Promise((r) => setTimeout(r, LOCK_MS));
    focus = {
      lat: geo.lat,
      lng: geo.lng,
      place: ctx.place,
      placeSource: ctx.placeSource,
      elevationMeters: ctx.elevationMeters,
      elevationSource: ctx.elevationSource,
      acquiredAt: new Date().toISOString()
    };
    rebuildReticle(marks.focus, map.getZoom(), { seam: true });
    bindSeam();
    syncFocusMark();
    paintInspector();
    paintRange(focus);
    locking = false;
    setPointerState(marks.pointer, 'hidden');
    setMode(inspectorOpen ? 'inspecting' : 'idle');
    return;
  }
  if (locking) return;
  locking = true;
  cancelDwell();
  pointerGeo = geo;
  const pt = map.latLngToContainerPoint(latlng);
  pointerPx = { x: pt.x, y: pt.y };
  setMarkPosition(marks.pointer, pt.x, pt.y);
  setPointerState(marks.pointer, 'lock');
  setMode('acquired');
  bindAcquiredFeature(hit.item.feature, { path: 'pointer-hit', view: 'MAP' });
  acquiredObject.relation = hit.relation;
  const resolved = await resolveContext(geo.lat, geo.lng).catch(() => null);
  const ctx = enrichContext(geo, resolved);
  const derived = deriveObject(hit.item.feature, reference, catalog.features);
  if (derived?.overlay) {
    ctx.place = [derived.name, derived.address].filter(Boolean).join(' — ');
    ctx.placeSource = 'iqai-catalog-overlay';
    lastContext = ctx;
  }
  paintPointerReadout(geo, 'acquired');
  await new Promise((r) => setTimeout(r, LOCK_MS));
  const anchor = derived?.centroid;
  focus = {
    lat: anchor?.lat ?? geo.lat,
    lng: anchor?.lng ?? geo.lng,
    place: ctx.place,
    placeSource: ctx.placeSource,
    elevationMeters: ctx.elevationMeters,
    elevationSource: ctx.elevationSource,
    acquiredAt: new Date().toISOString()
  };
  rebuildReticle(marks.focus, map.getZoom(), { seam: true });
  bindSeam();
  syncFocusMark();
  paintInspector();
  paintRange(focus);
  locking = false;
  setPointerState(marks.pointer, 'hidden');
  setMode(inspectorOpen ? 'inspecting' : 'acquired');
}

function clearFocus({ announce = true } = {}) {
  focus = null;
  locking = false;
  acquiredObject = null;
  selectionState = null;
  identityPath = null;
  hoverHit = null;
  cancelDwell();
  footprints.clear();
  syncFocusMark();
  inspectorOpen = false;
  btnInspect.setAttribute('aria-pressed', 'false');
  paintInspector();
  setPointerState(marks.pointer, pointerGeo ? 'move' : 'hidden');
  paintRange(pointerGeo);
  if (announce) {
    setMode('cleared');
    setTimeout(() => {
      if (mode === 'cleared' && !acquiredObject) setMode('idle');
    }, 500);
  } else {
    setMode('idle');
  }
}

function setReferencePoint(latlng) {
  reference = { lat: latlng.lat, lng: latlng.lng };
  armReference = false;
  btnRef.setAttribute('aria-pressed', 'false');
  placeRefMarker();
  paintInspector();
  paintRange(focus || pointerGeo);
  showToast('REFERENCE SET');
}

function bindSeam() {
  const hit = marks.focus.querySelector('[data-role="hit"]');
  const items = marks.focus.querySelectorAll('[data-action]');
  if (hit) {
    hit.onmouseenter = () => marks.focus.classList.add('is-seam-hot');
    hit.onmouseleave = () => marks.focus.classList.remove('is-seam-hot');
  }
  items.forEach((item) => {
    item.style.pointerEvents = 'auto';
    item.style.cursor = 'pointer';
    item.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.dataset.action === 'inspect') {
        setInspectorOpen(true);
        showToast('INSPECTOR');
        return;
      }
      showToast(`${item.dataset.action.toUpperCase()}  ·  reserved`);
    };
  });
}

map.on('mousemove', (event) => {
  document.getElementById('map').classList.toggle('is-dragging', drag);
  if (drag) {
    setPointerState(marks.pointer, 'hidden');
    return;
  }
  marks.pointer.hidden = false;
  onPointerSample(event.latlng, event.containerPoint);
});

map.on('mouseout', () => {
  if (locking) return;
  cancelDwell();
  setPointerState(marks.pointer, 'hidden');
  if (!focus) setMode(acquiredObject ? 'acquired' : 'idle');
  else if (inspectorOpen && acquiredObject) setMode('inspecting');
  else if (acquiredObject) setMode('acquired');
});

map.on('dragstart', () => {
  drag = true;
  cancelDwell();
  setPointerState(marks.pointer, 'hidden');
});

map.on('dragend zoomend moveend', () => {
  drag = false;
  syncFocusMark();
  placeRefMarker();
  paintInspector();
});

map.on('zoomend', () => {
  const zoom = map.getZoom();
  if (zoom !== lastZoom) {
    lastZoom = zoom;
    rebuildReticle(marks.pointer, zoom, { seam: false });
    if (focus) {
      rebuildReticle(marks.focus, zoom, { seam: true });
      bindSeam();
    }
  }
  syncFocusMark();
});

map.on('click', (event) => {
  const target = event.originalEvent?.target;
  if (target?.closest?.('.fi-tools, .fi-inspector, .fi-toast, .fi-overlay')) return;
  if (event.originalEvent?.shiftKey || armReference) {
    setReferencePoint(event.latlng);
    return;
  }
  void acquire(event.latlng);
});

document.getElementById('btn-in').addEventListener('click', () => map.zoomIn());
document.getElementById('btn-out').addEventListener('click', () => map.zoomOut());
document.getElementById('btn-home').addEventListener('click', () => map.setView([ORIGIN.lat, ORIGIN.lng], 17));
document.getElementById('btn-clear').addEventListener('click', () => {
  clearFocus();
  reference = null;
  placeRefMarker();
  rangeLine.setLatLngs([]);
});
btnRef.addEventListener('click', () => {
  armReference = !armReference;
  btnRef.setAttribute('aria-pressed', armReference ? 'true' : 'false');
  showToast(armReference ? 'CLICK MAP TO SET REFERENCE' : 'REFERENCE ARM OFF');
});
btnInspect.addEventListener('click', () => {
  setInspectorOpen(!inspectorOpen);
});
document.getElementById('inspector-close')?.addEventListener('click', () => setInspectorOpen(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (inspectorOpen) setInspectorOpen(false);
    else clearFocus();
  }
  if (event.key === 'i' || event.key === 'I' || event.key === 'p' || event.key === 'P') {
    setInspectorOpen(!inspectorOpen);
  }
});

function containerPointOf(lat, lng) {
  return map.latLngToContainerPoint([lat, lng]);
}

window.IQAIFocusInstrument = {
  version: '4.3',
  origin: ORIGIN,
  geometrySource: buildingCollection.attribution,
  buildingSource: buildingCollection.source,
  contract: 'iqai.lab.objectref.v1',
  states: Object.keys(STATES),
  getState() {
    const object = currentObject();
    return {
      mode,
      activeView,
      identityPath,
      pointer: pointerGeo,
      focus,
      reference,
      snap: lastSnap,
      context: lastContext,
      inspectorOpen,
      geometrySource: buildingCollection.attribution,
      buildingSource: buildingCollection.source,
      hover: hoverHit ? { id: hoverHit.item.feature.id, relation: hoverHit.relation, range: hoverHit.range } : null,
      candidate: hoverHit ? {
        sourceId: hoverHit.item.feature.properties?.feature_id || null,
        relation: hoverHit.relation
      } : null,
      object: object ? {
        objectId: object.objectId,
        kind: object.objectKind,
        source: object.source,
        sourceLayer: object.sourceLayer,
        name: object.name,
        multipart: object.multipart,
        sourceAttributes: object.sourceAttributes,
        derived: object.derived
      } : null,
      objectRef: selectionState?.objectRef || null,
      selection: selectionState,
      zoom: map.getZoom(),
      scale: currentScale(),
      formats: focus ? formatsFor(focus.lat, focus.lng, focus) : pointerGeo ? formatsFor(pointerGeo.lat, pointerGeo.lng) : null
    };
  },
  serializeSelection() {
    if (!selectionState) return null;
    return serializeSelection(selectionState);
  },
  restoreSelection(payload, nextView = 'MAP') {
    const sourceId = payload?.objectRef?.sourceId;
    const item = buildings.findBySourceId(sourceId);
    if (!item) {
      return {
        ok: false,
        reidentified: false,
        identityPath: 'source-id-miss',
        sourceId: sourceId || null
      };
    }
    const bound = bindAcquiredFeature(item.feature, {
      path: 'source-id-restore',
      view: nextView,
      acquiredAt: payload.acquiredAt || new Date().toISOString()
    });
    const anchor = bound.objectRef.anchor;
    focus = {
      lat: anchor?.lat ?? focus?.lat,
      lng: anchor?.lng ?? focus?.lng,
      place: bound.derived?.name || bound.derived?.address || focus?.place || null,
      placeSource: bound.derived?.overlay ? 'iqai-catalog-overlay' : 'authority-restore',
      elevationMeters: focus?.elevationMeters ?? null,
      elevationSource: focus?.elevationSource ?? null,
      acquiredAt: payload.acquiredAt || new Date().toISOString()
    };
    rebuildReticle(marks.focus, map.getZoom(), { seam: true });
    bindSeam();
    syncFocusMark();
    paintInspector();
    setMode(inspectorOpen ? 'inspecting' : 'acquired');
    return this.getState();
  },
  transferView(nextView) {
    const snapshot = this.serializeSelection();
    if (!snapshot) return { ok: false, reason: 'no-selection' };
    footprints.clear();
    acquiredObject = null;
    return this.restoreSelection(snapshot, nextView);
  },
  async moveTo(lat, lng) {
    const pt = containerPointOf(lat, lng);
    const latlng = L.latLng(lat, lng);
    onPointerSample(latlng, pt);
    cancelDwell();
    return this.getState();
  },
  async hoverAt(lat, lng) {
    const pt = containerPointOf(lat, lng);
    onPointerSample(L.latLng(lat, lng), pt);
    cancelDwell();
    return this.getState();
  },
  async dwellAt(lat, lng) {
    const pt = containerPointOf(lat, lng);
    const latlng = L.latLng(lat, lng);
    onPointerSample(latlng, pt);
    cancelDwell();
    hoverHit = buildings.findAt(lat, lng, 14);
    const resolved = await resolveContext(lat, lng);
    enrichContext({ lat, lng }, resolved);
    if (acquiredObject) setMode(inspectorOpen ? 'inspecting' : 'acquired');
    else setMode(hoverHit ? 'targeted' : 'idle');
    setPointerState(marks.pointer, 'dwell');
    const derived = hoverObject();
    if (hoverHit) {
      footprints.setDwell(hoverHit.item.feature, {
        name: derived && derived.name !== 'Building' ? derived.name : null
      });
    }
    paintPointerReadout({ lat, lng }, 'targeted');
    return this.getState();
  },
  async acquireAt(lat, lng) {
    await acquire(L.latLng(lat, lng));
    return this.getState();
  },
  openInspector() {
    setInspectorOpen(true);
    return this.getState();
  },
  closeInspector() {
    setInspectorOpen(false);
    return this.getState();
  },
  rest() {
    clearFocus({ announce: false });
    cancelDwell();
    setPointerState(marks.pointer, 'hidden');
    marks.pointer.hidden = true;
    return this.getState();
  },
  setView(lat, lng, zoom) {
    map.setView([lat, lng], zoom ?? map.getZoom());
    return this.getState();
  },
  setReference(lat, lng) {
    setReferencePoint(L.latLng(lat, lng));
    return this.getState();
  },
  clear() {
    clearFocus();
    return this.getState();
  }
};

setPointerState(marks.pointer, 'hidden');
setInspectorOpen(false);
