/**
 * Lab-only ObjectRef continuity contract.
 * Not the production Spatial V2 ObjectRef. Do not import this into production.
 *
 * Authority providers (NRCan, municipal, global) sit beneath ObjectRef.
 * They are not per-view databases for MAP / STREET_360 / SCENE_3D.
 *
 * VIEW → candidate/acquisition → OBJECT RESOLVER → AUTHORITY PROVIDER → OBJECTREF → synchronized views
 *
 * visual class inference ≠ authoritative GIS identity
 */

export const ACQUISITION_STATES = Object.freeze([
  'IDLE',
  'HOVER',
  'TARGETED',
  'ACQUIRED',
  'INSPECTING',
  'CLEARED'
]);

export const VIEW_CONTEXTS = Object.freeze(['MAP', 'STREET_360', 'SCENE_3D']);

export const CONTRACT_ID = 'iqai.lab.objectref.v1';

export function objectKey(provider, objectClass, sourceId) {
  return `${provider}:${objectClass}:${sourceId}`;
}

export function createObjectRef(feature, {
  catalogName = null,
  measurements = null
} = {}) {
  const props = feature?.properties || {};
  const sourceId = props.feature_id || null;
  const objectClass = props.objectKind || 'building';
  const provider = 'nrcan';
  if (!sourceId) {
    return {
      contract: CONTRACT_ID,
      ok: false,
      reason: 'missing-provider-source-id',
      inference: false
    };
  }
  const centroid = feature.properties?._anchor || null;
  return {
    contract: CONTRACT_ID,
    ok: true,
    objectKey: objectKey(provider, objectClass, sourceId),
    objectClass,
    authority: {
      provider,
      dataset: props.source || 'NRCan Automatically Extracted Buildings',
      datasetUuid: props.sourceUuid || '7a5cda52-c7df-427f-9ced-26f19a8a64d6',
      layer: props.sourceLayer || 'Optimized Buildings Layer (auto_building_opti_2)'
    },
    sourceId,
    geometry: feature.geometry ? {
      type: feature.geometry.type,
      coordinates: feature.geometry.coordinates,
      crs: 'EPSG:4326',
      nativeCrs: props.sourceCrs || 'EPSG:4617'
    } : null,
    anchor: centroid,
    attributesRef: {
      kind: 'authority-record',
      provider,
      sourceId,
      featureId: sourceId
    },
    provenance: {
      method: 'vector-selection',
      inference: false,
      visualClassEquivalentToIdentity: false
    },
    overlay: catalogName ? { name: catalogName, kind: 'iqai-catalog-overlay' } : null,
    measurements: measurements || null
  };
}

export function attachAnchor(objectRef, anchor) {
  if (!objectRef?.ok) return objectRef;
  return { ...objectRef, anchor: anchor ? { lat: anchor.lat, lng: anchor.lng } : objectRef.anchor };
}

export function createSelectionState(objectRef, {
  acquiredAt = new Date().toISOString(),
  activeView = 'MAP'
} = {}) {
  return {
    contract: CONTRACT_ID,
    objectRef,
    acquiredAt,
    activeView: VIEW_CONTEXTS.includes(activeView) ? activeView : 'MAP'
  };
}

export function serializeSelection(selection) {
  return JSON.parse(JSON.stringify(selection));
}

export function restoreKey(selection) {
  return selection?.objectRef?.sourceId || null;
}
