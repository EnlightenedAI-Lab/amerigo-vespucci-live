/**
 * Deterministic hospital proximity analysis — authoritative ODHF + geodesic distance.
 */
import { randomUUID } from 'node:crypto';
import { DATASET_IDS, getDatasetById } from '../dataset-registry.js';
import { loadDatasetFeatures } from '../dataset-query-engine.js';
import { filterWithinRadius } from '../spatial-operations.js';
import { GEOMETRY_METHOD } from './spatial-fact-contract.js';
import { createSpatialFact } from './spatial-fact-contract.js';

export const DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M = 2000;

/**
 * @param {object} [deps]
 */
export async function loadAuthoritativeHospitals(deps = {}) {
  const dataset = getDatasetById(DATASET_IDS.HOSPITALS);
  if (!dataset) {
    const err = new Error('Hospital dataset not registered');
    err.code = 'HOSPITAL_DATASET_UNAVAILABLE';
    throw err;
  }
  if (deps.simulateHospitalUnavailable) {
    const err = new Error('Hospital dataset unavailable');
    err.code = 'HOSPITAL_DATASET_UNAVAILABLE';
    throw err;
  }
  const started = Date.now();
  const loaded = await loadDatasetFeatures(dataset, deps);
  return {
    dataset,
    features: loaded.features,
    receipt: {
      receiptId: randomUUID(),
      datasetId: dataset.id,
      sourceId: dataset.sourceId,
      authority: dataset.authority,
      publisher: dataset.publisher,
      catalogueUrl: dataset.catalogueUrl,
      featureCount: loaded.features.length,
      totalSourceRecords: loaded.totalSourceRecords,
      coordinateSystem: dataset.coordinateSystem,
      method: 'AUTHORITATIVE_DATASET_LOAD',
      latencyMs: Date.now() - started,
      computedAt: new Date().toISOString()
    }
  };
}

function eventOrigin(event = {}) {
  const coords = event.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return { longitude: coords[0], latitude: coords[1] };
}

/**
 * @param {object} governed
 * @param {object} options
 */
export async function computeHospitalProximityForEvent(governed = {}, options = {}) {
  const thresholdMeters = options.thresholdMeters ?? DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M;
  const event = governed.candidate || governed;
  const origin = eventOrigin(event);
  if (!origin) {
    const err = new Error('Governed event has no mappable geometry');
    err.code = 'EVENT_NOT_MAPPABLE';
    throw err;
  }

  const hospitalLoad = options.hospitalLoad || await loadAuthoritativeHospitals(options);
  const gisStarted = Date.now();
  const nearby = filterWithinRadius(hospitalLoad.features, {
    ...origin,
    radiusMeters: thresholdMeters
  });

  const gisReceiptId = randomUUID();
  const geometryVersion = Number(event.geometryVersion || governed.geometryVersion || 1);
  const governedEventVersion = Number(governed.governedEventVersion || 1);

  const spatialFacts = nearby.map((hospital) => createSpatialFact({
    eventId: governed.governedEventId || event.eventId,
    governedEventVersion,
    geometryVersion,
    hospitalId: hospital.featureId || hospital.id || hospital.name,
    hospitalSourceId: hospitalLoad.dataset.sourceId,
    thresholdMeters,
    distanceMeters: hospital.distanceMeters,
    geometryMethod: GEOMETRY_METHOD.GEODESIC_HAVERSINE_WGS84,
    inputVersions: {
      eventGeometryVersion: geometryVersion,
      governedEventVersion,
      hospitalDatasetId: hospitalLoad.dataset.id,
      hospitalSourceId: hospitalLoad.dataset.sourceId
    },
    gisReceiptId
  }));

  return {
    eventId: governed.governedEventId || event.eventId,
    governedEventVersion,
    geometryVersion,
    thresholdMeters,
    hospitals: nearby,
    spatialFacts,
    hospitalDatasetReceipt: hospitalLoad.receipt,
    gisReceipt: {
      receiptId: gisReceiptId,
      method: GEOMETRY_METHOD.GEODESIC_HAVERSINE_WGS84,
      coordinateSystem: 'EPSG:4326',
      thresholdMeters,
      units: 'meters',
      geodesic: true,
      eventsAnalyzed: 1,
      hospitalsMatched: nearby.length,
      latencyMs: Date.now() - gisStarted,
      computedAt: new Date().toISOString()
    }
  };
}
