/**
 * Classify a Google Street View lookup as a provider representation.
 * Capture coordinate stays separate from planned CameraPose.
 */

import { STREET_360_SEARCH_RADIUS_METERS } from '../../map/google-street-view.js';
import {
  CURRENTNESS,
  REPRESENTATION_TYPE,
  VISUAL_PROVIDER,
  createProviderRepresentation
} from './provider-representation.js';

export function classifyGoogleStreet360(lookup = {}, cameraCoordinate = null) {
  const camera = cameraCoordinate || lookup.cameraCoordinate || null;
  const available = lookup.available === true && lookup.panoId;
  const capturedAt = lookup.imageDate ? String(lookup.imageDate) : null;
  if (!available) {
    return createProviderRepresentation({
      provider: VISUAL_PROVIDER.GOOGLE_STREET360,
      providerId: null,
      representationType: REPRESENTATION_TYPE.STREET360,
      cameraCoordinate: camera,
      captureCoordinate: lookup.captureCoordinate || null,
      distanceMeters: lookup.offsetMeters,
      status: lookup.status === 'INVALID_LOCATION' ? 'NONE' : 'NONE',
      labels: ['GOOGLE STREET360', 'REPRESENTATION NOT AVAILABLE'],
      limitation: 'No Street panorama near planned CameraPose',
      honesty: { currentnessUnknown: true }
    });
  }
  return createProviderRepresentation({
    provider: VISUAL_PROVIDER.GOOGLE_STREET360,
    providerId: String(lookup.panoId),
    representationType: REPRESENTATION_TYPE.STREET360,
    cameraCoordinate: camera,
    captureCoordinate: lookup.captureCoordinate,
    distanceMeters: lookup.offsetMeters,
    capturedAt,
    capturedAtIso: capturedAt && /^\d{4}-\d{2}/.test(capturedAt) ? capturedAt : null,
    currentness: capturedAt ? CURRENTNESS.CAPTURED : CURRENTNESS.UNKNOWN,
    compassDeg: lookup.heading,
    isPano: true,
    thumbUrl: lookup.thumbUrl || null,
    snapshotUrl: lookup.thumbUrl || null,
    viewer: 'GOOGLE_STREET_VIEW',
    status: 'GOOGLE STREET360',
    honesty: { currentnessUnknown: !capturedAt },
    labels: [
      'GOOGLE STREET360',
      capturedAt ? `CAPTURED ${String(capturedAt).slice(0, 10)}` : 'CAPTURE TIME UNKNOWN'
    ],
    limitation: [
      'GOOGLE STREET360',
      'Capture coordinate is not CameraPose',
      'PROVIDER REPRESENTATION',
      'NOT CAMERA FEED',
      'Historical panoramas are not enumerated'
    ].join(' · ')
  });
}

export function googleStreetViewThumbUrl(panoId, heading, apiKey) {
  const pano = String(panoId || '').trim();
  const key = String(apiKey || '').trim();
  if (!pano || !key) return null;
  const pov = Number.isFinite(Number(heading)) ? Number(heading) : 0;
  const params = new URLSearchParams({
    size: '320x180',
    pano,
    fov: '80',
    heading: String(Math.round(pov)),
    pitch: '0',
    key
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

export { STREET_360_SEARCH_RADIUS_METERS };
