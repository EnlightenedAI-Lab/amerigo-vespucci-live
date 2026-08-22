/**
 * Tiny proof catalog. Generic Camera is the product default.
 * Real models: official Axis Communications specifications only.
 * No harvested bulk catalog. No invented sensor millimetre sizes.
 */

export const FOV_METHOD = Object.freeze({
  OPERATOR_AUTHORED: 'OPERATOR_AUTHORED_FOV',
  VERIFIED_SPEC: 'FROM_VERIFIED_CAMERA_SPEC',
  VERIFIED_SPEC_INTERPOLATED: 'CALCULATED_FROM_VERIFIED_CAMERA_SPEC'
});

export const GENERIC_MODEL_ID = 'generic';

export const CAMERA_CATALOG = Object.freeze([
  Object.freeze({
    modelId: GENERIC_MODEL_ID,
    name: 'Generic Camera',
    manufacturer: 'OPERATOR',
    kind: 'GENERIC',
    fovMethod: FOV_METHOD.OPERATOR_AUTHORED,
    defaultHorizontalFov: 60,
    minHorizontalFov: 10,
    maxHorizontalFov: 120,
    defaultVerticalFov: null,
    assumedAspect: 16 / 9,
    resolution: null,
    focalMm: null,
    zoom: null,
    sensorFormatInches: null,
    sourceUrl: null,
    sourceLabel: 'Operator-authored FOV. Not a manufacturer specification.',
    notes: 'Resolution optional. DORI blocked until a resolution is authored.'
  }),
  Object.freeze({
    modelId: 'axis-m3085-v',
    name: 'AXIS M3085-V',
    manufacturer: 'Axis Communications',
    kind: 'REAL',
    fovMethod: FOV_METHOD.VERIFIED_SPEC,
    defaultHorizontalFov: 102,
    defaultVerticalFov: 55,
    minHorizontalFov: 102,
    maxHorizontalFov: 102,
    minVerticalFov: 55,
    maxVerticalFov: 55,
    resolution: Object.freeze({ width: 1920, height: 1080 }),
    focalMm: Object.freeze({ wide: 3.1, tele: 3.1 }),
    zoom: null,
    sensorFormatInches: '1/2.9"',
    sourceUrl: 'https://www.axis.com/products/axis-m3085-v',
    sourceLabel: 'Axis Communications product specification (official).',
    notes: 'Fixed 3.1 mm lens. Max video resolution 1920×1080. HFOV 102°. VFOV 55°.'
  }),
  Object.freeze({
    modelId: 'axis-p3265-lve-9mm',
    name: 'AXIS P3265-LVE 9 mm',
    manufacturer: 'Axis Communications',
    kind: 'REAL',
    fovMethod: FOV_METHOD.VERIFIED_SPEC_INTERPOLATED,
    defaultHorizontalFov: 100,
    defaultVerticalFov: 53,
    minHorizontalFov: 36,
    maxHorizontalFov: 100,
    minVerticalFov: 20,
    maxVerticalFov: 53,
    resolution: Object.freeze({ width: 1920, height: 1080 }),
    focalMm: Object.freeze({ wide: 3.4, tele: 8.9 }),
    zoom: Object.freeze({ min: 0, max: 1, default: 0 }),
    sensorFormatInches: '1/2.8"',
    sourceUrl: 'https://www.axis.com/products/axis-p3265-lve',
    sourceLabel: 'Axis Communications product specification / datasheet (official).',
    notes: 'Varifocal 3.4–8.9 mm. Published HFOV 100°–36°. Published VFOV 53°–20°. Resolution 1920×1080. Zoom interpolates official endpoints with a pinhole model.'
  }),
  Object.freeze({
    modelId: 'axis-q1656',
    name: 'AXIS Q1656',
    manufacturer: 'Axis Communications',
    kind: 'REAL',
    fovMethod: FOV_METHOD.VERIFIED_SPEC_INTERPOLATED,
    defaultHorizontalFov: 120,
    defaultVerticalFov: 63,
    minHorizontalFov: 47,
    maxHorizontalFov: 120,
    minVerticalFov: 27,
    maxVerticalFov: 63,
    resolution: Object.freeze({ width: 2688, height: 1512 }),
    focalMm: Object.freeze({ wide: 3.9, tele: 10 }),
    zoom: Object.freeze({ min: 0, max: 1, default: 0 }),
    sensorFormatInches: '1/1.8"',
    sourceUrl: 'https://www.axis.com/products/axis-q1656',
    sourceLabel: 'Axis Communications product specification / datasheet (official).',
    notes: 'Varifocal 3.9–10 mm. Published HFOV 120°–47°. Published VFOV 63°–27°. Max video resolution 2688×1512. Zoom interpolates official endpoints with a pinhole model.'
  })
]);

export function listCameraModels() {
  return CAMERA_CATALOG.slice();
}

export function getCameraModel(modelId) {
  return CAMERA_CATALOG.find((item) => item.modelId === modelId) || null;
}

export function isGenericModel(modelId) {
  return !modelId || modelId === GENERIC_MODEL_ID;
}

export function isRealModel(modelId) {
  const model = getCameraModel(modelId);
  return Boolean(model && model.kind === 'REAL');
}
