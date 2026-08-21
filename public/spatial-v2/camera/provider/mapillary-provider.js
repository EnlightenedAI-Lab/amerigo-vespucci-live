/**
 * Mapillary nearby-image query builder and honest classification.
 * Official Graph API only. Does not scrape mapillary.com. Does not hold tokens.
 */

import { geodesicMeters } from '../engine/geodesy.js';
import {
  CURRENTNESS,
  REPRESENTATION_TYPE,
  VISUAL_PROVIDER,
  createProviderRepresentation
} from './provider-representation.js';

export const MAPILLARY_IMAGES_URL = 'https://graph.mapillary.com/images';
export const MAPILLARY_MAX_BBOX_AREA_DEG2 = 0.01;
export const MAPILLARY_DEFAULT_RADIUS_M = 120;
export const MAPILLARY_WALL_RADIUS_M = Object.freeze([120, 250, 400]);
export const MAPILLARY_FIELDS = 'id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,is_pano,camera_type,thumb_1024_url,thumb_2048_url';

const METERS_PER_DEG_LAT = 111320;

export function mapillaryBboxFromTarget(latitude, longitude, radiusM) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const radius = Math.max(20, Number(radiusM) || MAPILLARY_DEFAULT_RADIUS_M);
  const degLat = radius / METERS_PER_DEG_LAT;
  const degLng = radius / (METERS_PER_DEG_LAT * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  let minLon = lng - degLng;
  let maxLon = lng + degLng;
  let minLat = lat - degLat;
  let maxLat = lat + degLat;
  let area = (maxLon - minLon) * (maxLat - minLat);
  if (area >= MAPILLARY_MAX_BBOX_AREA_DEG2) {
    const scale = Math.sqrt((MAPILLARY_MAX_BBOX_AREA_DEG2 * 0.98) / area);
    const midLon = (minLon + maxLon) / 2;
    const midLat = (minLat + maxLat) / 2;
    const halfLon = ((maxLon - minLon) / 2) * scale;
    const halfLat = ((maxLat - minLat) / 2) * scale;
    minLon = midLon - halfLon;
    maxLon = midLon + halfLon;
    minLat = midLat - halfLat;
    maxLat = midLat + halfLat;
    area = (maxLon - minLon) * (maxLat - minLat);
  }
  return Object.freeze({
    minLon,
    minLat,
    maxLon,
    maxLat,
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    radiusM: radius,
    areaDeg2: area
  });
}

export function buildMapillaryNearbyRequest(input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const radiusM = Number(input.radiusM) > 0 ? Number(input.radiusM) : MAPILLARY_DEFAULT_RADIUS_M;
  const box = mapillaryBboxFromTarget(latitude, longitude, radiusM);
  const query = Object.freeze({
    bbox: box.bbox,
    fields: MAPILLARY_FIELDS,
    limit: Number.isFinite(Number(input.limit)) ? Number(input.limit) : 50
  });
  const search = new URLSearchParams({
    bbox: query.bbox,
    fields: query.fields,
    limit: String(query.limit)
  });
  return Object.freeze({
    method: 'GET',
    url: `${MAPILLARY_IMAGES_URL}?${search.toString()}`,
    endpoint: MAPILLARY_IMAGES_URL,
    query,
    bbox: box,
    target: Object.freeze({ latitude, longitude }),
    auth: Object.freeze({
      queryParam: 'access_token',
      header: 'Authorization',
      envName: 'MAPILLARY_ACCESS_TOKEN',
      hardcoded: false
    })
  });
}

function imageCoordinate(image = {}) {
  const computed = image.computed_geometry?.coordinates;
  const raw = image.geometry?.coordinates;
  const pair = Array.isArray(computed) && computed.length >= 2 ? computed : raw;
  if (!Array.isArray(pair) || pair.length < 2) return null;
  return { longitude: Number(pair[0]), latitude: Number(pair[1]) };
}

export function formatMapillaryCaptureDate(capturedAt) {
  const instant = formatMapillaryCaptureInstant(capturedAt);
  return instant ? instant.slice(0, 10) : null;
}

export function formatMapillaryCaptureInstant(capturedAt) {
  if (capturedAt == null || capturedAt === '') return null;
  const numeric = Number(capturedAt);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(String(capturedAt));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function classifyMapillaryImage(image = {}, context = {}) {
  const cameraCoordinate = context.cameraCoordinate || context.targetCoordinate || null;
  const captureCoordinate = imageCoordinate(image);
  const capturedDate = formatMapillaryCaptureDate(image.captured_at);
  const capturedAtIso = formatMapillaryCaptureInstant(image.captured_at);
  const isPano = image.is_pano === true || String(image.camera_type || '').toLowerCase().includes('pano');
  const compass = Number.isFinite(Number(image.computed_compass_angle))
    ? Number(image.computed_compass_angle)
    : (Number.isFinite(Number(image.compass_angle)) ? Number(image.compass_angle) : null);
  const distanceMeters = cameraCoordinate && captureCoordinate
    ? geodesicMeters(cameraCoordinate, captureCoordinate)
    : null;
  const type = isPano ? REPRESENTATION_TYPE.PANORAMA_360 : REPRESENTATION_TYPE.STREET_IMAGE;
  const labels = [
    'MAPILLARY',
    isPano ? 'MAPILLARY 360' : 'MAPILLARY IMAGE',
    capturedDate ? `CAPTURED ${capturedDate}` : 'CAPTURE TIME UNKNOWN'
  ];
  return createProviderRepresentation({
    provider: VISUAL_PROVIDER.MAPILLARY,
    providerId: image.id ? String(image.id) : null,
    representationType: type,
    captureCoordinate,
    cameraCoordinate,
    distanceMeters,
    capturedAt: capturedDate,
    capturedAtIso,
    retrievedAt: context.retrievedAt || null,
    currentness: capturedDate ? CURRENTNESS.CAPTURED : CURRENTNESS.UNKNOWN,
    compassDeg: compass,
    isPano,
    thumbUrl: image.thumb_2048_url || image.thumb_1024_url || null,
    snapshotUrl: image.thumb_2048_url || image.thumb_1024_url || null,
    viewer: 'MAPILLARY_JS',
    status: isPano ? 'MAPILLARY 360' : 'MAPILLARY IMAGE',
    honesty: { currentnessUnknown: !capturedDate },
    labels,
    limitation: [
      isPano ? 'MAPILLARY 360' : 'MAPILLARY IMAGE',
      'Capture coordinate is not CameraPose',
      'PROVIDER REPRESENTATION',
      'NOT CAMERA FEED',
      'Not visibility proof'
    ].join(' · ')
  });
}

export function selectNearestMapillary(images = [], cameraCoordinate) {
  const classified = images.map((image) => classifyMapillaryImage(image, { cameraCoordinate }));
  const ranked = classified
    .filter((item) => item.providerId && item.captureCoordinate)
    .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  return Object.freeze({
    count: classified.length,
    selected: ranked[0] || null,
    ranked
  });
}
