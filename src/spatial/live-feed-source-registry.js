import {
  HYDRO_LAYER_ID,
  HYDRO_LAYER_TITLE,
  HYDRO_SOURCE_NAME,
  HYDRO_REFRESH_MS
} from './hydro-quebec-outages-config.js';
import {
  STM_LAYER_ID,
  STM_LAYER_TITLE,
  STM_SOURCE_LABEL,
  STM_CLIENT_REFRESH_MS
} from './stm-gtfs-rt-config.js';

export const LIVE_FEED_SOURCE_CLASS = 'OFFICIAL_OPEN_DATA';
export const LIVE_FEED_TRUST_TIER = 'TRUSTED_EXTERNAL';

/** @type {object[]} */
export const LIVE_FEED_SOURCES = [
  {
    id: 'STM_LIVE_BUSES',
    layerId: STM_LAYER_ID,
    title: STM_LAYER_TITLE,
    sourceClass: LIVE_FEED_SOURCE_CLASS,
    trustTier: LIVE_FEED_TRUST_TIER,
    provider: 'Société de transport de Montréal',
    sourceName: STM_SOURCE_LABEL,
    refreshTargetMs: STM_CLIENT_REFRESH_MS,
    geometryType: 'esriGeometryPoint',
    spatialPrecision: 'Live vehicle position',
    capabilities: {
      LIVE_FEED: true,
      COUNT: true
    },
    provenance: {
      authorityLabel: `${LIVE_FEED_TRUST_TIER} / STM GTFS-Realtime`,
      catalogueUrl: 'https://www.stm.info/en/info/developers'
    }
  },
  {
    id: 'HYDRO_QUEBEC_CURRENT_OUTAGES',
    layerId: HYDRO_LAYER_ID,
    title: HYDRO_LAYER_TITLE,
    sourceClass: LIVE_FEED_SOURCE_CLASS,
    trustTier: LIVE_FEED_TRUST_TIER,
    provider: 'Hydro-Québec',
    sourceName: HYDRO_SOURCE_NAME,
    refreshTargetMs: HYDRO_REFRESH_MS,
    geometryType: 'esriGeometryPoint',
    spatialPrecision: 'Approximate outage location',
    indicativeAreas: true,
    capabilities: {
      LIVE_FEED: true,
      COUNT: true,
      WITHIN: true,
      CURRENT_OUTAGE: true
    },
    provenance: {
      authorityLabel: `${LIVE_FEED_TRUST_TIER} / Hydro-Québec Open Data`,
      catalogueUrl: 'https://pannes.hydroquebec.com/pannes/donnees/v3_0/bisversion.json'
    }
  }
];

export function getLiveFeedSource(id) {
  return LIVE_FEED_SOURCES.find((entry) => entry.id === id) || null;
}

export function listLiveFeedSources() {
  return LIVE_FEED_SOURCES.map((entry) => ({
    id: entry.id,
    layerId: entry.layerId,
    title: entry.title,
    sourceClass: entry.sourceClass,
    trustTier: entry.trustTier,
    capabilities: entry.capabilities
  }));
}
