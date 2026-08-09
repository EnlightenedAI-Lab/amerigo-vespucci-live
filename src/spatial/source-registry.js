import {
  MTL_FIRE_STATIONS_CATALOGUE_URL,
  MTL_FIRE_STATIONS_GEOJSON_URL,
  MTL_FIRE_STATIONS_SOURCE_ID
} from './fire-station-config.js';
import { VERIFIED_DATASETS } from './dataset-registry.js';

/** @type {object[]} */
export const CURATED_SOURCES = VERIFIED_DATASETS.map((dataset) => ({
  id: dataset.sourceId,
  name: dataset.displayName,
  type: 'reference-points',
  url: dataset.dataUrl,
  catalogueUrl: dataset.catalogueUrl,
  category: 'where',
  temporalClass: 'REFERENCE',
  access: 'public',
  trust: 'AUTHORITATIVE_PUBLIC',
  intendedUses: ['reference point mapping', 'proximity analysis', 'public-safety context'],
  queryable: true,
  visible: true,
  authority: dataset.authority,
  coverage: dataset.coverage,
  geometryType: 'esriGeometryPoint',
  provenance: dataset.provenance,
  datasetId: dataset.id
}));

export function getCuratedSource(id) {
  return CURATED_SOURCES.find((s) => s.id === id) || null;
}

export function listWhereSources() {
  return CURATED_SOURCES.filter((s) => s.category === 'where');
}

export { MTL_FIRE_STATIONS_SOURCE_ID, MTL_FIRE_STATIONS_CATALOGUE_URL, MTL_FIRE_STATIONS_GEOJSON_URL };
