import { fetchDatasetRecords, clearDatasetCache } from './dataset-fetch.js';
import {
  normalizeFeature,
  applyOperationalFilter,
  isMontrealSchoolRow,
  isHospitalOdhfRow,
  isMontrealHospitalRow
} from './dataset-normalizers.js';
import {
  filterWithinRadius,
  selectNearest,
  filterWithinMontrealBbox,
  attachDistanceLabels,
  formatRadiusKm
} from './spatial-operations.js';
import { DATASET_IDS } from './dataset-registry.js';
import { summarizeOperationalExclusions } from './fire-station-query.js';

/**
 * @param {object} dataset
 * @param {{ fetchFn?: typeof fetch, forceRefresh?: boolean }} options
 */
export async function loadDatasetFeatures(dataset, options = {}) {
  const { records, cached } = await fetchDatasetRecords(dataset, options);
  const receivedAt = new Date().toISOString();
  const normalized = [];

  if (dataset.dataFormat === 'geojson') {
    for (const feature of records) {
      const props = feature.properties || feature.attributes || {};
      const item = normalizeFeature(dataset, props, receivedAt);
      if (item) normalized.push(item);
    }
  } else if (dataset.id === DATASET_IDS.SCHOOLS) {
    for (const row of records) {
      if (!isMontrealSchoolRow(row)) continue;
      const item = normalizeFeature(dataset, row, receivedAt);
      if (item) normalized.push(item);
    }
  } else if (dataset.id === DATASET_IDS.HOSPITALS) {
    for (const row of records) {
      if (!isHospitalOdhfRow(row)) continue;
      if (!isMontrealHospitalRow(row)) continue;
      const item = normalizeFeature(dataset, row, receivedAt);
      if (item) normalized.push(item);
    }
  } else if (dataset.id === DATASET_IDS.TRANSIT) {
    for (const row of records) {
      const item = normalizeFeature(dataset, row, receivedAt);
      if (item) normalized.push(item);
    }
  }

  const operationalMeta = dataset.id === DATASET_IDS.FIRE_STATIONS
    ? summarizeOperationalExclusions(normalized)
    : { closedExcluded: 0, ambiguousExcluded: 0 };

  const active = applyOperationalFilter(dataset, normalized);

  return {
    features: active,
    totalSourceRecords: normalized.length,
    closedExcluded: operationalMeta.closedExcluded,
    ambiguousExcluded: operationalMeta.ambiguousExcluded,
    cached
  };
}

/**
 * @param {object} request
 * @param {{ latitude: number, longitude: number }} origin
 * @param {{ fetchFn?: typeof fetch }} [options]
 */
export async function executeDatasetQuery(request, origin, options = {}) {
  const datasets = request.datasets || [];
  const datasetResults = [];
  const allFeatures = [];

  for (const dataset of datasets) {
    const loaded = await loadDatasetFeatures(dataset, options);
    let spatialFeatures = loaded.features;

    if (request.action === 'SHOW' && !request.radiusMeters) {
      spatialFeatures = filterWithinMontrealBbox(spatialFeatures);
    } else if (request.action === 'NEAREST') {
      spatialFeatures = selectNearest(spatialFeatures, origin, request.limit);
    } else if (request.radiusMeters) {
      spatialFeatures = filterWithinRadius(spatialFeatures, {
        latitude: origin.latitude,
        longitude: origin.longitude,
        radiusMeters: request.radiusMeters
      });
    }

    spatialFeatures = attachDistanceLabels(spatialFeatures);

    datasetResults.push({
      datasetId: dataset.id,
      displayName: dataset.displayName,
      sourceId: dataset.sourceId,
      authority: dataset.authority,
      catalogueUrl: dataset.catalogueUrl,
      iqaiType: dataset.iqaiType,
      matchedFeatures: spatialFeatures.length,
      totalSourceRecords: loaded.totalSourceRecords,
      closedExcluded: loaded.closedExcluded,
      ambiguousExcluded: loaded.ambiguousExcluded,
      features: spatialFeatures,
      renderMeta: {
        symbol: dataset.symbol,
        detailFields: dataset.detailFields
      }
    });

    allFeatures.push(...spatialFeatures);
  }

  return {
    features: allFeatures,
    datasetResults,
    totalSourceRecords: datasetResults.reduce((sum, r) => sum + r.totalSourceRecords, 0),
    closedExcluded: datasetResults.reduce((sum, r) => sum + (r.closedExcluded || 0), 0),
    ambiguousExcluded: datasetResults.reduce((sum, r) => sum + (r.ambiguousExcluded || 0), 0)
  };
}

export function buildSpatialOperationLabel(request) {
  const datasetLabel = (request.datasets || []).map((d) => d.displayName).join(' + ') || '—';
  switch (request.action) {
    case 'LOCATE':
      return 'Locate';
    case 'SHOW':
      return request.radiusMeters
        ? `Show within ${formatRadiusKm(request.radiusMeters)} km`
        : 'Show in Montréal';
    case 'WITHIN':
      return `Within ${formatRadiusKm(request.radiusMeters)} km`;
    case 'NEAREST':
      return `Nearest ${request.limit}`;
    case 'COUNT':
      return `Count within ${formatRadiusKm(request.radiusMeters)} km`;
    case 'CLEAR':
      return 'Clear';
    default:
      return datasetLabel;
  }
}

export function clearAllDatasetCaches() {
  clearDatasetCache();
}

export { clearDatasetCache };
