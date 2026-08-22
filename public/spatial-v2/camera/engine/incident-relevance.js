/**
 * 2D plan-view incident relevance.
 * Nearby ≠ facing ≠ FOV intersection ≠ visibility ≠ observation.
 */

import { geodesicMeters, headingFromPoints, wrapHeading } from './geodesy.js';
import {
  RELEVANCE_FILTER,
  RELEVANCE_SORT,
  formatCompassHeading,
  formatViewDelta,
  signedHeadingDelta
} from './relevance-constants.js';
import {
  PIXEL_DENSITY_DESIGN_ESTIMATE,
  PIXEL_DENSITY_UNKNOWN,
  DESIGN_BAND_UNKNOWN,
  evaluateTargetDesign
} from './dori.js';

export const REASON = Object.freeze({
  NEARBY: 'NEARBY',
  OUTSIDE_RADIUS: 'OUTSIDE_RADIUS',
  HEADING_TOWARD_POINT: 'HEADING_TOWARD_POINT',
  FACES_AWAY: 'FACES_AWAY',
  HORIZONTAL_FOV_INTERSECTS: 'HORIZONTAL_FOV_INTERSECTS',
  OUTSIDE_HORIZONTAL_FOV: 'OUTSIDE_HORIZONTAL_FOV',
  PLANNED_GEOMETRIC_FOV_INTERSECTS: 'PLANNED_GEOMETRIC_FOV_INTERSECTS',
  SELECTED_BY_OPERATOR: 'SELECTED_BY_OPERATOR',
  REPRESENTATION_AVAILABLE: 'REPRESENTATION_AVAILABLE',
  VISIBILITY_NOT_TESTED: 'VISIBILITY_NOT_TESTED',
  PLANNED_AIM: 'PLANNED AIM'
});

export const VISIBILITY_NOT_TESTED = 'VISIBILITY NOT TESTED';
export const PLAN_DISTANCE = 'PLAN DISTANCE';
export const HISTORICAL_CAMERA_STATE_NOT_VERIFIED = 'HISTORICAL CAMERA STATE NOT VERIFIED';
export const PIXEL_DENSITY_DESIGN_RANGE = 'PIXEL-DENSITY DESIGN RANGE';
export const PLANNING_GEOMETRY = 'PLANNING GEOMETRY';
export { PIXEL_DENSITY_DESIGN_ESTIMATE, PIXEL_DENSITY_UNKNOWN, DESIGN_BAND_UNKNOWN };

const FRONT_HEMISPHERE_DEG = 90;

export function planDistanceMeters(camera, point) {
  return geodesicMeters(camera, point);
}

export function targetBearingDeg(camera, point) {
  return headingFromPoints(camera, point);
}

export function headingDeltaToPoint(cameraHeading, bearingDeg) {
  return signedHeadingDelta(cameraHeading, bearingDeg);
}

export function pointInHorizontalFov(deltaDeg, horizontalFovDeg) {
  const half = Number(horizontalFovDeg) / 2;
  const delta = Number(deltaDeg);
  if (!Number.isFinite(half) || !(half > 0) || !Number.isFinite(delta)) return false;
  return Math.abs(delta) <= half + 1e-9;
}

export function headingTowardPoint(deltaDeg) {
  return Number.isFinite(Number(deltaDeg)) && Math.abs(Number(deltaDeg)) <= FRONT_HEMISPHERE_DEG + 1e-9;
}

function formatMeters(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function evaluateCameraRelevance(camera, incident, options = {}) {
  const point = incident?.point || incident;
  const radiusM = Number(options.radiusM);
  const selected = Boolean(options.selectedCameraRef && camera?.cameraId === options.selectedCameraRef);
  const distanceM = planDistanceMeters(camera, point);
  const bearingDeg = (camera && point) ? targetBearingDeg(camera, point) : null;
  const deltaDeg = (bearingDeg != null && Number.isFinite(Number(camera?.heading)))
    ? headingDeltaToPoint(camera.heading, bearingDeg)
    : null;
  const nearby = Number.isFinite(distanceM) && Number.isFinite(radiusM) && distanceM <= radiusM;
  const toward = headingTowardPoint(deltaDeg);
  const fovIntersects = pointInHorizontalFov(deltaDeg, camera?.horizontalFov);
  const planned = camera?.planned === true || camera?.simulated === true || camera?.qualification === 'PLANNING_ONLY';
  const reasons = [];
  const missing = [];
  if (nearby) reasons.push(REASON.NEARBY);
  else missing.push(REASON.OUTSIDE_RADIUS);
  if (toward) reasons.push(REASON.HEADING_TOWARD_POINT);
  else missing.push(REASON.FACES_AWAY);
  if (fovIntersects) {
    reasons.push(REASON.HORIZONTAL_FOV_INTERSECTS);
    if (planned) reasons.push(REASON.PLANNED_GEOMETRIC_FOV_INTERSECTS);
  } else missing.push(REASON.OUTSIDE_HORIZONTAL_FOV);
  if (selected) reasons.push(REASON.SELECTED_BY_OPERATOR);
  if ((options.aimedCameraRefs || []).includes(camera?.cameraId)) reasons.push(REASON.PLANNED_AIM);
  reasons.push(REASON.REPRESENTATION_AVAILABLE);
  reasons.push(REASON.VISIBILITY_NOT_TESTED);

  const relevant = Boolean(nearby && (fovIntersects || selected));
  const checks = [
    { ok: nearby, label: nearby ? `WITHIN ${radiusM} m` : `OUTSIDE ${radiusM} m` },
    { ok: toward, label: toward ? 'FACING TOWARD POINT' : 'CAMERA FACES AWAY' },
    { ok: fovIntersects, label: fovIntersects
      ? (planned ? 'PLANNED GEOMETRIC FOV INTERSECTS' : 'HORIZONTAL FOV INTERSECTS')
      : 'FOV DOES NOT INTERSECT' }
  ];
  const resolutionWidth = camera?.resolution?.width ?? camera?.dori?.resolution?.width ?? null;
  const targetDesign = evaluateTargetDesign({
    resolutionWidth,
    horizontalFov: camera?.horizontalFov,
    distanceMeters: distanceM
  });

  return Object.freeze({
    cameraRef: camera?.cameraId || null,
    modelName: camera?.modelName || camera?.modelId || null,
    qualification: planned ? (camera.planningLabel || 'PLANNED') : 'AUTHORED · NOT INSTALLED',
    planned,
    planDistanceM: distanceM,
    planDistanceLabel: `${PLAN_DISTANCE} ${formatMeters(distanceM)}`,
    targetDistanceLabel: Number.isFinite(distanceM) ? `TARGET ${formatMeters(distanceM)}` : 'TARGET —',
    cameraHeading: Number.isFinite(Number(camera?.heading)) ? wrapHeading(camera.heading) : null,
    cameraHeadingLabel: formatCompassHeading(camera?.heading),
    targetBearingDeg: bearingDeg,
    targetBearingLabel: bearingDeg == null ? '—' : formatCompassHeading(bearingDeg),
    deltaDeg,
    deltaLabel: formatViewDelta(deltaDeg),
    nearby,
    headingToward: toward,
    fovIntersects,
    relevant,
    reasons: Object.freeze(reasons),
    missing: Object.freeze(missing),
    checks: Object.freeze(checks),
    limitations: Object.freeze([
      VISIBILITY_NOT_TESTED,
      PIXEL_DENSITY_DESIGN_ESTIMATE,
      ...(incident?.requestedTime ? [HISTORICAL_CAMERA_STATE_NOT_VERIFIED] : []),
      ...(planned ? [PLANNING_GEOMETRY] : [])
    ]),
    targetDesign,
    pixelDensityPxPerM: targetDesign.pixelDensityPxPerM,
    pixelDensityLabel: targetDesign.pixelDensityLabel,
    designBand: targetDesign.designBand,
    designBandLabel: targetDesign.designBandLabel,
    doriContext: camera?.dori?.ranges
      ? Object.freeze({
        label: PIXEL_DENSITY_DESIGN_RANGE,
        identifyM: camera.dori.ranges.IDENTIFY,
        notObservation: true
      })
      : null,
    visibilityTested: false,
    observationClaim: false
  });
}

export function filterRelevanceResults(results = [], filter = RELEVANCE_FILTER.ALL) {
  if (filter === RELEVANCE_FILTER.NEARBY) return results.filter((item) => item.nearby);
  if (filter === RELEVANCE_FILTER.FOV_INTERSECTS) return results.filter((item) => item.fovIntersects);
  if (filter === RELEVANCE_FILTER.RELEVANT) return results.filter((item) => item.relevant);
  return results;
}

export function sortRelevanceResults(results = [], sort = RELEVANCE_SORT.DISTANCE) {
  const copy = [...results];
  if (sort === RELEVANCE_SORT.HEADING_ALIGNMENT) {
    copy.sort((a, b) => Math.abs(a.deltaDeg ?? 180) - Math.abs(b.deltaDeg ?? 180)
      || (a.planDistanceM ?? 1e12) - (b.planDistanceM ?? 1e12));
  } else {
    copy.sort((a, b) => (a.planDistanceM ?? 1e12) - (b.planDistanceM ?? 1e12));
  }
  return copy;
}

export function evaluateIncidentRelevance(cameras = [], incident, options = {}) {
  if (!incident?.point) {
    return Object.freeze({
      incident: null,
      radiusM: options.radiusM ?? null,
      results: Object.freeze([]),
      visible: Object.freeze([]),
      relevant: Object.freeze([])
    });
  }
  const evaluated = (cameras || []).map((camera) => evaluateCameraRelevance(camera, incident, options));
  const sorted = sortRelevanceResults(evaluated, options.sort);
  const visible = filterRelevanceResults(sorted, options.filter);
  return Object.freeze({
    incident,
    radiusM: options.radiusM,
    filter: options.filter || RELEVANCE_FILTER.ALL,
    sort: options.sort || RELEVANCE_SORT.DISTANCE,
    results: Object.freeze(sorted),
    visible: Object.freeze(visible),
    relevant: Object.freeze(sorted.filter((item) => item.relevant)),
    limitation: VISIBILITY_NOT_TESTED,
    honesty: '2D PLAN-VIEW GEOMETRY — NOT LOS — NOT REAL VISIBILITY — NOT OBSERVATION'
  });
}

export function relevantWallPlan(results = []) {
  const cameraIds = [...new Set((results || []).filter((item) => item.relevant).map((item) => item.cameraRef).filter(Boolean))];
  let layout = 1;
  if (cameraIds.length >= 2 && cameraIds.length <= 4) layout = 4;
  else if (cameraIds.length >= 5) layout = 9;
  return Object.freeze({
    cameraIds,
    layout,
    assigned: cameraIds.slice(0, layout === 1 ? 1 : layout),
    remainder: cameraIds.slice(layout === 1 ? 1 : layout),
    duplicates: cameraIds.length !== new Set(cameraIds).size
  });
}
