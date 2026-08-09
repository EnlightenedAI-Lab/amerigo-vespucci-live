/** IQAI proxy for EnlightenedAI-Lab SPVM 90-day GeoJSON service */

export const SPVM_UPSTREAM_GEOJSON_URL =
  'https://enlightenedai-lab.github.io/iqai-spvm-data/spvm/spvm-crime-90d.geojson';

export const SPVM_UPSTREAM_STATUS_URL =
  'https://enlightenedai-lab.github.io/iqai-spvm-data/spvm/status.json';

export const SPVM_SOURCE_NAME = 'Service de police de la Ville de Montréal';
export const SPVM_DATASET_NAME = 'Actes criminels';
export const SPVM_LICENSE = 'CC BY 4.0';

/** Server-side cache — source updates once daily */
export const SPVM_SERVER_CACHE_MS = 45 * 60 * 1000;

export const SPVM_USER_AGENT = 'IQAI-SPVM-Proxy/1.0 (+https://github.com/EnlightenedAI-Lab/iqai-spvm-data)';
