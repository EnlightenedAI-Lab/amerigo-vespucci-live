/**
 * Session-only provider representations attached to Camera Wall ViewSlots.
 * Does not mint cameras. Does not write CameraPose. Does not claim visibility.
 */

import { getAuthoredCamera } from '../../map/authored-cameras.js';
import { STREET_360_SEARCH_RADIUS_METERS, lookupGoogleStreetViewNear } from '../../map/google-street-view.js';
import {
  HEAVY_VIEWER_LIMIT,
  REPRESENTATION_KIND,
  heavyViewerPolicy
} from '../engine/view-slot.js';
import { getCameraWallSnapshot, listWallSlots, setSlotRepresentation } from '../engine/camera-wall.js';
import {
  PROVIDER_CREDENTIAL_REQUIRED,
  VISUAL_PROVIDER,
  createProviderRepresentation
} from './provider-representation.js';
import { classifyGoogleStreet360, googleStreetViewThumbUrl } from './google-street360-representation.js';

export const PROVIDER_PREFERENCE = Object.freeze([
  'GOOGLE_STREET360',
  'MAPILLARY_360',
  'MAPILLARY_IMAGE',
  'NONE'
]);

const bySlotId = new Map();
const listeners = new Set();
let googleThumbKey = null;
let attachInFlight = 0;

let lookups = {
  google: defaultGoogleLookup,
  mapillary: defaultMapillaryLookup,
  googleKey: defaultGoogleKey
};

async function defaultGoogleKey() {
  try {
    const payload = await fetch('/api/spatial/config', { cache: 'no-store' }).then((res) => res.json());
    return String(payload?.streetLevelContext?.googleMapsBrowserApiKey || '').trim() || null;
  } catch {
    return null;
  }
}

async function defaultGoogleLookup(camera) {
  return lookupGoogleStreetViewNear({
    longitude: camera.longitude,
    latitude: camera.latitude,
    radiusMeters: STREET_360_SEARCH_RADIUS_METERS
  });
}

async function defaultMapillaryLookup(camera) {
  const params = new URLSearchParams({
    lng: String(camera.longitude),
    lat: String(camera.latitude)
  });
  const res = await fetch(`/spatial-v2/api/camera-providers/mapillary?${params}`, { cache: 'no-store' });
  return res.json();
}

function emit() {
  const snapshot = getSlotRepresentationSnapshot();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (error) {
      console.warn('[IQAI CAMERA WALL] representation listener failed', error);
    }
  }
}

function availabilityLabel(pack) {
  if (pack?.selected === 'GOOGLE_STREET360' && pack.google?.providerId) return 'GOOGLE STREET360 AVAILABLE';
  if (pack?.selected === 'MAPILLARY' && pack.mapillary?.isPano) return 'MAPILLARY 360 AVAILABLE';
  if (pack?.selected === 'MAPILLARY' && pack.mapillary?.providerId) return 'MAPILLARY IMAGE AVAILABLE';
  if (pack?.mapillaryStatus === PROVIDER_CREDENTIAL_REQUIRED.MAPILLARY) {
    return pack.google?.providerId ? 'GOOGLE STREET360 AVAILABLE' : 'MAPILLARY CREDENTIAL REQUIRED';
  }
  if (pack?.google?.providerId) return 'GOOGLE STREET360 AVAILABLE';
  if (pack?.mapillary?.providerId) {
    return pack.mapillary.isPano ? 'MAPILLARY 360 AVAILABLE' : 'MAPILLARY IMAGE AVAILABLE';
  }
  return 'REPRESENTATION NOT AVAILABLE';
}

function chooseDefaultProvider(google, mapillary, mapillaryStatus) {
  if (google?.providerId) return 'GOOGLE_STREET360';
  if (mapillary?.providerId && mapillary.isPano) return 'MAPILLARY';
  if (mapillary?.providerId) return 'MAPILLARY';
  if (mapillaryStatus === PROVIDER_CREDENTIAL_REQUIRED.MAPILLARY && !google?.providerId) return 'NONE';
  return 'NONE';
}

function selectedRepresentation(pack) {
  if (!pack) return null;
  if (pack.selected === 'GOOGLE_STREET360') return pack.google?.providerId ? pack.google : null;
  if (pack.selected === 'MAPILLARY') return pack.mapillary?.providerId ? pack.mapillary : null;
  return null;
}

function kindForSelection(selected, representation) {
  if (selected === 'GOOGLE_STREET360' && representation?.providerId) return REPRESENTATION_KIND.STREET360;
  if (selected === 'MAPILLARY' && representation?.providerId) return REPRESENTATION_KIND.MAPILLARY;
  return REPRESENTATION_KIND.GEOMETRIC;
}

export function configureProviderLookups(next = {}) {
  lookups = { ...lookups, ...next };
}

export function resetProviderLookups() {
  lookups = {
    google: defaultGoogleLookup,
    mapillary: defaultMapillaryLookup,
    googleKey: defaultGoogleKey
  };
}

export function resetSlotRepresentations({ emit: shouldEmit = true } = {}) {
  bySlotId.clear();
  if (shouldEmit) emit();
}

export function getRepresentationAttachStatus() {
  return Object.freeze({ inFlight: attachInFlight > 0 });
}

export function getSlotRepresentation(slotId) {
  return slotId ? bySlotId.get(String(slotId)) || null : null;
}

export function getSlotRepresentationSnapshot() {
  const wall = getCameraWallSnapshot();
  const slots = (wall.slots || []).map((slot) => {
    const pack = getSlotRepresentation(slot.slotId);
    const selected = selectedRepresentation(pack);
    return Object.freeze({
      slotId: slot.slotId,
      cameraRef: slot.cameraRef,
      active: slot.active === true,
      selected: pack?.selected || 'NONE',
      availability: availabilityLabel(pack),
      google: pack?.google || null,
      mapillary: pack?.mapillary || null,
      mapillaryStatus: pack?.mapillaryStatus || null,
      representation: selected,
      cameraCoordinate: pack?.cameraCoordinate || null,
      heavy: Boolean(selected?.providerId)
    });
  });
  const policy = heavyViewerPolicy(wall.slots || [], wall.activeSlotId, {
    budget: wall.maxHeavyViewers,
    enlargedSlotId: wall.enlargedSlotId
  });
  const live = slots.filter((item) => item.heavy).length;
  return Object.freeze({
    preference: PROVIDER_PREFERENCE,
    maxHeavyViewers: wall.maxHeavyViewers ?? HEAVY_VIEWER_LIMIT,
    heavySlotId: live ? wall.activeSlotId : null,
    liveDecoders: Math.min(live, wall.maxHeavyViewers || 0),
    slots: Object.freeze(slots),
    heavyViewer: policy,
    mutatesCameraPose: false,
    observationClaim: false,
    visibilityTested: false
  });
}

export function subscribeSlotRepresentations(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function selectSlotProvider(slotId, selected) {
  const pack = getSlotRepresentation(slotId);
  if (!pack) return null;
  const next = selected === 'GOOGLE_STREET360' || selected === 'MAPILLARY' ? selected : 'NONE';
  const representation = next === 'GOOGLE_STREET360'
    ? pack.google
    : (next === 'MAPILLARY' ? pack.mapillary : null);
  const updated = Object.freeze({ ...pack, selected: representation?.providerId ? next : 'NONE' });
  bySlotId.set(String(slotId), updated);
  setSlotRepresentation(slotId, kindForSelection(updated.selected, selectedRepresentation(updated)));
  emit();
  return updated;
}

function classifyMapillaryLookup(mapillaryResult, cameraCoordinate) {
  const mapillaryStatus = mapillaryResult?.status || null;
  let mapillary = null;
  if (mapillaryStatus === PROVIDER_CREDENTIAL_REQUIRED.MAPILLARY) {
    mapillary = createProviderRepresentation({
      provider: VISUAL_PROVIDER.MAPILLARY,
      providerId: null,
      cameraCoordinate,
      status: PROVIDER_CREDENTIAL_REQUIRED.MAPILLARY,
      labels: ['MAPILLARY', 'MAPILLARY CREDENTIAL REQUIRED'],
      limitation: 'MAPILLARY_CREDENTIAL_REQUIRED'
    });
  } else if (mapillaryResult?.selected?.providerId) {
    mapillary = mapillaryResult.selected.cameraCoordinate
      ? mapillaryResult.selected
      : Object.freeze({
        ...mapillaryResult.selected,
        cameraCoordinate,
        targetCoordinate: cameraCoordinate
      });
  }
  const usable = mapillary?.providerId ? mapillary : null;
  return {
    mapillary: usable || (mapillaryStatus === PROVIDER_CREDENTIAL_REQUIRED.MAPILLARY ? mapillary : null),
    usableMapillary: usable,
    mapillaryStatus
  };
}

function classifyGoogleLookup(googleResult, cameraCoordinate) {
  if (googleResult?.error) return null;
  const withThumb = googleResult?.panoId
    ? {
      ...googleResult,
      thumbUrl: googleResult.thumbUrl || googleStreetViewThumbUrl(googleResult.panoId, googleResult.heading, googleThumbKey)
    }
    : googleResult;
  const classified = classifyGoogleStreet360(withThumb || {}, cameraCoordinate);
  return classified.providerId ? classified : null;
}

function writeSlotPack(slot, cameraCoordinate, google, mapillaryPack) {
  const selected = chooseDefaultProvider(google, mapillaryPack.usableMapillary, mapillaryPack.mapillaryStatus);
  const attached = Object.freeze({
    slotId: slot.slotId,
    cameraRef: slot.cameraRef,
    cameraCoordinate,
    google,
    mapillary: mapillaryPack.mapillary,
    mapillaryStatus: mapillaryPack.mapillaryStatus,
    selected
  });
  bySlotId.set(slot.slotId, attached);
  setSlotRepresentation(slot.slotId, kindForSelection(attached.selected, selectedRepresentation(attached)), { emit: false });
  emit();
  return attached;
}

export async function attachRepresentationsForWall(options = {}) {
  attachInFlight += 1;
  emit();
  try {
    if (!googleThumbKey && typeof lookups.googleKey === 'function') {
      googleThumbKey = await lookups.googleKey();
    }
    const jobs = listWallSlots()
      .filter((slot) => slot.cameraRef)
      .map(async (slot) => {
        const camera = getAuthoredCamera(slot.cameraRef);
        if (!camera) return null;
        const cameraCoordinate = Object.freeze({
          longitude: Number(camera.longitude),
          latitude: Number(camera.latitude)
        });
        const mapillaryResult = await lookups.mapillary(camera).catch((error) => {
          console.warn('[IQAI CAMERA WALL] Mapillary lookup failed', error);
          return { status: 'MAPILLARY_FETCH_FAILED' };
        });
        const mapillaryPack = classifyMapillaryLookup(mapillaryResult, cameraCoordinate);
        writeSlotPack(slot, cameraCoordinate, null, mapillaryPack);
        const googleResult = await lookups.google(camera).catch((error) => {
          console.warn('[IQAI CAMERA WALL] Google Street360 lookup failed', error);
          return { error: true };
        });
        const google = classifyGoogleLookup(googleResult, cameraCoordinate);
        return writeSlotPack(slot, cameraCoordinate, google, mapillaryPack);
      });
    await Promise.all(jobs);
    return getSlotRepresentationSnapshot();
  } finally {
    attachInFlight = Math.max(0, attachInFlight - 1);
    emit();
  }
}

export function attachVisualCoverageToWall(viewpoints = []) {
  const slots = listWallSlots();
  (Array.isArray(viewpoints) ? viewpoints : []).forEach((viewpoint, index) => {
    const slot = slots[index];
    if (!slot) return;
    const google = viewpoint.provider === VISUAL_PROVIDER.GOOGLE_STREET360 ? viewpoint.representation : null;
    const mapillary = viewpoint.provider === VISUAL_PROVIDER.MAPILLARY ? viewpoint.representation : null;
    writeSlotPack(slot, viewpoint.captureCoordinate || null, google, {
      mapillary,
      usableMapillary: mapillary,
      mapillaryStatus: null
    });
  });
  return getSlotRepresentationSnapshot();
}
