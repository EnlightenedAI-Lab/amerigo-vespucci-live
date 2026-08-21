/**
 * 360 visual coverage around FocusRef POINT.
 * Searches real Google Street360 / Mapillary capture positions.
 * Does not mint CameraRef. Does not mutate CameraPose. Does not claim LOS.
 */

import { destinationAlongHeading, geodesicMeters, headingFromPoints, wrapHeading } from './geodesy.js';
import { focusPointFromFocusRef } from './coverage-plan.js';
import { lookupGoogleStreetViewNear } from '../../map/google-street-view.js';
import {
  REPRESENTATION_KIND
} from './view-slot.js';
import {
  REPRESENTATION_TYPE,
  VISUAL_PROVIDER,
  createProviderRepresentation
} from '../provider/provider-representation.js';
import { classifyGoogleStreet360 } from '../provider/google-street360-representation.js';

export const VISUAL_COVERAGE_KIND = 'STREET_360_VIEWPOINT';
export const VISUAL_COVERAGE_LABEL = 'SELECTED STREET VIEWPOINTS';
export const VISUAL_COVERAGE_RADII_M = Object.freeze([60, 125, 250]);
export const VISUAL_COVERAGE_MAX_RADIUS_M = 250;
export const VISUAL_COVERAGE_RING_HEADINGS = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);
export const VISUAL_COVERAGE_DUP_METERS = 15;
export const VISUAL_COVERAGE_MIN_SEP_DEG = 55;
export const VISUAL_COVERAGE_RELAX_SEP_DEG = 35;
export const VISUAL_COVERAGE_MIN_CAPTURE_SEP_M = 28;
export const VISUAL_COVERAGE_RELAX_CAPTURE_SEP_M = 12;
export const VISUAL_COVERAGE_CAP = 3;
export const APPROACH_QUADRANTS = Object.freeze(['NORTH', 'EAST', 'SOUTH', 'WEST']);
export const VISUAL_COVERAGE_HONESTY = [
  'SELECTED STREET VIEWPOINTS',
  'PROVIDER REPRESENTATION',
  'NOT CAMERA FEED',
  'VIEW ORIENTED TOWARD TARGET',
  'VISIBILITY NOT TESTED',
  'NOT LOS'
].join(' · ');

let lastVisualCoverage = null;
let searching = false;
const listeners = new Set();
let lookups = {
  google: defaultGoogleLookup,
  mapillary: defaultMapillaryLookup
};

function emit() {
  const snapshot = lastVisualCoverage;
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

function uniqueCounts(pool = []) {
  const google = new Set();
  const mapillary = new Set();
  for (const item of pool) {
    if (!item?.providerId) continue;
    if (item.provider === VISUAL_PROVIDER.GOOGLE_STREET360) google.add(item.providerId);
    else if (item.provider === VISUAL_PROVIDER.MAPILLARY) mapillary.add(item.providerId);
  }
  return { googleCount: google.size, mapillaryCount: mapillary.size };
}

async function defaultGoogleLookup(point, radiusMeters) {
  return lookupGoogleStreetViewNear({
    longitude: point.longitude,
    latitude: point.latitude,
    radiusMeters
  });
}

async function defaultMapillaryLookup(point, radiusM) {
  const params = new URLSearchParams({
    lng: String(point.longitude),
    lat: String(point.latitude),
    radiusM: String(radiusM)
  });
  const res = await fetch(`/spatial-v2/api/camera-providers/mapillary?${params}`, { cache: 'no-store' });
  return res.json();
}

export function configureVisualCoverageLookups(next = {}) {
  lookups = { ...lookups, ...next };
}

export function resetVisualCoverageLookups() {
  lookups = {
    google: defaultGoogleLookup,
    mapillary: defaultMapillaryLookup
  };
}

export function getLastVisualCoverage() {
  return lastVisualCoverage;
}

export function isVisualCoverageSearching() {
  return searching === true;
}

export function subscribeVisualCoverage(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetVisualCoverageState({ emit: shouldEmit = true } = {}) {
  lastVisualCoverage = null;
  searching = false;
  if (shouldEmit) emit();
  return lastVisualCoverage;
}

export function angularSeparationDeg(a, b) {
  const delta = Math.abs(wrapHeading(a) - wrapHeading(b));
  return delta > 180 ? 360 - delta : delta;
}

export function isNearDuplicate(a, b, meters = VISUAL_COVERAGE_DUP_METERS) {
  if (!a || !b) return false;
  if (a.provider && b.provider && a.providerId && a.providerId === b.providerId) return true;
  const dist = geodesicMeters(a.captureCoordinate, b.captureCoordinate);
  return Number.isFinite(dist) && dist <= meters;
}

export function approachQuadrant(bearingDeg) {
  const bearing = wrapHeading(bearingDeg);
  if (bearing >= 315 || bearing < 45) return 'NORTH';
  if (bearing < 135) return 'EAST';
  if (bearing < 225) return 'SOUTH';
  return 'WEST';
}

export function summarizeApproaches(selected = []) {
  const approaches = [...new Set(
    selected
      .map((item) => approachQuadrant(item?.bearingFromTargetDeg))
      .filter((name) => APPROACH_QUADRANTS.includes(name))
  )];
  const views = selected.length;
  const approachCount = approaches.length;
  const coverageSummary = `${views} VIEW${views === 1 ? '' : 'S'} · ${approachCount} APPROACH${approachCount === 1 ? '' : 'ES'}`;
  const coverageLimitation = views > 1 && approachCount === 1
    ? `LIMITED STREET COVERAGE · ${views} CAPTURES · ${approaches[0]} APPROACH ONLY`
    : null;
  return Object.freeze({
    approaches: Object.freeze(approaches),
    approachCount,
    coverageSummary: coverageLimitation || coverageSummary,
    coverageLimitation
  });
}

function qualityRank(candidate) {
  const type = candidate.providerType || candidate.representationType;
  if (candidate.provider === VISUAL_PROVIDER.GOOGLE_STREET360) return 0;
  if (type === REPRESENTATION_TYPE.PANORAMA_360 || candidate.isPano === true) return 1;
  return 2;
}

export function selectDiverseViewpoints(candidates = [], cap = VISUAL_COVERAGE_CAP, options = {}) {
  const minSep = Number(options.minSepDeg) > 0 ? Number(options.minSepDeg) : VISUAL_COVERAGE_MIN_SEP_DEG;
  const relaxSep = Number(options.relaxSepDeg) > 0 ? Number(options.relaxSepDeg) : VISUAL_COVERAGE_RELAX_SEP_DEG;
  const minSepM = Number(options.minCaptureSepM) > 0 ? Number(options.minCaptureSepM) : VISUAL_COVERAGE_MIN_CAPTURE_SEP_M;
  const relaxSepM = Number(options.relaxCaptureSepM) > 0 ? Number(options.relaxCaptureSepM) : VISUAL_COVERAGE_RELAX_CAPTURE_SEP_M;
  const dupM = Number(options.dupMeters) > 0 ? Number(options.dupMeters) : VISUAL_COVERAGE_DUP_METERS;
  const unique = [];
  const ranked = [...candidates]
    .filter((item) => item?.providerId && item?.captureCoordinate)
    .sort((a, b) => {
      const q = qualityRank(a) - qualityRank(b);
      if (q !== 0) return q;
      return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity);
    });
  for (const item of ranked) {
    if (unique.some((other) => isNearDuplicate(item, other, dupM))) continue;
    unique.push(item);
  }
  const selected = [];
  if (!unique.length) return Object.freeze([]);
  selected.push(unique.shift());

  function minCaptureDist(item, picks) {
    const distances = picks
      .map((pick) => geodesicMeters(pick.captureCoordinate, item.captureCoordinate))
      .filter((meters) => Number.isFinite(meters));
    return distances.length ? Math.min(...distances) : Infinity;
  }

  function scoreItem(item, floorDeg, floorM) {
    const minAng = Math.min(
      ...selected.map((pick) => angularSeparationDeg(pick.bearingFromTargetDeg, item.bearingFromTargetDeg))
    );
    const minDist = minCaptureDist(item, selected);
    if (minAng < floorDeg) return null;
    if (minDist < floorM) return null;
    const occupied = new Set(selected.map((pick) => approachQuadrant(pick.bearingFromTargetDeg)));
    const approachBonus = occupied.has(approachQuadrant(item.bearingFromTargetDeg)) ? 0 : 45;
    return minAng + Math.min(minDist, 90) / 2 + approachBonus - ((item.distanceM || 0) / 20);
  }

  function bestByDiversity(floorDeg, floorM) {
    let best = null;
    let bestScore = -Infinity;
    for (const item of unique) {
      const score = scoreItem(item, floorDeg, floorM);
      if (score == null) continue;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  while (selected.length < cap && unique.length) {
    const next = bestByDiversity(minSep, minSepM)
      || bestByDiversity(relaxSep, minSepM)
      || bestByDiversity(relaxSep, relaxSepM)
      || unique[0];
    if (!next) break;
    selected.push(next);
    unique.splice(unique.indexOf(next), 1);
  }
  return Object.freeze(selected.slice(0, cap));
}

export function viewpointId(index) {
  return `view-360-${String(index + 1).padStart(2, '0')}`;
}

function samplePoints(target, radiusM) {
  const ring = radiusM * 0.55;
  const points = [{ ...target, sample: 'TARGET' }];
  for (const heading of VISUAL_COVERAGE_RING_HEADINGS) {
    const pose = destinationAlongHeading(target, heading, ring);
    if (pose) points.push({ ...pose, sample: `RING_${heading}` });
  }
  return points;
}

function fromGoogleLookup(lookup, target, radiusM) {
  if (!lookup?.available || !lookup.panoId || !lookup.captureCoordinate) return null;
  const capture = lookup.captureCoordinate;
  const distanceM = geodesicMeters(target, capture);
  if (!Number.isFinite(distanceM) || distanceM > radiusM + 1) return null;
  const bearingFromTargetDeg = wrapHeading(headingFromPoints(target, capture));
  const viewHeadingTowardTarget = wrapHeading(headingFromPoints(capture, target));
  const classified = classifyGoogleStreet360({
    ...lookup,
    heading: viewHeadingTowardTarget
  }, target);
  if (!classified?.providerId) return null;
  return Object.freeze({
    kind: VISUAL_COVERAGE_KIND,
    provider: VISUAL_PROVIDER.GOOGLE_STREET360,
    providerId: String(lookup.panoId),
    providerType: REPRESENTATION_TYPE.STREET360,
    isPano: true,
    captureCoordinate: Object.freeze({ ...capture }),
    captureDate: lookup.imageDate ? String(lookup.imageDate) : null,
    distanceM,
    bearingFromTargetDeg,
    viewHeadingTowardTarget,
    searchRadiusM: radiusM,
    representation: Object.freeze({
      ...classified,
      compassDeg: viewHeadingTowardTarget,
      cameraCoordinate: Object.freeze({ ...capture })
    }),
    cameraRef: null,
    mutatesCameraPose: false,
    visibilityTested: false,
    observationClaim: false
  });
}

function fromMapillaryItem(item, target, radiusM) {
  if (!item?.providerId || !item.captureCoordinate) return null;
  const capture = item.captureCoordinate;
  const distanceM = geodesicMeters(target, capture);
  if (!Number.isFinite(distanceM) || distanceM > radiusM + 1) return null;
  const bearingFromTargetDeg = wrapHeading(headingFromPoints(target, capture));
  const viewHeadingTowardTarget = wrapHeading(headingFromPoints(capture, target));
  const representation = createProviderRepresentation({
    ...item,
    compassDeg: viewHeadingTowardTarget,
    cameraCoordinate: Object.freeze({ ...capture }),
    distanceMeters: distanceM
  });
  return Object.freeze({
    kind: VISUAL_COVERAGE_KIND,
    provider: VISUAL_PROVIDER.MAPILLARY,
    providerId: String(item.providerId),
    providerType: item.representationType || (item.isPano ? REPRESENTATION_TYPE.PANORAMA_360 : REPRESENTATION_TYPE.STREET_IMAGE),
    isPano: item.isPano === true,
    captureCoordinate: Object.freeze({ ...capture }),
    captureDate: item.capturedAt || item.capturedAtIso || null,
    distanceM,
    bearingFromTargetDeg,
    viewHeadingTowardTarget,
    searchRadiusM: radiusM,
    representation,
    cameraRef: null,
    mutatesCameraPose: false,
    visibilityTested: false,
    observationClaim: false
  });
}

function finalizeSelected(selected) {
  return Object.freeze(selected.map((item, index) => Object.freeze({
    ...item,
    viewpointId: viewpointId(index),
    label: `360 VIEW ${String(index + 1).padStart(2, '0')}`,
    representationKind: item.provider === VISUAL_PROVIDER.GOOGLE_STREET360
      ? REPRESENTATION_KIND.STREET360
      : REPRESENTATION_KIND.MAPILLARY
  })));
}

export function emptyVisualCoverage(reason, extras = {}) {
  lastVisualCoverage = Object.freeze({
    kind: 'VISUAL_COVERAGE',
    ok: false,
    reason: reason || 'NO_TARGET',
    label: VISUAL_COVERAGE_LABEL,
    selected: Object.freeze([]),
    candidates: Object.freeze([]),
    googleCount: 0,
    mapillaryCount: 0,
    chosenRadiusM: extras.chosenRadiusM ?? null,
    searchedRadiiM: Object.freeze(extras.searchedRadiiM || []),
    maxRadiusM: VISUAL_COVERAGE_MAX_RADIUS_M,
    target: extras.target || null,
    mutatesCameraPose: false,
    visibilityTested: false,
    observationClaim: false,
    mintsCameraRef: false,
    honesty: VISUAL_COVERAGE_HONESTY,
    approaches: Object.freeze([]),
    approachCount: 0,
    coverageSummary: '0 VIEWS · 0 APPROACHES',
    coverageLimitation: null,
    emptyMessage: extras.emptyMessage || (
      Number.isFinite(Number(extras.chosenRadiusM || extras.maxRadiusM))
        ? `NO STREET 360 REPRESENTATION FOUND WITHIN ${extras.chosenRadiusM || VISUAL_COVERAGE_MAX_RADIUS_M} m`
        : 'NO STREET 360 REPRESENTATION FOUND'
    )
  });
  emit();
  return lastVisualCoverage;
}

function coverageSnapshot(fields) {
  const selected = fields.selected || Object.freeze([]);
  const approaches = summarizeApproaches(selected);
  lastVisualCoverage = Object.freeze({
    kind: 'VISUAL_COVERAGE',
    ok: true,
    label: VISUAL_COVERAGE_LABEL,
    mutatesCameraPose: false,
    visibilityTested: false,
    observationClaim: false,
    mintsCameraRef: false,
    honesty: VISUAL_COVERAGE_HONESTY,
    emptyMessage: null,
    maxRadiusM: VISUAL_COVERAGE_MAX_RADIUS_M,
    ...fields,
    ...approaches
  });
  emit();
  return lastVisualCoverage;
}

export async function searchVisualCoverage(focusRef, options = {}) {
  searching = true;
  lastVisualCoverage = null;
  emit();
  try {
  const target = focusPointFromFocusRef(focusRef);
  if (!target) return emptyVisualCoverage('FOCUSREF_POINT_REQUIRED');
  const radii = Array.isArray(options.radiiM) && options.radiiM.length
    ? options.radiiM.map(Number).filter((n) => n > 0)
    : [...VISUAL_COVERAGE_RADII_M];
  const cap = Number(options.cap) > 0 ? Number(options.cap) : VISUAL_COVERAGE_CAP;
  const searched = [];
  const pool = [];
  let chosenRadiusM = radii[0] || VISUAL_COVERAGE_MAX_RADIUS_M;

  for (const radiusM of radii) {
    if (radiusM > VISUAL_COVERAGE_MAX_RADIUS_M && options.radiiM == null) break;
    searched.push(radiusM);
    chosenRadiusM = radiusM;
    const points = samplePoints(target, radiusM);
    const googleHits = await Promise.all(points.map(async (point) => {
      try {
        return await lookups.google(point, radiusM);
      } catch {
        return null;
      }
    }));
    for (const lookup of googleHits) {
      const candidate = fromGoogleLookup(lookup, target, radiusM);
      if (!candidate) continue;
      pool.push(candidate);
    }
    try {
      const mapillary = await lookups.mapillary(target, radiusM);
      const ranked = Array.isArray(mapillary?.ranked)
        ? mapillary.ranked
        : (mapillary?.selected ? [mapillary.selected] : []);
      for (const item of ranked) {
        const candidate = fromMapillaryItem(item, target, radiusM);
        if (!candidate) continue;
        pool.push(candidate);
      }
    } catch {
      /* Mapillary optional */
    }
    const selected = selectDiverseViewpoints(pool, cap, options);
    if (selected.length >= cap) {
      return coverageSnapshot({
        reason: null,
        selected: finalizeSelected(selected),
        candidates: Object.freeze(selectDiverseViewpoints(pool, Math.min(12, pool.length), { minSepDeg: 20 })),
        ...uniqueCounts(pool),
        chosenRadiusM,
        searchedRadiiM: Object.freeze(searched),
        target: Object.freeze({ ...target })
      });
    }
  }

  const selected = selectDiverseViewpoints(pool, cap, options);
  if (!selected.length) {
    return emptyVisualCoverage('NO_STREET_360_REPRESENTATION', {
      target: Object.freeze({ ...target }),
      chosenRadiusM,
      searchedRadiiM: searched,
      emptyMessage: `NO STREET 360 REPRESENTATION FOUND WITHIN ${chosenRadiusM} m`
    });
  }
  return coverageSnapshot({
    reason: selected.length < cap ? 'PARTIAL_VIEWPOINTS' : null,
    selected: finalizeSelected(selected),
    candidates: Object.freeze(pool.slice(0, 24)),
    ...uniqueCounts(pool),
    chosenRadiusM,
    searchedRadiiM: Object.freeze(searched),
    target: Object.freeze({ ...target })
  });
  } finally {
    searching = false;
    emit();
  }
}
