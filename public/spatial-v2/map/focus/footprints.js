/**
 * Focus V4.6 footprint language on the long-lived MapView.
 * SVG overlay: GraphicsLayer counts are not pixels (F-37).
 * GREEN = candidate. BRIGHT RED = acquired. Collected = quiet hairline.
 */

import {
  featureCentroid,
  featureOuterRings,
  nearestEdgePoint,
  nearestFacadeEdges,
  ringCentroid
} from './objects.js';

const NS = 'http://www.w3.org/2000/svg';
const GREEN = '#3DFF74';
const GREEN_BRIGHT = '#6CFF94';
const RED = '#FF0000';
const COLLECTED = '#c8b48a';
const INK = '#05070a';
export const FOCUS_FOOTPRINT_OVERLAY_ID = 'iqai-v2-focus-overlay';

function featureKey(feature) {
  return feature?.id || feature?.properties?.feature_id || null;
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
    if (picked.some((row) => Math.hypot(row.cur[0] - pt.cur[0], row.cur[1] - pt.cur[1]) < 0.00009)) continue;
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

function offsetMeters(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { lat: lat + dLat, lng: lng + dLng };
}

function candidateIdentity({ name, sourceId } = {}) {
  if (name) return name;
  if (sourceId) return String(sourceId).slice(0, 8);
  return 'BUILDING';
}

export function createFocusFootprintPainter(getView) {
  let selectedId = null;
  let acquiredFeature = null;
  let acquiredPlate = { identity: 'BUILDING', heightMax: null };
  let hoverFeature = null;
  let hoverInside = false;
  let hoverFrom = null;
  let hoverMeta = {};
  let dwellFeature = null;
  let dwellMeta = {};
  let collectedFeatures = [];
  let sealing = false;
  let pulseTimer = 0;
  let plate = null;
  let pointer = null;

  function svgEl(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value != null) node.setAttribute(key, String(value));
    }
    return node;
  }

  function ensureSvg() {
    const view = getView();
    const host = view?.container;
    if (!host) return null;
    let svg = host.querySelector(`#${FOCUS_FOOTPRINT_OVERLAY_ID}`);
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = FOCUS_FOOTPRINT_OVERLAY_ID;
      svg.setAttribute('data-iqai-focus-overlay', 'true');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:26;overflow:visible';
      host.appendChild(svg);
    }
    const width = Math.max(1, host.clientWidth || view.width || 1);
    const height = Math.max(1, host.clientHeight || view.height || 1);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    if (!plate) {
      plate = document.createElement('div');
      plate.className = 'iqai-v2-id-plate';
      plate.hidden = true;
      plate.innerHTML = '<strong data-role="text"></strong><span data-role="height" hidden></span>';
      plate.style.cssText = 'position:absolute;z-index:27;pointer-events:none;transform:translate(8px,-10px)';
      host.appendChild(plate);
    }
    if (!pointer) {
      pointer = document.createElementNS(NS, 'svg');
      pointer.setAttribute('data-iqai-focus-pointer', 'true');
      pointer.setAttribute('viewBox', '0 0 28 28');
      pointer.style.cssText = 'position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;z-index:28;pointer-events:none;overflow:visible';
      pointer.innerHTML = `
        <path d="M4 10 L4 4 L10 4" fill="none" stroke="#f4f0ea" stroke-width="1.3" stroke-linecap="square"></path>
        <path d="M18 4 L24 4 L24 10" fill="none" stroke="#f4f0ea" stroke-width="1.3" stroke-linecap="square"></path>
        <path d="M24 18 L24 24 L18 24" fill="none" stroke="#f4f0ea" stroke-width="1.3" stroke-linecap="square"></path>
        <path d="M10 24 L4 24 L4 18" fill="none" stroke="#f4f0ea" stroke-width="1.3" stroke-linecap="square"></path>
        <circle cx="14" cy="14" r="1.35" fill="#f4f0ea"></circle>
      `;
      pointer.hidden = true;
      host.appendChild(pointer);
    }
    return svg;
  }

  function webMercator(longitude, latitude) {
    const lon = Number(longitude);
    const lat = Number(latitude);
    const x = (lon * 20037508.342789244) / 180;
    const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180))
      * (20037508.342789244) / 180;
    return { x, y };
  }

  function toScreen(lng, lat) {
    const view = getView();
    if (!view || typeof view.toScreen !== 'function') return null;
    const lon = Number(lng);
    const latN = Number(lat);
    if (!Number.isFinite(lon) || !Number.isFinite(latN)) return null;
    const attempts = [
      { type: 'point', longitude: lon, latitude: latN, spatialReference: { wkid: 4326 } },
      { type: 'point', ...webMercator(lon, latN), spatialReference: { wkid: 102100 } }
    ];
    for (const geometry of attempts) {
      try {
        const screen = view.toScreen(geometry);
        const x = Number(screen?.x);
        const y = Number(screen?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      } catch {
        // try next geometry form
      }
    }
    return null;
  }

  function pathFromFeature(feature) {
    const rings = featureOuterRings(feature);
    const parts = [];
    for (const ring of rings) {
      const pts = ring.map(([lng, lat]) => toScreen(lng, lat)).filter(Boolean);
      if (pts.length < 3) continue;
      parts.push(pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ') + ' Z');
    }
    return parts.join(' ');
  }

  function line(svg, a, b, width, color, extra = {}) {
    const p1 = toScreen(a[0] ?? a.lng, a[1] ?? a.lat);
    const p2 = toScreen(b[0] ?? b.lng, b[1] ?? b.lat);
    if (!p1 || !p2) return;
    svg.appendChild(svgEl('line', {
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      stroke: color, 'stroke-width': width, fill: 'none',
      'stroke-linecap': extra.cap || 'square',
      'stroke-linejoin': extra.join || 'miter',
      class: extra.className || '',
      'data-iqai-kind': extra.kind || ''
    }));
  }

  function polygon(svg, feature, width, color, className, kind) {
    const d = pathFromFeature(feature);
    if (!d) return;
    svg.appendChild(svgEl('path', {
      d, fill: 'none', stroke: color, 'stroke-width': width,
      'stroke-linejoin': 'round', class: className || '',
      'data-iqai-kind': kind || ''
    }));
  }

  function paintApproach(svg, feature, from) {
    if (!feature || !from) return 0;
    const edge = nearestEdgePoint(from.lat, from.lng, feature);
    if (!edge || edge.range < 0.4 || edge.range > 16) return 0;
    const bearingNorth = edge.lat - from.lat;
    const bearingEast = (edge.lng - from.lng) * Math.cos(edge.lat * Math.PI / 180);
    const mag = Math.hypot(bearingNorth, bearingEast) || 1e-9;
    const inward = offsetMeters(edge.lat, edge.lng, (bearingNorth / mag) * 12, (bearingEast / mag) * 12);
    const left = offsetMeters(edge.lat, edge.lng, -(bearingEast / mag) * 8, (bearingNorth / mag) * 8);
    const right = offsetMeters(edge.lat, edge.lng, (bearingEast / mag) * 8, -(bearingNorth / mag) * 8);
    line(svg, edge, inward, 2.45, GREEN, { className: 'iqai-v2-focus-tick', kind: 'approach' });
    line(svg, left, right, 2.45, GREEN, { className: 'iqai-v2-focus-tick', kind: 'approach' });
    return 2;
  }

  function paintContact(svg, feature, from, mode) {
    if (!feature || !from) return 0;
    const edges = nearestFacadeEdges(from.lat, from.lng, feature, 3);
    const color = mode === 'dwell' ? GREEN_BRIGHT : GREEN;
    const weight = mode === 'dwell' ? 5.6 : 5.2;
    for (const edge of edges) {
      line(svg, edge.a, edge.b, weight + 2.1, INK, { kind: 'contact-ink' });
      line(svg, edge.a, edge.b, weight, color, { className: 'iqai-v2-focus-contact', kind: 'contact' });
    }
    return edges.length;
  }

  function paintSeal(svg, feature) {
    const corners = dominantCorners(feature, 4);
    for (const { prev, cur, next } of corners) {
      const a = tickSegment(cur, prev, 0.000092);
      const b = tickSegment(cur, next, 0.000092);
      line(svg, a[0], a[1], 2.9, RED, { className: 'iqai-v2-focus-seal', kind: 'seal' });
      line(svg, b[0], b[1], 2.9, RED, { className: 'iqai-v2-focus-seal', kind: 'seal' });
    }
    return corners.length;
  }

  function placePlate(feature, { identity, heightMax, acquired }) {
    if (!plate || !feature) {
      if (plate) plate.hidden = true;
      return;
    }
    const centroid = featureCentroid(feature);
    const ring = featureOuterRings(feature)[0];
    const east = ring ? Math.max(...ring.map((p) => p[0])) : centroid?.lng;
    const screen = toScreen(east != null ? east + 0.00004 : centroid?.lng, centroid?.lat);
    if (!screen) {
      plate.hidden = true;
      return;
    }
    plate.hidden = false;
    plate.dataset.mode = acquired ? 'acquired' : 'candidate';
    plate.style.left = `${screen.x}px`;
    plate.style.top = `${screen.y}px`;
    plate.querySelector('[data-role="text"]').textContent = identity || 'BUILDING';
    const heightNode = plate.querySelector('[data-role="height"]');
    const show = Number.isFinite(Number(heightMax)) && Number(heightMax) > 1;
    heightNode.hidden = !show;
    heightNode.textContent = show ? `H ${Math.round(Number(heightMax))} m` : '';
  }

  function paint() {
    const svg = ensureSvg();
    if (!svg) return snapshot();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const excludeId = selectedId;
    for (const feature of collectedFeatures) {
      if (!feature || featureKey(feature) === excludeId) continue;
      polygon(svg, feature, 1.05, COLLECTED, 'iqai-v2-focus-collected', 'collected');
    }
    if (acquiredFeature) {
      polygon(svg, acquiredFeature, 6.8, INK, '', 'acquired-casing');
      polygon(svg, acquiredFeature, 4.5, RED, 'iqai-v2-focus-acquired', 'acquired');
      if (sealing) paintSeal(svg, acquiredFeature);
      placePlate(acquiredFeature, {
        identity: acquiredPlate.identity,
        heightMax: acquiredPlate.heightMax,
        acquired: true
      });
    }
    const candidate = dwellFeature || hoverFeature;
    const candidateKey = featureKey(candidate);
    if (candidate && candidateKey !== selectedId) {
      const inside = Boolean(dwellFeature) || hoverInside;
      if (!inside && hoverFrom) {
        paintApproach(svg, candidate, hoverFrom);
        if (!acquiredFeature) {
          if (plate) plate.hidden = true;
        }
      } else if (inside) {
        polygon(svg, candidate, 5.1, INK, '', 'candidate-casing');
        polygon(svg, candidate, dwellFeature ? 3.15 : 2.8, GREEN, 'iqai-v2-focus-candidate', 'candidate');
        paintContact(svg, candidate, hoverFrom, dwellFeature ? 'dwell' : 'hover');
        placePlate(candidate, {
          identity: candidateIdentity(dwellFeature ? dwellMeta : hoverMeta),
          heightMax: (dwellFeature ? dwellMeta.heightMax : hoverMeta.heightMax),
          acquired: false
        });
      }
    } else if (!acquiredFeature && plate) {
      plate.hidden = true;
    }
    return snapshot();
  }

  function snapshot() {
    const svg = getView()?.container?.querySelector?.(`#${FOCUS_FOOTPRINT_OVERLAY_ID}`);
    const visible = [...(svg?.querySelectorAll?.('[data-iqai-kind]') || [])].map((node) => ({
      role: node.getAttribute('data-iqai-kind'),
      family: /acquired|seal/.test(node.getAttribute('data-iqai-kind') || '') ? 'red'
        : /collected/.test(node.getAttribute('data-iqai-kind') || '') ? 'quiet' : 'green',
      className: node.getAttribute('class') || ''
    }));
    const green = visible.filter((row) => row.role === 'candidate').length ? 1 : 0;
    const red = visible.filter((row) => row.role === 'acquired').length ? 1 : 0;
    const contact = visible.filter((row) => row.role === 'contact').length;
    const seal = visible.filter((row) => row.role === 'seal').length;
    return {
      green,
      red,
      contact,
      seal,
      candidateGreen: green === 1,
      acquiredRed: red === 1,
      brightRed: red === 1,
      candidateIdentity: plate?.hidden ? null : plate?.querySelector?.('[data-role="text"]')?.textContent || null,
      plateText: plate?.hidden ? '' : `${plate?.querySelector?.('[data-role="text"]')?.textContent || ''} ${plate?.querySelector?.('[data-role="height"]')?.textContent || ''}`.trim(),
      plateCount: plate && !plate.hidden ? 1 : 0,
      extraLabels: 0,
      visible
    };
  }

  return {
    setHover(feature, {
      inside = true,
      name = null,
      sourceId = null,
      from = null,
      heightMax = null
    } = {}) {
      hoverFeature = feature || null;
      hoverInside = inside;
      hoverFrom = from;
      hoverMeta = { name, sourceId, heightMax };
      if (!feature) dwellFeature = null;
      paint();
      if (!inside && feature && from) {
        const edge = nearestEdgePoint(from.lat, from.lng, feature);
        return edge;
      }
      return feature && inside ? { range: 0 } : null;
    },
    setDwell(feature, {
      name = null,
      sourceId = null,
      heightMax = null,
      from = null
    } = {}) {
      if (!feature || featureKey(feature) === selectedId) {
        dwellFeature = null;
        paint();
        return;
      }
      dwellFeature = feature;
      dwellMeta = { name, sourceId, heightMax };
      hoverFrom = from || hoverFrom;
      hoverInside = true;
      paint();
    },
    acquire(feature, { name = null, heightMax = null } = {}) {
      selectedId = featureKey(feature);
      acquiredFeature = feature;
      acquiredPlate = { identity: candidateIdentity({ name }), heightMax };
      hoverFeature = null;
      dwellFeature = null;
      sealing = true;
      paint();
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => {
        sealing = false;
        paint();
      }, 420);
      return selectedId;
    },
    setCollected(features = [], { excludeId = null } = {}) {
      collectedFeatures = (features || []).filter((feature) => feature && featureKey(feature) !== excludeId);
      paint();
    },
    clear() {
      selectedId = null;
      acquiredFeature = null;
      hoverFeature = null;
      dwellFeature = null;
      sealing = false;
      clearTimeout(pulseTimer);
      paint();
    },
    selectedId() {
      return selectedId;
    },
    sensing: snapshot,
    paint,
    setPointer(x, y, { hidden = false, state = 'idle' } = {}) {
      ensureSvg();
      if (!pointer) return;
      pointer.hidden = hidden || !Number.isFinite(x);
      if (hidden) return;
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
      pointer.dataset.state = state;
      const stroke = state === 'hover' || state === 'dwell' ? GREEN : '#f4f0ea';
      pointer.querySelectorAll('path, circle').forEach((node) => {
        if (node.tagName === 'circle') node.setAttribute('fill', stroke);
        else node.setAttribute('stroke', stroke);
      });
    },
    detach() {
      clearTimeout(pulseTimer);
      const view = getView();
      view?.container?.querySelector?.(`#${FOCUS_FOOTPRINT_OVERLAY_ID}`)?.remove?.();
      plate?.remove?.();
      pointer?.remove?.();
      plate = null;
      pointer = null;
    }
  };
}
