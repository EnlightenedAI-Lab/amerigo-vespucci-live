/**
 * WorldView orientation overlay on the long-lived MapView.
 *
 * WORLDVIEW_POSITION is not FocusRef, not ObjectRef, not a virtual sensor.
 * WORLDVIEW_LOOK is Street POV heading, not north, not travel.
 * WORLDVIEW_TRAVERSAL is already-travelled panorama coordinates only.
 * WORLDVIEW_NORTH is true/grid north on the 2D map, not magnetic north.
 * Coordinates come from Street panorama or shared WorldView navigation.
 * Never from invented screen-space geography.
 *
 * ArcGIS 5.1 GraphicsLayer holds graphics in the correct MapView SR, but the
 * 2D LayerView does not composite them onto the headed canvas. This overlay
 * projects the same geographic points through view.toScreen into one SVG
 * attached to the live MapView container. Compass is a separate MAP instrument.
 */

import { getMapView } from './map-foundation.js';
import {
  getWorldviewNavigation,
  subscribeWorldviewNavigation
} from './worldview-navigation.js';
import {
  WORLDVIEW_GEOMETRY_KIND,
  clearWorldviewTraversal,
  getWorldviewTraversal,
  subscribeWorldviewTraversal
} from './worldview-traversal.js';
import {
  getGoogleStreetViewSnapshot,
  subscribeGoogleStreetViewNavigation
} from './google-street-view.js';
import {
  getGoogleMapsJs3dSnapshot,
  subscribeGoogleMapsJs3dCamera
} from './google-maps-js-3d.js';

export const WORLDVIEW_BEACON_LAYER_ID = 'iqai-v2-worldview-overlay';
export const WORLDVIEW_TRACE_LAYER_ID = 'iqai-v2-worldview-overlay';
export const WORLDVIEW_OVERLAY_LAYER_ID = 'iqai-v2-worldview-overlay';
export const WORLDVIEW_NORTH_INSTRUMENT_ID = 'iqai-v2-north-instrument';
export const WORLDVIEW_CAMERA_INSTRUMENT_ID = 'iqai-v2-camera-instrument';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#f4f0ea';
const KEY = '#0c0c0e';

function wrapHeading(value) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return null;
  return ((heading % 360) + 360) % 360;
}

function snapNorth(value) {
  const heading = wrapHeading(value);
  if (heading == null) return null;
  return heading < 0.6 || heading > 359.4 ? 0 : heading;
}

function formatDeg(value) {
  const heading = wrapHeading(value);
  if (heading == null) return '—';
  return `${String(Math.round(heading === 360 ? 0 : heading)).padStart(3, '0')}°`;
}

function cardinalFromHeading(value) {
  const heading = wrapHeading(value);
  if (heading == null) return '—';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
}

function pitchFromTilt(tilt) {
  const value = Number(tilt);
  if (!Number.isFinite(value)) return null;
  return value - 90;
}

function destinationAlongHeading(origin, headingDeg, meters) {
  const lat1 = Number(origin?.latitude) * Math.PI / 180;
  const lon1 = Number(origin?.longitude) * Math.PI / 180;
  const bearing = Number(headingDeg) * Math.PI / 180;
  const angular = Number(meters) / 6371000;
  if (![lat1, lon1, bearing, angular].every(Number.isFinite)) return null;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180
  };
}

export function resolveBeaconPose() {
  const street = getGoogleStreetViewSnapshot();
  const longitude = Number(street?.panoramaPosition?.longitude);
  const latitude = Number(street?.panoramaPosition?.latitude);
  if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
    return {
      longitude,
      latitude,
      heading: wrapHeading(street.pov?.heading),
      sourceView: 'STREET 360',
      kind: WORLDVIEW_GEOMETRY_KIND.POSITION
    };
  }
  const nav = getWorldviewNavigation();
  if (!nav) return null;
  return {
    longitude: nav.longitude,
    latitude: nav.latitude,
    heading: wrapHeading(nav.heading),
    sourceView: nav.sourceView,
    kind: WORLDVIEW_GEOMETRY_KIND.POSITION
  };
}

export function bindWorldviewPositionOverlay(root = null) {
  let lastBeacon = null;
  let lastLook = null;
  let lastNorth = null;
  let lastCamera = null;
  let viewHandles = [];
  let watchedView = null;

  function webMercator(longitude, latitude) {
    const lon = Number(longitude);
    const lat = Number(latitude);
    const x = (lon * 20037508.342789244) / 180;
    const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180))
      * (20037508.342789244) / 180;
    return { x, y };
  }

  function toScreen(view, longitude, latitude) {
    if (!view || typeof view.toScreen !== 'function') return null;
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const attempts = [
      { type: 'point', longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } },
      { type: 'point', ...webMercator(lon, lat), spatialReference: { wkid: 102100 } }
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

  function svgEl(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value != null) node.setAttribute(key, String(value));
    }
    return node;
  }

  function ensureSvg(view) {
    const host = view?.container;
    if (!host || typeof document === 'undefined') return null;
    let svg = host.querySelector(`#${WORLDVIEW_OVERLAY_LAYER_ID}`);
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = WORLDVIEW_OVERLAY_LAYER_ID;
      svg.setAttribute('data-iqai-worldview-overlay', 'true');
      svg.style.cssText = [
        'position:absolute',
        'inset:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:24',
        'overflow:visible'
      ].join(';');
      host.appendChild(svg);
    }
    const width = Math.max(1, host.clientWidth || view.width || 1);
    const height = Math.max(1, host.clientHeight || view.height || 1);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return svg;
  }

  function resetMapNorth() {
    const view = getMapView();
    if (!view) return false;
    view.rotation = 0;
    if (typeof view.goTo === 'function') {
      void view.goTo({ rotation: 0 }, { animate: true, duration: 280 });
    }
    paintCompass(view);
    return true;
  }

  function ensureCompass(view) {
    const host = root?.querySelector('[data-iqai-pane="MAP"] .iqai-v2-pane__body')
      || view?.container?.closest?.('.iqai-v2-map-host')
      || view?.container;
    if (!host || typeof document === 'undefined') return null;
    let instrument = document.querySelector(`#${WORLDVIEW_NORTH_INSTRUMENT_ID}`);
    if (instrument) return instrument;
    instrument = document.createElement('button');
    instrument.type = 'button';
    instrument.id = WORLDVIEW_NORTH_INSTRUMENT_ID;
    instrument.className = 'iqai-v2-north';
    instrument.setAttribute('data-iqai-north-instrument', 'true');
    instrument.setAttribute('data-iqai-kind', WORLDVIEW_GEOMETRY_KIND.NORTH);
    instrument.title = 'True / grid north. Click to return map north-up.';
    instrument.setAttribute('aria-label', 'True north. Reset map to north-up');
    instrument.innerHTML = `
      <span class="iqai-v2-north__frame" aria-hidden="true">
        <svg class="iqai-v2-north__rose" viewBox="0 0 72 72">
          <path d="M14 24 L14 14 L24 14" fill="none" stroke="${INK}" stroke-width="1.35" stroke-linecap="square"></path>
          <path d="M48 14 L58 14 L58 24" fill="none" stroke="${INK}" stroke-width="1.35" stroke-linecap="square"></path>
          <path d="M58 48 L58 58 L48 58" fill="none" stroke="${INK}" stroke-width="1.35" stroke-linecap="square"></path>
          <path d="M24 58 L14 58 L14 48" fill="none" stroke="${INK}" stroke-width="1.35" stroke-linecap="square"></path>
          <g data-iqai-north-card>
            <line x1="36" y1="18" x2="36" y2="24" stroke="${INK}" stroke-width="1.4"></line>
            <text x="36" y="17.2" text-anchor="middle">N</text>
            <text x="55.4" y="39.2" text-anchor="middle">E</text>
            <text x="36" y="58.6" text-anchor="middle">S</text>
            <text x="16.6" y="39.2" text-anchor="middle">W</text>
          </g>
          <circle cx="36" cy="36" r="1.7" fill="${INK}" stroke="${KEY}" stroke-width="0.9"></circle>
        </svg>
      </span>
      <span class="iqai-v2-north__cardinal" data-iqai-north-cardinal>N</span>
      <span class="iqai-v2-north__deg" data-iqai-north-degrees>000°</span>
      <span class="iqai-v2-north__truth">TRUE / GRID</span>
    `;
    instrument.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetMapNorth();
    });
    host.appendChild(instrument);
    return instrument;
  }

  function paintCompass(view) {
    const instrument = ensureCompass(view);
    if (!instrument) {
      lastNorth = null;
      return null;
    }
    const rotation = snapNorth(view?.rotation) ?? 0;
    const card = instrument.querySelector('[data-iqai-north-card]');
    if (card) card.setAttribute('transform', `rotate(${-rotation} 36 36)`);
    const cardinal = instrument.querySelector('[data-iqai-north-cardinal]');
    const degrees = instrument.querySelector('[data-iqai-north-degrees]');
    if (cardinal) cardinal.textContent = 'N';
    if (degrees) {
      degrees.textContent = formatDeg(rotation);
      degrees.hidden = rotation === 0;
    }
    instrument.dataset.iqaiNorthUp = rotation === 0 ? 'true' : 'false';
    lastNorth = {
      kind: WORLDVIEW_GEOMETRY_KIND.NORTH,
      rotation,
      northUp: rotation === 0
    };
    return lastNorth;
  }

  function ensureCamera() {
    const host = root?.querySelector('[data-iqai-pane="3D VISUAL"] .iqai-v2-pane__body');
    if (!host || typeof document === 'undefined') return null;
    let instrument = document.querySelector(`#${WORLDVIEW_CAMERA_INSTRUMENT_ID}`);
    if (instrument) return instrument;
    instrument = document.createElement('div');
    instrument.id = WORLDVIEW_CAMERA_INSTRUMENT_ID;
    instrument.className = 'iqai-v2-camera';
    instrument.setAttribute('data-iqai-camera-instrument', 'true');
    instrument.setAttribute('data-iqai-kind', WORLDVIEW_GEOMETRY_KIND.NORTH);
    instrument.innerHTML = `
      <span class="iqai-v2-camera__frame" aria-hidden="true">
        <svg class="iqai-v2-camera__horizon" viewBox="0 0 72 28">
          <path d="M14 8 L14 4 L24 4" fill="none" stroke="${INK}" stroke-width="1.25" stroke-linecap="square"></path>
          <path d="M48 4 L58 4 L58 8" fill="none" stroke="${INK}" stroke-width="1.25" stroke-linecap="square"></path>
          <path d="M58 20 L58 24 L48 24" fill="none" stroke="${INK}" stroke-width="1.25" stroke-linecap="square"></path>
          <path d="M24 24 L14 24 L14 20" fill="none" stroke="${INK}" stroke-width="1.25" stroke-linecap="square"></path>
          <line data-iqai-camera-horizon x1="20" y1="14" x2="52" y2="14" stroke="${INK}" stroke-width="1.2"></line>
          <circle cx="36" cy="14" r="1.45" fill="${INK}" stroke="${KEY}" stroke-width="0.8"></circle>
        </svg>
      </span>
      <span class="iqai-v2-camera__heading" data-iqai-camera-heading>000°</span>
      <span class="iqai-v2-camera__cardinal" data-iqai-camera-cardinal>N</span>
      <span class="iqai-v2-camera__pitch" data-iqai-camera-pitch>P —</span>
      <span class="iqai-v2-camera__truth">CAMERA</span>
    `;
    host.appendChild(instrument);
    return instrument;
  }

  function paintCamera(camera) {
    const instrument = ensureCamera();
    const live = getGoogleMapsJs3dSnapshot();
    const pose = camera || live?.camera || null;
    const open = live?.open === true && pose;
    if (!instrument) {
      lastCamera = null;
      return null;
    }
    instrument.hidden = !open;
    if (!open) {
      lastCamera = null;
      return null;
    }
    const heading = wrapHeading(pose.heading) ?? 0;
    const pitch = pitchFromTilt(pose.tilt);
    const horizon = instrument.querySelector('[data-iqai-camera-horizon]');
    if (horizon && pitch != null) {
      horizon.setAttribute('transform', `rotate(${pitch} 36 14)`);
    }
    const headingNode = instrument.querySelector('[data-iqai-camera-heading]');
    const cardinalNode = instrument.querySelector('[data-iqai-camera-cardinal]');
    const pitchNode = instrument.querySelector('[data-iqai-camera-pitch]');
    if (headingNode) headingNode.textContent = formatDeg(heading);
    if (cardinalNode) cardinalNode.textContent = cardinalFromHeading(heading);
    if (pitchNode) {
      pitchNode.textContent = pitch == null
        ? 'P —'
        : `P ${pitch > 0 ? '+' : ''}${Math.round(pitch)}°`;
    }
    lastCamera = {
      heading,
      cardinal: cardinalFromHeading(heading),
      pitch,
      tilt: Number(pose.tilt)
    };
    return lastCamera;
  }

  function watchView(view) {
    if (!view || view === watchedView) return;
    for (const handle of viewHandles) {
      try { handle.remove?.(); } catch { /* already gone */ }
    }
    viewHandles = [];
    watchedView = view;
    const refreshSoon = () => { void paint(); };
    if (typeof view.watch === 'function') {
      viewHandles.push(view.watch('stationary', (stationary) => {
        if (stationary) refreshSoon();
      }));
      viewHandles.push(view.watch('extent', refreshSoon));
      viewHandles.push(view.watch('rotation', refreshSoon));
      viewHandles.push(view.watch('scale', refreshSoon));
      viewHandles.push(view.watch('size', refreshSoon));
    }
    if (typeof view.on === 'function') {
      viewHandles.push(view.on('resize', refreshSoon));
    }
  }

  function lookLengthMeters(view) {
    const resolution = Number(view?.resolution);
    if (Number.isFinite(resolution) && resolution > 0) {
      return Math.max(32, Math.min(110, resolution * 46));
    }
    return 42;
  }

  function paintLookVector(svg, view, pose) {
    lastLook = null;
    const heading = wrapHeading(pose?.heading);
    if (!pose || pose.sourceView !== 'STREET 360' || heading == null) return false;
    const origin = toScreen(view, pose.longitude, pose.latitude);
    const dest = destinationAlongHeading(pose, heading, lookLengthMeters(view));
    const tip = dest ? toScreen(view, dest.longitude, dest.latitude) : null;
    if (!origin || !tip) return false;
    const dx = tip.x - origin.x;
    const dy = tip.y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return false;
    const ux = dx / len;
    const uy = dy / len;
    const group = svgEl('g', { 'data-iqai-kind': WORLDVIEW_GEOMETRY_KIND.LOOK });
    const line = (width, color) => svgEl('line', {
      x1: origin.x,
      y1: origin.y,
      x2: tip.x - ux * 6,
      y2: tip.y - uy * 6,
      fill: 'none',
      stroke: color,
      'stroke-width': width,
      'stroke-linecap': 'butt'
    });
    group.appendChild(line(3.4, KEY));
    group.appendChild(line(1.35, INK));
    const leftX = tip.x - ux * 8.5 - uy * 3.6;
    const leftY = tip.y - uy * 8.5 + ux * 3.6;
    const rightX = tip.x - ux * 8.5 + uy * 3.6;
    const rightY = tip.y - uy * 8.5 - ux * 3.6;
    group.appendChild(svgEl('polygon', {
      points: `${tip.x},${tip.y} ${leftX},${leftY} ${rightX},${rightY}`,
      fill: INK,
      stroke: KEY,
      'stroke-width': 1.15
    }));
    svg.appendChild(group);
    lastLook = {
      heading,
      meters: lookLengthMeters(view),
      origin,
      tip,
      kind: WORLDVIEW_GEOMETRY_KIND.LOOK
    };
    return true;
  }

  function paintBeacon(svg, view, pose) {
    if (!pose || !Number.isFinite(pose.longitude) || !Number.isFinite(pose.latitude)) {
      lastBeacon = null;
      return null;
    }
    const screen = toScreen(view, pose.longitude, pose.latitude);
    if (!screen) {
      lastBeacon = {
        longitude: pose.longitude,
        latitude: pose.latitude,
        heading: wrapHeading(pose.heading),
        sourceView: pose.sourceView || null,
        kind: WORLDVIEW_GEOMETRY_KIND.POSITION
      };
      return null;
    }
    const group = svgEl('g', {
      'data-iqai-kind': WORLDVIEW_GEOMETRY_KIND.POSITION,
      transform: `translate(${screen.x} ${screen.y})`
    });
    const arm = 5.6;
    const gap = 2.4;
    group.appendChild(svgEl('path', {
      d: `M ${-arm} ${-gap} L ${-arm} ${-arm} L ${-gap} ${-arm}`,
      fill: 'none',
      stroke: KEY,
      'stroke-width': 2.4,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${-arm} ${-gap} L ${-arm} ${-arm} L ${-gap} ${-arm}`,
      fill: 'none',
      stroke: INK,
      'stroke-width': 1.15,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${gap} ${-arm} L ${arm} ${-arm} L ${arm} ${-gap}`,
      fill: 'none',
      stroke: KEY,
      'stroke-width': 2.4,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${gap} ${-arm} L ${arm} ${-arm} L ${arm} ${-gap}`,
      fill: 'none',
      stroke: INK,
      'stroke-width': 1.15,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${arm} ${gap} L ${arm} ${arm} L ${gap} ${arm}`,
      fill: 'none',
      stroke: KEY,
      'stroke-width': 2.4,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${arm} ${gap} L ${arm} ${arm} L ${gap} ${arm}`,
      fill: 'none',
      stroke: INK,
      'stroke-width': 1.15,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${-gap} ${arm} L ${-arm} ${arm} L ${-arm} ${gap}`,
      fill: 'none',
      stroke: KEY,
      'stroke-width': 2.4,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${-gap} ${arm} L ${-arm} ${arm} L ${-arm} ${gap}`,
      fill: 'none',
      stroke: INK,
      'stroke-width': 1.15,
      'stroke-linecap': 'square'
    }));
    group.appendChild(svgEl('circle', {
      r: 2.05,
      fill: KEY,
      stroke: INK,
      'stroke-width': 1.15
    }));
    group.appendChild(svgEl('circle', {
      r: 0.85,
      fill: INK
    }));
    svg.appendChild(group);
    lastBeacon = {
      longitude: pose.longitude,
      latitude: pose.latitude,
      heading: wrapHeading(pose.heading),
      sourceView: pose.sourceView || null,
      kind: WORLDVIEW_GEOMETRY_KIND.POSITION,
      screen
    };
    return screen;
  }

  function segmentLength(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function pointAlongPath(screens, distance) {
    let remaining = distance;
    for (let i = 1; i < screens.length; i += 1) {
      const a = screens[i - 1];
      const b = screens[i];
      const len = segmentLength(a, b);
      if (len <= 0.01) continue;
      if (remaining <= len) {
        const t = remaining / len;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: Math.atan2(b.y - a.y, b.x - a.x)
        };
      }
      remaining -= len;
    }
    const last = screens[screens.length - 1];
    const prev = screens[screens.length - 2];
    return {
      x: last.x,
      y: last.y,
      angle: Math.atan2(last.y - prev.y, last.x - prev.x)
    };
  }

  function paintChevron(svg, point) {
    const ux = Math.cos(point.angle);
    const uy = Math.sin(point.angle);
    const tipX = point.x + ux * 4.6;
    const tipY = point.y + uy * 4.6;
    const leftX = point.x - ux * 3.1 - uy * 3.6;
    const leftY = point.y - uy * 3.1 + ux * 3.6;
    const rightX = point.x - ux * 3.1 + uy * 3.6;
    const rightY = point.y - uy * 3.1 - ux * 3.6;
    svg.appendChild(svgEl('polygon', {
      points: `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`,
      fill: INK,
      stroke: KEY,
      'stroke-width': 1.05,
      'data-iqai-kind': WORLDVIEW_GEOMETRY_KIND.TRAVERSAL,
      'data-iqai-trace-dir': 'true'
    }));
  }

  function paintTrace(svg, view, session) {
    const points = session?.points || [];
    if (points.length < 2) return false;
    const screens = points
      .map((point) => toScreen(view, point.longitude, point.latitude))
      .filter(Boolean);
    if (screens.length < 2) return false;
    const d = screens.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
    svg.appendChild(svgEl('path', {
      d,
      fill: 'none',
      stroke: KEY,
      'stroke-width': 3.6,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'data-iqai-kind': WORLDVIEW_GEOMETRY_KIND.TRAVERSAL
    }));
    svg.appendChild(svgEl('path', {
      d,
      fill: 'none',
      stroke: INK,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'data-iqai-kind': WORLDVIEW_GEOMETRY_KIND.TRAVERSAL
    }));
    let total = 0;
    for (let i = 1; i < screens.length; i += 1) total += segmentLength(screens[i - 1], screens[i]);
    if (total >= 14) {
      const count = total < 48 ? 1 : 2;
      const start = total * (count === 1 ? 0.58 : 0.34);
      const step = count === 1 ? total : total * 0.36;
      for (let i = 0; i < count; i += 1) {
        const dist = Math.min(total - 8, start + (i * step));
        if (dist > 8) paintChevron(svg, pointAlongPath(screens, dist));
      }
    }
    return true;
  }

  function paint() {
    const view = getMapView();
    if (!view) return snapshot();
    watchView(view);
    paintCompass(view);
    paintCamera();
    const svg = ensureSvg(view);
    if (!svg) return snapshot();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const pose = resolveBeaconPose();
    paintTrace(svg, view, getWorldviewTraversal());
    paintLookVector(svg, view, pose);
    paintBeacon(svg, view, pose);
    return snapshot();
  }

  function snapshot() {
    const pose = resolveBeaconPose();
    const traversal = getWorldviewTraversal();
    const view = getMapView();
    const svg = view?.container?.querySelector?.(`#${WORLDVIEW_OVERLAY_LAYER_ID}`) || null;
    const compass = document.querySelector('#iqai-v2-north-instrument');
    return {
      beacon: lastBeacon || pose,
      pose,
      look: lastLook,
      north: lastNorth,
      camera: lastCamera,
      traversal,
      beaconLayerId: WORLDVIEW_BEACON_LAYER_ID,
      traceLayerId: WORLDVIEW_TRACE_LAYER_ID,
      kinds: {
        position: WORLDVIEW_GEOMETRY_KIND.POSITION,
        look: WORLDVIEW_GEOMETRY_KIND.LOOK,
        traversal: WORLDVIEW_GEOMETRY_KIND.TRAVERSAL,
        north: WORLDVIEW_GEOMETRY_KIND.NORTH
      },
      render: {
        path: 'svg',
        svgPresent: Boolean(svg),
        compassPresent: Boolean(compass),
        childCount: svg?.childNodes?.length ?? 0,
        lookPresent: Boolean(lastLook),
        cameraPresent: Boolean(lastCamera),
        camera: lastCamera,
        screen: lastBeacon?.screen || null,
        northUp: lastNorth?.northUp ?? null,
        rotation: lastNorth?.rotation ?? null
      }
    };
  }

  function paintClearButton() {
    const button = root?.querySelector('[data-iqai-clear-trace]');
    if (!button) return;
    const traversal = getWorldviewTraversal();
    const hasPath = (traversal?.points?.length || 0) > 0;
    button.hidden = false;
    button.disabled = !hasPath;
  }

  const refresh = () => {
    const next = paint();
    paintClearButton();
    return next;
  };

  const unsubNav = subscribeWorldviewNavigation(refresh);
  const unsubTrace = subscribeWorldviewTraversal(refresh);
  const unsubStreet = subscribeGoogleStreetViewNavigation(refresh);
  const unsubCamera = subscribeGoogleMapsJs3dCamera(() => {
    paintCamera();
  });

  root?.querySelector('[data-iqai-clear-trace]')?.addEventListener('click', (event) => {
    event.preventDefault();
    clearWorldviewTraversal();
    refresh();
  });

  paintClearButton();

  return {
    refresh: async () => refresh(),
    snapshot,
    resetNorth: resetMapNorth,
    clearTrace: () => {
      const next = clearWorldviewTraversal();
      refresh();
      return next;
    },
    detach: () => {
      unsubNav();
      unsubTrace();
      unsubStreet();
      unsubCamera();
      for (const handle of viewHandles) {
        try { handle.remove?.(); } catch { /* already gone */ }
      }
      viewHandles = [];
      const view = getMapView();
      view?.container?.querySelector?.(`#${WORLDVIEW_OVERLAY_LAYER_ID}`)?.remove?.();
      const host = view?.container?.closest?.('.iqai-v2-map-host') || view?.container;
      host?.querySelector?.(`#${WORLDVIEW_NORTH_INSTRUMENT_ID}`)?.remove?.();
      document.querySelector(`#${WORLDVIEW_NORTH_INSTRUMENT_ID}`)?.remove?.();
      document.querySelector(`#${WORLDVIEW_CAMERA_INSTRUMENT_ID}`)?.remove?.();
    }
  };
}
