import {
  MTL_FIRE_STATIONS_CATALOGUE_URL,
  MTL_FIRE_STATIONS_GEOJSON_URL,
  MTL_FIRE_STATIONS_SOURCE_ID
} from './fire-station-config.js';
import { getResultSymbol } from './result-symbol-registry.js';

export const DATASET_IDS = {
  FIRE_STATIONS: 'FIRE_STATIONS',
  POLICE_STATIONS: 'POLICE_STATIONS',
  SCHOOLS: 'SCHOOLS',
  HOSPITALS: 'HOSPITALS',
  TRANSIT: 'TRANSIT',
  PUBLIC_BUILDINGS: 'PUBLIC_BUILDINGS'
};

/** Approximate Island of Montréal bounding box (WGS84). */
export const MONTREAL_BBOX = {
  minLat: 45.41,
  maxLat: 45.70,
  minLon: -73.98,
  maxLon: -73.47
};

export const FETCH_TIMEOUT_MS = 30_000;
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @type {object[]} */
export const VERIFIED_DATASETS = [
  {
    id: DATASET_IDS.FIRE_STATIONS,
    sourceId: MTL_FIRE_STATIONS_SOURCE_ID,
    displayName: 'Fire Stations',
    pluralLabel: 'fire stations',
    aliases: [
      'fire station', 'fire stations', 'caserne', 'casernes', 'pompier', 'pompiers',
      'station pompiers', 'stations pompiers'
    ],
    authority: 'Ville de Montréal',
    publisher: 'Ville de Montréal / SIM',
    catalogueUrl: MTL_FIRE_STATIONS_CATALOGUE_URL,
    dataUrl: MTL_FIRE_STATIONS_GEOJSON_URL,
    dataFormat: 'geojson',
    geometryType: 'point',
    coordinateSystem: 'EPSG:4326',
    coverage: 'Island of Montréal',
    operationalFilter: 'date_debut_fin',
    hospitalFilter: null,
    iqaiType: 'fire_station',
    symbol: getResultSymbol(DATASET_IDS.FIRE_STATIONS),
    detailFields: [
      { label: 'Station', attribute: 'stationNumber', prefix: 'Station ' },
      { label: 'Address', attribute: 'address' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Operational status', attribute: 'operationalStatus' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ],
    provenance: 'Official open-data GeoJSON — Casernes de pompiers sur l’île de Montréal'
  },
  {
    id: DATASET_IDS.POLICE_STATIONS,
    sourceId: 'MTL_POLICE_STATIONS_001',
    displayName: 'Police Stations',
    pluralLabel: 'police stations',
    aliases: [
      'police station', 'police stations', 'spvm', 'poste de police', 'postes de police',
      'poste de quartier', 'postes de quartier', 'pdq'
    ],
    authority: 'Ville de Montréal',
    publisher: 'Service de police de la Ville de Montréal (SPVM)',
    catalogueUrl: 'https://donnees.montreal.ca/en/dataset/neighborhood-police-stations-on-montreal-island',
    dataUrl: 'https://donnees.montreal.ca/fr/dataset/91f66001-b461-4f63-aff4-cddc0fe30ffe/resource/c9d0b8d6-c7a6-4766-a5cc-98e8b1392bbc/download/pdq.geojson',
    dataFormat: 'geojson',
    geometryType: 'point',
    coordinateSystem: 'EPSG:4326',
    coverage: 'Island of Montréal',
    operationalFilter: null,
    iqaiType: 'police_station',
    symbol: getResultSymbol(DATASET_IDS.POLICE_STATIONS),
    detailFields: [
      { label: 'PDQ', attribute: 'pdq' },
      { label: 'Address', attribute: 'address' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ],
    provenance: 'Postes de police de quartier sur l’île de Montréal (SPVM GeoJSON)'
  },
  {
    id: DATASET_IDS.SCHOOLS,
    sourceId: 'QC_SCHOOLS_001',
    displayName: 'Schools',
    pluralLabel: 'schools',
    aliases: [
      'school', 'schools', 'école', 'écoles', 'ecole', 'ecoles', 'établissement scolaire',
      'établissements scolaires'
    ],
    authority: 'Ministère de l’Éducation et Ministère de l’Enseignement supérieur',
    publisher: 'Gouvernement du Québec',
    catalogueUrl: 'https://www.donneesquebec.ca/recherche/dataset/localisation-des-etablissements-d-enseignement-du-reseau-scolaire-au-quebec',
    dataUrl: 'https://www.donneesquebec.ca/recherche/dataset/2d3b5cf8-b347-49c7-ad3b-bd6a9c15e443/resource/c6640a54-bc4b-43ec-864e-6c325dce61bc/download/pps_public_ecole.csv',
    dataFormat: 'csv',
    geometryType: 'point',
    coordinateSystem: 'EPSG:4326',
    coverage: 'Québec public schools (Montréal filter applied at query time)',
    operationalFilter: null,
    montrealField: 'NOM_MUNCP_GDUNO_IMM',
    iqaiType: 'school',
    symbol: getResultSymbol(DATASET_IDS.SCHOOLS),
    detailFields: [
      { label: 'School name', attribute: 'name' },
      { label: 'Type', attribute: 'schoolType' },
      { label: 'Address', attribute: 'address' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ],
    provenance: 'Localisation des établissements d’enseignement — réseau public (CSV)'
  },
  {
    id: DATASET_IDS.HOSPITALS,
    sourceId: 'STATCAN_HOSPITALS_001',
    displayName: 'Hospitals',
    pluralLabel: 'hospitals',
    aliases: ['hospital', 'hospitals', 'hôpital', 'hôpitaux', 'hopital', 'hopitaux'],
    authority: 'Statistics Canada',
    publisher: 'Statistics Canada — Open Database of Healthcare Facilities (ODHF)',
    catalogueUrl: 'https://open.canada.ca/data/en/dataset/a1bcd4ee-8e57-499b-9c6f-94f6902fdf32',
    dataUrl: 'https://ftp.maps.canada.ca/pub/statcan_statcan/Health-care-facilities_Etablissement-de-sante/ODHF_BDOES/odhf_bdoes_v1.csv',
    dataFormat: 'csv',
    geometryType: 'point',
    coordinateSystem: 'EPSG:4326',
    coverage: 'Canada (hospital facilities only; odhf_facility_type = Hospitals)',
    operationalFilter: null,
    hospitalFilter: 'odhf_hospitals_only',
    iqaiType: 'hospital',
    symbol: getResultSymbol(DATASET_IDS.HOSPITALS),
    detailFields: [
      { label: 'Name', attribute: 'name' },
      { label: 'Facility type', attribute: 'facilityType' },
      { label: 'Address', attribute: 'address' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ],
    provenance: 'ODHF — facilities where odhf_facility_type is Hospitals (excludes clinics, pharmacies, nursing homes)'
  },
  {
    id: DATASET_IDS.TRANSIT,
    sourceId: 'STM_TRANSIT_001',
    displayName: 'Transit Stops',
    pluralLabel: 'transit stops',
    aliases: [
      'transit', 'transit stop', 'transit stops', 'metro', 'métro', 'metro station',
      'metro stations', 'stm', 'bus stop', 'bus stops', 'arrêt', 'arrêts'
    ],
    authority: 'Société de transport de Montréal',
    publisher: 'STM',
    catalogueUrl: 'https://www.donneesquebec.ca/recherche/dataset/vmtl-stm-horaires-planifies-et-trajets-des-bus-et-du-metro',
    dataUrl: 'http://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip',
    dataFormat: 'gtfs_zip',
    zipEntry: 'stops.txt',
    geometryType: 'point',
    coordinateSystem: 'EPSG:4326',
    coverage: 'STM bus and metro stops (Montréal)',
    operationalFilter: null,
    iqaiType: 'transit_stop',
    symbol: getResultSymbol(DATASET_IDS.TRANSIT),
    detailFields: [
      { label: 'Stop/station name', attribute: 'name' },
      { label: 'Mode', attribute: 'transitMode' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ],
    provenance: 'STM GTFS stops.txt — bus and metro stop locations'
  },
  {
    id: DATASET_IDS.PUBLIC_BUILDINGS,
    sourceId: 'MTL_PUBLIC_BUILDINGS_001',
    displayName: 'Public Buildings',
    pluralLabel: 'government buildings',
    aliases: [
      'government building', 'government buildings', 'public building', 'public buildings',
      'municipal building', 'municipal buildings', 'government facility', 'government facilities',
      'points of service', 'points de service', 'bâtiment public', 'batiment public'
    ],
    authority: 'Ville de Montréal',
    publisher: 'Ville de Montréal — Données ouvertes',
    catalogueUrl: 'https://donnees.montreal.ca/en/dataset/lieux-batiments-vocation-publique',
    dataUrl: 'https://donnees.montreal.ca/dataset/43146e84-aaed-4552-87bf-e03954b81c20/resource/c58457eb-b4e7-46c4-abce-21137839bcd8/download/lieux-en.geojson',
    dataFormat: 'geojson',
    geometryType: 'point',
    coordinateSystem: 'EPSG:4326',
    coverage: 'Island of Montréal — public-purpose places and buildings',
    operationalFilter: 'government_public_building',
    iqaiType: 'public_building',
    symbol: getResultSymbol(DATASET_IDS.PUBLIC_BUILDINGS),
    detailFields: [
      { label: 'Name', attribute: 'name' },
      { label: 'Type', attribute: 'buildingType' },
      { label: 'Address', attribute: 'address' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ],
    provenance: 'Lieux et bâtiments à vocation publique — Ville de Montréal open data (Points of service subset)'
  }
];

export function getDatasetById(id) {
  return VERIFIED_DATASETS.find((d) => d.id === id) || null;
}

export function resolveDatasetFromText(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  let best = null;
  let bestLen = 0;
  for (const dataset of VERIFIED_DATASETS) {
    for (const alias of dataset.aliases) {
      const aliasNorm = alias
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (normalized.includes(aliasNorm) && aliasNorm.length > bestLen) {
        best = dataset;
        bestLen = aliasNorm.length;
      }
    }
  }
  return best;
}

export function resolveDatasetsFromPhrase(phrase) {
  const parts = String(phrase || '')
    .split(/\s+(?:and|et)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const datasets = [];
  const seen = new Set();
  for (const part of parts) {
    const dataset = resolveDatasetFromText(part);
    if (!dataset) return { datasets: [], unresolved: part };
    if (!seen.has(dataset.id)) {
      seen.add(dataset.id);
      datasets.push(dataset);
    }
  }
  return { datasets, unresolved: null };
}

export function listVerifiedDatasets() {
  return VERIFIED_DATASETS.map((d) => ({
    id: d.id,
    sourceId: d.sourceId,
    displayName: d.displayName,
    authority: d.authority,
    catalogueUrl: d.catalogueUrl,
    dataUrl: d.dataUrl,
    coverage: d.coverage
  }));
}
