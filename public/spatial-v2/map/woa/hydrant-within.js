/**
 * Execute a confirmed ASK MAP WITHIN or NEAREST against existing WOA hydrant records.
 * Invented geometry is forbidden. Painting uses the existing MapView only.
 */

import { failClosed } from '../../foundation/contracts/validate.js';
import { createSelectableRegistry, registerManifest } from './sources.js';
import { indexCollection, queryNearest, queryWithin } from './index.js';
import { ASK_MAP_OPERATIONS, HYDRANT_SOURCE } from '../../brain/ask-map-intent.js';

const COVERAGE_PAD_DEG = 0.001;

function bboxFromFeatures(features) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const feature of features || []) {
    const longitude = Number(feature?.geometry?.coordinates?.[0]);
    const latitude = Number(feature?.geometry?.coordinates?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    minLon = Math.min(minLon, longitude);
    minLat = Math.min(minLat, latitude);
    maxLon = Math.max(maxLon, longitude);
    maxLat = Math.max(maxLat, latitude);
  }
  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function featuresFromRecords(collectionOrIndex) {
  if (Array.isArray(collectionOrIndex?.features)) return collectionOrIndex.features;
  return (collectionOrIndex?.items || []).map((item) => item.feature);
}

export function assertHydrantCoverage(here, collectionOrIndex) {
  const bbox = bboxFromFeatures(featuresFromRecords(collectionOrIndex));
  const longitude = Number(here?.longitude);
  const latitude = Number(here?.latitude);
  if (
    !bbox
    || longitude < bbox[0] - COVERAGE_PAD_DEG
    || latitude < bbox[1] - COVERAGE_PAD_DEG
    || longitude > bbox[2] + COVERAGE_PAD_DEG
    || latitude > bbox[3] + COVERAGE_PAD_DEG
  ) {
    failClosed('HYDRANT_COVERAGE', 'Ville de Montréal hydrant inventory does not cover this location.');
  }
}

async function loadManifest(fetchFn) {
  const response = await fetchFn('/spatial-v2/data/woa/sources.json');
  if (!response.ok) failClosed('WOA_SOURCE_MISSING', 'WOA selectable source manifest is missing.');
  return response.json();
}

export async function loadHydrantRecords({ fetchImpl, collection } = {}) {
  if (collection?.features) return { source: HYDRANT_SOURCE, collection };
  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (typeof fetchFn !== 'function') {
    failClosed('HYDRANT_SOURCE_UNAVAILABLE', 'Ville de Montréal hydrant records are not available.');
  }
  const manifest = await loadManifest(fetchFn);
  const registry = createSelectableRegistry();
  registerManifest(registry, manifest);
  const source = registry.get('hydrant');
  if (!source?.dataUrl) failClosed('HYDRANT_SOURCE_UNAVAILABLE', 'Ville de Montréal hydrant source is not registered.');
  const response = await fetchFn(source.dataUrl);
  if (!response.ok) failClosed('HYDRANT_SOURCE_UNAVAILABLE', 'Ville de Montréal hydrant records failed to load.');
  const body = await response.json();
  if (!Array.isArray(body?.features)) {
    failClosed('HYDRANT_SOURCE_UNAVAILABLE', 'Hydrant payload is not a FeatureCollection.');
  }
  return {
    source: {
      objectClass: source.objectClass,
      label: source.label,
      provider: source.provider,
      dataset: source.dataset,
      datasetId: source.datasetId,
      identityField: source.identityField,
      dataUrl: source.dataUrl
    },
    collection: body
  };
}

export function filterHydrantsWithin(collection, here, radiusMeters) {
  const index = indexCollection(collection, 'hydrant');
  return queryWithin(index, {
    latitude: here.latitude,
    longitude: here.longitude,
    radiusMeters
  });
}

export function findNearestHydrant(collection, here) {
  const index = indexCollection(collection, 'hydrant');
  return queryNearest(index, {
    latitude: here.latitude,
    longitude: here.longitude
  });
}

function hydrantIdentity(hit) {
  const src = hit?.source || hit?.feature?.properties?.source || {};
  const coords = hit?.feature?.geometry?.coordinates;
  return {
    sourceId: hit?.sourceId != null ? String(hit.sourceId) : null,
    assetId: src.ID_BI != null ? String(src.ID_BI) : (hit?.sourceId != null ? String(hit.sourceId) : null),
    address: src.ADRESSE || null,
    status: src.STATUT_ACTIF || null,
    distanceMeters: Number(hit?.distanceMeters),
    longitude: Array.isArray(coords) ? Number(coords[0]) : null,
    latitude: Array.isArray(coords) ? Number(coords[1]) : null
  };
}

export async function executeHydrantWithin({
  intent,
  here,
  fetchImpl,
  collection,
  paint,
  loadFamily
} = {}) {
  const radiusMeters = Number(intent?.radiusMeters);
  const longitude = Number(here?.longitude);
  const latitude = Number(here?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    failClosed('HERE_UNDEFINED', 'HERE is not an operator-defined point.');
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    failClosed('MISSING_RADIUS', 'WITHIN requires a finite distance.');
  }
  let records;
  if (typeof loadFamily === 'function') {
    const loaded = await loadFamily('hydrant');
    if (loaded?.index) {
      assertHydrantCoverage({ longitude, latitude }, loaded.index);
      records = {
        source: loaded.source || HYDRANT_SOURCE,
        hits: queryWithin(loaded.index, { latitude, longitude, radiusMeters })
      };
    }
  }
  if (!records) {
    const loaded = await loadHydrantRecords({ fetchImpl, collection });
    assertHydrantCoverage({ longitude, latitude }, loaded.collection);
    records = {
      source: loaded.source,
      hits: filterHydrantsWithin(loaded.collection, { latitude, longitude }, radiusMeters)
    };
  }
  const result = {
    confirmationTitle: intent.confirmationTitle || `SHOW HYDRANTS WITHIN ${radiusMeters} M`,
    operation: ASK_MAP_OPERATIONS.WITHIN,
    objectClass: 'hydrant',
    radiusMeters,
    here: { longitude, latitude, kind: here.kind, source: here.source },
    count: records.hits.length,
    source: records.source,
    hits: records.hits.map((hit) => ({
      sourceId: hit.sourceId,
      distanceMeters: hit.distanceMeters,
      feature: hit.feature
    }))
  };
  if (typeof paint === 'function') {
    result.paint = await paint(result);
  }
  return result;
}

export async function executeHydrantNearest({
  intent,
  here,
  fetchImpl,
  collection,
  paint,
  loadFamily
} = {}) {
  const longitude = Number(here?.longitude);
  const latitude = Number(here?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    failClosed('HERE_UNDEFINED', 'HERE is not an operator-defined point.');
  }
  let hit = null;
  let source = HYDRANT_SOURCE;
  if (typeof loadFamily === 'function') {
    const loaded = await loadFamily('hydrant');
    if (loaded?.index) {
      assertHydrantCoverage({ longitude, latitude }, loaded.index);
      source = loaded.source || HYDRANT_SOURCE;
      hit = queryNearest(loaded.index, { latitude, longitude });
    }
  }
  if (!hit) {
    const loaded = await loadHydrantRecords({ fetchImpl, collection });
    assertHydrantCoverage({ longitude, latitude }, loaded.collection);
    source = loaded.source;
    hit = findNearestHydrant(loaded.collection, { latitude, longitude });
  }
  if (!hit) {
    failClosed('NO_HYDRANT', 'No hydrant exists in the Ville de Montréal records.');
  }
  const nearest = hydrantIdentity(hit);
  const result = {
    confirmationTitle: intent?.confirmationTitle || 'SHOW NEAREST HYDRANT',
    operation: ASK_MAP_OPERATIONS.NEAREST,
    objectClass: 'hydrant',
    radiusMeters: null,
    here: { longitude, latitude, kind: here.kind, source: here.source },
    count: 1,
    source,
    nearest,
    hits: [{
      sourceId: hit.sourceId,
      distanceMeters: hit.distanceMeters,
      feature: hit.feature
    }]
  };
  if (typeof paint === 'function') {
    result.paint = await paint(result);
  }
  return result;
}

export async function executeGovernedHydrantAction(input = {}) {
  if (input?.intent?.operation === ASK_MAP_OPERATIONS.NEAREST) {
    return executeHydrantNearest(input);
  }
  return executeHydrantWithin(input);
}
