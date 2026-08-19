import {
  featureCentroid,
  featureOuterRings,
  featureToLatLngs,
  ringCentroid
} from './objects.js';

const CYAN = '#7ec8e3';
const CYAN_BRIGHT = '#9ad7ec';
const CYAN_FILL = '#3a9bb8';
const INK = '#0b1014';

const STYLE = {
  approach: {
    color: CYAN,
    weight: 1.35,
    opacity: 0.55,
    fillColor: CYAN_FILL,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--approach',
    interactive: false
  },
  hover: {
    color: CYAN,
    weight: 2.15,
    opacity: 0.95,
    fillColor: CYAN_FILL,
    fillOpacity: 0.03,
    className: 'fi-footprint fi-footprint--hover',
    interactive: false
  },
  targeted: {
    color: CYAN_BRIGHT,
    weight: 2.7,
    opacity: 1,
    fillColor: CYAN_FILL,
    fillOpacity: 0.045,
    className: 'fi-footprint fi-footprint--targeted',
    interactive: false
  },
  acquire: {
    color: '#d4f4fb',
    weight: 3.05,
    opacity: 1,
    fillColor: CYAN_FILL,
    fillOpacity: 0.04,
    className: 'fi-footprint fi-footprint--acquire',
    interactive: false
  },
  selected: {
    color: '#b7e7f4',
    weight: 2.85,
    opacity: 1,
    fillColor: CYAN_FILL,
    fillOpacity: 0.035,
    className: 'fi-footprint fi-footprint--selected',
    interactive: false
  }
};

const CASING = {
  hover: { dark: 4.4, light: 0, darkOp: 0.72, lightOp: 0 },
  targeted: { dark: 6.2, light: 3.6, darkOp: 0.92, lightOp: 0.88 },
  acquire: { dark: 8.4, light: 5.2, darkOp: 0.96, lightOp: 0.95 },
  selected: { dark: 8.2, light: 5.0, darkOp: 0.96, lightOp: 0.94 }
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
    className: 'fi-footprint fi-footprint--casing-dark',
    pane: 'object-footprints',
    interactive: false,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  const casingLight = L.polygon([], {
    color: '#f4f0ea',
    weight: 4,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--casing-light',
    pane: 'object-footprints',
    interactive: false,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);
  const hover = L.polygon([], { ...STYLE.hover, pane: 'object-footprints' }).addTo(map);
  const inner = L.polygon([], {
    color: CYAN,
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
    color: CYAN_BRIGHT,
    weight: 1.2,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--pulse',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const traveler = L.polyline([], {
    color: '#d7f4fb',
    weight: 1.35,
    opacity: 0,
    className: 'fi-footprint fi-footprint--travel',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
  const ticks = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const radial = L.circleMarker([0, 0], {
    radius: 10,
    color: CYAN,
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

  hover.setStyle({ opacity: 0, fillOpacity: 0 });
  dwell.setStyle({ opacity: 0, fillOpacity: 0 });
  selected.setStyle({ opacity: 0, fillOpacity: 0 });

  let selectedId = null;
  let pulseTimer = 0;
  let phase = 'idle';

  function hide(layer) {
    if (layer.setLatLngs) layer.setLatLngs([]);
    if (layer.setStyle) layer.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  function showPolygon(layer, feature, style) {
    layer.setLatLngs(featureToLatLngs(feature));
    layer.setStyle(style);
  }

  function showInner(feature, opacity) {
    const latlngs = featureOuterRings(feature).map((ring) => toLatLngsRing(insetRing(ring)));
    inner.setLatLngs(latlngs);
    inner.setStyle({ opacity, fillOpacity: 0, weight: 0.9, color: CYAN, dashArray: '2 6' });
  }

  function showShadow(feature, fillOpacity) {
    shadow.setLatLngs(featureToLatLngs(feature));
    shadow.setStyle({ fillOpacity, opacity: 0, weight: 0 });
  }

  function showCasing(feature, mode) {
    const spec = CASING[mode];
    if (!feature || !spec) {
      hide(casingDark);
      hide(casingLight);
      return;
    }
    const latlngs = featureToLatLngs(feature);
    casingDark.setLatLngs(latlngs);
    casingDark.setStyle({
      color: '#05070a',
      weight: spec.dark,
      opacity: spec.darkOp,
      fillOpacity: 0,
      lineJoin: 'round',
      lineCap: 'round'
    });
    if (spec.light > 0) {
      casingLight.setLatLngs(latlngs);
      casingLight.setStyle({
        color: '#f4f0ea',
        weight: spec.light,
        opacity: spec.lightOp,
        fillOpacity: 0,
        lineJoin: 'round',
        lineCap: 'round'
      });
    } else {
      hide(casingLight);
    }
  }

  function paintTicks(feature, mode) {
    ticks.clearLayers();
    if (!feature || mode === 'approach') return;
    const limit = mode === 'acquire' ? 16 : 10;
    for (const ring of featureOuterRings(feature)) {
      for (const { prev, cur, next } of cornerVertices(ring, limit)) {
        const a = tickSegment(cur, prev);
        const b = tickSegment(cur, next);
        const tickStyle = {
          color: CYAN_BRIGHT,
          weight: mode === 'acquire' ? 1.6 : 1.15,
          opacity: mode === 'hover' ? 0.55 : 0.9,
          pane: 'object-footprints',
          interactive: false,
          className: 'fi-footprint-tick'
        };
        L.polyline(toLatLngsRing(a), tickStyle).addTo(ticks);
        L.polyline(toLatLngsRing(b), tickStyle).addTo(ticks);
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
    traveler.setStyle({ opacity: 0.85, weight: 1.2 });
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
      root.dataset.mode = status ? 'acquired' : 'footprint';
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

  function clearTransient() {
    hide(hover);
    hide(dwell);
    hide(pulse);
    hide(traveler);
    radial.setStyle({ opacity: 0 });
    if (phase !== 'selected') {
      hide(inner);
      hide(shadow);
      ticks.clearLayers();
      hideLabel();
    }
  }

  return {
    setHover(feature, { inside = true, name = null } = {}) {
      if (selectedId) {
        hide(dwell);
        if (!feature || feature.id === selectedId) {
          hide(hover);
          return;
        }
        showPolygon(hover, feature, {
          ...STYLE.approach,
          opacity: inside ? 0.5 : 0.32,
          className: 'fi-footprint fi-footprint--candidate'
        });
        return;
      }
      hide(dwell);
      hide(pulse);
      hide(traveler);
      if (!feature) {
        hide(hover);
        hide(inner);
        hide(shadow);
        hide(casingDark);
        hide(casingLight);
        ticks.clearLayers();
        hideLabel();
        phase = 'idle';
        return;
      }
      phase = inside ? 'hover' : 'approach';
      showPolygon(hover, feature, inside ? STYLE.hover : STYLE.approach);
      if (inside) {
        showCasing(feature, 'hover');
        showInner(feature, 0.4);
        showShadow(feature, 0.08);
        paintTicks(feature, 'hover');
        placeLabel(feature, {
          kicker: 'BUILDING FOOTPRINT',
          name,
          status: ''
        });
      } else {
        hide(inner);
        hide(shadow);
        hide(casingDark);
        hide(casingLight);
        ticks.clearLayers();
        hideLabel();
      }
    },
    setDwell(feature, { name = null } = {}) {
      if (!feature || feature.id === selectedId) {
        hide(dwell);
        return;
      }
      hide(hover);
      phase = 'targeted';
      showPolygon(dwell, feature, STYLE.targeted);
      showCasing(feature, 'targeted');
      showInner(feature, 0.55);
      showShadow(feature, 0.1);
      paintTicks(feature, 'dwell');
      paintTraveler(feature, true);
      placeLabel(feature, {
        kicker: 'BUILDING FOOTPRINT',
        name,
        status: 'TARGETED'
      });
    },
    acquire(feature, { name = null } = {}) {
      const centroid = featureCentroid(feature);
      selectedId = feature.id;
      phase = 'acquire';
      hide(hover);
      hide(dwell);
      showPolygon(selected, feature, STYLE.acquire);
      showPolygon(pulse, feature, {
        color: CYAN_BRIGHT,
        weight: 1.1,
        opacity: 0.7,
        fillOpacity: 0,
        className: 'fi-footprint fi-footprint--pulse'
      });
      showCasing(feature, 'acquire');
      showInner(feature, 0.65);
      showShadow(feature, 0.12);
      paintTicks(feature, 'acquire');
      paintTraveler(feature, true);
      if (centroid) {
        radial.setLatLng([centroid.lat, centroid.lng]);
        radial.setStyle({ opacity: 0.9, fillOpacity: 0.08, radius: 14 });
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
        paintTicks(feature, 'selected');
        showCasing(feature, 'selected');
        showInner(feature, 0.5);
        showShadow(feature, 0.1);
        phase = 'selected';
      }, 860);
      return selectedId;
    },
    clear() {
      selectedId = null;
      phase = 'idle';
      clearTimeout(pulseTimer);
      hide(hover);
      hide(dwell);
      hide(selected);
      hide(pulse);
      hide(inner);
      hide(shadow);
      hide(casingDark);
      hide(casingLight);
      hide(traveler);
      ticks.clearLayers();
      radial.setStyle({ opacity: 0, fillOpacity: 0 });
      hideLabel();
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
