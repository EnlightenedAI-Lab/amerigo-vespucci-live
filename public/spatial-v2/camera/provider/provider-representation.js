/**
 * Provider representation contract.
 * Provider IDs stay provider-owned. They are not Cameras, ViewSlots, or Spatial ObjectRefs.
 * A representation is not CameraPose, not visibility proof, and not a camera feed.
 */

export const PROVIDER_REPRESENTATION_KIND = 'CAMERA_PROVIDER_REPRESENTATION';
export const PROVIDER_REPRESENTATION_REF_AUTHORITY = 'iqai.camera.provider';
export const PROVIDER_REPRESENTATION_OBJECT_TYPE = 'provider-representation';

export const VISUAL_PROVIDER = Object.freeze({
  MAPILLARY: 'MAPILLARY',
  GOOGLE_STREET360: 'GOOGLE_STREET360'
});

export const REPRESENTATION_TYPE = Object.freeze({
  STREET_IMAGE: 'STREET_IMAGE',
  PANORAMA_360: 'PANORAMA_360',
  STREET360: 'STREET360'
});

export const CURRENTNESS = Object.freeze({
  UNKNOWN: 'CURRENTNESS UNKNOWN',
  PROVIDER_TIMESTAMP: 'PROVIDER TIMESTAMP',
  CAPTURED: 'CAPTURED'
});

export const PROVIDER_CREDENTIAL_REQUIRED = Object.freeze({
  MAPILLARY: 'MAPILLARY_CREDENTIAL_REQUIRED'
});

export const PROVIDER_HONESTY_LABELS = Object.freeze([
  'PROVIDER REPRESENTATION',
  'NOT CAMERA FEED'
]);

export const CAPTURE_TIME_UNKNOWN = 'CAPTURE TIME UNKNOWN';

export function providerCatalogRef(provider, providerId) {
  const id = String(providerId || '').trim();
  const name = String(provider || '').trim();
  if (!name || !id) return null;
  return `provider:${name}:${id}`;
}

export function createProviderRepresentationRef(input = {}) {
  const provider = String(input.provider || '').trim();
  const providerId = input.providerId == null || input.providerId === ''
    ? null
    : String(input.providerId);
  if (!provider) return null;
  return Object.freeze({
    authority: PROVIDER_REPRESENTATION_REF_AUTHORITY,
    objectType: PROVIDER_REPRESENTATION_OBJECT_TYPE,
    provider,
    providerId,
    objectId: providerId ? `${provider}:${providerId}` : provider
  });
}

export function isProviderRepresentationRef(value) {
  return Boolean(value)
    && value.authority === PROVIDER_REPRESENTATION_REF_AUTHORITY
    && value.objectType === PROVIDER_REPRESENTATION_OBJECT_TYPE
    && typeof value.provider === 'string'
    && value.provider.length > 0;
}

export function createProviderRepresentation(input = {}) {
  const provider = String(input.provider || '').trim();
  const providerId = input.providerId == null || input.providerId === ''
    ? null
    : String(input.providerId);
  const capture = input.captureCoordinate && Number.isFinite(Number(input.captureCoordinate.longitude))
    && Number.isFinite(Number(input.captureCoordinate.latitude))
    ? Object.freeze({
      longitude: Number(input.captureCoordinate.longitude),
      latitude: Number(input.captureCoordinate.latitude)
    })
    : null;
  const cameraCoordinate = input.cameraCoordinate && Number.isFinite(Number(input.cameraCoordinate.longitude))
    && Number.isFinite(Number(input.cameraCoordinate.latitude))
    ? Object.freeze({
      longitude: Number(input.cameraCoordinate.longitude),
      latitude: Number(input.cameraCoordinate.latitude)
    })
    : (input.targetCoordinate && Number.isFinite(Number(input.targetCoordinate.longitude))
      && Number.isFinite(Number(input.targetCoordinate.latitude))
      ? Object.freeze({
        longitude: Number(input.targetCoordinate.longitude),
        latitude: Number(input.targetCoordinate.latitude)
      })
      : null);
  const labels = Array.isArray(input.labels) ? input.labels.map(String) : [];
  for (const label of PROVIDER_HONESTY_LABELS) {
    if (!labels.includes(label)) labels.push(label);
  }
  return Object.freeze({
    kind: PROVIDER_REPRESENTATION_KIND,
    representationRef: createProviderRepresentationRef({ provider, providerId }),
    provider: provider || null,
    providerId,
    catalogRef: input.catalogRef || providerCatalogRef(provider, providerId),
    representationType: input.representationType || null,
    captureCoordinate: capture,
    cameraCoordinate,
    targetCoordinate: cameraCoordinate,
    captureEqualsCameraPose: false,
    captureEqualsTarget: false,
    distanceMeters: Number.isFinite(Number(input.distanceMeters)) ? Number(input.distanceMeters) : null,
    capturedAt: input.capturedAt ? String(input.capturedAt) : null,
    capturedAtIso: input.capturedAtIso ? String(input.capturedAtIso) : null,
    retrievedAt: input.retrievedAt ? String(input.retrievedAt) : null,
    currentness: input.currentness || (input.capturedAt ? CURRENTNESS.CAPTURED : CURRENTNESS.UNKNOWN),
    snapshotUrl: input.snapshotUrl || null,
    thumbUrl: input.thumbUrl || null,
    compassDeg: Number.isFinite(Number(input.compassDeg)) ? Number(input.compassDeg) : null,
    isPano: input.isPano === true,
    viewer: input.viewer || null,
    status: input.status || null,
    honesty: Object.freeze({
      notLiveCctv: true,
      notCameraFeed: true,
      notCameraPose: true,
      notVisibilityProof: true,
      notObservation: true,
      notSpatialObjectRef: true,
      currentnessUnknown: input.honesty?.currentnessUnknown !== false && !input.capturedAt
    }),
    labels: Object.freeze(labels),
    limitation: input.limitation || null,
    mutatesCameraPose: false,
    visibilityProof: false,
    observationClaim: false
  });
}

export function captureTimeLabel(representation) {
  const text = representation?.capturedAt || representation?.capturedAtIso;
  if (!text) return CAPTURE_TIME_UNKNOWN;
  return `CAPTURED ${String(text).slice(0, 10)}`;
}

export function captureOffsetLabel(representation) {
  const meters = Number(representation?.distanceMeters);
  if (!Number.isFinite(meters)) return 'CAPTURE OFFSET UNKNOWN';
  return `CAPTURE OFFSET ${Math.round(meters)} m`;
}
