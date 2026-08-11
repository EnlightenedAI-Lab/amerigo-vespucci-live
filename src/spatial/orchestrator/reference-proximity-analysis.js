/**
 * Deterministic reference-feature proximity analysis for compound objectives.
 */
import { randomUUID } from 'node:crypto';
import { getDatasetById, DATASET_IDS } from '../dataset-registry.js';
import { loadDatasetFeatures } from '../dataset-query-engine.js';
import { filterWithinRadius } from '../spatial-operations.js';
import {
  createSpatialFact,
  GEOMETRY_METHOD
} from './spatial-fact-contract.js';
import {
  loadAuthoritativeHospitals,
  DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M
} from './hospital-proximity-analysis.js';

export async function loadAuthoritativeReferenceDataset(datasetId, deps = {}) {
  if (datasetId === DATASET_IDS.HOSPITALS) {
    return loadAuthoritativeHospitals(deps);
  }
  const dataset = getDatasetById(datasetId);
  if (!dataset) {
    const err = new Error(`Reference dataset not registered: ${datasetId}`);
    err.code = 'REFERENCE_DATASET_UNAVAILABLE';
    throw err;
  }
  if (deps.simulateReferenceUnavailable) {
    const err = new Error(`Reference dataset unavailable: ${datasetId}`);
    err.code = 'REFERENCE_DATASET_UNAVAILABLE';
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
export async function computeReferenceProximityForEvent(governed = {}, options = {}) {
  const thresholdMeters = options.thresholdMeters
    ?? options.proximityThresholdMeters
    ?? DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M;
  const event = governed.candidate || governed;
  const origin = eventOrigin(event);
  if (!origin) {
    const err = new Error('Governed event has no mappable geometry');
    err.code = 'EVENT_NOT_MAPPABLE';
    throw err;
  }

  const referenceLoad = options.referenceLoad
    || await loadAuthoritativeReferenceDataset(options.referenceDatasetId, options);
  const gisStarted = Date.now();
  const nearby = filterWithinRadius(referenceLoad.features, {
    ...origin,
    radiusMeters: thresholdMeters
  });

  const gisReceiptId = randomUUID();
  const geometryVersion = Number(event.geometryVersion || governed.geometryVersion || 1);
  const governedEventVersion = Number(governed.governedEventVersion || 1);
  const referenceDatasetId = referenceLoad.dataset.id;

  const spatialFacts = nearby.map((feature) => {
    const referenceFeatureId = feature.featureId || feature.id || feature.name;
    return createSpatialFact({
      eventId: governed.governedEventId || event.eventId,
      governedEventVersion,
      geometryVersion,
      hospitalId: referenceFeatureId,
      hospitalSourceId: referenceLoad.dataset.sourceId,
      referenceFeatureId,
      referenceDatasetId,
      thresholdMeters,
      distanceMeters: feature.distanceMeters,
      geometryMethod: GEOMETRY_METHOD.GEODESIC_HAVERSINE_WGS84,
      inputVersions: {
        eventGeometryVersion: geometryVersion,
        governedEventVersion,
        referenceDatasetId,
        referenceSourceId: referenceLoad.dataset.sourceId
      },
      gisReceiptId
    });
  });

  return {
    eventId: governed.governedEventId || event.eventId,
    governedEventVersion,
    geometryVersion,
    thresholdMeters,
    referenceFeatures: nearby,
    hospitals: nearby,
    spatialFacts,
    referenceDatasetReceipt: referenceLoad.receipt,
    hospitalDatasetReceipt: referenceLoad.receipt,
    gisReceipt: {
      receiptId: gisReceiptId,
      method: GEOMETRY_METHOD.GEODESIC_HAVERSINE_WGS84,
      coordinateSystem: 'EPSG:4326',
      thresholdMeters,
      units: 'meters',
      geodesic: true,
      eventsAnalyzed: 1,
      referencesMatched: nearby.length,
      hospitalsMatched: nearby.length,
      latencyMs: Date.now() - gisStarted,
      computedAt: new Date().toISOString()
    }
  };
}
