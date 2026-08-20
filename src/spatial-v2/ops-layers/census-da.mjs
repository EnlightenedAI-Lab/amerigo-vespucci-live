/**
 * Statistics Canada 2021 Census Dissemination Areas via the public ArcGIS FeatureServer.
 * Resident population. Does not establish people physically present at the calculation instant.
 */

import { USER_AGENT } from './catalog.mjs';
import { illuminationState, noaaElements, solarPositionFromElements } from './sun.mjs';

export const CENSUS_DA = {
  censusYear: 2021,
  authority: 'Statistics Canada 2021 Census',
  layerName: 'DisseminationAreas_21',
  layerId: 3,
  featureServer:
    'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Canadian_Population_and_Dwelling_Counts_2021/FeatureServer',
  layerUrl:
    'https://services.arcgis.com/wjcPoefzjpzCgffS/ArcGIS/rest/services/Canadian_Population_and_Dwelling_Counts_2021/FeatureServer/3',
  fields: ['DAUID', 'DGUID', 'Population2021', 'TotPrivDwellings2021', 'PvtDwelUsualRes2021', 'PopPerSqKm2021'],
  montrealCduid: '2466',
  montrealCensusDivision: 'Montréal',
  method: 'DA_CENTROID_CLASSIFICATION',
  methodNote:
    'Entire 2021 resident count assigned to the solar illumination class at the DA centroid. A DA that straddles a solar boundary is not split. Not sub-DA precision. Uniform within-DA distribution is not assumed because area-weighted intersection is not used.',
  label: 'RESIDENT POPULATION BY ILLUMINATION STATE — 2021 CENSUS',
  occupancyNote:
    '2021 Census usual-resident counts. Does not establish people physically present right now.'
};

const OUT_FIELDS = CENSUS_DA.fields.join(',');
const PAGE = 2000;
const MAX_FEATURES = 8000;
const VIEW_MAX_LAT_SPAN = 1.2;
const VIEW_MAX_LON_SPAN = 1.6;

const daListCache = new Map();

function emptyBands() {
  return {
    DAYLIGHT: 0,
    CIVIL: 0,
    NAUTICAL: 0,
    ASTRONOMICAL: 0,
    NIGHT: 0
  };
}

async function fetchJson(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, status: 0, body: { error: { message: 'upstream timeout' } } };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function queryUrl(params) {
  const url = new URL(`${CENSUS_DA.layerUrl}/query`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function envelopeJson(bbox) {
  return JSON.stringify({
    xmin: bbox.minLon,
    ymin: bbox.minLat,
    xmax: bbox.maxLon,
    ymax: bbox.maxLat,
    spatialReference: { wkid: 4326 }
  });
}

function readCentroid(feature) {
  const c = feature?.centroid;
  if (c && Number.isFinite(c.y) && Number.isFinite(c.x)) {
    return { lat: c.y, lon: c.x };
  }
  return null;
}

function normalizeDa(feature) {
  const a = feature?.attributes || {};
  const centroid = readCentroid(feature);
  if (!centroid) return null;
  const pop = Number(a.Population2021);
  return {
    dauid: a.DAUID != null ? String(a.DAUID) : null,
    dguid: a.DGUID != null ? String(a.DGUID) : null,
    population2021: Number.isFinite(pop) ? pop : 0,
    totPrivDwellings2021: Number.isFinite(Number(a.TotPrivDwellings2021)) ? Number(a.TotPrivDwellings2021) : null,
    pvtDwelUsualRes2021: Number.isFinite(Number(a.PvtDwelUsualRes2021)) ? Number(a.PvtDwelUsualRes2021) : null,
    popPerSqKm2021: Number.isFinite(Number(a.PopPerSqKm2021)) ? Number(a.PopPerSqKm2021) : null,
    lat: centroid.lat,
    lon: centroid.lon
  };
}

export async function countDas(params) {
  const url = queryUrl({ ...params, f: 'json', returnCountOnly: 'true' });
  const res = await fetchJson(url);
  if (!res.ok || res.body?.count == null) {
    throw new Error(`DA count HTTP ${res.status}${res.body?.error?.message ? `: ${res.body.error.message}` : ''}`);
  }
  return Number(res.body.count) || 0;
}

async function queryDas(baseParams) {
  const rows = [];
  let offset = 0;
  while (offset < MAX_FEATURES) {
    const url = queryUrl({
      ...baseParams,
      f: 'json',
      outFields: OUT_FIELDS,
      returnGeometry: 'false',
      returnCentroid: 'true',
      outSR: '4326',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE)
    });
    const res = await fetchJson(url);
    if (!res.ok) {
      throw new Error(`DA query HTTP ${res.status}${res.body?.error?.message ? `: ${res.body.error.message}` : ''}`);
    }
    const features = res.body?.features || [];
    for (const feature of features) {
      const row = normalizeDa(feature);
      if (row) rows.push(row);
    }
    if (features.length < PAGE) break;
    offset += PAGE;
    if (res.body?.exceededTransferLimit === false) break;
  }
  return rows;
}

async function loadDas(cacheKey, params) {
  const hit = daListCache.get(cacheKey);
  if (hit) return hit;
  const count = await countDas(params);
  if (count > MAX_FEATURES) {
    const err = new Error(`DA count ${count} exceeds bounded-query cap ${MAX_FEATURES}`);
    err.code = 'TOO_LARGE';
    err.count = count;
    throw err;
  }
  const features = await queryDas(params);
  const value = { count, features, loadedAt: new Date().toISOString() };
  daListCache.set(cacheKey, value);
  return value;
}

export function classifyDas(features, date) {
  const elements = noaaElements(date);
  const bands = emptyBands();
  let used = 0;
  let withPop = 0;
  for (const da of features) {
    const pos = solarPositionFromElements(da.lat, da.lon, date, elements);
    const cls = illuminationState(pos.elevationGeometricDeg);
    bands[cls] += da.population2021 || 0;
    used += 1;
    if (da.population2021 > 0) withPop += 1;
  }
  const total = bands.DAYLIGHT + bands.CIVIL + bands.NAUTICAL + bands.ASTRONOMICAL + bands.NIGHT;
  return { bands, daFeaturesUsed: used, daFeaturesWithPopulation: withPop, totalPopulation: total };
}

function summaryShell(extra = {}) {
  return {
    available: true,
    status: 'CURRENT',
    censusYear: CENSUS_DA.censusYear,
    source: CENSUS_DA.authority,
    sourceLayer: CENSUS_DA.layerName,
    sourceUrl: CENSUS_DA.layerUrl,
    label: CENSUS_DA.label,
    occupancyClaim: false,
    occupancyNote: CENSUS_DA.occupancyNote,
    method: CENSUS_DA.method,
    methodNote: CENSUS_DA.methodNote,
    daylightPopulation: 0,
    civilPopulation: 0,
    nauticalPopulation: 0,
    astronomicalPopulation: 0,
    nightPopulation: 0,
    totalPopulation: 0,
    daFeaturesUsed: 0,
    daFeaturesWithPopulation: 0,
    ...extra
  };
}

function fromClassification(pack, extra) {
  return summaryShell({
    ...extra,
    daylightPopulation: pack.bands.DAYLIGHT,
    civilPopulation: pack.bands.CIVIL,
    nauticalPopulation: pack.bands.NAUTICAL,
    astronomicalPopulation: pack.bands.ASTRONOMICAL,
    nightPopulation: pack.bands.NIGHT,
    totalPopulation: pack.totalPopulation,
    daFeaturesUsed: pack.daFeaturesUsed,
    daFeaturesWithPopulation: pack.daFeaturesWithPopulation
  });
}

function blocked(status, message, extra = {}) {
  return summaryShell({
    available: false,
    status,
    message,
    occupancyClaim: false,
    ...extra
  });
}

function viewTooWide(bbox) {
  if (!bbox) return true;
  const latSpan = Number(bbox.maxLat) - Number(bbox.minLat);
  const lonSpan = Number(bbox.maxLon) - Number(bbox.minLon);
  return !(Number.isFinite(latSpan) && Number.isFinite(lonSpan)
    && latSpan > 0 && lonSpan > 0
    && latSpan <= VIEW_MAX_LAT_SPAN
    && lonSpan <= VIEW_MAX_LON_SPAN);
}

export async function illuminationPopulationSummary({ area = 'montreal', bbox = null, date = new Date() } = {}) {
  const calculatedAt = date.toISOString();
  const requested = String(area || 'montreal').toLowerCase();

  if (requested === 'canada') {
    return blocked(
      'BOUNDED_QUERY_REQUIRED',
      'Canada-wide Dissemination Area download is not performed. Use MONTRÉAL ANALYSIS AREA or a bounded CURRENT MAP VIEW.',
      { analysisArea: 'CANADA', calculatedAt, totalPopulation: 0 }
    );
  }

  try {
    if (requested === 'view') {
      if (viewTooWide(bbox)) {
        return blocked(
          'BOUNDED_QUERY_REQUIRED',
          'CURRENT MAP VIEW is too large for a Dissemination Area query. Zoom in or use MONTRÉAL ANALYSIS AREA. Canada-wide download is not performed.',
          { analysisArea: 'CURRENT MAP VIEW', calculatedAt }
        );
      }
      const params = {
        where: '1=1',
        geometry: envelopeJson(bbox),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects'
      };
      const key = `view:${bbox.minLat.toFixed(3)},${bbox.minLon.toFixed(3)},${bbox.maxLat.toFixed(3)},${bbox.maxLon.toFixed(3)}`;
      const loaded = await loadDas(key, params);
      const pack = classifyDas(loaded.features, date);
      return fromClassification(pack, {
        analysisArea: 'CURRENT MAP VIEW',
        calculatedAt,
        daServiceCount: loaded.count,
        cachedListAt: loaded.loadedAt
      });
    }

    const params = { where: `CDUID='${CENSUS_DA.montrealCduid}'` };
    const loaded = await loadDas('montreal-cd-2466', params);
    const pack = classifyDas(loaded.features, date);
    return fromClassification(pack, {
      analysisArea: 'MONTRÉAL CENSUS DIVISION (CDUID 2466)',
      calculatedAt,
      daServiceCount: loaded.count,
      cachedListAt: loaded.loadedAt
    });
  } catch (error) {
    if (error?.code === 'TOO_LARGE') {
      return blocked(
        'BOUNDED_QUERY_REQUIRED',
        error.message,
        { analysisArea: requested === 'view' ? 'CURRENT MAP VIEW' : 'MONTRÉAL ANALYSIS AREA', calculatedAt }
      );
    }
    return blocked(
      'FAILED',
      error?.message || 'Dissemination Area query failed',
      { analysisArea: requested === 'view' ? 'CURRENT MAP VIEW' : 'MONTRÉAL ANALYSIS AREA', calculatedAt }
    );
  }
}

export async function identifyDa(lat, lon) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return null;
  const url = queryUrl({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify({ x: safeLon, y: safeLat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: 'false',
    returnCentroid: 'true',
    outSR: '4326',
    resultRecordCount: '1'
  });
  let res = await fetchJson(url, 45000);
  if (!res.ok || !res.body?.features?.[0]) {
    res = await fetchJson(url, 45000);
  }
  if (!res.ok) return { status: 'FAILED', message: `DA identify HTTP ${res.status}${res.body?.error?.message ? `: ${res.body.error.message}` : ''}` };
  const feature = res.body?.features?.[0];
  if (!feature) return { status: 'EMPTY', message: 'No Dissemination Area at this point' };
  const row = normalizeDa(feature) || {
    dauid: feature.attributes?.DAUID != null ? String(feature.attributes.DAUID) : null,
    dguid: feature.attributes?.DGUID != null ? String(feature.attributes.DGUID) : null,
    population2021: Number(feature.attributes?.Population2021) || 0
  };
  return {
    status: 'CURRENT',
    censusYear: 2021,
    source: CENSUS_DA.authority,
    occupancyNote: CENSUS_DA.occupancyNote,
    ...row
  };
}
