/**
 * PLACE CAMERA SVG overlay on the long-lived MapView.
 * GraphicsLayer counts are not pixels (F-37). Planned CameraRef position + HFOV wedge.
 * This is orientation / FOV direction, not LOS, not Building_Montreal, not Google 3D camera.
 * Not Street360. Not a provider capture.
 */

import { getMapView } from './map-foundation.js';
import {
  frustumRangeMeters,
  getAuthoredCamerasSnapshot,
  selectAuthoredCamera,
  subscribeAuthoredCameras,
  updateAuthoredCamera
} from './authored-cameras.js';
import { getLastCoveragePlan, rememberedCoverageTarget } from '../camera/engine/coverage-plan.js';
import { geodesicMeters } from '../camera/engine/geodesy.js';
import {
  CAMERA_OPERATOR_MODE,
  getCameraOperatorMode,
  subscribeCameraOperatorMode
} from '../camera/operator-mode.js';
import {
  getCoverageIntentSnapshot,
  subscribeCoverageIntent
} from '../camera/engine/coverage-intent.js';

export const PLACE_CAMERA_OVERLAY_ID = 'iqai-v2-place-camera-overlay';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#f4f0ea';
const KEY = '#0b0d10';
const ACTIVE = '#00e5ff';
const CAMERA_FILL = '#f4f0ea';
const TARGET = '#00e5ff';
const TARGET_FILL = 'rgba(0, 229, 255, 0.18)';
const BOUNDARY = '#ff9f1c';
const BOUNDARY_GLOW = 'rgba(255, 159, 28, 0.45)';
const WEDGE_FILL = 'rgba(0, 229, 255, 0.12)';
const WEDGE_FILL_ACTIVE = 'rgba(0, 229, 255, 0.22)';

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

function headingFromPoints(origin, target) {
  const lat1 = Number(origin.latitude) * Math.PI / 180;
  const lat2 = Number(target.latitude) * Math.PI / 180;
  const dLon = (Number(target.longitude) - Number(origin.longitude)) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function plannedRangeMeters(camera, target) {
  const frustum = frustumRangeMeters(camera.heightAboveGround);
  const toTarget = target ? geodesicMeters(camera, target) : null;
  const toward = Number.isFinite(toTarget) ? toTarget * 1.08 : 56;
  return Math.max(frustum, toward, 56);
}

function cameraOrdinal(index) {
  return `CAMERA ${String(index + 1).padStart(2, '0')}`;
}

function screenPath(view, points) {
  const screens = (points || []).map((point) => toScreen(view, point.longitude, point.latitude)).filter(Boolean);
  if (screens.length < 2) return { screens, d: '' };
  const d = screens.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ') + ' Z';
  return { screens, d };
}

function paintTargetLabel(svg, screen, text, attrs = {}) {
  const label = svgEl('text', {
    x: screen.x + 16,
    y: screen.y - 16,
    fill: TARGET,
    stroke: KEY,
    'stroke-width': 4,
    'paint-order': 'stroke',
    'font-size': 11,
    'font-weight': 800,
    'font-family': 'ui-sans-serif, system-ui, sans-serif',
    'letter-spacing': '0.12em',
    'pointer-events': 'none',
    'data-iqai-coverage-target-label': 'true',
    ...attrs
  });
  label.textContent = text;
  svg.appendChild(label);
}

function paintPlanGeometry(svg, view, { target, ring, cameras }) {
  const intent = getCoverageIntentSnapshot();
  const draft = (intent.vertices && intent.vertices.length) ? intent.vertices : [];
  const polygon = (ring && ring.length >= 4) ? ring : (intent.polygon && intent.polygon.length >= 4 ? intent.polygon : null);
  if (polygon) {
    const path = screenPath(view, polygon);
    if (path.d) {
      svg.appendChild(svgEl('path', {
        d: path.d,
        fill: 'none',
        stroke: BOUNDARY_GLOW,
        'stroke-width': 8,
        'stroke-linejoin': 'round',
        'opacity': '0.55',
        'pointer-events': 'none'
      }));
      svg.appendChild(svgEl('path', {
        d: path.d,
        fill: 'none',
        stroke: BOUNDARY,
        'stroke-width': 2.4,
        'stroke-linejoin': 'round',
        'data-iqai-plan-boundary': 'true',
        'pointer-events': 'none'
      }));
      svg.appendChild(svgEl('path', {
        d: path.d,
        fill: TARGET_FILL,
        stroke: TARGET,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'data-iqai-coverage-target': 'polygon',
        'data-iqai-coverage-target-area': 'true',
        'pointer-events': 'none'
      }));
      for (const screen of path.screens) {
        svg.appendChild(svgEl('circle', {
          cx: screen.x,
          cy: screen.y,
          r: 3.6,
          fill: BOUNDARY,
          stroke: KEY,
          'stroke-width': 1.4,
          'data-iqai-plan-boundary-node': 'true',
          'pointer-events': 'none'
        }));
      }
      if (path.screens[0]) paintTargetLabel(svg, path.screens[0], 'TARGET AREA');
    }
  } else if (target) {
    const targetScreen = toScreen(view, target.longitude, target.latitude);
    if (targetScreen) {
      const hull = screenPath(view, cameras);
      if (cameras.length >= 3 && hull.d) {
        svg.appendChild(svgEl('path', {
          d: hull.d,
          fill: 'none',
          stroke: BOUNDARY_GLOW,
          'stroke-width': 5,
          'stroke-linejoin': 'round',
          opacity: '0.45',
          'pointer-events': 'none'
        }));
        svg.appendChild(svgEl('path', {
          d: hull.d,
          fill: 'none',
          stroke: BOUNDARY,
          'stroke-width': 1.8,
          'stroke-linejoin': 'round',
          'stroke-dasharray': '5 4',
          'data-iqai-plan-boundary': 'true',
          'pointer-events': 'none'
        }));
      }
      svg.appendChild(svgEl('circle', {
        cx: targetScreen.x,
        cy: targetScreen.y,
        r: 22,
        fill: TARGET_FILL,
        stroke: TARGET,
        'stroke-width': 3.6,
        'data-iqai-coverage-target': 'point',
        'data-iqai-planned-target': 'true',
        'pointer-events': 'none'
      }));
      svg.appendChild(svgEl('circle', {
        cx: targetScreen.x,
        cy: targetScreen.y,
        r: 6,
        fill: TARGET,
        stroke: KEY,
        'stroke-width': 1.8,
        'data-iqai-coverage-target-core': 'true',
        'pointer-events': 'none'
      }));
      svg.appendChild(svgEl('line', {
        x1: targetScreen.x - 26, y1: targetScreen.y, x2: targetScreen.x + 26, y2: targetScreen.y,
        stroke: TARGET, 'stroke-width': 2, 'pointer-events': 'none'
      }));
      svg.appendChild(svgEl('line', {
        x1: targetScreen.x, y1: targetScreen.y - 26, x2: targetScreen.x, y2: targetScreen.y + 26,
        stroke: TARGET, 'stroke-width': 2, 'pointer-events': 'none'
      }));
      paintTargetLabel(svg, targetScreen, 'TARGET');
    }
  }
  for (const vertex of draft) {
    const screen = toScreen(view, vertex.longitude, vertex.latitude);
    if (!screen) continue;
    svg.appendChild(svgEl('circle', {
      cx: screen.x,
      cy: screen.y,
      r: 4,
      fill: TARGET,
      stroke: KEY,
      'stroke-width': 1.2,
      'data-iqai-coverage-vertex': 'true',
      'pointer-events': 'none'
    }));
  }
}

export function bindPlaceCameraOverlay() {
  let viewHandles = [];
  let watchedView = null;
  let drag = null;

  function ensureSvg(view) {
    const host = view?.container;
    if (!host) return null;
    let svg = host.querySelector(`#${PLACE_CAMERA_OVERLAY_ID}`);
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = PLACE_CAMERA_OVERLAY_ID;
      svg.setAttribute('data-iqai-place-camera-overlay', 'true');
      svg.setAttribute('data-iqai-planned-camera-overlay', 'true');
      svg.setAttribute('aria-label', 'Planned camera position and field of view');
      svg.style.cssText = [
        'position:absolute',
        'inset:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:28',
        'overflow:visible'
      ].join(';');
      host.appendChild(svg);
      svg.addEventListener('pointerdown', onPointerDown);
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
    const mode = getCameraOperatorMode();
    const lookAround = mode === CAMERA_OPERATOR_MODE.LOOK_AROUND;
    svg.style.visibility = lookAround ? 'hidden' : 'visible';
    svg.replaceChildren();
    if (lookAround) return getAuthoredCamerasSnapshot();
    const snapshot = getAuthoredCamerasSnapshot();
    const remembered = rememberedCoverageTarget();
    const plan = getLastCoveragePlan();
    const target = remembered || plan?.target || null;
    const ring = remembered?.ring || plan?.polygon || getCoverageIntentSnapshot().polygon;
    paintPlanGeometry(svg, view, {
      target,
      ring,
      cameras: snapshot.cameras.filter((camera) => camera.creationMode === 'AUTO_PLAN' && Number.isFinite(camera.longitude))
    });
    snapshot.cameras.forEach((camera, index) => {
      const origin = toScreen(view, camera.longitude, camera.latitude);
      if (!origin) return;
      const active = camera.cameraId === snapshot.activeCameraId;
      const range = plannedRangeMeters(camera, target);
      const left = destinationAlongHeading(camera, camera.heading - camera.horizontalFov / 2, range);
      const right = destinationAlongHeading(camera, camera.heading + camera.horizontalFov / 2, range);
      const tip = destinationAlongHeading(camera, camera.heading, range);
      const leftScreen = left ? toScreen(view, left.longitude, left.latitude) : null;
      const rightScreen = right ? toScreen(view, right.longitude, right.latitude) : null;
      const tipScreen = tip ? toScreen(view, tip.longitude, tip.latitude) : null;
      const group = svgEl('g', {
        'data-iqai-authored-camera': camera.cameraId,
        'data-iqai-planned-camera': camera.cameraId,
        'data-iqai-camera-active': active ? 'true' : 'false'
      });
      if (leftScreen && rightScreen) {
        const wedge = svgEl('path', {
          d: `M ${origin.x} ${origin.y} L ${leftScreen.x} ${leftScreen.y} L ${rightScreen.x} ${rightScreen.y} Z`,
          fill: active ? WEDGE_FILL_ACTIVE : WEDGE_FILL,
          stroke: active ? ACTIVE : INK,
          'stroke-width': active ? 2.2 : 0.8,
          opacity: active ? '1' : '0.28',
          'data-iqai-camera-wedge': camera.cameraId,
          'data-iqai-planned-fov': camera.cameraId,
          'data-iqai-planned-fov-truth': 'NOT LOS',
          'pointer-events': active ? 'stroke' : 'none'
        });
        group.appendChild(wedge);
      }
      if (tipScreen && active) {
        const ray = svgEl('line', {
          x1: origin.x,
          y1: origin.y,
          x2: tipScreen.x,
          y2: tipScreen.y,
          stroke: KEY,
          'stroke-width': 4,
          'stroke-linecap': 'round',
          'data-iqai-planned-heading': camera.cameraId,
          'pointer-events': 'none'
        });
        const rayInk = svgEl('line', {
          x1: origin.x,
          y1: origin.y,
          x2: tipScreen.x,
          y2: tipScreen.y,
          stroke: active ? ACTIVE : INK,
          'stroke-width': 1.8,
          'stroke-linecap': 'round',
          'pointer-events': 'none'
        });
        group.appendChild(ray);
        group.appendChild(rayInk);
        const handle = svgEl('circle', {
          cx: tipScreen.x,
          cy: tipScreen.y,
          r: active ? 6.5 : 5,
          fill: active ? ACTIVE : INK,
          stroke: KEY,
          'stroke-width': 1.4,
          'data-iqai-camera-rotate': camera.cameraId,
          'pointer-events': 'auto',
          style: 'cursor:grab'
        });
        group.appendChild(handle);
      }
      const heading = Number(camera.heading) || 0;
      const glyph = svgEl('g', {
        transform: `rotate(${heading} ${origin.x} ${origin.y})`,
        'data-iqai-authored-camera': camera.cameraId,
        'data-iqai-camera-body': camera.cameraId,
        'data-iqai-planned-camera-symbol': camera.cameraId,
        'data-iqai-planned-camera-glyph': 'cctv',
        'data-iqai-planned-heading-deg': String(Math.round(heading)),
        'pointer-events': 'auto',
        style: 'cursor:move'
      });
      const fill = active ? '#ffffff' : CAMERA_FILL;
      glyph.appendChild(svgEl('circle', {
        cx: origin.x,
        cy: origin.y,
        r: active ? 16 : 12,
        fill: 'none',
        stroke: active ? ACTIVE : '#f4f0ea',
        'stroke-width': active ? 3 : 2,
        opacity: '0.95',
        'data-iqai-planned-camera-halo': camera.cameraId,
        'pointer-events': 'none'
      }));
      glyph.appendChild(svgEl('circle', {
        cx: origin.x,
        cy: origin.y,
        r: 2.4,
        fill: active ? ACTIVE : '#ffffff',
        stroke: KEY,
        'stroke-width': 1.6,
        'data-iqai-planned-camera-anchor': camera.cameraId,
        'pointer-events': 'none'
      }));
      const housing = svgEl('rect', {
        x: origin.x - 7.2,
        y: origin.y - 1.8,
        width: 14.4,
        height: 9.4,
        rx: 1.2,
        fill,
        stroke: KEY,
        'stroke-width': 2.2
      });
      const barrel = svgEl('rect', {
        x: origin.x - 2.8,
        y: origin.y - 9.6,
        width: 5.6,
        height: 8.2,
        rx: 0.7,
        fill: '#ffffff',
        stroke: KEY,
        'stroke-width': 2
      });
      const lens = svgEl('circle', {
        cx: origin.x,
        cy: origin.y - 10.4,
        r: 3.1,
        fill: KEY,
        stroke: active ? ACTIVE : '#ffffff',
        'stroke-width': 1.8
      });
      glyph.appendChild(housing);
      glyph.appendChild(barrel);
      glyph.appendChild(lens);
      group.appendChild(glyph);
      const label = svgEl('text', {
        x: origin.x + 14,
        y: origin.y - 12,
        fill: INK,
        stroke: KEY,
        'stroke-width': 4.4,
        'paint-order': 'stroke',
        'font-size': 11,
        'font-weight': 800,
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'letter-spacing': '0.08em',
        'pointer-events': 'none',
        'data-iqai-planned-camera-label': camera.cameraId
      });
      label.textContent = String(index + 1).padStart(2, '0');
      group.appendChild(label);
      if (active) {
        const truth = svgEl('text', {
          x: origin.x + 12,
          y: origin.y + 6,
          fill: ACTIVE,
          stroke: KEY,
          'stroke-width': 3,
          'paint-order': 'stroke',
          'font-size': 0,
          'font-family': 'ui-sans-serif, system-ui, sans-serif',
          'letter-spacing': '0.08em',
          'pointer-events': 'none',
          'aria-hidden': 'true',
          'data-iqai-planned-fov-label': 'true'
        });
        truth.textContent = 'PLANNED FOV · NOT LOS';
        group.appendChild(truth);
      }
      svg.appendChild(group);
    });
    return snapshot;
  }

  function mapPointFromEvent(event, view) {
    const rect = view?.container?.getBoundingClientRect?.();
    const x = Number(event.clientX) - Number(rect?.left || 0);
    const y = Number(event.clientY) - Number(rect?.top || 0);
    const mapPoint = view?.toMap?.({ x, y });
    const longitude = Number(mapPoint?.longitude);
    const latitude = Number(mapPoint?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return { longitude, latitude };
  }

  function onPointerDown(event) {
    if (getCameraOperatorMode() === CAMERA_OPERATOR_MODE.LOOK_AROUND) return;
    const rotateId = event.target?.getAttribute?.('data-iqai-camera-rotate');
    const bodyId = event.target?.getAttribute?.('data-iqai-camera-body');
    const cameraId = rotateId || bodyId || event.target?.closest?.('[data-iqai-authored-camera]')?.getAttribute('data-iqai-authored-camera');
    if (!cameraId) return;
    event.preventDefault();
    event.stopPropagation();
    selectAuthoredCamera(cameraId);
    document.getElementById('iqai-spatial-v2')?.dispatchEvent(new CustomEvent('iqai-camera-command-reveal'));
    const view = getMapView();
    drag = {
      cameraId,
      mode: rotateId ? 'rotate' : 'move',
      pointerId: event.pointerId
    };
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    view?.container?.classList?.toggle?.('is-place-camera-dragging', true);
    if (drag.mode === 'move') {
      const point = mapPointFromEvent(event, view);
      if (point) updateAuthoredCamera(cameraId, point);
    } else {
      rotateToward(cameraId, event, view);
    }
  }

  function rotateToward(cameraId, event, view) {
    const camera = getAuthoredCamerasSnapshot().cameras.find((item) => item.cameraId === cameraId);
    const point = mapPointFromEvent(event, view);
    if (!camera || !point) return;
    updateAuthoredCamera(cameraId, { heading: headingFromPoints(camera, point) });
  }

  function onPointerMove(event) {
    if (!drag) return;
    const view = getMapView();
    if (drag.mode === 'move') {
      const point = mapPointFromEvent(event, view);
      if (point) updateAuthoredCamera(drag.cameraId, point);
      return;
    }
    rotateToward(drag.cameraId, event, view);
  }

  function onPointerUp() {
    if (!drag) return;
    drag = null;
    getMapView()?.container?.classList?.toggle?.('is-place-camera-dragging', false);
  }

  function watchView(view) {
    if (!view) return;
    if (view === watchedView) {
      paint();
      return;
    }
    for (const handle of viewHandles) {
      try { handle.remove?.(); } catch { /* gone */ }
    }
    viewHandles = [];
    watchedView = view;
    const refresh = () => paint();
    if (typeof view.watch === 'function') {
      viewHandles.push(view.watch('stationary', (stationary) => { if (stationary) refresh(); }));
      viewHandles.push(view.watch('extent', refresh));
      viewHandles.push(view.watch('rotation', refresh));
      viewHandles.push(view.watch('scale', refresh));
    }
    paint();
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  const unsubscribe = subscribeAuthoredCameras(() => paint());
  const unsubscribeMode = subscribeCameraOperatorMode(() => paint());
  const unsubscribeIntent = subscribeCoverageIntent(() => paint());
  watchView(getMapView());

  return Object.freeze({
    paint,
    refresh: paint,
    attachView: watchView,
    snapshot: getAuthoredCamerasSnapshot,
    isDragging: () => Boolean(drag),
    detach() {
      unsubscribe();
      unsubscribeMode();
      unsubscribeIntent();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      for (const handle of viewHandles) {
        try { handle.remove?.(); } catch { /* gone */ }
      }
      getMapView()?.container?.querySelector?.(`#${PLACE_CAMERA_OVERLAY_ID}`)?.remove?.();
    }
  });
}
