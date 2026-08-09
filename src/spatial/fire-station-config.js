/** Official Ville de Montréal fire station open-data source (verified live). */

export const MTL_FIRE_STATIONS_SOURCE_ID = 'MTL_FIRE_STATIONS_001';

export const MTL_FIRE_STATIONS_CATALOGUE_URL =
  'https://donnees.montreal.ca/en/dataset/casernes-pompiers';

export const MTL_FIRE_STATIONS_GEOJSON_URL =
  'https://donnees.montreal.ca/dataset/c69e78c6-e454-4bd9-9778-e4b0eaf8105b/resource/beff8ce0-7a61-4a82-95b5-96d89bafa671/download/casernes.geojson';

export const MTL_FIRE_STATIONS_FETCH_TIMEOUT_MS = 30_000;

export const MTL_FIRE_STATIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
