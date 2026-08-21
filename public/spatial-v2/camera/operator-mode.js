/**
 * Operator-facing Camera mode. Not CameraRef. Not ViewSlot. Not relevance.
 * CHOOSER is the only default entry: LOOK AROUND or PLAN CAMERAS.
 */

export const CAMERA_OPERATOR_MODE = Object.freeze({
  CHOOSER: 'CHOOSER',
  LOOK_AROUND: 'LOOK_AROUND',
  PLAN_CAMERAS: 'PLAN_CAMERAS'
});

const listeners = new Set();
let mode = CAMERA_OPERATOR_MODE.CHOOSER;

function emit() {
  for (const listener of listeners) {
    try { listener(mode); } catch { /* ignore */ }
  }
}

export function getCameraOperatorMode() {
  return mode;
}

export function setCameraOperatorMode(next) {
  const value = Object.values(CAMERA_OPERATOR_MODE).includes(next)
    ? next
    : CAMERA_OPERATOR_MODE.CHOOSER;
  if (mode === value) return mode;
  mode = value;
  emit();
  return mode;
}

export function resetCameraOperatorMode({ emit: shouldEmit = true } = {}) {
  mode = CAMERA_OPERATOR_MODE.CHOOSER;
  if (shouldEmit) emit();
  return mode;
}

export function subscribeCameraOperatorMode(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
