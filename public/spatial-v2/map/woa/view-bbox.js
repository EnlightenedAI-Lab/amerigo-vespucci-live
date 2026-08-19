/**
 * Geographic bbox helpers for World Object Acquisition.
 * ArcGIS MapView points may expose Web Mercator x/y; UEV cells are lon/lat.
 */

const WEB_MERCATOR = 20037508.34;
const DOWNTOWN = Object.freeze([-73.578, 45.495, -73.554, 45.512]);

export function webMercatorToLonLat(x, y) {
  const lon = (Number(x) / WEB_MERCATOR) * 180;
  let lat = (Number(y) / WEB_MERCATOR) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

export function isGeographic(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

export function toLonLat(pt) {
  if (!pt) return null;
  const lon = Number(pt.longitude);
  const lat = Number(pt.latitude);
  if (isGeographic(lon, lat)) return [lon, lat];
  const x = Number(pt.x);
  const y = Number(pt.y);
  if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) > 180) return webMercatorToLonLat(x, y);
  if (isGeographic(x, y)) return [x, y];
  return null;
}

export function padBbox(lng, lat, pad = 0.004) {
  const lon = Number(lng);
  const la = Number(lat);
  if (!isGeographic(lon, la)) return DOWNTOWN.slice();
  return [lon - pad, la - pad, lon + pad, la + pad];
}

export function viewBbox(view) {
  const width = Number(view?.width) || 0;
  const height = Number(view?.height) || 0;
  const toMap = typeof view?.toMap === 'function'
    ? (x, y) => {
      try {
        return view.toMap({ x, y });
      } catch {
        return null;
      }
    }
    : null;
  if (toMap && width > 0 && height > 0) {
    const a = toLonLat(toMap(0, 0));
    const b = toLonLat(toMap(width, height));
    if (a && b) {
      return [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1])
      ];
    }
  }
  const center = toLonLat(view?.center);
  if (center) return padBbox(center[0], center[1], 0.006);
  const extent = view?.extent;
  if (extent) {
    const a = toLonLat({ x: extent.xmin, y: extent.ymin });
    const b = toLonLat({ x: extent.xmax, y: extent.ymax });
    if (a && b) {
      return [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1])
      ];
    }
  }
  return DOWNTOWN.slice();
}
