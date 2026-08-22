/**
 * Resolve HFOV / VFOV from Generic Camera operator input or verified specs.
 * Does not invent sensor millimetre sizes. Sensor format strings stay labels.
 */

import { clamp } from './geodesy.js';
import { FOV_METHOD, GENERIC_MODEL_ID, getCameraModel, isGenericModel } from './catalog.js';

export function verticalFovFromHorizontal(horizontalFov, aspect = 16 / 9) {
  const h = Number(horizontalFov) * Math.PI / 180;
  if (!Number.isFinite(h) || !(aspect > 0)) return null;
  return (2 * Math.atan(Math.tan(h / 2) / aspect)) * 180 / Math.PI;
}

export function interpolateOfficialFov(wideDeg, teleDeg, zoom01) {
  const wide = Number(wideDeg);
  const tele = Number(teleDeg);
  const t = clamp(zoom01, 0, 1, 0);
  if (!Number.isFinite(wide) || !Number.isFinite(tele)) return null;
  if (t === 0) return wide;
  if (t === 1) return tele;
  const a = Math.tan((wide * Math.PI) / 360);
  const b = Math.tan((tele * Math.PI) / 360);
  return (2 * Math.atan(a + t * (b - a))) * 180 / Math.PI;
}

export function coverageWidthMeters(distanceMeters, horizontalFovDeg) {
  const distance = Number(distanceMeters);
  const fov = Number(horizontalFovDeg) * Math.PI / 180;
  if (!(distance > 0) || !Number.isFinite(fov)) return null;
  return 2 * distance * Math.tan(fov / 2);
}

export function pixelDensityPerMeter(resolutionWidth, distanceMeters, horizontalFovDeg) {
  const widthPx = Number(resolutionWidth);
  const coverage = coverageWidthMeters(distanceMeters, horizontalFovDeg);
  if (!(widthPx > 0) || !(coverage > 0)) return null;
  return widthPx / coverage;
}

export function resolveOptics(input = {}) {
  const model = getCameraModel(input.modelId) || getCameraModel(GENERIC_MODEL_ID);
  const generic = isGenericModel(model.modelId);
  const zoom = model.zoom ? clamp(input.zoom, 0, 1, model.zoom.default) : 0;

  if (generic) {
    const horizontalFov = clamp(
      input.horizontalFov,
      model.minHorizontalFov,
      model.maxHorizontalFov,
      model.defaultHorizontalFov
    );
    const aspect = Number(input.aspect) > 0 ? Number(input.aspect) : model.assumedAspect;
    const operatorWidth = Number(input.resolutionWidth);
    const operatorHeight = Number(input.resolutionHeight);
    const hasResolution = operatorWidth > 0 && operatorHeight > 0;
    const verticalFov = verticalFovFromHorizontal(horizontalFov, aspect);
    return Object.freeze({
      modelId: model.modelId,
      modelName: model.name,
      kind: model.kind,
      zoom: null,
      horizontalFov,
      verticalFov,
      fovMethod: FOV_METHOD.OPERATOR_AUTHORED,
      fovLabel: 'OPERATOR-AUTHORED FOV',
      verticalFovLabel: 'DERIVED FROM OPERATOR HFOV AND ASSUMED 16:9 ASPECT — NOT SENSOR SPEC',
      resolution: hasResolution
        ? Object.freeze({ width: Math.round(operatorWidth), height: Math.round(operatorHeight) })
        : null,
      resolutionSource: hasResolution ? 'OPERATOR_AUTHORED' : 'NONE',
      sourceUrl: null,
      sourceLabel: model.sourceLabel
    });
  }

  const hasZoom = Boolean(model.zoom);
  const horizontalFov = hasZoom
    ? interpolateOfficialFov(model.maxHorizontalFov, model.minHorizontalFov, zoom)
    : model.defaultHorizontalFov;
  const verticalFov = hasZoom
    ? interpolateOfficialFov(model.maxVerticalFov, model.minVerticalFov, zoom)
    : model.defaultVerticalFov;

  return Object.freeze({
    modelId: model.modelId,
    modelName: model.name,
    kind: model.kind,
    zoom: hasZoom ? zoom : null,
    horizontalFov,
    verticalFov,
    fovMethod: hasZoom ? FOV_METHOD.VERIFIED_SPEC_INTERPOLATED : FOV_METHOD.VERIFIED_SPEC,
    fovLabel: hasZoom ? 'CALCULATED FROM VERIFIED CAMERA SPEC' : 'FROM VERIFIED CAMERA SPEC',
    verticalFovLabel: hasZoom ? 'CALCULATED FROM VERIFIED CAMERA SPEC' : 'FROM VERIFIED CAMERA SPEC',
    resolution: model.resolution,
    resolutionSource: 'VERIFIED_SPEC',
    sourceUrl: model.sourceUrl,
    sourceLabel: model.sourceLabel
  });
}
