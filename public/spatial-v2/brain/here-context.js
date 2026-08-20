/**
 * Resolve HERE from operator-defined context. Map center is not HERE.
 * Incident / pin / selected point first. EO AOI only if its center is unambiguous.
 */

import { DEFAULT_PROOF_AOI } from '../imagery/eo/eo-aoi.js';

const DEFAULT_AOI_SOURCES = new Set([
  'DEFAULT AREA',
  'DEFAULT_MONTREAL',
  DEFAULT_PROOF_AOI.label,
  DEFAULT_PROOF_AOI.id
]);

const MAX_AOI_CONTEXT_M = 1500;

function finitePoint(value) {
  const longitude = Number(value?.longitude ?? value?.lng ?? value?.x);
  const latitude = Number(value?.latitude ?? value?.lat ?? value?.y);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function haversineMeters(lon1, lat1, lon2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6378137 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function aoiCenter(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const west = Number(bbox[0]);
  const south = Number(bbox[1]);
  const east = Number(bbox[2]);
  const north = Number(bbox[3]);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (east === west || north === south) return null;
  return {
    longitude: (west + east) / 2,
    latitude: (south + north) / 2,
    widthM: haversineMeters(west, (south + north) / 2, east, (south + north) / 2),
    heightM: haversineMeters((west + east) / 2, south, (west + east) / 2, north)
  };
}

function pointResult(kind, point, extra = {}) {
  return Object.freeze({
    ok: true,
    kind,
    longitude: point.longitude,
    latitude: point.latitude,
    label: extra.label || kind,
    source: extra.source || kind,
    message: extra.message || `HERE resolved from ${kind}.`
  });
}

function undefinedHere(message) {
  return Object.freeze({
    ok: false,
    code: 'HERE_UNDEFINED',
    kind: null,
    longitude: null,
    latitude: null,
    message: message || 'Define a location. Drop a pin or select a point. HERE is not map center.'
  });
}

export function unambiguousAoiCenter(aoi) {
  if (!aoi) return null;
  const source = String(aoi.source || aoi.label || aoi.id || '');
  if (DEFAULT_AOI_SOURCES.has(source) || aoi.default === true) return null;
  const center = aoiCenter(aoi.bbox || aoi.coordinates);
  if (!center) return null;
  if (center.widthM > MAX_AOI_CONTEXT_M || center.heightM > MAX_AOI_CONTEXT_M) return null;
  return center;
}

export function resolveHereContext(input = {}) {
  const incident = finitePoint(input.incident);
  if (incident) {
    return pointResult('INCIDENT', incident, { label: 'CURRENT INCIDENT', source: input.incident?.source || 'incident' });
  }
  const pin = finitePoint(input.pin || input.focus);
  if (pin) {
    return pointResult('PIN', pin, { label: 'OPERATOR PIN', source: input.pin?.source || input.focus?.source || 'drop-pin' });
  }
  const selected = finitePoint(input.selectedPoint || input.selection);
  if (selected) {
    return pointResult('SELECTED_POINT', selected, {
      label: 'SELECTED POINT',
      source: input.selectedPoint?.source || input.selection?.source || 'selection'
    });
  }
  const aoiCenterPoint = unambiguousAoiCenter(input.eoAoi || input.aoi);
  if (aoiCenterPoint) {
    return pointResult('EO_AOI', aoiCenterPoint, {
      label: 'EO AOI CENTER',
      source: input.eoAoi?.source || input.aoi?.source || 'eo-aoi',
      message: 'HERE resolved from an unambiguous EO AOI center.'
    });
  }
  return undefinedHere();
}
