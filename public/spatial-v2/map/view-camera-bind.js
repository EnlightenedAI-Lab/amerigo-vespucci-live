/**
 * VIEW CAMERA bind plan: one OPERATOR_AUTHORED SensorPose, many representations.
 * Geometric preview and production Street360 consume the same pose.
 * Does not claim FOV match, height match, LOS, or authored-camera photography.
 *
 * EXPERIMENTAL WORKING PROOF. PROVIDER RELEASE GATE OPEN.
 * ArcGIS + Google Street View on the same screen is provider-gated and is
 * not approved production Google architecture. This local proof stays enabled.
 */

import { offsetMetersBetween } from './google-street-view.js';

export const CAMERA_VIEW_MODE = Object.freeze({
  GEOMETRIC: 'geometric',
  STREET360: 'street360'
});

export const STREET360_FOV_LIMITATION = 'STREET360 PROVIDER POV';
export const STREET360_NOT_OPTICALLY_MATCHED = 'NOT OPTICALLY MATCHED';
export const STREET360_HEIGHT_LIMITATION = 'STREET360 CAPTURE HEIGHT IS PROVIDER-DEFINED';
export const STREET360_UNAVAILABLE = 'STREET360 UNAVAILABLE AT THIS LOCATION';

export function poseKey(camera) {
  if (!camera) return null;
  return Object.freeze({
    cameraId: camera.cameraId,
    longitude: Number(camera.longitude),
    latitude: Number(camera.latitude),
    heading: Number(camera.heading),
    pitch: Number(camera.pitch),
    heightAboveGround: Number(camera.heightAboveGround),
    horizontalFov: Number(camera.horizontalFov)
  });
}

export function street360SyncPlan(previous, next, options = {}) {
  if (!next) return Object.freeze({ action: 'close' });
  if (!previous) return Object.freeze({ action: 'resolve' });
  if (previous.cameraId !== next.cameraId) return Object.freeze({ action: 'resolve' });
  const moved = offsetMetersBetween(previous, next);
  const moveMeters = Number(options.moveMeters) > 0 ? Number(options.moveMeters) : 1.5;
  if (Number.isFinite(moved) && moved > moveMeters) {
    return Object.freeze({ action: 'resolve', movedMeters: moved });
  }
  const headingDelta = Math.abs(((Number(previous.heading) - Number(next.heading) + 540) % 360) - 180);
  const pitchDelta = Math.abs(Number(previous.pitch) - Number(next.pitch));
  if (headingDelta > 0.2 || pitchDelta > 0.2) {
    return Object.freeze({ action: 'pov', heading: next.heading, pitch: next.pitch });
  }
  return Object.freeze({ action: 'idle' });
}

export function street360Truth(camera, provider = {}, status = 'UNAVAILABLE') {
  const authored = camera && Number.isFinite(Number(camera.longitude)) && Number.isFinite(Number(camera.latitude))
    ? Object.freeze({ longitude: Number(camera.longitude), latitude: Number(camera.latitude) })
    : null;
  const capture = provider.panoramaPosition
    && Number.isFinite(Number(provider.panoramaPosition.longitude))
    && Number.isFinite(Number(provider.panoramaPosition.latitude))
    ? Object.freeze({
      longitude: Number(provider.panoramaPosition.longitude),
      latitude: Number(provider.panoramaPosition.latitude)
    })
    : null;
  const offset = Number.isFinite(Number(provider.offsetMeters))
    ? Number(provider.offsetMeters)
    : (authored && capture ? offsetMetersBetween(authored, capture) : null);
  const available = status === 'AVAILABLE' && Boolean(provider.available);
  return Object.freeze({
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    unavailableLabel: available ? null : STREET360_UNAVAILABLE,
    authoredLocation: authored,
    captureLocation: capture,
    captureOffsetMeters: Number.isFinite(offset) ? offset : null,
    cameraHeading: camera && Number.isFinite(Number(camera.heading)) ? Number(camera.heading) : null,
    cameraPitch: camera && Number.isFinite(Number(camera.pitch)) ? Number(camera.pitch) : null,
    cameraHfov: camera && Number.isFinite(Number(camera.horizontalFov)) ? Number(camera.horizontalFov) : null,
    fovLimitation: STREET360_FOV_LIMITATION,
    notOpticallyMatched: STREET360_NOT_OPTICALLY_MATCHED,
    heightLimitation: STREET360_HEIGHT_LIMITATION,
    fakeImagery: false,
    losClaim: false,
    opticallyMatched: false,
    heightMatched: false
  });
}

export function selectionMustNotMutate(before, after) {
  if (!before || !after) return false;
  return before.longitude === after.longitude
    && before.latitude === after.latitude
    && before.heading === after.heading
    && before.pitch === after.pitch
    && before.heightAboveGround === after.heightAboveGround
    && before.horizontalFov === after.horizontalFov;
}
