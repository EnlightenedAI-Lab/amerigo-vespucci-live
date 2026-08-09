import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import {
  STM_GTFS_RT_BASE_URL,
  STM_VEHICLE_POSITIONS_PATH,
  STM_SOURCE_LABEL
} from './stm-gtfs-rt-config.js';

function getApiKey() {
  const key = String(process.env.STM_API_KEY || '').trim();
  return key || null;
}

function decodeTimestamp(value) {
  if (value == null) return null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeVehicle(entity) {
  const vehicle = entity?.vehicle;
  const position = vehicle?.position;
  if (!position) return null;

  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const bearing = position.bearing != null ? Number(position.bearing) : null;
  const speed = position.speed != null ? Number(position.speed) : null;
  const vehicleTimestamp = decodeTimestamp(vehicle.timestamp);

  return {
    vehicleId: String(entity.id || ''),
    routeId: vehicle.trip?.routeId || null,
    tripId: vehicle.trip?.tripId || null,
    bearing: Number.isFinite(bearing) ? bearing : null,
    speed: Number.isFinite(speed) ? speed : null,
    timestamp: vehicleTimestamp,
    latitude,
    longitude
  };
}

/**
 * Fetch and decode STM GTFS-Realtime vehicle positions (server-side only).
 * @param {{ fetchFn?: typeof fetch }} [options]
 */
export async function fetchStmVehiclePositions(options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'STM_API_KEY is not configured on the server.' };
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const url = `${STM_GTFS_RT_BASE_URL}${STM_VEHICLE_POSITIONS_PATH}`;

  try {
    const response = await fetchFn(url, {
      headers: {
        apikey: apiKey,
        accept: 'application/x-protobuf'
      }
    });

    if (!response.ok) {
      return { ok: false, error: `STM API HTTP ${response.status}` };
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    const feedTimestamp = decodeTimestamp(feed.header?.timestamp);
    const vehicles = [];

    for (const entity of feed.entity || []) {
      const normalized = normalizeVehicle(entity);
      if (normalized) vehicles.push(normalized);
    }

    const retrievedAt = new Date().toISOString();

    return {
      ok: true,
      source: STM_SOURCE_LABEL,
      feedTimestamp,
      feedTimestampIso: feedTimestamp ? new Date(feedTimestamp * 1000).toISOString() : null,
      retrievedAt,
      vehicleCount: vehicles.length,
      vehicles
    };
  } catch (error) {
    return { ok: false, error: error?.message || 'STM GTFS-RT request failed' };
  }
}
