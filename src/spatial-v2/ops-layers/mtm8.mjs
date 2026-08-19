import proj4 from 'proj4';

/** Official EPSG:32188 from iqai-spvm-data pdq-geography.js — NAD83 / MTM zone 8. */
export const SOURCE_CRS_PROJ4 =
  '+proj=tmerc +lat_0=0 +lon_0=-73.5 +k=0.9999 +x_0=304800 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs';

proj4.defs('EPSG:32188', SOURCE_CRS_PROJ4);

function mapCoordinates(coords, transform) {
  if (typeof coords[0] === 'number') return transform(coords);
  return coords.map((ring) => mapCoordinates(ring, transform));
}

export function reprojectGeometryToWgs84(geometry) {
  if (!geometry) return geometry;
  const cloned = JSON.parse(JSON.stringify(geometry));
  cloned.coordinates = mapCoordinates(cloned.coordinates, (pt) => {
    const [lon, lat] = proj4('EPSG:32188', 'EPSG:4326', [Number(pt[0]), Number(pt[1])]);
    return [lon, lat];
  });
  return cloned;
}

export function looksLikeWgs84(geometry) {
  const first = geometry?.coordinates;
  let pair = first;
  while (Array.isArray(pair) && Array.isArray(pair[0])) pair = pair[0];
  if (!Array.isArray(pair) || pair.length < 2) return false;
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}
