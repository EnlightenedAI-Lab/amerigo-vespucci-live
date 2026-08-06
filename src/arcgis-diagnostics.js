import { arcgisDateToIso } from './map-api.js';

const LAYER_NAMES = {
  0: 'Current Vessel Position',
  1: 'Vespucci Track History',
  2: 'Vespucci Travelled Route',
  3: 'Vespucci Destination',
  4: 'Vespucci Estimated Route',
  5: 'Vespucci Marine Conditions'
};

function parseExtent(data) {
  if (data?.extent) {
    const e = data.extent;
    return { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax, spatialReference: e.spatialReference?.wkid || 4326 };
  }
  return null;
}

function polylineEndpoints(geometry) {
  const path = geometry?.paths?.[0];
  if (!Array.isArray(path) || path.length < 2) return null;
  const [startLon, startLat] = path[0];
  const [endLon, endLat] = path[path.length - 1];
  if (![startLon, startLat, endLon, endLat].every((v) => Number.isFinite(Number(v)))) return null;
  return {
    start: { longitude: Number(startLon), latitude: Number(startLat) },
    end: { longitude: Number(endLon), latitude: Number(endLat) },
    vertexCount: path.length
  };
}

function pointCoordinates(geometry, attrs = {}) {
  const attrLat = Number(attrs.Latitude);
  const attrLon = Number(attrs.Longitude);
  if (Number.isFinite(attrLon) && Number.isFinite(attrLat)
    && Math.abs(attrLon) <= 180 && Math.abs(attrLat) <= 90) {
    return { longitude: attrLon, latitude: attrLat };
  }
  const lon = Number(geometry?.x ?? attrs.Longitude);
  const lat = Number(geometry?.y ?? attrs.Latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { longitude: lon, latitude: lat };
}

function hasValidPoint(geometry, attrs = {}) {
  return pointCoordinates(geometry, attrs) != null;
}

function hasValidPolyline(geometry) {
  return polylineEndpoints(geometry) != null;
}

function uniqueHistoryPoints(features) {
  const seen = new Set();
  let count = 0;
  for (const f of features || []) {
    const key = f.attributes?.PositionKey || `${f.attributes?.LastAIS}:${f.geometry?.x}:${f.geometry?.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (hasValidPoint(f.geometry, f.attributes)) count++;
  }
  return count;
}

/**
 * Read-only diagnostic report for a single ArcGIS feature layer.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {number} layerId
 * @param {object} config
 */
export async function diagnoseLayer(client, layerId, config) {
  const name = LAYER_NAMES[layerId] || `Layer ${layerId}`;
  const meta = await client.get(`${client.layerUrl(layerId)}?f=json`);
  const countParams = new URLSearchParams({ f: 'json', where: '1=1', returnCountOnly: 'true' });
  const countData = await client.get(`${client.layerUrl(layerId)}/query?${countParams}`);

  const where = layerId === config.destinationLayerId
    ? '1=1'
    : `MMSI=${config.targetMmsi}`;

  const queryParams = new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    returnGeometry: 'true',
    resultRecordCount: layerId === config.historyLayerId ? String(config.routeMaxHistoryPoints) : '50'
  });
  if (layerId === config.historyLayerId) queryParams.set('orderByFields', 'LastAIS ASC');

  const data = await client.get(`${client.layerUrl(layerId)}/query?${queryParams}`);
  const features = data.features || [];
  const geometryType = meta.geometryType || null;
  const featureCount = Number(countData.count ?? features.length);

  let hasValidGeometry = false;
  let latestTimestamp = null;
  let displayAttributes = null;
  let historyPointCount = null;
  let travelledRouteExists = null;
  let destinationExists = null;
  let estimatedRouteExists = null;
  let conditionsExists = null;
  let travelledRouteNote = null;

  if (geometryType === 'esriGeometryPoint') {
    hasValidGeometry = features.some((f) => hasValidPoint(f.geometry, f.attributes));
    const timestamps = features.map((f) => f.attributes?.LastAIS || f.attributes?.ConditionsAt || f.attributes?.UpdatedAt).filter(Boolean);
    latestTimestamp = timestamps.length ? arcgisDateToIso(Math.max(...timestamps.map(Number))) : null;
    displayAttributes = features[0]?.attributes ? sanitizeAttrs(features[0].attributes) : null;
  }

  if (geometryType === 'esriGeometryPolyline') {
    hasValidGeometry = features.some((f) => hasValidPolyline(f.geometry));
    latestTimestamp = features[0]?.attributes?.LastUpdated
      ? arcgisDateToIso(features[0].attributes.LastUpdated)
      : (features[0]?.attributes?.CalculatedAt ? arcgisDateToIso(features[0].attributes.CalculatedAt) : null);
    displayAttributes = features[0]?.attributes ? sanitizeAttrs(features[0].attributes) : null;
  }

  if (layerId === config.historyLayerId) {
    historyPointCount = uniqueHistoryPoints(features);
    hasValidGeometry = historyPointCount > 0;
  }
  if (layerId === config.travelledRouteLayerId) {
    travelledRouteExists = features.some((f) => hasValidPolyline(f.geometry));
    if (!travelledRouteExists) {
      const hist = await client.queryHistoryPoints(config);
      const unique = uniqueHistoryPoints(hist.map((p) => ({ geometry: { x: p.longitude, y: p.latitude }, attributes: p.attributes })));
      if (unique < 2) {
        travelledRouteNote = 'Observed route unavailable: fewer than two stored observations.';
      }
    }
  }
  if (layerId === config.destinationLayerId) destinationExists = features.some((f) => hasValidPoint(f.geometry, f.attributes));
  if (layerId === config.estimatedRouteLayerId) estimatedRouteExists = features.some((f) => hasValidPolyline(f.geometry));
  if (layerId === config.conditionsLayerId) {
    conditionsExists = features.some((f) => hasValidPoint(f.geometry, f.attributes));
    latestTimestamp = features[0]?.attributes?.ConditionsAt
      ? arcgisDateToIso(features[0].attributes.ConditionsAt)
      : latestTimestamp;
  }

  const extent = parseExtent(data) || (features[0]?.geometry ? pointExtent(features[0].geometry) : null);
  const objectIds = features.map((f) => f.attributes?.OBJECTID).filter((id) => id != null);
  const geometryExists = features.some((f) => Boolean(f.geometry));
  const currentCoordinates = layerId === config.currentLayerId
    ? pointCoordinates(features[0]?.geometry, features[0]?.attributes)
    : null;
  const routePolyline = layerId === config.travelledRouteLayerId || layerId === config.estimatedRouteLayerId
    ? polylineEndpoints(features.find((f) => hasValidPolyline(f.geometry))?.geometry)
    : null;
  const destinationCoordinates = layerId === config.destinationLayerId
    ? pointCoordinates(features[0]?.geometry, features[0]?.attributes)
    : null;

  return {
    layerId,
    name,
    featureCount,
    geometryType,
    objectIds,
    geometryExists,
    hasValidGeometry,
    extent,
    latestTimestamp,
    displayAttributes,
    historyPointCount,
    travelledRouteExists,
    destinationExists,
    estimatedRouteExists,
    conditionsExists,
    travelledRouteNote,
    currentCoordinates,
    destinationCoordinates,
    routeVertexCount: routePolyline?.vertexCount ?? null,
    routeStart: routePolyline?.start ?? null,
    routeEnd: routePolyline?.end ?? null,
    rendererType: meta.drawingInfo?.renderer?.type || null,
    defaultVisibility: meta.defaultVisibility ?? null
  };
}

function pointExtent(geometry) {
  if (!Number.isFinite(geometry?.x) || !Number.isFinite(geometry?.y)) return null;
  const pad = 0.05;
  return {
    xmin: geometry.x - pad,
    ymin: geometry.y - pad,
    xmax: geometry.x + pad,
    ymax: geometry.y + pad,
    spatialReference: geometry.spatialReference?.wkid || 4326
  };
}

function sanitizeAttrs(attrs) {
  const result = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'OBJECTID') continue;
    if (/At$/.test(k) || k === 'LastAIS') result[k] = arcgisDateToIso(v);
    else result[k] = v;
  }
  return result;
}

/**
 * Full read-only diagnostics for layers 0–5.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} config
 */
export async function runArcGISDiagnostics(client, config) {
  const layerIds = [
    config.currentLayerId,
    config.historyLayerId,
    config.travelledRouteLayerId,
    config.destinationLayerId,
    config.estimatedRouteLayerId,
    config.conditionsLayerId
  ];
  const layers = [];
  for (const id of layerIds) {
    layers.push(await diagnoseLayer(client, id, config));
  }
  return {
    generatedAt: new Date().toISOString(),
    featureServiceUrl: client.featureServiceUrl,
    targetMmsi: config.targetMmsi,
    readOnly: true,
    layers
  };
}

/**
 * Parse stored Layer 0 feature into a position object for route rebuild.
 * @param {object} attrs
 */
export function layer0AttributesToPosition(attrs, config) {
  if (!attrs) return null;
  let lastAIS = null;
  if (attrs.LastAIS instanceof Date) lastAIS = attrs.LastAIS;
  else if (typeof attrs.LastAIS === 'string') lastAIS = new Date(attrs.LastAIS);
  else if (attrs.LastAIS != null) lastAIS = new Date(Number(attrs.LastAIS));
  if (!lastAIS || Number.isNaN(lastAIS.getTime())) return null;
  const lat = Number(attrs.Latitude);
  const lon = Number(attrs.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    mmsi: Number(attrs.MMSI || config.targetMmsi),
    vesselName: attrs.VesselName || 'Amerigo Vespucci',
    speedKnots: attrs.SpeedKnots ?? null,
    course: attrs.Course ?? null,
    heading: attrs.Heading ?? null,
    latitude: lat,
    longitude: lon,
    lastAIS,
    destination: attrs.Destination || null,
    navStatus: attrs.NavStatus || null
  };
}
