export const AISSTREAM_SOURCE_ID = 'aisstream';
export const AISSTREAM_SOURCE_NAME = 'AISStream.io';
export const AISSTREAM_SOURCE_URL = 'https://aisstream.io/';
export const AISSTREAM_SOURCE_LICENSE = 'AISStream terms of use';
export const AISSTREAM_SOURCE_NOTE = 'Free community AIS WebSocket API; API key required.';

export const AISSTREAM_DEFAULT_URL = 'wss://stream.aisstream.io/v0/stream';

/**
 * Spatial V2 chassis does not own the AISStream provider socket.
 * Default off. Opt in only with IQAI_AIS_SPATIAL_STREAM=on.
 */
export const AIS_SPATIAL_STREAM_ENV = 'IQAI_AIS_SPATIAL_STREAM';

export function isAisSpatialStreamEnabled(env = process.env) {
  const raw = String(env?.[AIS_SPATIAL_STREAM_ENV] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes'
    || raw === 'enable' || raw === 'enabled';
}

/** Greater Montréal + Port of Montréal + St. Lawrence approach */
export const MONTREAL_VESSEL_BOUNDS = {
  minLat: 44.75,
  maxLat: 46.35,
  minLon: -74.85,
  maxLon: -71.75
};

export function montrealBoundingBoxes() {
  return [[
    [MONTREAL_VESSEL_BOUNDS.minLat, MONTREAL_VESSEL_BOUNDS.minLon],
    [MONTREAL_VESSEL_BOUNDS.maxLat, MONTREAL_VESSEL_BOUNDS.maxLon]
  ]];
}

export function isWithinMontrealBounds(lat, lon) {
  return lat >= MONTREAL_VESSEL_BOUNDS.minLat
    && lat <= MONTREAL_VESSEL_BOUNDS.maxLat
    && lon >= MONTREAL_VESSEL_BOUNDS.minLon
    && lon <= MONTREAL_VESSEL_BOUNDS.maxLon;
}

/** Position age ≤ this → CURRENT */
export const AIS_POSITION_CURRENT_SECONDS = 600;
/** Position age > CURRENT and ≤ this → STALE (still displayed) */
export const AIS_POSITION_STALE_SECONDS = 1800;
/** No position update for longer → REMOVE from snapshot */

export const AIS_CLIENT_REFRESH_MS = 8_000;
export const AIS_INVALID_HEADING = 511;

export const VESSELS_LAYER_ID = 'live-vessels';
export const VESSELS_LAYER_TITLE = 'Vessels — Live';
export const MARINE_GROUP_TITLE = 'Marine';
