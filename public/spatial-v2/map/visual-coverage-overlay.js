/**
 * Map overlay for selected street-360 provider capture positions.
 * Distinct from planned CameraRef graphics. Lines are VIEW DIRECTION, not FOV / LOS.
 */

import { getMapView } from './map-foundation.js';
import {
  getLastVisualCoverage,
  subscribeVisualCoverage
} from '../camera/engine/visual-coverage.js';
import { getAuthoredCamerasSnapshot, subscribeAuthoredCameras } from './authored-cameras.js';
import { geodesicMeters } from '../camera/engine/geodesy.js';
import {
  CAMERA_OPERATOR_MODE,
  getCameraOperatorMode,
  subscribeCameraOperatorMode
} from '../camera/operator-mode.js';

export const VISUAL_COVERAGE_OVERLAY_ID = 'iqai-v2-visual-coverage-overlay';
export const REPRESENTATION_NEAR_PLANNED_MAX_M = 80;

const NS = 'http://www.w3.org/2000/svg';
const INK = '#8a97a3';
const KEY = '#0c0c0e';
const TARGET = '#d7dde3';

function svgEl(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value != null) node.setAttribute(key, String(value));
  }
  return node;
}

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
      /* try next CRS */
    }
  }
  return null;
}

function providerShort(provider) {
  if (provider === 'GOOGLE_STREET360') return 'GOOGLE 360';
  if (provider === 'MAPILLARY') return 'MAPILLARY 360';
  return '360';
}

function nearestViewpoint(camera, viewpoints) {
  let best = null;
  let bestMeters = Infinity;
  for (const viewpoint of viewpoints) {
    const capture = viewpoint.captureCoordinate;
    if (!capture) continue;
    const meters = geodesicMeters(camera, capture);
    if (!Number.isFinite(meters) || meters >= bestMeters) continue;
    best = viewpoint;
    bestMeters = meters;
  }
  return best && bestMeters <= REPRESENTATION_NEAR_PLANNED_MAX_M
    ? { viewpoint: best, offsetM: bestMeters }
    : null;
}

export function bindVisualCoverageOverlay() {
  let viewHandles = [];
  let watchedView = null;

  function ensureSvg(view) {
    const host = view?.container;
    if (!host) return null;
    let svg = host.querySelector(`#${VISUAL_COVERAGE_OVERLAY_ID}`);
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = VISUAL_COVERAGE_OVERLAY_ID;
      svg.setAttribute('data-iqai-visual-coverage-overlay', 'true');
      svg.setAttribute('aria-label', 'Street 360 viewpoint positions');
      svg.style.cssText = [
        'position:absolute',
        'inset:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:25',
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

  function paint() {
    const view = getMapView();
    const svg = ensureSvg(view);
    if (!svg) return null;
    svg.replaceChildren();
    const mode = getCameraOperatorMode();
    const coverage = getLastVisualCoverage();
    const target = coverage?.target;
    const viewpoints = coverage?.ok ? (coverage.selected || []) : [];
    const cameras = getAuthoredCamerasSnapshot().cameras || [];
    const planCameras = mode !== CAMERA_OPERATOR_MODE.LOOK_AROUND;
    const targetScreen = target ? toScreen(view, target.longitude, target.latitude) : null;
    if (targetScreen) {
      const mark = svgEl('circle', {
        cx: targetScreen.x,
        cy: targetScreen.y,
        r: 4,
        fill: 'none',
        stroke: TARGET,
        'stroke-width': 1.4,
        'data-iqai-visual-target': 'true'
      });
      svg.appendChild(mark);
    }
    if (planCameras) {
      for (const camera of cameras) {
        const near = nearestViewpoint(camera, viewpoints);
        if (!near) continue;
        const cameraScreen = toScreen(view, camera.longitude, camera.latitude);
        const capture = near.viewpoint.captureCoordinate;
        const captureScreen = capture ? toScreen(view, capture.longitude, capture.latitude) : null;
        if (!cameraScreen || !captureScreen) continue;
        const connector = svgEl('line', {
          x1: cameraScreen.x,
          y1: cameraScreen.y,
          x2: captureScreen.x,
          y2: captureScreen.y,
          stroke: INK,
          'stroke-width': 1,
          'stroke-dasharray': '3 5',
          opacity: '0.7',
          'data-iqai-representation-near': camera.cameraId,
          'data-iqai-representation-offset': String(Math.round(near.offsetM))
        });
        svg.appendChild(connector);
        const midX = (cameraScreen.x + captureScreen.x) / 2;
        const midY = (cameraScreen.y + captureScreen.y) / 2;
        const offsetLabel = svgEl('text', {
          x: midX + 6,
          y: midY + 4,
          fill: INK,
          stroke: KEY,
          'stroke-width': 2.6,
          'paint-order': 'stroke',
          'font-size': '8',
          'font-family': 'inherit',
          'data-iqai-representation-offset-label': camera.cameraId
        });
        offsetLabel.textContent = `${providerShort(near.viewpoint.provider)} · ${Math.round(near.offsetM)} m FROM PLANNED POSITION`;
        svg.appendChild(offsetLabel);
      }
    }
    for (const viewpoint of viewpoints) {
      const capture = viewpoint.captureCoordinate;
      const origin = capture ? toScreen(view, capture.longitude, capture.latitude) : null;
      if (!origin) continue;
      const group = svgEl('g', {
        'data-iqai-visual-viewpoint': viewpoint.viewpointId || viewpoint.providerId,
        'data-iqai-visual-provider': viewpoint.provider || '',
        'data-iqai-360-symbol': viewpoint.viewpointId || viewpoint.providerId
      });
      if (targetScreen) {
        const dx = targetScreen.x - origin.x;
        const dy = targetScreen.y - origin.y;
        const x2 = origin.x + dx * 0.42;
        const y2 = origin.y + dy * 0.42;
        const ray = svgEl('line', {
          x1: origin.x,
          y1: origin.y,
          x2,
          y2,
          stroke: INK,
          'stroke-width': 1.1,
          'stroke-dasharray': '4 3',
          'marker-end': 'none',
          'data-iqai-view-direction': viewpoint.viewpointId || '',
          'data-iqai-view-direction-kind': 'VIRTUAL'
        });
        group.appendChild(ray);
        const label = svgEl('text', {
          x: origin.x + dx * 0.22 + 6,
          y: origin.y + dy * 0.22 - 4,
          fill: INK,
          stroke: KEY,
          'stroke-width': 2.4,
          'paint-order': 'stroke',
          'font-size': '8',
          'font-family': 'inherit',
          'data-iqai-view-direction-label': 'true'
        });
        label.textContent = 'VIEW DIRECTION';
        group.appendChild(label);
      }
      const ring = svgEl('circle', {
        cx: origin.x,
        cy: origin.y,
        r: 9,
        fill: 'rgba(12,12,14,0.55)',
        stroke: INK,
        'stroke-width': 1.3,
        'data-iqai-visual-viewpoint-icon': viewpoint.provider || '',
        'data-iqai-360-ring': 'true'
      });
      group.appendChild(ring);
      const text = svgEl('text', {
        x: origin.x,
        y: origin.y + 3,
        fill: INK,
        'font-size': '7',
        'font-weight': 700,
        'text-anchor': 'middle',
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'letter-spacing': '0.04em',
        'data-iqai-360-text': 'true'
      });
      text.textContent = '360';
      group.appendChild(text);
      svg.appendChild(group);
    }
    return svg;
  }

  function attachView(view) {
    if (watchedView === view) {
      paint();
      return;
    }
    for (const handle of viewHandles) {
      try { handle.remove?.(); } catch { /* ignore */ }
    }
    viewHandles = [];
    watchedView = view || null;
    if (view && typeof view.watch === 'function') {
      viewHandles.push(view.watch('extent', paint));
      viewHandles.push(view.watch('size', paint));
      viewHandles.push(view.watch('stationary', paint));
    }
    paint();
  }

  subscribeVisualCoverage(() => paint());
  subscribeAuthoredCameras(() => paint());
  subscribeCameraOperatorMode(() => paint());

  return Object.freeze({
    paint,
    attachView,
    overlayId: VISUAL_COVERAGE_OVERLAY_ID
  });
}
