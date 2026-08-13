/**
 * Area Acquisition geometry — polygon tests, bbox, boundary distance.
 * Presentation/classification only. Does not imply coverage or dependence.
 */

export const AOI_CLASS = Object.freeze({
  INSIDE_AOI: 'INSIDE_AOI',
  SUPPORTING_EXTERNAL: 'SUPPORTING_EXTERNAL'
});

/** Connector is distance-to-boundary only. Not dependency, flow, coverage, or a network edge. */
export const CONNECTOR_MEANING = 'SPATIAL_DISTANCE_TO_ACQUISITION_AREA';

export const AOI_PROOF_FAMILIES = Object.freeze(['hydrometric', 'weather']);

/** Extra retrieval beyond AOI envelope so a family with no inside station can still find a supporting source. */
export const AOI_EXTERNAL_BUFFER_METERS = 15000;
export const AOI_MAX_QUERY_RADIUS_METERS = 50000;

const EARTH_M = 6371000;

export function haversineMeters(lon1, lat1, lon2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function polygonRings(polygon) {
  if (!polygon) return [];
  if (Array.isArray(polygon.rings)) return polygon.rings;
  if (polygon.type === 'Polygon' && Array.isArray(polygon.coordinates)) return polygon.coordinates;
  if (polygon.type === 'MultiPolygon' && Array.isArray(polygon.coordinates)) {
    return polygon.coordinates.flat();
  }
  return [];
}

export function polygonEnvelope(polygon) {
  const rings = polygonRings(polygon);
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const coord of ring) {
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

export function polygonCentroid(polygon) {
  const env = polygonEnvelope(polygon);
  if (!env) return null;
  return {
    longitude: (env.minLon + env.maxLon) / 2,
    latitude: (env.minLat + env.maxLat) / 2
  };
}

export function expandEnvelope(envelope, meters) {
  if (!envelope || !Number.isFinite(meters) || meters <= 0) return envelope;
  const midLat = (envelope.minLat + envelope.maxLat) / 2;
  const deltaLat = meters / 111320;
  const deltaLon = meters / (111320 * Math.max(Math.cos((midLat * Math.PI) / 180), 0.1));
  return {
    minLon: envelope.minLon - deltaLon,
    minLat: envelope.minLat - deltaLat,
    maxLon: envelope.maxLon + deltaLon,
    maxLat: envelope.maxLat + deltaLat
  };
}

export function envelopeToBbox(envelope) {
  if (!envelope) return null;
  return [envelope.minLon, envelope.minLat, envelope.maxLon, envelope.maxLat];
}

export function coveringRadiusMeters(polygon, centroid = null) {
  const center = centroid || polygonCentroid(polygon);
  const env = polygonEnvelope(polygon);
  if (!center || !env) return null;
  const corners = [
    [env.minLon, env.minLat],
    [env.minLon, env.maxLat],
    [env.maxLon, env.minLat],
    [env.maxLon, env.maxLat]
  ];
  let max = 0;
  for (const [lon, lat] of corners) {
    const d = haversineMeters(center.longitude, center.latitude, lon, lat);
    if (d > max) max = d;
  }
  return max;
}

/**
 * Query plan for existing point/radius PI APIs.
 * Radius covers the AOI envelope plus an external supporting buffer, capped.
 */
export function queryPlanFromAoi(polygon, options = {}) {
  const centroid = polygonCentroid(polygon);
  const envelope = polygonEnvelope(polygon);
  if (!centroid || !envelope) return null;
  const cover = coveringRadiusMeters(polygon, centroid) || 0;
  const buffer = Number.isFinite(options.externalBufferMeters)
    ? options.externalBufferMeters
    : AOI_EXTERNAL_BUFFER_METERS;
  const cap = Number.isFinite(options.maxRadiusMeters)
    ? options.maxRadiusMeters
    : AOI_MAX_QUERY_RADIUS_METERS;
  const radiusMeters = Math.min(cap, Math.max(1000, Math.ceil(cover + buffer)));
  const queryEnvelope = expandEnvelope(envelope, buffer);
  return {
    centroid,
    radiusMeters,
    envelope,
    queryEnvelope,
    bbox: envelopeToBbox(queryEnvelope),
    aoiBbox: envelopeToBbox(envelope)
  };
}

export function pointInRing(longitude, latitude, ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      continue;
    }
    const intersect = ((yi > latitude) !== (yj > latitude))
      && (longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Exterior ring even-odd, holes subtract. */
export function pointInPolygon(longitude, latitude, polygon) {
  const rings = polygonRings(polygon);
  if (!rings.length) return false;
  if (!pointInRing(longitude, latitude, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(longitude, latitude, rings[i])) return false;
  }
  return true;
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return { longitude: ax, latitude: ay };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { longitude: ax + t * dx, latitude: ay + t * dy };
}

export function nearestBoundaryPoint(longitude, latitude, polygon) {
  const rings = polygonRings(polygon);
  let best = null;
  let bestDist = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const ax = Number(ring[i][0]);
      const ay = Number(ring[i][1]);
      const bx = Number(ring[i + 1][0]);
      const by = Number(ring[i + 1][1]);
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const point = closestPointOnSegment(longitude, latitude, ax, ay, bx, by);
      const dist = haversineMeters(longitude, latitude, point.longitude, point.latitude);
      if (dist < bestDist) {
        bestDist = dist;
        best = point;
      }
    }
  }
  return best ? { ...best, distanceMeters: bestDist } : null;
}

export function distanceToPolygonBoundaryMeters(longitude, latitude, polygon) {
  if (pointInPolygon(longitude, latitude, polygon)) return 0;
  const nearest = nearestBoundaryPoint(longitude, latitude, polygon);
  return nearest ? nearest.distanceMeters : null;
}

export function classifyPointAgainstAoi(longitude, latitude, polygon) {
  const inside = pointInPolygon(longitude, latitude, polygon);
  const nearest = nearestBoundaryPoint(longitude, latitude, polygon);
  return {
    aoiClassification: inside ? AOI_CLASS.INSIDE_AOI : AOI_CLASS.SUPPORTING_EXTERNAL,
    aoiBoundaryDistanceMeters: inside ? 0 : (nearest?.distanceMeters ?? null),
    aoiNearestBoundary: nearest
      ? { longitude: nearest.longitude, latitude: nearest.latitude }
      : null,
    insideAoi: inside
  };
}

/**
 * Keep every inside station. If a proof family has none inside, keep the nearest external only.
 * Does not treat INSIDE as coverage of the polygon.
 */
export function selectConstellationStations(records = [], polygon) {
  if (!polygon) {
    return records.map((record) => ({
      ...record,
      aoiClassification: null,
      aoiBoundaryDistanceMeters: null,
      aoiNearestBoundary: null
    }));
  }

  const classified = records.map((record) => {
    const hit = classifyPointAgainstAoi(record.longitude, record.latitude, polygon);
    const aoiClass = hit.insideAoi ? AOI_CLASS.INSIDE_AOI : AOI_CLASS.SUPPORTING_EXTERNAL;
    return {
      ...record,
      aoiClassification: aoiClass,
      aoiBoundaryDistanceMeters: hit.aoiBoundaryDistanceMeters,
      aoiNearestBoundary: hit.aoiNearestBoundary,
      rendererKey: `${record.family}-${record.freshnessClass}-${hit.insideAoi ? 'inside' : 'external'}`
    };
  });

  const selected = [];
  for (const family of AOI_PROOF_FAMILIES) {
    const familyRows = classified.filter((row) => row.family === family);
    const inside = familyRows.filter((row) => row.aoiClassification === AOI_CLASS.INSIDE_AOI);
    if (inside.length) {
      selected.push(...inside);
      continue;
    }
    const external = familyRows
      .filter((row) => row.aoiClassification === AOI_CLASS.SUPPORTING_EXTERNAL)
      .sort((a, b) => (a.aoiBoundaryDistanceMeters ?? 1e12) - (b.aoiBoundaryDistanceMeters ?? 1e12));
    if (external[0]) selected.push(external[0]);
  }

  selected.sort((a, b) => {
    if (a.aoiClassification !== b.aoiClassification) {
      return a.aoiClassification === AOI_CLASS.INSIDE_AOI ? -1 : 1;
    }
    return (a.aoiBoundaryDistanceMeters ?? 0) - (b.aoiBoundaryDistanceMeters ?? 0);
  });
  return selected;
}

export function summarizeAoiConstellation(records = []) {
  const inside = records.filter((row) => row.aoiClassification === AOI_CLASS.INSIDE_AOI);
  const supporting = records.filter((row) => row.aoiClassification === AOI_CLASS.SUPPORTING_EXTERNAL);
  const families = [...new Set(records.map((row) => row.family).filter(Boolean))];
  const freshness = { CURRENT: 0, RECENT: 0, STALE: 0, REGISTRY: 0 };
  for (const row of records) {
    if (freshness[row.freshnessClass] != null) freshness[row.freshnessClass] += 1;
  }
  return {
    stationCount: records.length,
    familyCount: families.length,
    families,
    insideCount: inside.length,
    supportingCount: supporting.length,
    freshness
  };
}

export function stampResultsWithAoi(results = [], stationRecords = []) {
  const byId = new Map();
  for (const station of stationRecords) {
    for (const id of station.observationIds || []) {
      byId.set(id, station);
    }
    if (station.observationId) byId.set(station.observationId, station);
  }
  return results.map((result) => {
    const id = result?.resultId || result?.nativeRecordId;
    const station = byId.get(id) || (result?.resultId ? byId.get(result.resultId) : null);
    if (!station?.aoiClassification) return result;
    return {
      ...result,
      aoiClassification: station.aoiClassification,
      aoiBoundaryDistanceMeters: station.aoiBoundaryDistanceMeters,
      aoiNearestBoundary: station.aoiNearestBoundary || null,
      clickDistanceMeters: result.clickDistanceMeters
    };
  });
}

export function formatAoiDistanceLabel(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

export function circlePolygon(longitude, latitude, radiusMeters, steps = 64) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(radiusMeters)) {
    return null;
  }
  const latRad = (latitude * Math.PI) / 180;
  const angularLat = radiusMeters / EARTH_M;
  const angularLon = radiusMeters / (EARTH_M * Math.max(Math.cos(latRad), 0.1));
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      longitude + (angularLon * 180 / Math.PI) * Math.cos(angle),
      latitude + (angularLat * 180 / Math.PI) * Math.sin(angle)
    ]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

export function toGeoJsonPolygon(rings) {
  if (!Array.isArray(rings) || !rings.length) return null;
  const closed = rings.map((ring) => {
    if (!ring.length) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring;
    return [...ring, first];
  });
  return { type: 'Polygon', coordinates: closed };
}
