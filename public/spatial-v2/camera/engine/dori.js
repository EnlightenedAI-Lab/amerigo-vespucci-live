/**
 * DORI-style ranges from EN 62676-4:2015 recommended pixel densities.
 * Geometric only: resolution × FOV × distance. No atmosphere, MTF, lighting, LOS.
 */

import { coverageWidthMeters, pixelDensityPerMeter } from './optics.js';

export const DORI_STANDARD = 'EN 62676-4:2015';

export const DORI_THRESHOLDS_PX_PER_M = Object.freeze({
  DETECT: 25,
  OBSERVE: 62.5,
  RECOGNIZE: 125,
  IDENTIFY: 250
});

export const DORI_STATUS = Object.freeze({
  QUALIFIED: 'QUALIFIED',
  BLOCKED: 'BLOCKED'
});

function rangeForThreshold(resolutionWidth, horizontalFovDeg, pxPerMeter) {
  const widthPx = Number(resolutionWidth);
  const fov = Number(horizontalFovDeg) * Math.PI / 180;
  const threshold = Number(pxPerMeter);
  if (!(widthPx > 0) || !Number.isFinite(fov) || !(threshold > 0)) return null;
  const tanHalf = Math.tan(fov / 2);
  if (!(tanHalf > 0)) return null;
  return widthPx / (2 * tanHalf * threshold);
}

export function evaluateDori(input = {}) {
  const widthPx = Number(input.resolutionWidth);
  const heightPx = Number(input.resolutionHeight);
  const horizontalFov = Number(input.horizontalFov);
  const blockedReason = !(widthPx > 0)
    ? 'DORI BLOCKED — no resolution. Geometric pixel density requires horizontal pixel count.'
    : !(horizontalFov > 0)
      ? 'DORI BLOCKED — no horizontal FOV.'
      : null;

  if (blockedReason) {
    return Object.freeze({
      status: DORI_STATUS.BLOCKED,
      standard: DORI_STANDARD,
      label: 'DORI = BLOCKED',
      reason: blockedReason,
      resolution: null,
      ranges: null,
      thresholds: DORI_THRESHOLDS_PX_PER_M,
      honesty: 'No real-world identification claim. Thresholds unused without resolution × FOV.'
    });
  }

  const ranges = Object.freeze({
    DETECT: rangeForThreshold(widthPx, horizontalFov, DORI_THRESHOLDS_PX_PER_M.DETECT),
    OBSERVE: rangeForThreshold(widthPx, horizontalFov, DORI_THRESHOLDS_PX_PER_M.OBSERVE),
    RECOGNIZE: rangeForThreshold(widthPx, horizontalFov, DORI_THRESHOLDS_PX_PER_M.RECOGNIZE),
    IDENTIFY: rangeForThreshold(widthPx, horizontalFov, DORI_THRESHOLDS_PX_PER_M.IDENTIFY)
  });

  return Object.freeze({
    status: DORI_STATUS.QUALIFIED,
    standard: DORI_STANDARD,
    label: 'DORI — EN 62676-4 PIXEL DENSITY (GEOMETRIC)',
    reason: null,
    resolution: Object.freeze({
      width: Math.round(widthPx),
      height: Number.isFinite(heightPx) && heightPx > 0 ? Math.round(heightPx) : null
    }),
    ranges,
    thresholds: DORI_THRESHOLDS_PX_PER_M,
    honesty: [
      'Geometric pixel density on a flat plane along the stated distance.',
      'Uses EN 62676-4:2015 recommended px/m thresholds.',
      'Not illumination, lens MTF, compression, atmosphere, or obstruction.',
      'Not a claim that a person would be identified in a real scene.'
    ].join(' ')
  });
}

export function densityAtDistance(input = {}) {
  return pixelDensityPerMeter(input.resolutionWidth, input.distanceMeters, input.horizontalFov);
}

export function widthAtDistance(input = {}) {
  return coverageWidthMeters(input.distanceMeters, input.horizontalFov);
}

export const DESIGN_BAND = Object.freeze({
  IDENTIFY: 'IDENTIFY',
  RECOGNIZE: 'RECOGNIZE',
  OBSERVE: 'OBSERVE',
  DETECT: 'DETECT',
  BELOW_DETECT: 'BELOW DETECT',
  UNKNOWN: 'UNKNOWN'
});

export const PIXEL_DENSITY_UNKNOWN = 'PIXEL DENSITY UNKNOWN';
export const DESIGN_BAND_UNKNOWN = 'DESIGN BAND UNKNOWN';
export const PIXEL_DENSITY_DESIGN_ESTIMATE = 'PIXEL-DENSITY DESIGN ESTIMATE';

const BAND_ORDER = Object.freeze([
  ['IDENTIFY', DORI_THRESHOLDS_PX_PER_M.IDENTIFY],
  ['RECOGNIZE', DORI_THRESHOLDS_PX_PER_M.RECOGNIZE],
  ['OBSERVE', DORI_THRESHOLDS_PX_PER_M.OBSERVE],
  ['DETECT', DORI_THRESHOLDS_PX_PER_M.DETECT]
]);

export function designBandForDensity(pxPerM) {
  if (pxPerM == null || pxPerM === '') return DESIGN_BAND.UNKNOWN;
  const density = Number(pxPerM);
  if (!Number.isFinite(density) || density < 0) return DESIGN_BAND.UNKNOWN;
  for (const [band, threshold] of BAND_ORDER) {
    if (density >= threshold) return DESIGN_BAND[band];
  }
  return DESIGN_BAND.BELOW_DETECT;
}

function formatPxPerM(pxPerM) {
  const density = Number(pxPerM);
  if (!Number.isFinite(density)) return null;
  if (density >= 10) return String(Math.round(density));
  return String(Math.round(density * 10) / 10);
}

export function evaluateTargetDesign(input = {}) {
  const distanceM = Number(input.distanceMeters);
  const widthPx = Number(input.resolutionWidth);
  const horizontalFov = Number(input.horizontalFov);
  const distanceOk = Number.isFinite(distanceM) && distanceM >= 0;
  const opticsOk = widthPx > 0 && Number.isFinite(horizontalFov) && horizontalFov > 0;
  if (!distanceOk || !opticsOk) {
    return Object.freeze({
      distanceM: distanceOk ? distanceM : null,
      pixelDensityPxPerM: null,
      designBand: DESIGN_BAND.UNKNOWN,
      pixelDensityLabel: PIXEL_DENSITY_UNKNOWN,
      designBandLabel: DESIGN_BAND_UNKNOWN,
      honesty: PIXEL_DENSITY_DESIGN_ESTIMATE,
      known: false,
      usesHeight: false
    });
  }
  const density = densityAtDistance({
    resolutionWidth: widthPx,
    distanceMeters: distanceM,
    horizontalFov
  });
  const known = Number.isFinite(density);
  const band = known ? designBandForDensity(density) : DESIGN_BAND.UNKNOWN;
  return Object.freeze({
    distanceM,
    pixelDensityPxPerM: known ? density : null,
    designBand: band,
    pixelDensityLabel: known
      ? `PIXEL DENSITY ${formatPxPerM(density)} px/m`
      : PIXEL_DENSITY_UNKNOWN,
    designBandLabel: known ? `DESIGN BAND: ${band}` : DESIGN_BAND_UNKNOWN,
    honesty: PIXEL_DENSITY_DESIGN_ESTIMATE,
    known,
    usesHeight: false
  });
}
