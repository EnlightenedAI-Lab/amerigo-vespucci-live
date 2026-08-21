/**
 * PLACE CAMERA operator control on the long-lived MAP.
 * Authors SensorPose (OPERATOR_AUTHORED). Does not write WorldState.cameras.
 * Does not snap to roofs, attach buildings, or claim LOS.
 */

import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { getMapView } from '../map/map-foundation.js';
import {
  PLANNING_LABEL,
  deleteAuthoredCamera,
  getActiveAuthoredSensorPose,
  getAuthoredCamerasSnapshot,
  hydrateAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras,
  selectAuthoredCamera,
  subscribeAuthoredCameras,
  updateAuthoredCamera
} from '../map/authored-cameras.js';
import { bindPlaceCameraOverlay } from '../map/place-camera-overlay.js';
import { formatLatitude, formatLongitude } from '../map/spatial-focus.js';

function pointFromMapEvent(event) {
  const longitude = Number(event?.mapPoint?.longitude);
  const latitude = Number(event?.mapPoint?.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) return null;
  return { longitude, latitude };
}

function field(root, name) {
  return root?.querySelector?.(`[data-iqai-place-camera-${name}]`);
}

export function bindPlaceCameraControl(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const button = root?.querySelector('[data-iqai-place-camera]');
  const editor = root?.querySelector('[data-iqai-place-camera-editor]');
  const overlay = bindPlaceCameraOverlay();
  let armed = false;
  let mapReady = false;
  let clickHandle = null;
  let painting = false;

  hydrateAuthoredCameras();

  function snapshot() {
    return Object.freeze({
      ...getAuthoredCamerasSnapshot(),
      armed,
      mapReady,
      overlayId: 'iqai-v2-place-camera-overlay'
    });
  }

  function paintEditor() {
    if (!editor) return;
    const current = getAuthoredCamerasSnapshot().active;
    editor.hidden = !current;
    if (!current) return;
    const idNode = field(editor, 'id');
    const llNode = field(editor, 'll');
    const zNode = field(editor, 'z');
    const heading = field(editor, 'heading');
    const pitch = field(editor, 'pitch');
    const height = field(editor, 'height');
    const fov = field(editor, 'fov');
    if (idNode) idNode.textContent = current.cameraId;
    if (llNode) llNode.textContent = `${formatLatitude(current.latitude)}   ${formatLongitude(current.longitude)}`;
    if (zNode) zNode.textContent = current.zKnown ? `Z ${current.z}` : 'Z UNKNOWN';
    const planNode = field(editor, 'plan');
    if (planNode) planNode.textContent = current.planningLabel || PLANNING_LABEL;
    if (heading && document.activeElement !== heading) heading.value = String(Math.round(current.heading));
    if (pitch && document.activeElement !== pitch) pitch.value = String(current.pitch);
    if (height && document.activeElement !== height) height.value = String(current.heightAboveGround);
    if (fov && document.activeElement !== fov) fov.value = String(Math.round(current.horizontalFov));
  }

  function paintChrome() {
    if (painting) return;
    painting = true;
    if (well) well.classList.toggle('is-place-camera', armed);
    if (mapHost) mapHost.classList.toggle('is-place-camera', armed);
    if (button) {
      button.setAttribute('aria-pressed', armed ? 'true' : 'false');
      button.classList.toggle('is-active', armed);
    }
    paintEditor();
    overlay.paint();
    painting = false;
  }

  function attachMapView(view) {
    if (!view || clickHandle || typeof view.on !== 'function') {
      overlay.attachView(view);
      return Boolean(view);
    }
    clickHandle = view.on('click', (event) => {
      if (!armed) return;
      if (overlay.isDragging()) return;
      const cameraId = event?.native?.target?.getAttribute?.('data-iqai-authored-camera')
        || event?.native?.target?.closest?.('[data-iqai-authored-camera]')?.getAttribute('data-iqai-authored-camera');
      if (cameraId) {
        selectAuthoredCamera(cameraId);
        return;
      }
      const point = pointFromMapEvent(event);
      if (!point) return;
      placeAuthoredCamera(point);
    });
    overlay.attachView(view);
    mapReady = true;
    paintChrome();
    return true;
  }

  async function arm() {
    if (options.getActiveView?.() && options.getActiveView() !== 'map' && options.getActiveView() !== 'MAP') {
      await options.returnToMap?.();
    }
    options.disarmDropPin?.();
    armed = true;
    paintChrome();
    return snapshot();
  }

  function disarm() {
    armed = false;
    paintChrome();
    return snapshot();
  }

  async function toggle() {
    if (armed) return disarm();
    return arm();
  }

  function onEditorField(event) {
    const active = getAuthoredCamerasSnapshot().active;
    if (!active) return;
    const target = event.target;
    const fields = {};
    if (target === field(editor, 'heading')) fields.heading = Number(target.value);
    if (target === field(editor, 'pitch')) fields.pitch = Number(target.value);
    if (target === field(editor, 'height')) fields.heightAboveGround = Number(target.value);
    if (target === field(editor, 'fov')) {
      fields.horizontalFov = Number(target.value);
      fields.verticalFov = null;
    }
    if (Object.keys(fields).length) updateAuthoredCamera(active.cameraId, fields);
  }

  button?.addEventListener('click', (event) => {
    event.preventDefault();
    void toggle();
  });
  editor?.addEventListener('change', onEditorField);
  editor?.addEventListener('input', onEditorField);
  field(editor, 'delete')?.addEventListener('click', (event) => {
    event.preventDefault();
    deleteAuthoredCamera();
  });
  subscribeAuthoredCameras(() => paintChrome());
  paintChrome();

  return Object.freeze({
    arm,
    disarm,
    toggle,
    snapshot,
    paint: paintChrome,
    placeAt: (longitude, latitude, fields = {}) => placeAuthoredCamera({ longitude, latitude, ...fields }),
    updateActive: (fields) => {
      const active = getAuthoredCamerasSnapshot().active;
      return active ? updateAuthoredCamera(active.cameraId, fields) : null;
    },
    select: selectAuthoredCamera,
    deleteActive: () => deleteAuthoredCamera(),
    reset: resetAuthoredCameras,
    sensorPose: getActiveAuthoredSensorPose,
    setMapReady(ready) {
      mapReady = Boolean(ready);
      if (mapReady) attachMapView(getMapView());
      paintChrome();
      return snapshot();
    },
    attachView: attachMapView
  });
}
