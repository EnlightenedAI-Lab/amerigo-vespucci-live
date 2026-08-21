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
import { rememberedCoverageTarget } from '../camera/engine/coverage-plan.js';
import { geodesicMeters } from '../camera/engine/geodesy.js';
import {
  CAMERA_OPERATOR_MODE,
  getCameraOperatorMode,
  subscribeCameraOperatorMode
} from '../camera/operator-mode.js';

export const PLACE_CAMERA_OVERLAY_ID = 'iqai-v2-place-camera-overlay';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#f4e6c8';
const KEY = '#0c0c0e';
const ACTIVE = '#ffcc66';
const WEDGE_FILL = 'rgba(232,168,23,0.34)';
const WEDGE_FILL_ACTIVE = 'rgba(255,204,102,0.46)';

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
    const target = rememberedCoverageTarget();
    const targetScreen = target ? toScreen(view, target.longitude, target.latitude) : null;
    if (targetScreen) {
      const targetMark = svgEl('circle', {
        cx: targetScreen.x,
        cy: targetScreen.y,
        r: 5.5,
        fill: 'none',
        stroke: ACTIVE,
        'stroke-width': 2,
        'data-iqai-planned-target': 'true',
        'pointer-events': 'none'
      });
      svg.appendChild(targetMark);
    }
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
          'stroke-width': active ? 2.2 : 1.7,
          'data-iqai-camera-wedge': camera.cameraId,
          'data-iqai-planned-fov': camera.cameraId,
          'data-iqai-planned-fov-truth': 'NOT LOS',
          'pointer-events': 'stroke'
        });
        group.appendChild(wedge);
      }
      if (tipScreen) {
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
      const fill = active ? ACTIVE : '#e8b84a';
      const housing = svgEl('rect', {
        x: origin.x - 5.5,
        y: origin.y - 1.2,
        width: 11,
        height: 7.4,
        rx: 1.5,
        fill,
        stroke: KEY,
        'stroke-width': active ? 1.8 : 1.5
      });
      const barrel = svgEl('rect', {
        x: origin.x - 2.3,
        y: origin.y - 7.6,
        width: 4.6,
        height: 6.6,
        rx: 0.9,
        fill: active ? '#ffe08a' : '#d4a017',
        stroke: KEY,
        'stroke-width': 1.2
      });
      const lens = svgEl('circle', {
        cx: origin.x,
        cy: origin.y - 8.1,
        r: 2.35,
        fill: KEY,
        stroke: fill,
        'stroke-width': 1.4
      });
      glyph.appendChild(housing);
      glyph.appendChild(barrel);
      glyph.appendChild(lens);
      group.appendChild(glyph);
      const label = svgEl('text', {
        x: origin.x + 12,
        y: origin.y - 10,
        fill: INK,
        stroke: KEY,
        'stroke-width': 3.2,
        'paint-order': 'stroke',
        'font-size': 10,
        'font-weight': 700,
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'letter-spacing': '0.06em',
        'pointer-events': 'none',
        'data-iqai-planned-camera-label': camera.cameraId
      });
      label.textContent = `${cameraOrdinal(index)} · HFOV ${Math.round(Number(camera.horizontalFov) || 0)}°`;
      group.appendChild(label);
      if (active) {
        const truth = svgEl('text', {
          x: origin.x + 12,
          y: origin.y + 6,
          fill: ACTIVE,
          stroke: KEY,
          'stroke-width': 3,
          'paint-order': 'stroke',
          'font-size': 8,
          'font-family': 'ui-sans-serif, system-ui, sans-serif',
          'letter-spacing': '0.08em',
          'pointer-events': 'none',
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
