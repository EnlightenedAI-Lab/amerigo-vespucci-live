/**
 * Operator coordinate formats from WGS84 decimal degrees.
 * Missing values stay null. Do not emit 0 as a substitute.
 */

const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;
const UTM_K0 = 0.9996;
const MGRS_ROW = 'ABCDEFGHJKLMNPQRSTUV';
const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatDecimalDegrees(latitude, longitude, digits = 5) {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  if (lat == null || lon == null) return null;
  const latH = lat >= 0 ? 'N' : 'S';
  const lonH = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${latH}   ${Math.abs(lon).toFixed(digits)}° ${lonH}`;
}

function toDmsParts(value) {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = (minFloat - min) * 60;
  if (sec >= 59.95) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    return { deg: deg + 1, min, sec };
  }
  return { deg, min, sec };
}

export function formatDms(latitude, longitude) {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  if (lat == null || lon == null) return null;
  const latP = toDmsParts(lat);
  const lonP = toDmsParts(lon);
  const latH = lat >= 0 ? 'N' : 'S';
  const lonH = lon >= 0 ? 'E' : 'W';
  const sec = (value) => value.toFixed(2).padStart(5, '0');
  const min = (value) => String(value).padStart(2, '0');
  return `${latP.deg}° ${min(latP.min)}′ ${sec(latP.sec)}″ ${latH}  ${lonP.deg}° ${min(lonP.min)}′ ${sec(lonP.sec)}″ ${lonH}`;
}

function utmZone(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

function latBand(latitude) {
  const lat = Number(latitude);
  if (lat < -80 || lat > 84) return null;
  if (lat >= 72) return 'X';
  const index = Math.floor((lat + 80) / 8);
  return LAT_BANDS[index] || null;
}

export function wgs84ToUtm(latitude, longitude) {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  if (lat == null || lon == null || Math.abs(lat) > 84) return null;
  const zone = utmZone(lon, lat);
  const band = latBand(lat);
  if (!band) return null;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(latRad) ** 2);
  const t = Math.tan(latRad) ** 2;
  const c = (WGS84_E2 / (1 - WGS84_E2)) * Math.cos(latRad) ** 2;
  const a = Math.cos(latRad) * (lonRad - lonOrigin);
  const ePrime2 = WGS84_E2 / (1 - WGS84_E2);
  const m = WGS84_A * (
    (1 - WGS84_E2 / 4 - 3 * WGS84_E2 ** 2 / 64 - 5 * WGS84_E2 ** 3 / 256) * latRad
    - (3 * WGS84_E2 / 8 + 3 * WGS84_E2 ** 2 / 32 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(2 * latRad)
    + (15 * WGS84_E2 ** 2 / 256 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(4 * latRad)
    - (35 * WGS84_E2 ** 3 / 3072) * Math.sin(6 * latRad)
  );
  const easting = UTM_K0 * n * (
    a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * ePrime2) * a ** 5 / 120
  ) + 500000;
  let northing = UTM_K0 * (
    m + n * Math.tan(latRad) * (
      a ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * a ** 4 / 24
      + (61 - 58 * t + t ** 2 + 600 * c - 330 * ePrime2) * a ** 6 / 720
    )
  );
  const hemisphere = lat >= 0 ? 'N' : 'S';
  if (hemisphere === 'S') northing += 10000000;
  return {
    zone,
    band,
    hemisphere,
    easting,
    northing
  };
}

export function formatUtm(latitude, longitude) {
  const utm = wgs84ToUtm(latitude, longitude);
  if (!utm) return null;
  return `${utm.zone}${utm.band}  ${utm.easting.toFixed(0)} E  ${utm.northing.toFixed(0)} N`;
}

function mgrsLetters(zone, easting, northing) {
  const colSets = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const colIndex = Math.floor(easting / 100000) - 1;
  const rowIndex = Math.floor(northing / 100000) % 20;
  const col = colSets[(zone - 1) % 3][colIndex];
  const rowOff = zone % 2 === 0 ? 5 : 0;
  const row = MGRS_ROW[(rowIndex + rowOff) % MGRS_ROW.length];
  return `${col || '?'}${row || '?'}`;
}

export function formatMgrs(latitude, longitude, digits = 5) {
  const utm = wgs84ToUtm(latitude, longitude);
  if (!utm) return null;
  const size = 10 ** (5 - digits);
  const e = Math.floor((utm.easting % 100000) / size);
  const n = Math.floor((utm.northing % 100000) / size);
  const pad = (value) => String(value).padStart(digits, '0');
  return `${utm.zone}${utm.band} ${mgrsLetters(utm.zone, utm.easting, utm.northing)} ${pad(e)} ${pad(n)}`;
}

export function formatElevationMeters(meters) {
  const value = finiteNumber(meters);
  if (value == null) return null;
  return `${Math.round(value)} m`;
}

export function describeCoordinates(latitude, longitude, extras = {}) {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  if (lat == null || lon == null) return null;
  return {
    latitude: lat,
    longitude: lon,
    dd: formatDecimalDegrees(lat, lon),
    dms: formatDms(lat, lon),
    utm: formatUtm(lat, lon),
    mgrs: formatMgrs(lat, lon),
    elevation: formatElevationMeters(extras.elevationMeters),
    place: extras.place || null
  };
}
