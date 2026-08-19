import {
  featureCentroid,
  featureOuterRings,
  featureToLatLngs,
  ringCentroid
} from './objects.js';

const GREEN = '#2FD46A';
const GREEN_BRIGHT = '#5AE88A';
const RED = '#FF1A12';
const RED_BRIGHT = '#FF3B14';
const INK = '#070b08';

const STYLE = {
  approach: {
    color: GREEN,
    weight: 1.2,
    opacity: 0,
    fillColor: GREEN,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--approach',
    interactive: false
  },
  hover: {
    color: GREEN,
    weight: 2.25,
    opacity: 0.98,
    fillColor: GREEN,
    fillOpacity: 0.03,
    className: 'fi-footprint fi-footprint--hover',
    interactive: false
  },
  targeted: {
    color: GREEN_BRIGHT,
    weight: 2.85,
    opacity: 1,
    fillColor: GREEN,
    fillOpacity: 0.045,
    className: 'fi-footprint fi-footprint--targeted',
    interactive: false
  },
  acquire: {
    color: RED_BRIGHT,
    weight: 3.35,
    opacity: 1,
    fillColor: RED,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--acquire',
    interactive: false
  },
  selected: {
    color: RED,
    weight: 3.2,
    opacity: 1,
    fillColor: RED,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--selected',
    interactive: false
  }
};

const CANDIDATE_CASING = {
  hover: { dark: 4.8, light: 0, darkOp: 0.82, lightOp: 0 },
  targeted: { dark: 6.0, light: 3.4, darkOp: 0.92, lightOp: 0.86 }
};

const ACQUIRED_CASING = {
  acquire: { dark: 9.2, light: 5.6, darkOp: 0.98, lightOp: 0.95 },
  selected: { dark: 8.6, light: 5.2, darkOp: 0.97, lightOp: 0.94 }
};

function insetRing(ring, factor = 0.045) {
  const c = ringCentroid(ring);
  if (!c) return ring;
  return ring.map(([lng, lat]) => [
    lng + (c.lng - lng) * factor,
    lat + (c.lat - lat) * factor
  ]);
}

function toLatLngsRing(ring) {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function cornerVertices(ring, limit = 12) {
  const pts = [];
  const n = ring.length - 1;
  for (let i = 0; i < n; i += 1) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
    const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = (2 * Math.PI) - turn;
    if (turn > 0.38) pts.push({ prev, cur, next });
  }
  return pts.slice(0, limit);
}

function tickSegment(from, to, length = 0.000028) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const mag = Math.hypot(dx, dy) || 1e-9;
  const t = Math.min(1, length / mag);
  return [from, [from[0] + dx * t, from[1] + dy * t]];
}

export function createFootprintController(map) {
  map.createPane('object-footprints');
  const pane = map.getPane('object-footprints');
  pane.style.zIndex = 450;
  pane.style.pointerEvents = 'none';

  const shadow = L.polygon([], {
    color: INK,
    weight: 0,
    fillColor: '#05070a',
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--shadow',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const casingDark = L.polygon([], {
    color: '#05070a',
    weight: 6,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--casing-dark fi-footprint--acquired-casing',
    pane: 'object-footprints',
    interactive: false,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  const casingLight = L.polygon([], {
    color: '#f7ecec',
    weight: 4,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--casing-light fi-footprint--acquired-casing',
    pane: 'object-footprints',
    interactive: false,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  const candCasingDark = L.polygon([], {
    color: '#041208',
    weight: 5,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--casing-dark fi-footprint--candidate-casing',
    pane: 'object-footprints',
    interactive: false,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  const candCasingLight = L.polygon([], {
    color: '#f3fff6',
    weight: 3,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--casing-light fi-footprint--candidate-casing',
    pane: 'object-footprints',
    interactive: false,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  const hover = L.polygon([], { ...STYLE.hover, pane: 'object-footprints' }).addTo(map);
  const inner = L.polygon([], {
    color: GREEN,
    weight: 0.85,
    opacity: 0,
    fillOpacity: 0,
    dashArray: '3 5',
    className: 'fi-footprint fi-footprint--inner',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const dwell = L.polygon([], { ...STYLE.targeted, pane: 'object-footprints' }).addTo(map);
  const selected = L.polygon([], { ...STYLE.selected, pane: 'object-footprints' }).addTo(map);
  const pulse = L.polygon([], {
    color: RED_BRIGHT,
    weight: 1.2,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--pulse',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const traveler = L.polyline([], {
    color: GREEN_BRIGHT,
    weight: 1.35,
    opacity: 0,
    className: 'fi-footprint fi-footprint--travel',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const ticks = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const acquiredTicks = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const radial = L.circleMarker([0, 0], {
    radius: 10,
    color: RED,
    weight: 1,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint-radial',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const label = L.marker([0, 0], {
    interactive: false,
    keyboard: false,
    pane: 'object-footprints',
    icon: L.divIcon({
      className: 'fi-foot-label',
      iconSize: [0, 0],
      iconAnchor: [0, 18],
      html: '<div class="fi-foot-label__card" hidden><span data-role="kicker">BUILDING FOOTPRINT</span><strong data-role="name"></strong><em data-role="status"></em></div>'
    })
  }).addTo(map);
  const candidateChip = L.marker([0, 0], {
    interactive: false,
    keyboard: false,
    pane: 'object-footprints',
    icon: L.divIcon({
      className: 'fi-cand-id-wrap',
      iconSize: [0, 0],
      iconAnchor: [0, 10],
      html: '<div class="fi-cand-id" hidden><span data-role="text"></span></div>'
    })
  }).addTo(map);

  hover.setStyle({ opacity: 0, fillOpacity: 0 });
  dwell.setStyle({ opacity: 0, fillOpacity: 0 });
  selected.setStyle({ opacity: 0, fillOpacity: 0 });

  let selectedId = null;
  let pulseTimer = 0;
  let phase = 'idle';

  function featureKey(feature) {
    return feature?.id || feature?.properties?.feature_id || null;
  }

  function hide(layer) {
    if (layer.setLatLngs) layer.setLatLngs([]);
    if (layer.setStyle) layer.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  function showPolygon(layer, feature, style) {
    layer.setLatLngs(featureToLatLngs(feature));
    layer.setStyle(style);
  }

  function showInner(feature, opacity, color = GREEN) {
    const latlngs = featureOuterRings(feature).map((ring) => toLatLngsRing(insetRing(ring)));
    inner.setLatLngs(latlngs);
    inner.setStyle({ opacity, fillOpacity: 0, weight: 0.9, color, dashArray: '2 6' });
  }

  function showShadow(feature, fillOpacity) {
    shadow.setLatLngs(featureToLatLngs(feature));
    shadow.setStyle({ fillOpacity, opacity: 0, weight: 0 });
  }

  function paintCasing(darkLayer, lightLayer, feature, spec, lightColor) {
    if (!feature || !spec) {
      hide(darkLayer);
      hide(lightLayer);
      return;
    }
    const latlngs = featureToLatLngs(feature);
    darkLayer.setLatLngs(latlngs);
    darkLayer.setStyle({
      color: '#05070a',
      weight: spec.dark,
      opacity: spec.darkOp,
      fillOpacity: 0,
      lineJoin: 'round',
      lineCap: 'round'
    });
    if (spec.light > 0) {
      lightLayer.setLatLngs(latlngs);
      lightLayer.setStyle({
        color: lightColor,
        weight: spec.light,
        opacity: spec.lightOp,
        fillOpacity: 0,
        lineJoin: 'round',
        lineCap: 'round'
      });
    } else {
      hide(lightLayer);
    }
  }

  function showCandidateCasing(feature, mode) {
    paintCasing(candCasingDark, candCasingLight, feature, CANDIDATE_CASING[mode], '#f3fff6');
  }

  function showAcquiredCasing(feature, mode) {
    paintCasing(casingDark, casingLight, feature, ACQUIRED_CASING[mode], '#f4f0ea');
  }

  function hideCandidateCasing() {
    hide(candCasingDark);
    hide(candCasingLight);
  }

  function paintTicks(feature, mode, group, color) {
    group.clearLayers();
    if (!feature || mode === 'approach') return;
    const limit = mode === 'acquire' || mode === 'selected' ? 16 : 10;
    for (const ring of featureOuterRings(feature)) {
      for (const { prev, cur, next } of cornerVertices(ring, limit)) {
        const a = tickSegment(cur, prev);
        const b = tickSegment(cur, next);
        const tickStyle = {
          color,
          weight: mode === 'acquire' || mode === 'selected' ? 1.6 : 1.15,
          opacity: mode === 'hover' ? 0.7 : 0.92,
          pane: 'object-footprints',
          interactive: false,
          className: 'fi-footprint-tick'
        };
        L.polyline(toLatLngsRing(a), tickStyle).addTo(group);
        L.polyline(toLatLngsRing(b), tickStyle).addTo(group);
      }
    }
  }

  function paintTraveler(feature, on) {
    if (!on || !feature) {
      hide(traveler);
      return;
    }
    const ring = featureOuterRings(feature)[0];
    traveler.setLatLngs(toLatLngsRing(ring));
    traveler.setStyle({ opacity: 0.85, weight: 1.2, color: GREEN_BRIGHT });
  }

  function hideCandidate() {
    hide(hover);
    hide(dwell);
    hide(pulse);
    hide(traveler);
    hideCandidateCasing();
    ticks.clearLayers();
    hideCandidateId();
  }

  function placeLabel(feature, { kicker, name, status }) {
    const centroid = featureCentroid(feature);
    const ring = featureOuterRings(feature)[0];
    const east = ring ? Math.max(...ring.map((p) => p[0])) : centroid?.lng;
    const lat = centroid?.lat;
    const lng = east != null ? east + 0.00004 : centroid?.lng;
    if (lat == null || lng == null) return;
    label.setLatLng([lat, lng]);
    const apply = () => {
      const root = label.getElement()?.querySelector('.fi-foot-label__card');
      if (!root) return false;
      root.hidden = false;
      root.dataset.mode = status === 'OBJECT ACQUIRED'
        ? 'acquired'
        : (status ? 'candidate' : 'footprint');
      root.querySelector('[data-role="kicker"]').textContent = kicker || 'BUILDING FOOTPRINT';
      const nameNode = root.querySelector('[data-role="name"]');
      nameNode.textContent = name || '';
      nameNode.hidden = !name;
      const statusNode = root.querySelector('[data-role="status"]');
      statusNode.textContent = status || '';
      statusNode.hidden = !status;
      return true;
    };
    if (!apply()) requestAnimationFrame(apply);
  }

  function hideLabel() {
    const root = label.getElement()?.querySelector('.fi-foot-label__card');
    if (root) root.hidden = true;
  }

  function candidateIdentity({ name, sourceId } = {}) {
    if (name) return name;
    if (sourceId) return String(sourceId).slice(0, 8);
    return 'BUILDING';
  }

  function placeCandidateId(feature, identity) {
    const centroid = featureCentroid(feature);
    const ring = featureOuterRings(feature)[0];
    const east = ring ? Math.max(...ring.map((p) => p[0])) : centroid?.lng;
    const lat = centroid?.lat;
    const lng = east != null ? east + 0.00004 : centroid?.lng;
    if (lat == null || lng == null) return;
    candidateChip.setLatLng([lat, lng]);
    const apply = () => {
      const root = candidateChip.getElement()?.querySelector('.fi-cand-id');
      if (!root) return false;
      root.hidden = false;
      root.querySelector('[data-role="text"]').textContent = identity || 'BUILDING';
      return true;
    };
    if (!apply()) requestAnimationFrame(apply);
  }

  function hideCandidateId() {
    const root = candidateChip.getElement()?.querySelector('.fi-cand-id');
    if (root) root.hidden = true;
  }

  function hideAcquired() {
    hide(selected);
    hide(pulse);
    hide(casingDark);
    hide(casingLight);
    acquiredTicks.clearLayers();
    hideLabel();
    radial.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  function clearTransient() {
    hideCandidate();
    radial.setStyle({ opacity: 0 });
    if (phase !== 'selected') {
      hide(inner);
      hide(shadow);
      hideLabel();
    }
  }

  return {
    setHover(feature, { inside = true, name = null, sourceId = null } = {}) {
      const key = featureKey(feature);
      const identity = candidateIdentity({ name, sourceId });
      if (selectedId) {
        hide(dwell);
        if (!feature || key === selectedId || !inside) {
          hide(hover);
          hideCandidateCasing();
          ticks.clearLayers();
          hideCandidateId();
          return;
        }
        showPolygon(hover, feature, STYLE.hover);
        showCandidateCasing(feature, 'hover');
        paintTicks(feature, 'hover', ticks, GREEN);
        placeCandidateId(feature, identity);
        return;
      }
      hide(dwell);
      hide(pulse);
      hide(traveler);
      if (!feature || !inside) {
        hide(hover);
        hide(inner);
        hide(shadow);
        hideCandidateCasing();
        ticks.clearLayers();
        hideCandidateId();
        hideLabel();
        phase = 'idle';
        return;
      }
      phase = 'hover';
      showPolygon(hover, feature, STYLE.hover);
      showCandidateCasing(feature, 'hover');
      showInner(feature, 0.28, GREEN);
      showShadow(feature, 0.05);
      paintTicks(feature, 'hover', ticks, GREEN);
      placeCandidateId(feature, identity);
    },
    setDwell(feature, { name = null, sourceId = null } = {}) {
      const key = featureKey(feature);
      const identity = candidateIdentity({ name, sourceId });
      if (!feature || key === selectedId) {
        hide(dwell);
        hide(hover);
        hideCandidateCasing();
        ticks.clearLayers();
        hideCandidateId();
        return;
      }
      hide(hover);
      phase = selectedId ? phase : 'targeted';
      showPolygon(dwell, feature, STYLE.targeted);
      showCandidateCasing(feature, 'targeted');
      paintTicks(feature, 'dwell', ticks, GREEN_BRIGHT);
      paintTraveler(feature, false);
      placeCandidateId(feature, identity);
      if (!selectedId) {
        showInner(feature, 0.32, GREEN);
        showShadow(feature, 0.06);
      }
    },
    acquire(feature, { name = null } = {}) {
      const nextId = featureKey(feature);
      const centroid = featureCentroid(feature);
      if (selectedId && selectedId !== nextId) {
        hideAcquired();
      }
      selectedId = nextId;
      phase = 'acquire';
      hideCandidate();
      showPolygon(selected, feature, STYLE.acquire);
      showPolygon(pulse, feature, {
        color: RED_BRIGHT,
        weight: 2.4,
        opacity: 1,
        fillOpacity: 0,
        className: 'fi-footprint fi-footprint--pulse'
      });
      showAcquiredCasing(feature, 'acquire');
      showInner(feature, 0, RED);
      showShadow(feature, 0.06);
      paintTicks(feature, 'acquire', acquiredTicks, RED_BRIGHT);
      if (centroid) {
        radial.setLatLng([centroid.lat, centroid.lng]);
        radial.setStyle({ opacity: 0.85, fillOpacity: 0, radius: 16, color: RED_BRIGHT });
      }
      placeLabel(feature, {
        kicker: 'BUILDING',
        name,
        status: 'OBJECT ACQUIRED'
      });
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => {
        selected.setStyle(STYLE.selected);
        hide(pulse);
        hide(traveler);
        radial.setStyle({ opacity: 0, fillOpacity: 0 });
        paintTicks(feature, 'selected', acquiredTicks, RED);
        showAcquiredCasing(feature, 'selected');
        showInner(feature, 0, RED);
        showShadow(feature, 0.04);
        phase = 'selected';
      }, 420);
      return selectedId;
    },
    clear() {
      selectedId = null;
      phase = 'idle';
      clearTimeout(pulseTimer);
      hideCandidate();
      hideAcquired();
      hide(inner);
      hide(shadow);
      hide(traveler);
      hideCandidateId();
    },
    selectedId() {
      return selectedId;
    }
  };
}

export function footprintSvgPath(ring, size = 72) {
  if (!ring?.length) return '';
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 6;
  const w = Math.max(maxX - minX, 1e-8);
  const h = Math.max(maxY - minY, 1e-8);
  const scale = (size - pad * 2) / Math.max(w, h);
  const d = ring.map(([x, y], i) => {
    const px = pad + (x - minX) * scale;
    const py = size - (pad + (y - minY) * scale);
    return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(' ') + ' Z';
  return d;
}
