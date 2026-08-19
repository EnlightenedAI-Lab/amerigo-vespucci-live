import {
  featureCentroid,
  featureOuterRings,
  featureToLatLngs,
  nearestEdgePoint,
  nearestFacadeEdges,
  ringCentroid
} from './objects.js';

const GREEN = '#3DFF74';
const GREEN_BRIGHT = '#6CFF94';
const RED = '#FF0000';
const RED_BRIGHT = '#FF1500';
const COLLECTED = '#c8b48a';
const INK = '#14120f';

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
    weight: 2.8,
    opacity: 0.92,
    fillColor: GREEN,
    fillOpacity: 0.04,
    className: 'fi-footprint fi-footprint--hover',
    interactive: false
  },
  targeted: {
    color: GREEN,
    weight: 3.15,
    opacity: 0.95,
    fillColor: GREEN,
    fillOpacity: 0.05,
    className: 'fi-footprint fi-footprint--targeted',
    interactive: false
  },
  acquire: {
    color: RED,
    weight: 4.8,
    opacity: 1,
    fillColor: RED,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--acquire',
    interactive: false
  },
  selected: {
    color: RED,
    weight: 4.5,
    opacity: 1,
    fillColor: RED,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--selected',
    interactive: false
  }
};

const CANDIDATE_CASING = {
  hover: { dark: 4.6, light: 0, darkOp: 0.9, lightOp: 0 },
  targeted: { dark: 5.1, light: 0, darkOp: 0.94, lightOp: 0 }
};

const ACQUIRED_CASING = {
  acquire: { dark: 7.2, light: 0, darkOp: 1, lightOp: 0 },
  selected: { dark: 6.8, light: 0, darkOp: 1, lightOp: 0 }
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

function dominantCorners(feature, limit = 4) {
  const pts = [];
  for (const ring of featureOuterRings(feature)) {
    const n = ring.length - 1;
    if (n < 3) continue;
    for (let i = 0; i < n; i += 1) {
      const prev = ring[(i - 1 + n) % n];
      const cur = ring[i];
      const next = ring[(i + 1) % n];
      const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
      const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
      let turn = Math.abs(a2 - a1);
      if (turn > Math.PI) turn = (2 * Math.PI) - turn;
      if (turn > 0.32) pts.push({ prev, cur, next, turn });
    }
  }
  pts.sort((a, b) => b.turn - a.turn);
  const picked = [];
  for (const pt of pts) {
    const clustered = picked.some((row) => (
      Math.hypot(row.cur[0] - pt.cur[0], row.cur[1] - pt.cur[1]) < 0.00009
    ));
    if (clustered) continue;
    picked.push(pt);
    if (picked.length >= limit) break;
  }
  return picked;
}

function tickSegment(from, to, length = 0.00004) {
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
  const collected = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const approach = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const contact = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const seal = L.layerGroup([], { pane: 'object-footprints' }).addTo(map);
  const releasing = L.polygon([], {
    color: RED,
    weight: 3.2,
    opacity: 0,
    fillOpacity: 0,
    className: 'fi-footprint fi-footprint--release',
    pane: 'object-footprints',
    interactive: false
  }).addTo(map);
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
  const identityPlate = L.marker([0, 0], {
    interactive: false,
    keyboard: false,
    pane: 'object-footprints',
    icon: L.divIcon({
      className: 'fi-id-plate-wrap',
      iconSize: [0, 0],
      iconAnchor: [0, 10],
      html: '<div class="fi-id-plate" hidden data-mode="candidate"><strong data-role="text"></strong><span data-role="height" hidden></span></div>'
    })
  }).addTo(map);

  hover.setStyle({ opacity: 0, fillOpacity: 0 });
  dwell.setStyle({ opacity: 0, fillOpacity: 0 });
  selected.setStyle({ opacity: 0, fillOpacity: 0 });

  let selectedId = null;
  let pulseTimer = 0;
  let releaseTimer = 0;
  let phase = 'idle';
  let acquiredPlate = { identity: 'BUILDING', heightMax: null };
  let acquiredFeature = null;

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
    inner.setStyle({ opacity, fillOpacity: 0, weight: 1.35, color, dashArray: '3 5' });
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
    if (!feature || mode === 'approach' || mode === 'acquire' || mode === 'selected') return;
    for (const { prev, cur, next } of dominantCorners(feature, 6)) {
      const a = tickSegment(cur, prev, 0.000036);
      const b = tickSegment(cur, next, 0.000036);
      const tickStyle = {
        color,
        weight: 1.35,
        opacity: 0.7,
        pane: 'object-footprints',
        interactive: false,
        className: 'fi-footprint-tick'
      };
      L.polyline(toLatLngsRing(a), tickStyle).addTo(group);
      L.polyline(toLatLngsRing(b), tickStyle).addTo(group);
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
    contact.clearLayers();
    approach.clearLayers();
    hideIdentity();
  }

  function offsetMeters(lat, lng, northM, eastM) {
    const dLat = northM / 111320;
    const dLng = eastM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    return { lat: lat + dLat, lng: lng + dLng };
  }

  function paintApproach(feature, from) {
    approach.clearLayers();
    contact.clearLayers();
    if (!feature || !from) return null;
    const edge = nearestEdgePoint(from.lat, from.lng, feature);
    if (!edge || edge.range < 0.4 || edge.range > 16) return edge;
    const bearingNorth = edge.lat - from.lat;
    const bearingEast = (edge.lng - from.lng) * Math.cos(edge.lat * Math.PI / 180);
    const mag = Math.hypot(bearingNorth, bearingEast) || 1e-9;
    const uN = bearingNorth / mag;
    const uE = bearingEast / mag;
    const inward = offsetMeters(edge.lat, edge.lng, uN * 12, uE * 12);
    const left = offsetMeters(edge.lat, edge.lng, -uE * 8, uN * 8);
    const right = offsetMeters(edge.lat, edge.lng, uE * 8, -uN * 8);
    const tickStyle = {
      color: GREEN,
      weight: 2.45,
      opacity: 1,
      pane: 'object-footprints',
      interactive: false,
      className: 'fi-footprint fi-footprint--approach-tick'
    };
    L.polyline([[edge.lat, edge.lng], [inward.lat, inward.lng]], tickStyle).addTo(approach);
    L.polyline([[left.lat, left.lng], [right.lat, right.lng]], tickStyle).addTo(approach);
    return edge;
  }

  function paintContact(feature, from, mode = 'hover') {
    contact.clearLayers();
    if (!feature || !from) return 0;
    const edges = nearestFacadeEdges(from.lat, from.lng, feature, 3);
    const color = mode === 'dwell' ? GREEN_BRIGHT : GREEN;
    const weight = mode === 'dwell' ? 5.6 : 5.2;
    for (const edge of edges) {
      const latlngs = [[edge.a.lat, edge.a.lng], [edge.b.lat, edge.b.lng]];
      L.polyline(latlngs, {
        color: '#05070a',
        weight: weight + 2.1,
        opacity: 0.95,
        pane: 'object-footprints',
        interactive: false,
        className: 'fi-footprint fi-footprint--contact-ink',
        lineCap: 'square',
        lineJoin: 'miter'
      }).addTo(contact);
      L.polyline(latlngs, {
        color,
        weight,
        opacity: 1,
        pane: 'object-footprints',
        interactive: false,
        className: 'fi-footprint fi-footprint--contact',
        lineCap: 'square',
        lineJoin: 'miter'
      }).addTo(contact);
    }
    return edges.length;
  }

  function paintSeal(feature) {
    seal.clearLayers();
    if (!feature) return 0;
    const corners = dominantCorners(feature, 4);
    const style = {
      color: RED,
      weight: 2.9,
      opacity: 1,
      pane: 'object-footprints',
      interactive: false,
      className: 'fi-footprint fi-footprint--seal',
      lineCap: 'square',
      lineJoin: 'miter'
    };
    for (const { prev, cur, next } of corners) {
      const a = tickSegment(cur, prev, 0.000092);
      const b = tickSegment(cur, next, 0.000092);
      L.polyline(toLatLngsRing(a), style).addTo(seal);
      L.polyline(toLatLngsRing(b), style).addTo(seal);
    }
    requestAnimationFrame(() => {
      seal.eachLayer((layer) => {
        const path = layer._path;
        if (!path) return;
        path.classList.remove('fi-footprint--seal');
        void path.getBoundingClientRect();
        path.classList.add('fi-footprint', 'fi-footprint--seal');
      });
    });
    return corners.length;
  }

  function candidateIdentity({ name, sourceId } = {}) {
    if (name) return name;
    if (sourceId) return String(sourceId).slice(0, 8);
    return 'BUILDING';
  }

  function plateAnchor(feature) {
    const centroid = featureCentroid(feature);
    const ring = featureOuterRings(feature)[0];
    const east = ring ? Math.max(...ring.map((p) => p[0])) : centroid?.lng;
    return {
      lat: centroid?.lat,
      lng: east != null ? east + 0.00004 : centroid?.lng
    };
  }

  function placeIdentity(feature, { identity, heightMax = null, acquired = false } = {}) {
    if (!feature) return;
    const at = plateAnchor(feature);
    if (at.lat == null || at.lng == null) return;
    identityPlate.setLatLng([at.lat, at.lng]);
    const apply = () => {
      const root = identityPlate.getElement()?.querySelector('.fi-id-plate');
      if (!root) return false;
      root.hidden = false;
      root.dataset.mode = acquired ? 'acquired' : 'candidate';
      root.querySelector('[data-role="text"]').textContent = identity || 'BUILDING';
      const heightNode = root.querySelector('[data-role="height"]');
      if (heightNode) {
        const show = Number.isFinite(Number(heightMax)) && Number(heightMax) > 1;
        heightNode.hidden = !show;
        heightNode.textContent = show ? `H ${Math.round(Number(heightMax))} m` : '';
      }
      return true;
    };
    if (!apply()) requestAnimationFrame(apply);
  }

  function hideIdentity() {
    const root = identityPlate.getElement()?.querySelector('.fi-id-plate');
    if (root) root.hidden = true;
  }

  function restoreAcquiredPlate() {
    if (!acquiredFeature) {
      hideIdentity();
      return;
    }
    placeIdentity(acquiredFeature, {
      identity: acquiredPlate.identity,
      heightMax: acquiredPlate.heightMax,
      acquired: true
    });
  }

  function hideAcquired() {
    hide(selected);
    hide(pulse);
    hide(casingDark);
    hide(casingLight);
    acquiredTicks.clearLayers();
    seal.clearLayers();
    radial.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  function startRelease() {
    const latlngs = selected.getLatLngs();
    if (!latlngs?.length) return;
    releasing.setLatLngs(latlngs);
    releasing.setStyle({
      color: RED,
      weight: 3.2,
      opacity: 1,
      fillOpacity: 0
    });
    const path = releasing._path;
    if (path) {
      path.classList.remove('fi-footprint--release');
      void path.getBoundingClientRect();
      path.classList.add('fi-footprint', 'fi-footprint--release');
    }
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => hide(releasing), 720);
  }

  function clearTransient() {
    hideCandidate();
    radial.setStyle({ opacity: 0 });
    if (phase !== 'selected') {
      hide(inner);
      hide(shadow);
    }
  }

  return {
    setHover(feature, {
      inside = true,
      name = null,
      sourceId = null,
      from = null,
      heightMax = null
    } = {}) {
      const key = featureKey(feature);
      const identity = candidateIdentity({ name, sourceId });
      if (selectedId) {
        hide(dwell);
        if (!feature || key === selectedId) {
          hide(hover);
          hideCandidateCasing();
          ticks.clearLayers();
          contact.clearLayers();
          approach.clearLayers();
          restoreAcquiredPlate();
          return null;
        }
        if (!inside) {
          hide(hover);
          hideCandidateCasing();
          ticks.clearLayers();
          restoreAcquiredPlate();
          return paintApproach(feature, from);
        }
        approach.clearLayers();
        showPolygon(hover, feature, STYLE.hover);
        showCandidateCasing(feature, 'hover');
        paintContact(feature, from, 'hover');
        placeIdentity(feature, { identity, heightMax, acquired: false });
        return { range: 0 };
      }
      hide(dwell);
      hide(pulse);
      hide(traveler);
      if (!feature) {
        hide(hover);
        hide(inner);
        hide(shadow);
        hideCandidateCasing();
        ticks.clearLayers();
        contact.clearLayers();
        approach.clearLayers();
        hideIdentity();
        phase = 'idle';
        return null;
      }
      if (!inside) {
        hide(hover);
        hide(inner);
        hide(shadow);
        hideCandidateCasing();
        ticks.clearLayers();
        hideIdentity();
        phase = 'approach';
        return paintApproach(feature, from);
      }
      approach.clearLayers();
      phase = 'hover';
      showPolygon(hover, feature, STYLE.hover);
      showCandidateCasing(feature, 'hover');
      showInner(feature, 0.28, GREEN);
      showShadow(feature, 0.04);
      paintContact(feature, from, 'hover');
      placeIdentity(feature, { identity, heightMax, acquired: false });
      return { range: 0 };
    },
    setDwell(feature, {
      name = null,
      sourceId = null,
      heightMax = null,
      from = null
    } = {}) {
      const key = featureKey(feature);
      const identity = candidateIdentity({ name, sourceId });
      if (!feature || key === selectedId) {
        hide(dwell);
        hide(hover);
        hideCandidateCasing();
        ticks.clearLayers();
        contact.clearLayers();
        approach.clearLayers();
        restoreAcquiredPlate();
        return;
      }
      hide(hover);
      approach.clearLayers();
      phase = selectedId ? phase : 'targeted';
      showPolygon(dwell, feature, STYLE.targeted);
      showCandidateCasing(feature, 'targeted');
      paintContact(feature, from, 'dwell');
      paintTraveler(feature, false);
      placeIdentity(feature, { identity, heightMax, acquired: false });
      if (!selectedId) {
        showInner(feature, 0.34, GREEN);
        showShadow(feature, 0.05);
      }
    },
    acquire(feature, { name = null, heightMax = null } = {}) {
      const nextId = featureKey(feature);
      const identity = candidateIdentity({ name });
      if (selectedId && selectedId !== nextId) {
        startRelease();
        hideAcquired();
      }
      selectedId = nextId;
      acquiredFeature = feature;
      acquiredPlate = { identity, heightMax };
      phase = 'acquire';
      hideCandidate();
      contact.clearLayers();
      showPolygon(selected, feature, STYLE.acquire);
      showAcquiredCasing(feature, 'acquire');
      showInner(feature, 0.32, RED);
      showShadow(feature, 0.05);
      acquiredTicks.clearLayers();
      paintSeal(feature);
      placeIdentity(feature, { identity, heightMax, acquired: true });
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => {
        selected.setStyle(STYLE.selected);
        hide(pulse);
        hide(traveler);
        seal.clearLayers();
        radial.setStyle({ opacity: 0, fillOpacity: 0 });
        showAcquiredCasing(feature, 'selected');
        showInner(feature, 0.28, RED);
        showShadow(feature, 0.04);
        placeIdentity(feature, { identity, heightMax, acquired: true });
        phase = 'selected';
      }, 420);
      return selectedId;
    },
    setCollected(features = [], { excludeId = null } = {}) {
      collected.clearLayers();
      for (const feature of features) {
        const key = featureKey(feature);
        if (!feature || (excludeId != null && key === excludeId)) continue;
        L.polygon(featureToLatLngs(feature), {
          color: COLLECTED,
          weight: 1.0,
          opacity: 0.4,
          fillOpacity: 0,
          className: 'fi-footprint fi-footprint--collected',
          pane: 'object-footprints',
          interactive: false,
          lineJoin: 'round'
        }).addTo(collected);
      }
      collected.bringToBack?.();
    },
    clear() {
      selectedId = null;
      acquiredFeature = null;
      acquiredPlate = { identity: 'BUILDING', heightMax: null };
      phase = 'idle';
      clearTimeout(pulseTimer);
      clearTimeout(releaseTimer);
      hideCandidate();
      hideAcquired();
      contact.clearLayers();
      seal.clearLayers();
      hide(releasing);
      hide(inner);
      hide(shadow);
      hide(traveler);
      hideIdentity();
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
