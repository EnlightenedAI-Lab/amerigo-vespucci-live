/**
 * Minimum Camera Freeze constants/helpers required by camera.query-relevant.
 * Lifted from incident-context (filters/radius) and sensor-remote (heading labels).
 * Not a lab store. Not a Camera lab pose store. Not a camera population.
 */

import { wrapHeading } from './geodesy.js';

export const DEFAULT_QUERY_RADIUS_M = 250;
export const QUERY_RADIUS_M = Object.freeze([100, 250, 500, 1000]);

export const RELEVANCE_FILTER = Object.freeze({
  ALL: 'ALL',
  RELEVANT: 'RELEVANT',
  FOV_INTERSECTS: 'FOV_INTERSECTS',
  NEARBY: 'NEARBY'
});

export const RELEVANCE_SORT = Object.freeze({
  DISTANCE: 'DISTANCE',
  HEADING_ALIGNMENT: 'HEADING_ALIGNMENT'
});

export const CAMERA_QUERY_CAPABILITY = 'camera.query-relevant';
export const CAMERA_POPULATION_SOURCE = 'public/spatial-v2/map/authored-cameras.js';
export const PLAN_GEOMETRY_HONESTY = '2D PLAN-VIEW GEOMETRY — NOT LOS — NOT REAL VISIBILITY — NOT OBSERVATION';
export const VISIBILITY_NOT_TESTED_LABEL = 'VISIBILITY NOT TESTED';

const CARDINALS = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

export function signedHeadingDelta(fromHeading, toHeading) {
  const from = wrapHeading(fromHeading);
  const to = wrapHeading(toHeading);
  return ((to - from + 540) % 360) - 180;
}

export function compassCardinal(heading) {
  const wrapped = wrapHeading(heading);
  return CARDINALS[Math.round(wrapped / 45) % 8];
}

export function formatCompassHeading(heading) {
  if (!Number.isFinite(Number(heading))) return '—';
  const wrapped = wrapHeading(heading);
  return `${Math.round(wrapped)}° ${compassCardinal(wrapped)}`;
}

export function formatViewDelta(deltaDeg) {
  if (!Number.isFinite(Number(deltaDeg))) return '—';
  const rounded = Math.round(Number(deltaDeg));
  if (rounded === 0) return '0°';
  if (Math.abs(rounded) === 180) return '180° BEHIND';
  const side = rounded > 0 ? 'RIGHT' : 'LEFT';
  const signed = rounded > 0 ? `+${rounded}` : `${rounded}`;
  return `${signed}° ${side}`;
}

export function resolveQueryRadiusM(meters) {
  const next = Number(meters);
  if (QUERY_RADIUS_M.includes(next)) return next;
  if (Number.isFinite(next) && next > 0) return next;
  return DEFAULT_QUERY_RADIUS_M;
}
