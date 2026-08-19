/**
 * IQAI Spatial V2 — authoritative operator spatial focus.
 * Specialists consume this contract. They do not invent a location.
 */

import { getLocalDemoApiKey } from './agol-session.js';
import { describeCoordinates, formatDecimalDegrees } from './coordinate-formats.js';

export const SPATIAL_FOCUS_SOURCE_TYPE = Object.freeze({
  DROP_PIN: 'DROP_PIN'
});

export const SPATIAL_FOCUS_ADDRESS_STATE = Object.freeze({
  NONE: 'NONE',
  PENDING: 'PENDING',
  RESOLVED: 'RESOLVED',
  NOT_RESOLVED: 'NOT_RESOLVED'
});

export const ADDRESS_NOT_RESOLVED = 'ADDRESS NOT RESOLVED';

const listeners = new Set();
let focus = null;
let pointer = null;

function cloneFocus(value) {
  if (!value) return null;
  return {
    longitude: Number(value.longitude),
    latitude: Number(value.latitude),
    spatialReferenceWkid: 4326,
    sourceView: String(value.sourceView || 'map'),
    sourceType: SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN,
    source: 'drop-pin',
    updatedAt: value.updatedAt || new Date().toISOString(),
    resolvedAddress: value.resolvedAddress ?? null,
    addressState: value.addressState || SPATIAL_FOCUS_ADDRESS_STATE.NONE
  };
}

function emit() {
  const snapshot = getSpatialFocusSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI V2] spatial focus listener failed', error);
    }
  }
}

export function formatHemisphereDegrees(value, positive, negative, digits = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const hemisphere = number >= 0 ? positive : negative;
  return `${Math.abs(number).toFixed(digits)}° ${hemisphere}`;
}

export function formatLatitude(latitude, digits = 5) {
  return formatHemisphereDegrees(latitude, 'N', 'S', digits);
}

export function formatLongitude(longitude, digits = 5) {
  return formatHemisphereDegrees(longitude, 'E', 'W', digits);
}

export function formatLatitudeLongitude(latitude, longitude, digits = 5) {
  return formatDecimalDegrees(latitude, longitude, digits);
}

export function isDropPinFocus(point) {
  return Boolean(
    point
    && Number.isFinite(Number(point.longitude))
    && Number.isFinite(Number(point.latitude))
    && (
      point.sourceType === SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN
      || point.source === 'drop-pin'
    )
  );
}

export function getActiveSpatialFocus() {
  return cloneFocus(focus);
}

export function getPointerCoordinates() {
  if (!pointer) return null;
  return { longitude: pointer.longitude, latitude: pointer.latitude };
}

export function getSpatialFocusSnapshot() {
  const active = getActiveSpatialFocus();
  const pointerFormats = pointer
    ? describeCoordinates(pointer.latitude, pointer.longitude)
    : null;
  const focusFormats = active
    ? describeCoordinates(active.latitude, active.longitude, {
      place: active.resolvedAddress
    })
    : null;
  return {
    focus: active,
    pointer: getPointerCoordinates(),
    pointerText: pointerFormats?.dd || null,
    pointerFormats,
    focusFormats,
    receiptText: active
      ? [
          active.resolvedAddress || ADDRESS_NOT_RESOLVED,
          focusFormats?.dd,
          focusFormats?.dms,
          focusFormats?.utm,
          focusFormats?.mgrs
        ].filter(Boolean).join('\n')
      : null
  };
}

export function setPointerCoordinates(longitude, latitude) {
  if (longitude == null || latitude == null) {
    if (pointer) {
      pointer = null;
    }
    return null;
  }
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    if (pointer) {
      pointer = null;
    }
    return null;
  }
  pointer = { longitude: lon, latitude: lat };
  return getPointerCoordinates();
}

export function setActiveSpatialFocus(next) {
  if (!next) {
    focus = null;
    emit();
    return null;
  }
  const lon = Number(next.longitude);
  const lat = Number(next.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return getActiveSpatialFocus();
  focus = cloneFocus({
    ...next,
    longitude: lon,
    latitude: lat,
    updatedAt: next.updatedAt || new Date().toISOString()
  });
  emit();
  return getActiveSpatialFocus();
}

export function subscribeSpatialFocus(listener) {
  listeners.add(listener);
  listener(getSpatialFocusSnapshot());
  return () => listeners.delete(listener);
}

const WORLD_GEOCODER_URL = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

function formatReverseAddress(address) {
  if (!address || typeof address !== 'object') return null;
  const match = String(
    address.Match_addr
    || address.LongLabel
    || address.ShortLabel
    || address.Address
    || ''
  ).trim();
  if (match) return match;
  const parts = [
    address.PlaceName,
    address.Neighborhood,
    address.City,
    address.RegionAbbr || address.Region
  ].filter((part) => String(part || '').trim());
  return parts.join(', ').trim() || null;
}

export async function reverseGeocodeFocus(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { ok: false, resolvedAddress: null };
  }
  const params = new URLSearchParams({
    f: 'json',
    location: `${lon},${lat}`,
    langCode: 'en',
    featureTypes: 'PointAddress,StreetAddress,StreetName,POI'
  });
  const apiKey = getLocalDemoApiKey();
  if (apiKey) params.set('token', apiKey);
  const geocodeRoot = apiKey
    ? 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer'
    : WORLD_GEOCODER_URL;
  try {
    const response = await fetch(`${geocodeRoot}/reverseGeocode?${params}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(() => ({}));
    const resolvedAddress = formatReverseAddress(data?.address);
    if (!resolvedAddress) return { ok: false, resolvedAddress: null };
    return { ok: true, resolvedAddress };
  } catch {
    return { ok: false, resolvedAddress: null };
  }
}
