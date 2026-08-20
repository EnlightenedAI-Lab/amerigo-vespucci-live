/**
 * Deterministic solar position from the NOAA Solar Calculator equations
 * (https://gml.noaa.gov/grad/solcalc/ — solareqns / calcdetails).
 * Computed locally. Not a weather observation. Not a remote sun feed.
 */

const TZ = 'America/Toronto';
const METHOD = 'NOAA Solar Calculator (GML solareqns / spreadsheet calcdetails)';
const APPARENT_HORIZON_DEG = -0.833;
const CIVIL_TWILIGHT_DEG = -6;
const NAUTICAL_TWILIGHT_DEG = -12;
const ASTRONOMICAL_TWILIGHT_DEG = -18;

export const ILLUMINATION = {
  DAYLIGHT: { id: 'DAYLIGHT', label: 'DAYLIGHT', minElev: 0 },
  CIVIL: { id: 'CIVIL', label: 'CIVIL TWILIGHT', minElev: -6, maxElev: 0 },
  NAUTICAL: { id: 'NAUTICAL', label: 'NAUTICAL TWILIGHT', minElev: -12, maxElev: -6 },
  ASTRONOMICAL: { id: 'ASTRONOMICAL', label: 'ASTRONOMICAL TWILIGHT', minElev: -18, maxElev: -12 },
  NIGHT: { id: 'NIGHT', label: 'NIGHT', maxElev: -18 }
};

function rad(d) {
  return d * Math.PI / 180;
}

function deg(r) {
  return r * 180 / Math.PI;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function julianCentury(jd) {
  return (jd - 2451545) / 36525;
}

function wrap360(value) {
  const n = value % 360;
  return n < 0 ? n + 360 : n;
}

/** NOAA geomagnetic/solar elements for an instant. */
export function noaaElements(date) {
  const jd = julianDay(date);
  const t = julianCentury(jd);
  const l0 = wrap360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t)
    + Math.sin(rad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
  const meanObliq = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
  const decl = deg(Math.asin(clamp(Math.sin(rad(obliq)) * Math.sin(rad(lambda)), -1, 1)));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqt = 4 * deg(
    y * Math.sin(2 * rad(l0))
    - 2 * e * Math.sin(rad(m))
    + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0))
    - 0.5 * y * y * Math.sin(4 * rad(l0))
    - 1.25 * e * e * Math.sin(2 * rad(m))
  );
  return { jd, t, l0, m, e, decl, eqt, obliq, lambda };
}

function trueSolarMinutes(date, lon, eqt) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  let tst = utcMinutes + eqt + 4 * lon;
  tst %= 1440;
  if (tst < 0) tst += 1440;
  return tst;
}

function hourAngleDeg(tst) {
  return tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
}

function refractionArcmin(elevGeom) {
  if (elevGeom > 85) return 0;
  const t = Math.tan(rad(elevGeom));
  if (elevGeom > 5) return 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  if (elevGeom > -0.575) {
    return 1735 + elevGeom * (-518.2 + elevGeom * (103.4 + elevGeom * (-12.79 + elevGeom * 0.711)));
  }
  return -20.774 / t;
}

export function solarPosition(lat, lon, date = new Date()) {
  return solarPositionFromElements(lat, lon, date, noaaElements(date));
}

export function solarPositionFromElements(lat, lon, date, el) {
  const tst = trueSolarMinutes(date, lon, el.eqt);
  const ha = hourAngleDeg(tst);
  const cosZen = clamp(
    Math.sin(rad(lat)) * Math.sin(rad(el.decl))
    + Math.cos(rad(lat)) * Math.cos(rad(el.decl)) * Math.cos(rad(ha)),
    -1,
    1
  );
  const zenith = deg(Math.acos(cosZen));
  const elevationGeometric = 90 - zenith;
  const elevationApparent = elevationGeometric + refractionArcmin(elevationGeometric) / 3600;
  const azimuth = wrap360(deg(Math.atan2(
    Math.sin(rad(ha)),
    Math.cos(rad(ha)) * Math.sin(rad(lat)) - Math.tan(rad(el.decl)) * Math.cos(rad(lat))
  )) + 180);
  return {
    azimuthDeg: azimuth,
    elevationGeometricDeg: elevationGeometric,
    elevationApparentDeg: elevationApparent,
    zenithDeg: zenith,
    hourAngleDeg: ha,
    declinationDeg: el.decl,
    equationOfTimeMin: el.eqt
  };
}

export function subsolarPoint(date = new Date()) {
  const el = noaaElements(date);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let lon = (720 - utcMinutes - el.eqt) / 4;
  lon = ((lon + 540) % 360) - 180;
  return {
    lat: el.decl,
    lon,
    declinationDeg: el.decl
  };
}

function dayFractionToUtc(date, fraction) {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return new Date(start + fraction * 86400000);
}

function solarEventUtc(lat, lon, date, zenithDeg) {
  const noonLocal = localCalendarNoon(date);
  const el = noaaElements(noonLocal);
  const cosHa = Math.cos(rad(zenithDeg)) / (Math.cos(rad(lat)) * Math.cos(rad(el.decl)))
    - Math.tan(rad(lat)) * Math.tan(rad(el.decl));
  if (!Number.isFinite(cosHa) || cosHa > 1 || cosHa < -1) return { beginUtc: null, endUtc: null, polar: cosHa > 1 ? 'BELOW' : 'ABOVE' };
  const ha = deg(Math.acos(clamp(cosHa, -1, 1)));
  const noonFrac = (720 - 4 * lon - el.eqt) / 1440;
  return {
    beginUtc: dayFractionToUtc(noonLocal, noonFrac - ha * 4 / 1440),
    endUtc: dayFractionToUtc(noonLocal, noonFrac + ha * 4 / 1440),
    noonUtc: dayFractionToUtc(noonLocal, noonFrac),
    polar: null
  };
}

function sunriseSunsetUtc(lat, lon, date) {
  const apparent = solarEventUtc(lat, lon, date, 90.833);
  if (apparent.polar === 'BELOW') return { sunriseUtc: null, sunsetUtc: null, solarNoonUtc: apparent.noonUtc || null, polar: 'NIGHT' };
  if (apparent.polar === 'ABOVE') return { sunriseUtc: null, sunsetUtc: null, solarNoonUtc: apparent.noonUtc || null, polar: 'DAY' };
  return {
    sunriseUtc: apparent.beginUtc,
    sunsetUtc: apparent.endUtc,
    solarNoonUtc: apparent.noonUtc,
    polar: null
  };
}

function localCalendarNoon(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  const iso = `${pick('year')}-${pick('month')}-${pick('day')}T12:00:00`;
  const asUtcGuess = new Date(`${iso}-04:00`);
  const shown = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false
  }).format(asUtcGuess);
  if (shown === '12') return asUtcGuess;
  const asEdt = new Date(`${iso}-04:00`);
  const asEst = new Date(`${iso}-05:00`);
  const hourEdt = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', hour12: false }).format(asEdt));
  return hourEdt === 12 ? asEdt : asEst;
}

function formatLocal(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(date);
}

export function illuminationState(elevationGeometricDeg) {
  if (elevationGeometricDeg >= 0) return 'DAYLIGHT';
  if (elevationGeometricDeg >= CIVIL_TWILIGHT_DEG) return 'CIVIL';
  if (elevationGeometricDeg >= NAUTICAL_TWILIGHT_DEG) return 'NAUTICAL';
  if (elevationGeometricDeg >= ASTRONOMICAL_TWILIGHT_DEG) return 'ASTRONOMICAL';
  return 'NIGHT';
}

function nextTransition(lat, lon, date) {
  const times = sunriseSunsetUtc(lat, lon, date);
  const civil = solarEventUtc(lat, lon, date, 96);
  const naut = solarEventUtc(lat, lon, date, 102);
  const astro = solarEventUtc(lat, lon, date, 108);
  const candidates = [
    { kind: 'SUNRISE', at: times.sunriseUtc },
    { kind: 'SUNSET', at: times.sunsetUtc },
    { kind: 'SOLAR NOON', at: times.solarNoonUtc },
    { kind: 'CIVIL BEGIN', at: civil.beginUtc },
    { kind: 'CIVIL END', at: civil.endUtc },
    { kind: 'NAUTICAL BEGIN', at: naut.beginUtc },
    { kind: 'NAUTICAL END', at: naut.endUtc },
    { kind: 'ASTRONOMICAL BEGIN', at: astro.beginUtc },
    { kind: 'ASTRONOMICAL END', at: astro.endUtc }
  ].filter((row) => row.at instanceof Date && Number.isFinite(row.at.getTime()));
  const later = candidates
    .filter((row) => row.at.getTime() > date.getTime() + 30000)
    .sort((a, b) => a.at - b.at);
  const pick = later[0];
  if (!pick) return null;
  return {
    kind: pick.kind,
    atUtc: pick.at.toISOString(),
    atLocal: formatLocal(pick.at),
    inMinutes: Math.round((pick.at.getTime() - date.getTime()) / 60000)
  };
}

function phaseFromElevation(elevGeom) {
  return illuminationState(elevGeom);
}

function round1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function round3(n) {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

/**
 * Reusable sun-state for later illumination / camera sun-relative work.
 * Does not compute shadows or camera orientation.
 */
export function computeSunState(lat, lon, date = new Date()) {
  const safeLat = clamp(Number(lat), -90, 90);
  const safeLon = clamp(Number(lon), -180, 180);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) {
    throw new Error('lat and lon are required');
  }
  const pos = solarPosition(safeLat, safeLon, date);
  const times = sunriseSunsetUtc(safeLat, safeLon, date);
  const sub = subsolarPoint(date);
  const phase = times.polar === 'DAY'
    ? 'DAYLIGHT'
    : (times.polar === 'NIGHT' ? 'NIGHT' : illuminationState(pos.elevationGeometricDeg));
  const next = nextTransition(safeLat, safeLon, date);
  return {
    calculatedAt: date.toISOString(),
    epochMs: date.getTime(),
    location: { lat: round3(safeLat), lon: round3(safeLon) },
    timeZone: TZ,
    utc: date.toISOString(),
    local: formatLocal(date),
    azimuthDeg: round1(pos.azimuthDeg),
    elevationDeg: round1(pos.elevationApparentDeg),
    elevationGeometricDeg: round1(pos.elevationGeometricDeg),
    declinationDeg: round1(pos.declinationDeg),
    zenithDeg: round1(pos.zenithDeg),
    sunriseUtc: times.sunriseUtc?.toISOString() || null,
    sunsetUtc: times.sunsetUtc?.toISOString() || null,
    solarNoonUtc: times.solarNoonUtc?.toISOString() || null,
    sunriseLocal: formatLocal(times.sunriseUtc),
    sunsetLocal: formatLocal(times.sunsetUtc),
    polar: times.polar,
    phase,
    illuminationState: phase,
    nextTransition: next,
    subsolar: { lat: round3(sub.lat), lon: round3(sub.lon), declinationDeg: round1(sub.declinationDeg) },
    method: METHOD,
    limitation: 'Astronomical calculation from NOAA solar equations at the requested lat/lon and UTC instant. Illumination bands use geometric solar elevation (0 / −6 / −12 / −18). Apparent elevation includes NOAA refraction and is reported separately. Not a pyranometer or ECCC observation. Not a shadow or camera-orientation model.',
    illumination: {
      sunAzimuthDeg: round1(pos.azimuthDeg),
      sunElevationDeg: round1(pos.elevationApparentDeg),
      sunElevationGeometricDeg: round1(pos.elevationGeometricDeg),
      phase,
      illuminationState: phase,
      nextTransition: next,
      note: 'Reserved for later selected-object illumination and camera sun-relative orientation. Shadow analysis is not implemented.'
    }
  };
}

function elevGeom(lat, lon, date, elements) {
  return solarPositionFromElements(lat, lon, date, elements || noaaElements(date)).elevationGeometricDeg;
}

function interpolateCross(lat0, el0, lat1, el1, target) {
  const t = (target - el0) / ((el1 - el0) || 1e-9);
  return lat0 + t * (lat1 - lat0);
}

/** Southernmost lat where geometric elevation crosses `target` going north. */
function southernCrossing(lon, date, target, elements) {
  let prevLat = -89;
  let prevEl = elevGeom(prevLat, lon, date, elements);
  if (prevEl >= target) return -90;
  for (let lat = -87; lat <= 89; lat += 2) {
    const el = elevGeom(lat, lon, date, elements);
    if (prevEl < target && el >= target) return interpolateCross(prevLat, prevEl, lat, el, target);
    prevLat = lat;
    prevEl = el;
  }
  return 90;
}

/** Northernmost lat where geometric elevation crosses `target` going south. */
function northernCrossing(lon, date, target, elements) {
  let prevLat = 89;
  let prevEl = elevGeom(prevLat, lon, date, elements);
  if (prevEl >= target) return 90;
  for (let lat = 87; lat >= -89; lat -= 2) {
    const el = elevGeom(lat, lon, date, elements);
    if (prevEl < target && el >= target) return interpolateCross(prevLat, prevEl, lat, el, target);
    prevLat = lat;
    prevEl = el;
  }
  return -90;
}

function sampleLongitudeLine(date, targetElev, step = 2) {
  const sub = subsolarPoint(date);
  const elements = noaaElements(date);
  const towardSouth = sub.lat >= 0;
  const coords = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const lat = towardSouth
      ? southernCrossing(lon, date, targetElev, elements)
      : northernCrossing(lon, date, targetElev, elements);
    if (Number.isFinite(lat)) coords.push([lon, clamp(lat, -85, 85)]);
  }
  return coords;
}

function closeToNightPole(line, sub) {
  if (!line?.length) return null;
  const pole = sub.lat >= 0 ? -85 : 85;
  return [...line, [180, pole], [-180, pole], line[0]];
}

export function sunGeometry(date = new Date()) {
  const sub = subsolarPoint(date);
  const terminator = sampleLongitudeLine(date, 0, 2);
  const civil = sampleLongitudeLine(date, CIVIL_TWILIGHT_DEG, 2);
  const nautical = sampleLongitudeLine(date, NAUTICAL_TWILIGHT_DEG, 2);
  const astronomical = sampleLongitudeLine(date, ASTRONOMICAL_TWILIGHT_DEG, 2);
  return {
    subsolar: sub,
    terminator,
    civil,
    nautical,
    astronomical,
    civilFill: closeToNightPole(terminator, sub),
    nauticalFill: closeToNightPole(civil, sub),
    astronomicalFill: closeToNightPole(nautical, sub),
    nightFill: closeToNightPole(astronomical, sub)
  };
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dp = rad(lat2 - lat1);
  const dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrap360(deg(Math.atan2(y, x)));
}

export function compass8(bearing) {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(bearing / 45) % 8];
}

export function nearestOnLine(line, lat, lon) {
  let best = null;
  for (const [x, y] of line || []) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const meters = haversineMeters(lat, lon, y, x);
    if (!best || meters < best.meters) best = { lat: y, lon: x, meters };
  }
  if (!best) return null;
  const bearing = bearingDeg(lat, lon, best.lat, best.lon);
  return {
    ...best,
    bearingDeg: round1(bearing),
    compass: compass8(bearing),
    km: best.meters >= 1000 ? Math.round(best.meters / 1000) : Math.round(best.meters) / 1000
  };
}

export function parseSolarInstant(value, now = new Date()) {
  if (value == null || value === '' || value === 'now') return now;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return now;
  const maxSkew = 48 * 3600 * 1000;
  if (Math.abs(ms - now.getTime()) > maxSkew) return now;
  return new Date(ms);
}

function lineFeature(id, kind, name, note, coords) {
  if (!coords?.length) return null;
  return {
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: coords },
    properties: { layerId: 'sun-daylight', sunKind: kind, name, note }
  };
}

function polyFeature(id, kind, name, note, ring) {
  if (!ring) return null;
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { layerId: 'sun-daylight', sunKind: kind, name, note }
  };
}

export function sunGeojson(date = new Date()) {
  const geom = sunGeometry(date);
  const features = [
    polyFeature('sun-civil-fill', 'civil-fill', 'Civil twilight and darker', 'Geometric elevation < 0°.', geom.civilFill),
    polyFeature('sun-nautical-fill', 'nautical-fill', 'Nautical twilight and darker', 'Geometric elevation < −6°.', geom.nauticalFill),
    polyFeature('sun-astro-fill', 'astronomical-fill', 'Astronomical twilight and darker', 'Geometric elevation < −12°.', geom.astronomicalFill),
    polyFeature('sun-night', 'night', 'Night', 'Geometric elevation < −18°.', geom.nightFill),
    lineFeature('sun-astro-casing', 'astronomical-casing', 'Astronomical twilight casing', 'Contrast casing for −18° boundary.', geom.astronomical),
    lineFeature('sun-astro-line', 'astronomical-line', 'Astronomical twilight', 'Geometric elevation −18°.', geom.astronomical),
    lineFeature('sun-nautical-casing', 'nautical-casing', 'Nautical twilight casing', 'Contrast casing for −12° boundary.', geom.nautical),
    lineFeature('sun-nautical-line', 'nautical-line', 'Nautical twilight', 'Geometric elevation −12°.', geom.nautical),
    lineFeature('sun-civil-casing', 'civil-casing', 'Civil twilight casing', 'Contrast casing for −6° boundary.', geom.civil),
    lineFeature('sun-civil-line', 'civil-line', 'Civil twilight', 'Geometric elevation −6°.', geom.civil),
    lineFeature('sun-terminator-casing', 'terminator-casing', 'Day / night line casing', 'Dark contrast casing for the 0° horizon.', geom.terminator),
    lineFeature('sun-terminator', 'terminator', 'Solar terminator', 'Geometric elevation 0°. Day / night horizon.', geom.terminator)
  ].filter(Boolean);
  features.push({
    type: 'Feature',
    id: 'sun-subsolar',
    geometry: { type: 'Point', coordinates: [geom.subsolar.lon, geom.subsolar.lat] },
    properties: {
      layerId: 'sun-daylight',
      sunKind: 'subsolar',
      name: 'SUBSOLAR POINT',
      note: 'Location where the sun is at the zenith (NOAA declination / equation of time).',
      lat: round3(geom.subsolar.lat),
      lon: round3(geom.subsolar.lon),
      declinationDeg: round1(geom.subsolar.declinationDeg)
    }
  });
  return {
    type: 'FeatureCollection',
    features,
    terminator: geom.terminator
  };
}

export const SUN_METHOD = METHOD;
export const SUN_TZ = TZ;

/** Compact reusable contract for later WOA / SensorPose / WorldState consumers. Not wired here. */
export function toSolarState(sunState) {
  const loc = sunState?.location || {};
  return {
    timestamp: sunState?.utc || sunState?.calculatedAt || null,
    lat: loc.lat ?? null,
    lon: loc.lon ?? null,
    solarAzimuth: sunState?.azimuthDeg ?? null,
    solarElevation: sunState?.elevationDeg ?? null,
    illuminationClass: sunState?.illuminationState || sunState?.phase || null,
    sunrise: sunState?.sunriseUtc || null,
    sunset: sunState?.sunsetUtc || null,
    nextTransition: sunState?.nextTransition || null
  };
}
