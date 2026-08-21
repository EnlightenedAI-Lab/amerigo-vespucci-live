/**
 * CameraRef is Camera-owned identity. It is not a Spatial ObjectRef.
 * Do not insert CameraRef into SelectionSet.
 */

export const CAMERA_REF_AUTHORITY = 'iqai.camera';
export const CAMERA_REF_OBJECT_TYPE = 'camera';
export const SPATIAL_OBJECT_REF_SCHEMA = 'iqai.spatial.object-ref/1.0.0';

export function createCameraRef(cameraId) {
  const objectId = String(cameraId || '').trim();
  if (!objectId) return null;
  return Object.freeze({
    authority: CAMERA_REF_AUTHORITY,
    objectType: CAMERA_REF_OBJECT_TYPE,
    objectId,
    cameraId: objectId
  });
}

export function isCameraRef(value) {
  return Boolean(value)
    && value.authority === CAMERA_REF_AUTHORITY
    && value.objectType === CAMERA_REF_OBJECT_TYPE
    && typeof value.objectId === 'string'
    && value.objectId.length > 0;
}

export function cameraRefKey(ref) {
  if (!isCameraRef(ref)) return null;
  return `${ref.authority}::${ref.objectType}::${ref.objectId}`;
}

export function cameraRefIsSpatialObjectRef(value) {
  return Boolean(value) && value.schemaId === SPATIAL_OBJECT_REF_SCHEMA;
}
