/**
 * SpatialFact contract — immutable/version-linked deterministic spatial conclusions.
 */
import { randomUUID } from 'node:crypto';

export const SPATIAL_FACT_SCHEMA_VERSION = '1.0.0';

export const SPATIAL_RELATION = Object.freeze({
  WITHIN_DISTANCE: 'WITHIN_DISTANCE'
});

export const SPATIAL_FACT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  STALE: 'STALE',
  INVALIDATED: 'INVALIDATED'
});

export const GEOMETRY_METHOD = Object.freeze({
  GEODESIC_HAVERSINE_WGS84: 'GEODESIC_HAVERSINE_WGS84'
});

/**
 * @param {object} fact
 */
export function createSpatialFact(fact = {}) {
  return {
    schemaVersion: SPATIAL_FACT_SCHEMA_VERSION,
    spatialFactId: fact.spatialFactId || randomUUID(),
    eventId: fact.eventId,
    governedEventVersion: Number(fact.governedEventVersion || 1),
    geometryVersion: Number(fact.geometryVersion || 1),
    hospitalId: fact.hospitalId,
    hospitalSourceId: fact.hospitalSourceId || 'STATCAN_HOSPITALS_001',
    referenceFeatureId: fact.referenceFeatureId || fact.hospitalId || null,
    referenceDatasetId: fact.referenceDatasetId || null,
    relation: fact.relation || SPATIAL_RELATION.WITHIN_DISTANCE,
    thresholdMeters: fact.thresholdMeters ?? 2000,
    distanceMeters: fact.distanceMeters ?? null,
    geometryMethod: fact.geometryMethod || GEOMETRY_METHOD.GEODESIC_HAVERSINE_WGS84,
    coordinateSystem: fact.coordinateSystem || 'EPSG:4326',
    inputVersions: fact.inputVersions || {},
    gisReceiptId: fact.gisReceiptId || null,
    status: fact.status || SPATIAL_FACT_STATUS.ACTIVE,
    computedAt: fact.computedAt || new Date().toISOString()
  };
}

/**
 * @param {object} fact
 * @param {object} patch
 */
export function markSpatialFactStale(fact = {}, patch = {}) {
  return {
    ...fact,
    status: SPATIAL_FACT_STATUS.STALE,
    staleReason: patch.staleReason || 'GEOMETRY_VERSION_CHANGED',
    staleAt: new Date().toISOString()
  };
}

/**
 * @param {object[]} facts
 * @param {object} eventContext
 */
export function factsForEventVersion(facts = [], eventContext = {}) {
  const version = Number(eventContext.governedEventVersion || 1);
  const geometryVersion = Number(eventContext.geometryVersion || 1);
  return facts.filter((fact) =>
    fact.eventId === eventContext.eventId
    && fact.governedEventVersion === version
    && fact.geometryVersion === geometryVersion
    && fact.status === SPATIAL_FACT_STATUS.ACTIVE);
}

/**
 * @param {object[]} facts
 * @param {object} priorContext
 */
export function invalidateFactsForGeometryChange(facts = [], priorContext = {}) {
  return facts.map((fact) => {
    if (fact.eventId !== priorContext.eventId) return fact;
    if (fact.geometryVersion === priorContext.geometryVersion
      && fact.governedEventVersion === priorContext.governedEventVersion) {
      return fact;
    }
    if (fact.status === SPATIAL_FACT_STATUS.ACTIVE) {
      return markSpatialFactStale(fact, { staleReason: 'GEOMETRY_VERSION_CHANGED' });
    }
    return fact;
  });
}
