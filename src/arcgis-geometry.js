import { logger } from './logger.js';

export const WEB_MERCATOR_WKIDS = new Set([3857, 102100]);

/**
 * Project WGS84 longitude/latitude to Web Mercator (EPSG:3857 / WKID 102100).
 * @param {number} lon
 * @param {number} lat
 */
export function wgs84ToWebMercator(lon, lat) {
  const x = lon * 20037508.34 / 180;
  const rad = lat * Math.PI / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 20037508.34 / Math.PI;
  return { x, y };
}

/** Project Web Mercator meters to WGS84 [longitude, latitude]. */
export function webMercatorToWgs84(x, y) {
  const lon = x * 180 / 20037508.34;
  const lat = Math.atan(Math.sinh((y * Math.PI) / 20037508.34)) * 180 / Math.PI;
  return [lon, lat];
}

/**
 * Heuristic: values within geographic degree bounds are not Web Mercator meters.
 */
export function looksLikeWgs84Degrees(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
    && Math.abs(x) <= 180
    && Math.abs(y) <= 90;
}

export function isWebMercatorWkid(wkid) {
  return WEB_MERCATOR_WKIDS.has(Number(wkid));
}

/**
 * Detect geometries stored as raw degrees in a Web Mercator layer.
 * @param {object|null} geometry
 * @param {string|null} geometryType
 */
export function geometryLooksLikeWgs84InWebMercatorLayer(geometry, geometryType) {
  if (!geometry) return false;
  if (geometryType === 'esriGeometryPoint' || (geometry.x != null && geometry.y != null && !geometry.paths)) {
    return looksLikeWgs84Degrees(Number(geometry.x), Number(geometry.y));
  }
  if (geometryType === 'esriGeometryPolyline' || geometry.paths) {
    for (const path of geometry.paths || []) {
      for (const vertex of path) {
        if (looksLikeWgs84Degrees(Number(vertex[0]), Number(vertex[1]))) return true;
      }
    }
  }
  return false;
}

export function webMercatorSpatialReference() {
  return { wkid: 102100, latestWkid: 3857 };
}

export function webMercatorPointFromWgs84(lon, lat) {
  const { x, y } = wgs84ToWebMercator(lon, lat);
  return { x, y, spatialReference: webMercatorSpatialReference() };
}

/**
 * Build a Web Mercator polyline from WGS84 lon/lat points.
 * @param {Array<{ longitude: number, latitude: number }>} points
 */
export function webMercatorPolylineFromWgs84Points(points) {
  return {
    paths: [points.map((point) => {
      const { x, y } = wgs84ToWebMercator(point.longitude, point.latitude);
      return [x, y];
    })],
    spatialReference: webMercatorSpatialReference()
  };
}

/**
 * Reject geometries that look like unprojected WGS84 degrees for Web Mercator layers.
 * @param {object} geometry
 * @param {string} [context]
 */
export function validateWebMercatorGeometry(geometry, context = 'feature write') {
  if (!geometry) {
    throw new Error(`ArcGIS geometry validation failed (${context}): geometry is required.`);
  }
  if (geometry.x != null && geometry.y != null) {
    if (looksLikeWgs84Degrees(Number(geometry.x), Number(geometry.y))) {
      const message = `ArcGIS geometry validation failed (${context}): point looks like raw WGS84 degrees (${geometry.x}, ${geometry.y}) but target layer uses Web Mercator (3857/102100). Project with wgs84ToWebMercator before writing.`;
      logger.error(message);
      throw new Error(message);
    }
    return;
  }
  for (const path of geometry.paths || []) {
    for (const vertex of path) {
      if (looksLikeWgs84Degrees(Number(vertex[0]), Number(vertex[1]))) {
        const message = `ArcGIS geometry validation failed (${context}): polyline vertex looks like raw WGS84 degrees (${vertex[0]}, ${vertex[1]}) but target layer uses Web Mercator (3857/102100). Project before writing.`;
        logger.error(message);
        throw new Error(message);
      }
    }
  }
}
