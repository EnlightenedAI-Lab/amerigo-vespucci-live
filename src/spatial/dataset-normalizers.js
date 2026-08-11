import { getCuratedSource } from './source-registry.js';
import { MTL_FIRE_STATIONS_SOURCE_ID } from './fire-station-config.js';
import {
  classifyOperationalStatus,
  isValidDateDebut,
  isEmptyDateFin
} from './fire-station-query.js';
import { DATASET_IDS } from './dataset-registry.js';

function buildStreetAddress(parts) {
  return parts.filter(Boolean).join(' ').trim() || '—';
}

function extractPdq(desc) {
  const text = String(desc || '').trim();
  const match = text.match(/(\d+)/);
  return match ? `PDQ ${match[1]}` : text || '—';
}

/**
 * @param {object} dataset
 * @param {object} props
 * @param {string} receivedAt
 */
export function normalizeFeature(dataset, props, receivedAt = new Date().toISOString()) {
  switch (dataset.id) {
    case DATASET_IDS.FIRE_STATIONS:
      return normalizeFireStation(props, receivedAt);
    case DATASET_IDS.POLICE_STATIONS:
      return normalizePoliceStation(dataset, props, receivedAt);
    case DATASET_IDS.SCHOOLS:
      return normalizeSchool(dataset, props, receivedAt);
    case DATASET_IDS.HOSPITALS:
      return normalizeHospital(dataset, props, receivedAt);
    case DATASET_IDS.TRANSIT:
      return normalizeTransitStop(dataset, props, receivedAt);
    case DATASET_IDS.PUBLIC_BUILDINGS:
      return normalizePublicBuilding(dataset, props, receivedAt);
    default:
      return null;
  }
}

function normalizeFireStation(props, receivedAt) {
  const lat = Number(props.LATITUDE ?? props.latitude);
  const lon = Number(props.LONGITUDE ?? props.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const source = getCuratedSource(MTL_FIRE_STATIONS_SOURCE_ID);
  const status = classifyOperationalStatus(props);
  const civic = String(props.NO_CIVIQUE || '').trim();
  const street = String(props.RUE || '').trim();
  return {
    id: String(props.CASERNE || props.OBJECTID || `${lat},${lon}`),
    datasetId: DATASET_IDS.FIRE_STATIONS,
    iqaiType: 'fire_station',
    stationNumber: String(props.CASERNE || '').trim() || null,
    name: `Station ${String(props.CASERNE || '').trim() || '—'}`,
    address: buildStreetAddress([civic, street]) || String(props.CASERNE || '').trim() || '—',
    borough: String(props.ARRONDISSEMENT || '').trim() || null,
    operationalStatus: status.operationalStatus,
    isActive: status.isActive,
    dateDebut: status.dateDebut,
    dateFin: status.dateFin,
    latitude: lat,
    longitude: lon,
    sourceId: MTL_FIRE_STATIONS_SOURCE_ID,
    sourceName: source?.name || 'Ville de Montréal — Fire Stations',
    authority: source?.authority || 'Ville de Montréal',
    receivedAt,
    spatialPrecision: 'Deterministic GIS'
  };
}

function normalizePoliceStation(dataset, props, receivedAt) {
  const lat = Number(props.LATITUDE ?? props.latitude);
  const lon = Number(props.LONGITUDE ?? props.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const civic = String(props.NO_CIV_LIE || '').trim();
  const prefix = String(props.PREFIX_TEM || '').trim();
  const name = String(props.NOM_TEMP || '').trim();
  const dir = String(props.DIR_TEMP || '').trim();
  const mun = String(props.MUN_TEMP || '').trim();
  const desc = String(props.DESC_LIEU || '').trim();
  return {
    id: String(props.OBJECTID || props.PDQ || desc || `${lat},${lon}`),
    datasetId: DATASET_IDS.POLICE_STATIONS,
    iqaiType: 'police_station',
    pdq: extractPdq(desc),
    name: desc || extractPdq(desc),
    address: buildStreetAddress([civic, prefix, name, dir, mun]),
    latitude: lat,
    longitude: lon,
    sourceId: dataset.sourceId,
    sourceName: dataset.displayName,
    authority: dataset.authority,
    receivedAt,
    spatialPrecision: 'Deterministic GIS'
  };
}

function normalizeSchool(dataset, row, receivedAt) {
  const lon = Number(row.COORD_X_LL84_IMM);
  const lat = Number(row.COORD_Y_LL84_IMM);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = String(row.NOM_OFFCL_ORGNS || row.NOM_COURT_ORGNS || '').trim();
  const address = String(row.ADRS_GEO_L1_GDUNO_IMM || row.ADRS_GEO_L1_GDUNO_ORGNS || '').trim();
  const city = String(row.NOM_MUNCP_GDUNO_IMM || row.NOM_MUNCP || '').trim();
  const schoolType = String(row.ORDRE_ENS || '').trim() || null;
  return {
    id: String(row.COMBINE_NUO_NUI || row.CD_ORGNS || name || `${lat},${lon}`),
    datasetId: DATASET_IDS.SCHOOLS,
    iqaiType: 'school',
    name: name || '—',
    schoolType,
    address: address || '—',
    city,
    latitude: lat,
    longitude: lon,
    sourceId: dataset.sourceId,
    sourceName: dataset.displayName,
    authority: dataset.authority,
    receivedAt,
    spatialPrecision: 'Deterministic GIS'
  };
}

function normalizeHospital(dataset, row, receivedAt) {
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const streetNo = String(row.street_no || '').trim();
  const streetName = String(row.street_name || '').trim();
  const city = String(row.city || '').trim();
  const province = String(row.province || '').trim();
  const postal = String(row.postal_code || '').trim();
  const addressParts = [streetNo, streetName, city, province, postal].filter(Boolean);
  return {
    id: String(row.index || row.facility_name || `${lat},${lon}`),
    datasetId: DATASET_IDS.HOSPITALS,
    iqaiType: 'hospital',
    name: String(row.facility_name || '').trim() || '—',
    facilityType: String(row.source_facility_type || row.odhf_facility_type || '').trim() || 'Hospital',
    address: addressParts.join(', ') || String(row.source_format_str_address || '').trim() || '—',
    latitude: lat,
    longitude: lon,
    sourceId: dataset.sourceId,
    sourceName: dataset.displayName,
    authority: dataset.authority,
    receivedAt,
    spatialPrecision: 'Deterministic GIS'
  };
}

function normalizePublicBuilding(dataset, props, receivedAt) {
  const lat = Number(props.latitude ?? props.lat);
  const lon = Number(props.longitude ?? props.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = String(props.titre_lieu || props.name || '').trim();
  const buildingType = String(props.types || props.buildingType || '').trim() || 'Public building';
  const address = String(props.adresse_postale || props.address || '').trim() || '—';
  return {
    id: String(props.url_fiche || name || `${lat},${lon}`),
    featureId: String(props.url_fiche || name || `${lat},${lon}`),
    datasetId: DATASET_IDS.PUBLIC_BUILDINGS,
    iqaiType: 'public_building',
    name: name || '—',
    buildingType,
    address,
    latitude: lat,
    longitude: lon,
    sourceId: dataset.sourceId,
    sourceName: dataset.displayName,
    authority: dataset.authority,
    receivedAt,
    spatialPrecision: 'Deterministic GIS'
  };
}

function normalizeTransitStop(dataset, row, receivedAt) {
  const lat = Number(row.stop_lat);
  const lon = Number(row.stop_lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = String(row.stop_name || '').trim();
  const mode = inferTransitMode(name, row);
  return {
    id: String(row.stop_id || `${lat},${lon}`),
    datasetId: DATASET_IDS.TRANSIT,
    iqaiType: 'transit_stop',
    name: name || String(row.stop_id || '—'),
    transitMode: mode,
    latitude: lat,
    longitude: lon,
    sourceId: dataset.sourceId,
    sourceName: dataset.displayName,
    authority: dataset.authority,
    receivedAt,
    spatialPrecision: 'Deterministic GIS'
  };
}

function inferTransitMode(stopName, row) {
  const name = String(stopName || '').toLowerCase();
  if (/station|métro|metro/i.test(name)) return 'Metro';
  if (String(row.location_type || '') === '1') return 'Station';
  return 'Bus';
}

export function isGovernmentPublicBuilding(props = {}) {
  const types = String(props.types || '');
  const title = String(props.titre_lieu || props.name || '');
  const haystack = `${types} ${title}`.toLowerCase();
  if (/points of service|points de service/i.test(types)) return true;
  return /\b(borough hall|city hall|hôtel de ville|hotel de ville|mairie|municipal hall|arrondissement hall|service point|service centre|service center)\b/i.test(haystack);
}

export function applyOperationalFilter(dataset, features) {
  if (dataset.id === DATASET_IDS.FIRE_STATIONS) {
    return features.filter((f) => f.isActive && f.operationalStatus === 'Active');
  }
  return features;
}

export function isMontrealFeature(feature, dataset) {
  if (dataset.id === DATASET_IDS.SCHOOLS) {
    const city = String(feature.city || '').toLowerCase();
    return /montréal|montreal/.test(city);
  }
  return true;
}

export function isMontrealHospitalRow(row) {
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  return lat >= 45.41 && lat <= 45.70 && lon >= -73.98 && lon <= -73.47;
}

export function isMontrealSchoolRow(row) {
  const city = String(row.NOM_MUNCP_GDUNO_IMM || row.NOM_MUNCP || '').toLowerCase();
  return /montréal|montreal/.test(city);
}

export function isHospitalOdhfRow(row) {
  return String(row.odhf_facility_type || '').trim() === 'Hospitals';
}
