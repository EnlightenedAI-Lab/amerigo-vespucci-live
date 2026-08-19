import { formatRange, haversineMeters, initialBearing } from './geodesy.js';

const EARTH_M = 6378137;

export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function bboxContains(bbox, lng, lat, pad = 0) {
  return lng >= bbox[0] - pad && lng <= bbox[2] + pad && lat >= bbox[1] - pad && lat <= bbox[3] + pad;
}

export function sphericalAreaSquareMeters(ring) {
  if (!ring || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const lon1 = ring[i][0] * Math.PI / 180;
    const lat1 = ring[i][1] * Math.PI / 180;
    const lon2 = ring[i + 1][0] * Math.PI / 180;
    const lat2 = ring[i + 1][1] * Math.PI / 180;
    sum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(sum * EARTH_M * EARTH_M / 2);
}

export function ringPerimeterMeters(ring) {
  if (!ring || ring.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += haversineMeters(ring[i][1], ring[i][0], ring[i + 1][1], ring[i + 1][0]);
  }
  return sum;
}

export function ringCentroid(ring) {
  if (!ring || ring.length < 4) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i += 1) {
    const lat = ring[i][1] * Math.PI / 180;
    const lon = ring[i][0] * Math.PI / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }
  x /= n;
  y /= n;
  z /= n;
  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);
  return { lng: lon * 180 / Math.PI, lat: lat * 180 / Math.PI };
}

export function polygonParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function pointInPolygonRings(lng, lat, rings) {
  if (!rings?.[0] || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

export function featureContainsPoint(feature, lng, lat) {
  for (const rings of polygonParts(feature?.geometry)) {
    if (pointInPolygonRings(lng, lat, rings)) return true;
  }
  return false;
}

export function featureBBox(feature) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rings of polygonParts(feature?.geometry)) {
    const bbox = ringBBox(rings[0]);
    if (bbox[0] < minX) minX = bbox[0];
    if (bbox[1] < minY) minY = bbox[1];
    if (bbox[2] > maxX) maxX = bbox[2];
    if (bbox[3] > maxY) maxY = bbox[3];
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

export function featureArea(feature) {
  let area = 0;
  for (const rings of polygonParts(feature?.geometry)) {
    area += sphericalAreaSquareMeters(rings[0]);
    for (let i = 1; i < rings.length; i += 1) {
      area -= sphericalAreaSquareMeters(rings[i]);
    }
  }
  return area;
}

export function featurePerimeter(feature) {
  let sum = 0;
  for (const rings of polygonParts(feature?.geometry)) {
    sum += ringPerimeterMeters(rings[0]);
  }
  return sum;
}

export function featureCentroid(feature) {
  const parts = polygonParts(feature?.geometry);
  if (!parts.length) return null;
  let weight = 0;
  let lat = 0;
  let lng = 0;
  for (const rings of parts) {
    const area = sphericalAreaSquareMeters(rings[0]) || 1;
    const c = ringCentroid(rings[0]);
    if (!c) continue;
    lat += c.lat * area;
    lng += c.lng * area;
    weight += area;
  }
  if (!weight) return ringCentroid(parts[0][0]);
  return { lat: lat / weight, lng: lng / weight };
}

export function featureOuterRings(feature) {
  return polygonParts(feature?.geometry).map((rings) => rings[0]).filter(Boolean);
}

export function featureToLatLngs(feature) {
  return polygonParts(feature?.geometry).map((rings) => (
    rings.map((ring) => ring.map(([lng, lat]) => [lat, lng]))
  ));
}

function distPointToSegmentMeters(lat, lng, a, b) {
  const steps = 8;
  let best = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const lngi = a[0] + (b[0] - a[0]) * t;
    const lati = a[1] + (b[1] - a[1]) * t;
    const d = haversineMeters(lat, lng, lati, lngi);
    if (d < best) best = d;
  }
  return best;
}

export function distanceToRingMeters(lat, lng, ring) {
  if (pointInRing(lng, lat, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const d = distPointToSegmentMeters(lat, lng, ring[i], ring[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function distanceToFeatureMeters(lat, lng, feature) {
  if (featureContainsPoint(feature, lng, lat)) return 0;
  let best = Infinity;
  for (const ring of featureOuterRings(feature)) {
    const d = distanceToRingMeters(lat, lng, ring);
    if (d < best) best = d;
  }
  return best;
}

export function formatArea(squareMeters) {
  if (!Number.isFinite(squareMeters)) return null;
  if (squareMeters >= 10000) return `${(squareMeters / 10000).toFixed(2)} ha`;
  return `${Math.round(squareMeters).toLocaleString('en-US')} m²`;
}

export function formatMeters(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  return `${value.toFixed(digits)} m`;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function catalogOverlay(feature, catalogFeatures = []) {
  for (const item of catalogFeatures) {
    if (item?.lng == null || item?.lat == null) continue;
    if (featureContainsPoint(feature, item.lng, item.lat) && item.name) {
      return {
        name: item.name,
        address: item.address || null,
        origin: 'IQAI catalog overlay'
      };
    }
  }
  return null;
}

export function deriveObject(feature, reference = null, catalogFeatures = []) {
  if (!feature?.geometry) return null;
  const props = feature.properties || {};
  const bbox = featureBBox(feature);
  const area = featureArea(feature);
  const perimeter = featurePerimeter(feature);
  const centroid = featureCentroid(feature);
  const overlay = catalogOverlay(feature, catalogFeatures);
  const sourceArea = finiteNumber(props.bldgarea);
  const heightMin = finiteNumber(props.heightmin);
  const heightMax = finiteNumber(props.heightmax);
  const elevMin = finiteNumber(props.elevmin);
  const elevMax = finiteNumber(props.elevmax);
  const nav = reference && centroid
    ? {
      brg: initialBearing(reference.lat, reference.lng, centroid.lat, centroid.lng),
      rng: haversineMeters(reference.lat, reference.lng, centroid.lat, centroid.lng)
    }
    : null;
  return {
    objectId: props.objectId || feature.id,
    objectKind: props.objectKind || 'building',
    source: props.source || 'NRCan Automatically Extracted Buildings',
    sourceLayer: props.sourceLayer || 'Optimized Buildings Layer',
    sourceUuid: props.sourceUuid || '7a5cda52-c7df-427f-9ced-26f19a8a64d6',
    multipart: feature.geometry.type === 'MultiPolygon',
    partCount: polygonParts(feature.geometry).length,
    overlay,
    name: overlay?.name || null,
    address: overlay?.address || null,
    sourceAttributes: {
      featureId: props.feature_id || null,
      buildingArea: sourceArea,
      heightMin,
      heightMax,
      elevMin,
      elevMax,
      quality: props.qltylvl_en || null,
      qualityCode: finiteNumber(props.qltylvl),
      comment: props.comment || null,
      acquisition: props.acqtech_en || null,
      provider: props.provideren || null,
      dateMin: props.datemin || null,
      dateMax: props.datemax || null,
      hAccMin: finiteNumber(props.haccmin),
      hAccMax: finiteNumber(props.haccmax),
      vAccMin: finiteNumber(props.vaccmin),
      vAccMax: finiteNumber(props.vaccmax)
    },
    derived: {
      area,
      perimeter,
      centroid,
      bbox
    },
    ring: featureOuterRings(feature)[0] || null,
    bbox,
    area,
    perimeter,
    centroid,
    nav,
    feature
  };
}

export function indexBuildings(collection) {
  const items = (collection?.features || []).map((feature) => {
    const bbox = featureBBox(feature);
    const area = featureArea(feature);
    if (!bbox || area <= 0) return null;
    return { feature, bbox, area };
  }).filter(Boolean);
  const bySourceId = new Map();
  for (const item of items) {
    const sourceId = item.feature?.properties?.feature_id;
    if (sourceId) bySourceId.set(String(sourceId), item);
  }
  return {
    source: collection?.attribution || collection?.name || 'unknown',
    meta: collection?.source || null,
    count: items.length,
    items,
    findBySourceId(sourceId) {
      if (sourceId == null || sourceId === '') return null;
      return bySourceId.get(String(sourceId)) || null;
    },
    findAt(lat, lng, nearMeters = 14) {
      const pad = 0.0002;
      let inside = null;
      let near = null;
      for (const item of items) {
        if (!bboxContains(item.bbox, lng, lat, pad)) continue;
        if (featureContainsPoint(item.feature, lng, lat)) {
          // Complete footprint: largest containing polygon wins.
          // V2 OSM bug: smallest nested part (courtyard/podium) stole the hit.
          if (!inside || item.area > inside.area) inside = item;
          continue;
        }
        const dist = distanceToFeatureMeters(lat, lng, item.feature);
        if (dist <= nearMeters && (!near || dist < near.dist)) {
          near = { ...item, dist };
        }
      }
      if (inside) return { item: inside, relation: 'inside', range: 0 };
      if (near) return { item: near, relation: 'near', range: near.dist };
      return null;
    }
  };
}

export function objectLabel(derived) {
  if (!derived) return null;
  return derived.name || derived.address || 'Building';
}

export { formatRange };
