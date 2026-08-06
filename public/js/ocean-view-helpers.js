/** Browser-safe helpers mirroring server ocean-view-config (no credentials). */

export function describeLayerRenderer(layer) {
  const renderer = layer?.renderer;
  const layerType = layer?.type || layer?.layerType || 'unknown';
  const title = layer?.title || 'Untitled layer';
  if (!renderer) {
    return {
      title,
      layerType,
      rendererType: null,
      animated: layerType === 'imagery' || layerType === 'imagery-tile'
    };
  }
  const rendererType = renderer.type || 'unknown';
  const animated = rendererType === 'flow'
    || rendererType === 'vector-field'
    || layerType === 'imagery'
    || layerType === 'imagery-tile'
    || /imagery/i.test(layerType);
  return { title, layerType, rendererType, animated };
}

export function isWgs84Coordinate(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

export function looksLikeWebMercator(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && (Math.abs(x) > 180 || Math.abs(y) > 90);
}

export function webMercatorToWgs84(x, y) {
  const lon = x * 180 / 20037508.34;
  const lat = Math.atan(Math.sinh((y * Math.PI) / 20037508.34)) * 180 / Math.PI;
  return [lon, lat];
}

export function normalizeToWgs84Pair(lon, lat, attrs = {}) {
  const attrLon = Number(attrs.Longitude);
  const attrLat = Number(attrs.Latitude);
  if (isWgs84Coordinate(attrLon, attrLat)) return [attrLon, attrLat];
  if (isWgs84Coordinate(lon, lat)) return [lon, lat];
  if (looksLikeWebMercator(lon, lat)) return webMercatorToWgs84(lon, lat);
  return null;
}
