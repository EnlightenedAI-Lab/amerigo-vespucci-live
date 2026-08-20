/**
 * VIEW CAMERA — compact control on the active authored camera.
 * Geometric preview and production Street360 consume the same SensorPose.
 * Does not copy Camera Lab UI. Does not mutate pose by opening Street360.
 *
 * EXPERIMENTAL WORKING PROOF. PROVIDER RELEASE GATE OPEN.
 * Not approved production Google architecture. Local proof stays enabled.
 */

import {
  getActiveAuthoredCamera,
  getAuthoredCamerasSnapshot,
  subscribeAuthoredCameras
} from '../map/authored-cameras.js';
import {
  CAMERA_VIEW_MODE,
  poseKey,
  street360SyncPlan,
  street360Truth
} from '../map/view-camera-bind.js';
import { drawGeometricCameraView } from '../map/view-camera-geometric.js';
import { formatLatitude, formatLongitude } from '../map/spatial-focus.js';

function fmtLocation(point) {
  if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) {
    return '—';
  }
  return `${formatLatitude(point.latitude)}   ${formatLongitude(point.longitude)}`;
}

function fmtOffset(meters) {
  return Number.isFinite(Number(meters)) ? `${Number(meters).toFixed(1)} m` : '—';
}

function fmtAngle(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}°` : '—';
}

function providerPixels(host) {
  return Boolean(host?.querySelector?.('.gm-style canvas, .gm-style img'));
}

function providerVisualFailed(host) {
  const node = host?.querySelector?.('.gm-err-container, .gm-err-message, .gm-err-title');
  const text = `${node?.textContent || ''} ${host?.textContent || ''}`;
  return /didn't load Google Maps correctly|Oops! Something went/i.test(text);
}

async function waitProviderVisual(host, timeoutMs = 4000) {
  const started = Date.now();
  let sawCanvas = false;
  while (Date.now() - started < timeoutMs) {
    if (providerVisualFailed(host)) return 'error';
    if (providerPixels(host)) sawCanvas = true;
    if (sawCanvas) return 'pixels';
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (providerVisualFailed(host)) return 'error';
  return sawCanvas ? 'pixels' : 'unknown';
}

export function bindViewCameraControl(root, options = {}) {
  const editor = root?.querySelector('[data-iqai-place-camera-editor]');
  const button = root?.querySelector('[data-iqai-view-camera]');
  const panel = root?.querySelector('[data-iqai-view-camera-panel]');
  const canvas = root?.querySelector('[data-iqai-view-camera-geometric]');
  const truthRoot = root?.querySelector('[data-iqai-view-camera-truth]');
  const street360 = options.street360;
  const worldViewFrame = options.worldViewFrame;

  let open = false;
  let mode = CAMERA_VIEW_MODE.GEOMETRIC;
  let lastBound = null;
  let lastTruth = street360Truth(null, {}, 'UNAVAILABLE');
  let lastProvider = null;
  let generation = 0;
  let resolveTimer = null;
  let layoutBeforeStreet = null;
  let painting = false;

  function activeCamera() {
    return getActiveAuthoredCamera();
  }

  function snapshot() {
    const camera = activeCamera();
    const street = street360?.snapshot?.() || {};
    return Object.freeze({
      open,
      mode,
      cameraId: camera?.cameraId || null,
      poseId: camera?.poseId || null,
      heading: camera?.heading ?? null,
      pitch: camera?.pitch ?? null,
      longitude: camera?.longitude ?? null,
      latitude: camera?.latitude ?? null,
      horizontalFov: camera?.horizontalFov ?? null,
      geometric: mode === CAMERA_VIEW_MODE.GEOMETRIC && open === true,
      street360: mode === CAMERA_VIEW_MODE.STREET360 && open === true,
      bindMode: street.bindMode || 'operator',
      truth: lastTruth,
      providerPixels: providerPixels(root?.querySelector('[data-iqai-street-360-stage]')),
      providerHeading: Number.isFinite(Number(street.pov?.heading)) ? Number(street.pov.heading) : null,
      providerPitch: Number.isFinite(Number(street.pov?.pitch)) ? Number(street.pov.pitch) : null,
      panoId: street.panoId || null,
      stageState: street.stageState || null,
      sensorPoseMutated: false
    });
  }

  function paintTruth() {
    if (!truthRoot) return;
    const camera = activeCamera();
    const hfov = truthRoot.querySelector('[data-iqai-view-camera-hfov]');
    const authored = truthRoot.querySelector('[data-iqai-view-camera-authored]');
    const capture = truthRoot.querySelector('[data-iqai-view-camera-capture]');
    const offset = truthRoot.querySelector('[data-iqai-view-camera-offset]');
    const heading = truthRoot.querySelector('[data-iqai-view-camera-heading]');
    const pitch = truthRoot.querySelector('[data-iqai-view-camera-pitch]');
    const status = truthRoot.querySelector('[data-iqai-view-camera-status]');
    if (hfov) hfov.textContent = fmtAngle(camera?.horizontalFov ?? lastTruth.cameraHfov);
    if (authored) authored.textContent = fmtLocation(lastTruth.authoredLocation || camera);
    if (capture) capture.textContent = fmtLocation(lastTruth.captureLocation);
    if (offset) offset.textContent = fmtOffset(lastTruth.captureOffsetMeters);
    if (heading) heading.textContent = fmtAngle(lastTruth.cameraHeading);
    if (pitch) pitch.textContent = fmtAngle(lastTruth.cameraPitch);
    if (status) status.textContent = lastTruth.status === 'AVAILABLE' ? 'AVAILABLE' : (lastTruth.unavailableLabel || 'UNAVAILABLE');
  }

  function paint() {
    if (painting) return;
    painting = true;
    const camera = activeCamera();
    const visible = Boolean(open && camera);
    if (button) {
      button.hidden = !camera;
      button.setAttribute('aria-pressed', open ? 'true' : 'false');
      button.classList.toggle('is-active', open);
    }
    if (panel) panel.hidden = !visible;
    if (editor) editor.classList.toggle('is-view-camera', visible);
    panel?.querySelectorAll('[data-iqai-view-camera-mode]').forEach((node) => {
      const active = node.getAttribute('data-iqai-view-camera-mode') === mode;
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
      node.classList.toggle('is-active', active);
    });
    const street = mode === CAMERA_VIEW_MODE.STREET360;
    if (canvas) canvas.hidden = !visible || street;
    if (truthRoot) truthRoot.hidden = !visible || !street;
    if (visible && !street && canvas) drawGeometricCameraView(canvas, camera);
    if (visible && street) paintTruth();
    painting = false;
    return snapshot();
  }

  function setTruth(camera, provider, status) {
    lastProvider = provider || null;
    lastTruth = street360Truth(camera, provider || {}, status);
    paint();
    return lastTruth;
  }

  async function closeStreetSession() {
    generation += 1;
    lastBound = null;
    clearTimeout(resolveTimer);
    resolveTimer = null;
    try {
      await street360?.releaseCameraBind?.();
    } catch {
      /* closed */
    }
    if (layoutBeforeStreet != null && worldViewFrame?.snapshot?.()?.layout !== layoutBeforeStreet) {
      await worldViewFrame?.setLayout?.(layoutBeforeStreet);
    }
    layoutBeforeStreet = null;
    return setTruth(activeCamera(), {}, 'UNAVAILABLE');
  }

  async function resolve(camera) {
    const token = ++generation;
    lastBound = poseKey(camera);
    if (!camera || !street360) return setTruth(camera, {}, 'UNAVAILABLE');
    if (layoutBeforeStreet == null) {
      layoutBeforeStreet = worldViewFrame?.snapshot?.()?.layout ?? 1;
    }
    street360.beginCameraBind?.(camera);
    try {
      await worldViewFrame?.openSupporting?.('STREET 360');
      const waitBusy = Date.now();
      while (worldViewFrame?.snapshot?.()?.busy && Date.now() - waitBusy < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      let opened = street360.snapshot?.() || {};
      if (opened.bindMode !== 'camera' || opened.open !== true || opened.available !== true) {
        opened = await street360.openForCamera?.(camera) || opened;
      } else {
        opened = street360.applyCameraPov?.(camera) || opened;
      }
      if (token !== generation) return lastTruth;
      const pose = activeCamera() || camera;
      const visual = await waitProviderVisual(root?.querySelector('[data-iqai-street-360-stage]'));
      if (token !== generation) return lastTruth;
      const available = opened?.open === true && opened?.available === true && !opened?.error && visual === 'pixels';
      if (!available) {
        return setTruth(pose, opened || {}, 'UNAVAILABLE');
      }
      opened = street360.applyCameraPov?.(pose) || opened;
      const provider = {
        ...opened,
        available: true,
        panoramaPosition: opened.panoramaPosition,
        offsetMeters: opened.offsetMeters
      };
      return setTruth(pose, provider, 'AVAILABLE');
    } catch {
      if (token !== generation) return lastTruth;
      return setTruth(activeCamera() || camera, {}, 'UNAVAILABLE');
    }
  }

  function applyPov(camera) {
    lastBound = poseKey(camera);
    const snapshot = street360?.applyCameraPov?.(camera) || {};
    return setTruth(camera, {
      ...lastProvider,
      ...snapshot,
      available: snapshot.open === true,
      offsetMeters: lastTruth.captureOffsetMeters,
      panoramaPosition: snapshot.panoramaPosition || lastProvider?.panoramaPosition
    }, snapshot.open ? 'AVAILABLE' : 'UNAVAILABLE');
  }

  function sync(camera = activeCamera()) {
    paint();
    if (!open) return lastTruth;
    if (!camera) {
      void closeStreetSession();
      open = false;
      paint();
      return lastTruth;
    }
    if (mode !== CAMERA_VIEW_MODE.STREET360) {
      if (lastBound) void closeStreetSession();
      return lastTruth;
    }
    const plan = street360SyncPlan(lastBound, camera);
    if (plan.action === 'close') {
      void closeStreetSession();
      return lastTruth;
    }
    if (plan.action === 'pov') {
      const street = street360?.snapshot?.() || {};
      if (street.open === true) applyPov(camera);
      else lastBound = poseKey(camera);
      return lastTruth;
    }
    if (plan.action === 'idle') {
      setTruth(camera, lastProvider, lastTruth.status);
      return lastTruth;
    }
    clearTimeout(resolveTimer);
    const immediate = !lastBound || lastBound.cameraId !== camera.cameraId;
    if (immediate) {
      void resolve(camera);
      return lastTruth;
    }
    resolveTimer = setTimeout(() => { void resolve(activeCamera() || camera); }, 280);
    return lastTruth;
  }

  async function setMode(next) {
    mode = next === CAMERA_VIEW_MODE.STREET360
      ? CAMERA_VIEW_MODE.STREET360
      : CAMERA_VIEW_MODE.GEOMETRIC;
    lastBound = null;
    paint();
    if (mode === CAMERA_VIEW_MODE.GEOMETRIC) await closeStreetSession();
    else sync(activeCamera());
    return mode;
  }

  async function openView() {
    if (!activeCamera()) return snapshot();
    open = true;
    paint();
    sync(activeCamera());
    return snapshot();
  }

  async function closeView() {
    open = false;
    await closeStreetSession();
    mode = CAMERA_VIEW_MODE.GEOMETRIC;
    paint();
    return snapshot();
  }

  async function toggle() {
    if (open) return closeView();
    return openView();
  }

  button?.addEventListener('click', (event) => {
    event.preventDefault();
    void toggle();
  });
  panel?.querySelectorAll('[data-iqai-view-camera-mode]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      void setMode(node.getAttribute('data-iqai-view-camera-mode'));
    });
  });
  subscribeAuthoredCameras(() => {
    if (!getAuthoredCamerasSnapshot().active) {
      if (open) void closeView();
      else paint();
      return;
    }
    if (open) sync(activeCamera());
    else paint();
  });
  paint();

  return Object.freeze({
    open: openView,
    close: closeView,
    toggle,
    setMode,
    sync,
    snapshot,
    paint
  });
}
