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

/** Visible fishnet is cartographic acquisition geography — not coverage, influence, interpolation, or search radius. */
export const FOOTPRINT_MEANING = 'CARTOGRAPHIC_ACQUISITION_GEOGRAPHY';
export const EVIDENCE_ROLE = 'SUPPORTING_OBSERVATION';
export const ACQUISITION_CARTOGRAPHIC_BUFFER_METERS = 550;
export const EVIDENCE_PER_FAMILY_LIMIT = 6;

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

export function normalizeLonLatPoint(point) {
  if (!point) return null;
  const longitude = Number(point.longitude ?? point.lon ?? point[0]);
  const latitude = Number(point.latitude ?? point.lat ?? point[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

export function uniqueLonLatPoints(points = [], decimals = 6) {
  const seen = new Set();
  const out = [];
  for (const point of points) {
    const normalized = normalizeLonLatPoint(point);
    if (!normalized) continue;
    const key = `${normalized.longitude.toFixed(decimals)},${normalized.latitude.toFixed(decimals)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function toLocalMeters(origin, point) {
  const lat0 = (origin.latitude * Math.PI) / 180;
  return {
    x: (point.longitude - origin.longitude) * Math.cos(lat0) * 111320,
    y: (point.latitude - origin.latitude) * 111320
  };
}

export function fromLocalMeters(origin, x, y) {
  const lat0 = (origin.latitude * Math.PI) / 180;
  return {
    longitude: origin.longitude + x / (111320 * Math.max(Math.cos(lat0), 0.1)),
    latitude: origin.latitude + y / 111320
  };
}

function localCross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHullLocal(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 1) return sorted;
  if (sorted.length === 2) return sorted;
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && localCross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && localCross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function localArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function normalizeVec(x, y) {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

function offsetConvexLocal(points, meters) {
  if (!points.length || !Number.isFinite(meters) || meters <= 0) return points;
  const ring = localArea(points) < 0 ? [...points].reverse() : points;
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const prev = ring[(i + n - 1) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    const e1 = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const e2 = normalizeVec(next.x - curr.x, next.y - curr.y);
    const n1 = { x: e1.y, y: -e1.x };
    const n2 = { x: e2.y, y: -e2.x };
    const bis = normalizeVec(n1.x + n2.x, n1.y + n2.y);
    const denom = Math.max(0.2, bis.x * n1.x + bis.y * n1.y);
    const scale = meters / denom;
    out.push({ x: curr.x + bis.x * scale, y: curr.y + bis.y * scale });
  }
  return out;
}

export function capsulePolygon(a, b, bufferMeters, steps = 20) {
  const origin = a;
  const pa = toLocalMeters(origin, a);
  const pb = toLocalMeters(origin, b);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) {
    return circlePolygon(a.longitude, a.latitude, bufferMeters);
  }
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const ringLocal = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = (Math.PI / 2) + ((i / steps) * Math.PI);
    ringLocal.push({
      x: pa.x + Math.cos(theta) * ux * bufferMeters + Math.sin(theta) * nx * bufferMeters,
      y: pa.y + Math.cos(theta) * uy * bufferMeters + Math.sin(theta) * ny * bufferMeters
    });
  }
  for (let i = 0; i <= steps; i += 1) {
    const theta = (-Math.PI / 2) + ((i / steps) * Math.PI);
    ringLocal.push({
      x: pb.x + Math.cos(theta) * ux * bufferMeters + Math.sin(theta) * nx * bufferMeters,
      y: pb.y + Math.cos(theta) * uy * bufferMeters + Math.sin(theta) * ny * bufferMeters
    });
  }
  const ring = ringLocal.map((pt) => {
    const geo = fromLocalMeters(origin, pt.x, pt.y);
    return [geo.longitude, geo.latitude];
  });
  return toGeoJsonPolygon([ring]);
}

export function polygonAreaKm2(polygon) {
  const ring = polygonRings(polygon)[0];
  if (!ring || ring.length < 4) return 0;
  const origin = { longitude: ring[0][0], latitude: ring[0][1] };
  const local = [];
  for (const coord of ring) {
    local.push(toLocalMeters(origin, { longitude: coord[0], latitude: coord[1] }));
  }
  if (local.length > 1) {
    const first = local[0];
    const last = local[local.length - 1];
    if (first.x === last.x && first.y === last.y) local.pop();
  }
  return Math.abs(localArea(local)) / 1e6;
}

export function formatFootprintKm2(km2) {
  if (!Number.isFinite(km2) || km2 <= 0) return null;
  if (km2 >= 10) return km2.toFixed(1);
  if (km2 >= 1) return km2.toFixed(1);
  return km2.toFixed(2);
}

export function formatOriginCoordinates(origin) {
  const point = normalizeLonLatPoint(origin);
  if (!point) return null;
  return `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
}

/**
 * Cartographic acquisition geography around the query origin and used evidence.
 * Not coverage, influence, interpolation, impact, or the provider search radius.
 */
export function buildEvidenceAcquisitionFootprint({ origin, evidence = [], bufferMeters } = {}) {
  const start = normalizeLonLatPoint(origin);
  const stations = uniqueLonLatPoints(evidence);
  const buffer = Number.isFinite(bufferMeters) ? bufferMeters : ACQUISITION_CARTOGRAPHIC_BUFFER_METERS;
  if (!start) {
    return { polygon: null, method: 'NONE', meaning: FOOTPRINT_MEANING, bufferMeters: buffer };
  }
  if (!stations.length) {
    return { polygon: null, method: 'NONE', meaning: FOOTPRINT_MEANING, bufferMeters: buffer };
  }

  const members = uniqueLonLatPoints([start, ...stations]);
  if (members.length === 1) {
    return {
      polygon: circlePolygon(start.longitude, start.latitude, buffer),
      method: 'BUFFERED_ORIGIN',
      meaning: FOOTPRINT_MEANING,
      bufferMeters: buffer,
      originIncluded: true,
      evidenceCount: stations.length
    };
  }
  if (stations.length === 1) {
    return {
      polygon: capsulePolygon(start, stations[0], buffer),
      method: 'BUFFERED_GEODESIC_CORRIDOR',
      meaning: FOOTPRINT_MEANING,
      bufferMeters: buffer,
      originIncluded: true,
      evidenceCount: stations.length
    };
  }

  const localOrigin = start;
  const localPoints = members.map((point) => toLocalMeters(localOrigin, point));
  let hull = convexHullLocal(localPoints);
  if (hull.length < 3) {
    const farthest = stations.reduce((best, point) => {
      const dist = haversineMeters(start.longitude, start.latitude, point.longitude, point.latitude);
      return !best || dist > best.dist ? { point, dist } : best;
    }, null);
    const polygon = capsulePolygon(start, farthest?.point || stations[0], buffer);
    return {
      polygon,
      method: 'BUFFERED_GEODESIC_CORRIDOR',
      meaning: FOOTPRINT_MEANING,
      bufferMeters: buffer,
      originIncluded: true,
      evidenceCount: stations.length
    };
  }
  if (localArea(hull) < 0) hull = hull.reverse();
  const buffered = offsetConvexLocal(hull, buffer);
  const ring = buffered.map((pt) => {
    const geo = fromLocalMeters(localOrigin, pt.x, pt.y);
    return [geo.longitude, geo.latitude];
  });
  return {
    polygon: toGeoJsonPolygon([ring]),
    method: stations.length === 2 ? 'BUFFERED_MINIMAL_ENVELOPE' : 'BUFFERED_CONVEX_HULL',
    meaning: FOOTPRINT_MEANING,
    bufferMeters: buffer,
    originIncluded: true,
    evidenceCount: stations.length
  };
}

export function selectEvidenceUsedStations(records = [], options = {}) {
  const limit = Number.isFinite(options.perFamilyLimit) ? options.perFamilyLimit : EVIDENCE_PER_FAMILY_LIMIT;
  const selected = [];
  const liveRank = { CURRENT: 0, RECENT: 1, STALE: 2, REGISTRY: 3 };
  for (const family of AOI_PROOF_FAMILIES) {
    const rows = records
      .filter((row) => row.family === family)
      .sort((a, b) => {
        const rankA = liveRank[a.freshnessClass] ?? 4;
        const rankB = liveRank[b.freshnessClass] ?? 4;
        if (rankA !== rankB) return rankA - rankB;
        return (a.distanceMeters ?? 1e12) - (b.distanceMeters ?? 1e12);
      });
    const live = rows.filter((row) => row.freshnessClass === 'CURRENT' || row.freshnessClass === 'RECENT');
    const chosen = (live.length ? live : rows.slice(0, 1)).slice(0, limit);
    selected.push(...chosen.map((row) => ({
      ...row,
      acquisitionRole: EVIDENCE_ROLE,
      queryOriginDistanceMeters: row.distanceMeters ?? null,
      aoiClassification: null,
      aoiBoundaryDistanceMeters: null,
      aoiNearestBoundary: null,
      rendererKey: `${row.family}-${row.freshnessClass}`
    })));
  }
  selected.sort((a, b) => (a.queryOriginDistanceMeters ?? 1e12) - (b.queryOriginDistanceMeters ?? 1e12));
  return selected;
}

export function stampResultsWithEvidence(results = [], stationRecords = []) {
  const byId = new Map();
  for (const station of stationRecords) {
    for (const id of station.observationIds || []) byId.set(id, station);
    if (station.observationId) byId.set(station.observationId, station);
  }
  return results.map((result) => {
    const id = result?.resultId || result?.nativeRecordId;
    const station = byId.get(id) || (result?.resultId ? byId.get(result.resultId) : null);
    if (!station?.acquisitionRole) return result;
    return {
      ...result,
      acquisitionRole: station.acquisitionRole,
      queryOriginDistanceMeters: station.queryOriginDistanceMeters,
      clickDistanceMeters: result.clickDistanceMeters,
      aoiClassification: null
    };
  });
}

export function summarizeEvidenceAcquisition({ origin, stations = [], polygon } = {}) {
  const freshness = { CURRENT: 0, RECENT: 0, STALE: 0, REGISTRY: 0 };
  let farthestMeters = 0;
  let farthestStation = null;
  for (const row of stations) {
    if (freshness[row.freshnessClass] != null) freshness[row.freshnessClass] += 1;
    const distance = row.queryOriginDistanceMeters ?? row.distanceMeters ?? 0;
    if (distance > farthestMeters) {
      farthestMeters = distance;
      farthestStation = row;
    }
  }
  const families = [...new Set(stations.map((row) => row.family).filter(Boolean))];
  const areaKm2 = polygon ? polygonAreaKm2(polygon) : 0;
  return {
    kind: 'EVIDENCE',
    originLabel: formatOriginCoordinates(origin),
    footprintKm2: areaKm2,
    footprintLabel: formatFootprintKm2(areaKm2),
    farthestEvidenceMeters: farthestMeters || null,
    farthestEvidenceLabel: formatAoiDistanceLabel(farthestMeters),
    farthestStationId: farthestStation?.stationId || null,
    stationCount: stations.length,
    familyCount: families.length,
    families,
    freshness,
    meaning: FOOTPRINT_MEANING
  };
}
