import {
  LAYERS,
  PANEL_GROUPS,
  URLS,
  USER_AGENT,
  MONTREAL_BBOX,
  MONTREAL_AREA_BBOX,
  MONTREAL_VIEW,
  inBbox,
  layerMeta
} from './catalog.mjs';
import { parseCsv, decodeCsvBuffer } from './csv.mjs';
import {
  parseVersionBody,
  parseHydroVersionTimestamp,
  normalizeHydroMarkersPayload
} from './hydro.mjs';
import {
  extractKmlFromKmzBuffer,
  parseHydroOutageAreasFromKml,
  linkHydroAreasToOutages
} from './hydro-kmz.mjs';
import {
  filterRecentSpvmFeatures,
  UNSUPPORTED_CLOCK_WINDOWS,
  normalizeCrimeWindow,
  crimeStatusForWindow,
  CRIME_WINDOWS,
  SPVM_SOURCE_CATEGORIES,
  previousWindowFor,
  countInDateRange,
  minSpvmDate
} from './spvm-recent.mjs';
import { reprojectGeometryToWgs84, looksLikeWgs84 } from './mtm8.mjs';
import {
  fetchBixiStations,
  fetchAircraft as fetchAircraftMovement,
  fetchQc511Works,
  fetchSimInterventions
} from './movement.mjs';
import { fetchTrafficCameras } from './cameras.mjs';
import {
  fetchActiveFires,
  fetchHotspots,
  fetchPerimeters,
  fetchFireWeatherStations,
  CWFIS,
  LIMITATION as CWFIS_LIMITATION
} from './cwfis.mjs';
import {
  fetchRsqaAirQuality,
  fetchHydrometric,
  fetchBikeCounters,
  fetchCivic311,
  fetchIntersectionCounts
} from './environment.mjs';
import { computeSunState, sunGeojson, SUN_METHOD, parseSolarInstant, nearestOnLine, toSolarState } from './sun.mjs';
import { illuminationPopulationSummary, identifyDa } from './census-da.mjs';

const cache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function fc(features) {
  return { type: 'FeatureCollection', features };
}

function pointFeature(id, lon, lat, properties) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties
  };
}

function publishedScalars(props = {}) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === '') continue;
    if (typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
}

function coordsFromFeature(feature, props = {}) {
  const propLat = Number(props.LATITUDE ?? props.latitude);
  const propLon = Number(props.LONGITUDE ?? props.longitude);
  if (Number.isFinite(propLat) && Number.isFinite(propLon) && Math.abs(propLon) <= 180 && Math.abs(propLat) <= 90) {
    return { lon: propLon, lat: propLat };
  }
  const geom = feature?.geometry;
  if (geom?.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    if (looksLikeWgs84(geom)) {
      return { lon: Number(geom.coordinates[0]), lat: Number(geom.coordinates[1]) };
    }
    const reprojected = reprojectGeometryToWgs84(geom);
    const lon = Number(reprojected.coordinates?.[0]);
    const lat = Number(reprojected.coordinates?.[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
      return { lon, lat };
    }
  }
  return null;
}

async function fetchBuffer(url, { timeoutMs = 30000, accept = '*/*' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      redirect: 'follow',
      signal: controller.signal
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      buffer
    };
  } finally {
    clearTimeout(timer);
  }
}

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    return { ...hit.value, cached: true };
  }
  const value = await loader();
  if (value?.ok) cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

function fail(meta, status, message, extra = {}) {
  return {
    ok: false,
    layerId: meta.id,
    title: meta.title,
    status,
    retrievedAt: nowIso(),
    source: meta.provider,
    licence: meta.licence,
    officialUrl: meta.officialUrl,
    catalogueUrl: meta.catalogueUrl,
    adapter: meta.adapter,
    establishes: meta.establishes,
    doesNotEstablish: meta.doesNotEstablish,
    limitations: meta.limitations,
    rightsBlocker: meta.rightsBlocker || null,
    authBlocker: meta.authBlocker || null,
    message,
    featureCount: 0,
    geojson: fc([]),
    ...extra
  };
}

function okPayload(meta, status, extra = {}) {
  return {
    ok: true,
    layerId: meta.id,
    title: meta.title,
    status,
    retrievedAt: extra.retrievedAt || nowIso(),
    source: meta.provider,
    licence: meta.licence,
    officialUrl: extra.officialUrl || meta.officialUrl,
    catalogueUrl: meta.catalogueUrl,
    adapter: meta.adapter,
    establishes: meta.establishes,
    doesNotEstablish: meta.doesNotEstablish,
    limitations: meta.limitations,
    rightsBlocker: meta.rightsBlocker || null,
    authBlocker: meta.authBlocker || null,
    featureCount: extra.featureCount ?? extra.geojson?.features?.length ?? 0,
    ...extra
  };
}

function fireOperationalStatus(props) {
  const debut = String(props.DATE_DEBUT || '').trim();
  const fin = String(props.DATE_FIN || '').trim();
  const emptyFin = !fin || ['nat', 'null', 'none', 'undefined'].includes(fin.toLowerCase());
  if (!debut || Number.isNaN(Date.parse(debut))) {
    return { operationalStatus: 'ambiguous', isActive: false, dateDebut: debut || null, dateFin: fin || null };
  }
  if (!emptyFin) {
    return { operationalStatus: 'closed', isActive: false, dateDebut: debut, dateFin: fin };
  }
  return { operationalStatus: 'Active', isActive: true, dateDebut: debut, dateFin: null };
}

async function fetchFire() {
  const meta = layerMeta('fire');
  return cached('fire', 6 * 60 * 60 * 1000, async () => {
    const res = await fetchBuffer(URLS.fireGeojson, { accept: 'application/geo+json, application/json' });
    if (!res.ok) return fail(meta, 'FAILED', `Ville casernes GeoJSON HTTP ${res.status}`);
    let geojson;
    try {
      geojson = JSON.parse(res.buffer.toString('utf8'));
    } catch {
      return fail(meta, 'FAILED', 'Ville casernes GeoJSON parse failed');
    }
    const receivedAt = nowIso();
    const features = [];
    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const xy = coordsFromFeature(feature, props);
      if (!xy) continue;
      const status = fireOperationalStatus(props);
      const civic = String(props.NO_CIVIQUE || '').trim();
      const street = String(props.RUE || '').trim();
      features.push(pointFeature(String(props.CASERNE || `${xy.lat},${xy.lon}`), xy.lon, xy.lat, {
        layerId: 'fire',
        name: `Station ${String(props.CASERNE || '').trim() || '—'}`,
        stationNumber: String(props.CASERNE || '').trim() || null,
        address: [civic, street].filter(Boolean).join(' ') || null,
        borough: String(props.ARRONDISSEMENT || '').trim() || null,
        city: String(props.VILLE || '').trim() || null,
        ...status,
        published: publishedScalars(props),
        source: meta.provider,
        retrievedAt: receivedAt
      }));
    }
    if (!features.length) return fail(meta, 'EMPTY_COVERAGE', 'Casernes GeoJSON returned no mappable points');
    return okPayload(meta, 'STATIC', {
      geojson: fc(features),
      featureCount: features.length,
      publisherBytes: res.buffer.length,
      evidence: { http: res.status, identity: URLS.fireGeojson }
    });
  });
}

async function fetchPdq() {
  const meta = layerMeta('pdq');
  return cached('pdq', 6 * 60 * 60 * 1000, async () => {
    const res = await fetchBuffer(URLS.pdqGeojson, { accept: 'application/geo+json, application/json' });
    if (!res.ok) return fail(meta, 'FAILED', `Ville PDQ GeoJSON HTTP ${res.status}`);
    let geojson;
    try {
      geojson = JSON.parse(res.buffer.toString('utf8'));
    } catch {
      return fail(meta, 'FAILED', 'Ville PDQ GeoJSON parse failed');
    }
    const receivedAt = nowIso();
    const features = [];
    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const xy = coordsFromFeature(feature, props);
      if (!xy) continue;
      const desc = String(props.DESC_LIEU || '').trim();
      const match = desc.match(/(\d+)/);
      const pdq = match ? `PDQ ${match[1]}` : desc || 'PDQ';
      const address = [props.NO_CIV_LIE, props.PREFIX_TEM, props.NOM_TEMP, props.DIR_TEMP, props.MUN_TEMP]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(' ');
      features.push(pointFeature(String(props.OBJECTID || pdq), xy.lon, xy.lat, {
        layerId: 'pdq',
        name: desc || pdq,
        pdq,
        address: address || null,
        municipality: String(props.MUN_TEMP || '').trim() || null,
        latitude: xy.lat,
        longitude: xy.lon,
        published: publishedScalars(props),
        source: meta.provider,
        retrievedAt: receivedAt,
        sourceCrs: 'Geometry EPSG:32188; LATITUDE/LONGITUDE on the record are WGS84',
        note: 'Facility location. Official PDQ GeoJSON has no phone or website fields. Not live CAD.'
      }));
    }
    if (!features.length) return fail(meta, 'EMPTY_COVERAGE', 'PDQ GeoJSON returned no mappable points');
    const sample = features[0].geometry.coordinates;
    if (sample[0] < -80 || sample[0] > -70 || sample[1] < 40 || sample[1] > 50) {
      return fail(meta, 'FAILED', 'PDQ points did not land in a plausible Montréal WGS84 range');
    }
    return okPayload(meta, 'STATIC', {
      geojson: fc(features),
      featureCount: features.length,
      evidence: { http: res.status, identity: URLS.pdqGeojson }
    });
  });
}

async function fetchHospitals() {
  const meta = layerMeta('hospitals');
  return cached('hospitals', 6 * 60 * 60 * 1000, async () => {
    const res = await fetchBuffer(URLS.odhfCsv, { timeoutMs: 60000, accept: 'text/csv, */*' });
    if (!res.ok) return fail(meta, 'FAILED', `ODHF CSV HTTP ${res.status}`);
    const text = decodeCsvBuffer(res.buffer, res.contentType);
    const rows = parseCsv(text);
    const receivedAt = nowIso();
    const features = [];
    let hospitalRows = 0;
    for (const row of rows) {
      if (String(row.odhf_facility_type || '').trim() !== 'Hospitals') continue;
      hospitalRows += 1;
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      if (!inBbox(lat, lon, MONTREAL_BBOX)) continue;
      const address = [row.street_no, row.street_name, row.city, row.province, row.postal_code]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(', ');
      features.push(pointFeature(String(row.index || row.facility_name), lon, lat, {
        layerId: 'hospitals',
        name: String(row.facility_name || '').trim() || '—',
        facilityType: String(row.source_facility_type || row.odhf_facility_type || '').trim() || 'Hospital',
        providerName: String(row.provider || '').trim() || null,
        unit: String(row.unit || '').trim() || null,
        address: address || String(row.source_format_str_address || '').trim() || null,
        postalCode: String(row.postal_code || '').trim() || null,
        city: String(row.city || '').trim() || null,
        published: publishedScalars(row),
        source: meta.provider,
        retrievedAt: receivedAt,
        note: 'Health-facility inventory. ODHF v1 has no telephone or website columns. Not occupancy or EMS CAD.'
      }));
    }
    if (!features.length) {
      return fail(meta, hospitalRows ? 'EMPTY_COVERAGE' : 'FAILED', hospitalRows
        ? 'ODHF hospitals exist nationally but none intersect the Montréal bbox'
        : 'ODHF CSV had no hospital rows');
    }
    return okPayload(meta, 'STATIC', {
      geojson: fc(features),
      featureCount: features.length,
      nationalHospitalRows: hospitalRows,
      evidence: { http: res.status, identity: URLS.odhfCsv, bbox: MONTREAL_BBOX }
    });
  });
}

function bilingual(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  if (value.en != null && typeof value.en !== 'object') return value.en;
  if (value.fr != null && typeof value.fr !== 'object') return value.fr;
  if (value.value != null) return bilingual(value.value);
  return null;
}

function flattenCitypage(props = {}) {
  const current = props.currentConditions || {};
  const temperature = current.temperature ?? current.air_temperature ?? null;
  return {
    name: bilingual(props.name) || props.identifier || 'ECCC station',
    identifier: props.identifier || null,
    region: bilingual(props.region) || null,
    lastUpdated: props.lastUpdated || current.dateTime || null,
    condition: bilingual(current.condition || current.conditionText),
    temperature: bilingual(temperature?.value ?? temperature),
    temperatureUnit: bilingual(temperature?.units),
    wind: current.wind || null
  };
}

async function fetchWeather() {
  const meta = layerMeta('weather');
  return cached('weather', 5 * 60 * 1000, async () => {
    const receivedAt = nowIso();
    const [cityRes, alertRes] = await Promise.all([
      fetchBuffer(URLS.ecccCitypage, { accept: 'application/geo+json, application/json' }),
      fetchBuffer(URLS.ecccAlerts, { accept: 'application/geo+json, application/json' })
    ]);

    if (!cityRes.ok) return fail(meta, 'FAILED', `ECCC citypage HTTP ${cityRes.status}`);

    let city;
    let alerts;
    try {
      city = JSON.parse(cityRes.buffer.toString('utf8'));
    } catch {
      return fail(meta, 'FAILED', 'ECCC citypage JSON parse failed');
    }
    if (!alertRes.ok) return fail(meta, 'FAILED', `ECCC weather-alerts HTTP ${alertRes.status}`);
    try {
      alerts = JSON.parse(alertRes.buffer.toString('utf8'));
    } catch {
      return fail(meta, 'FAILED', 'ECCC weather-alerts JSON parse failed');
    }

    const stationFeatures = [];
    for (const feature of city.features || []) {
      const props = feature.properties || {};
      const xy = coordsFromFeature(feature, props);
      if (!xy) continue;
      const flat = flattenCitypage(props);
      stationFeatures.push({
        type: 'Feature',
        id: String(props.identifier || feature.id || `${xy.lat},${xy.lon}`),
        geometry: feature.geometry,
        properties: {
          layerId: 'weather',
          weatherKind: 'citypage',
          ...flat,
          source: 'ECCC MSC citypageweather-realtime',
          retrievedAt: receivedAt
        }
      });
    }

    const alertFeatures = [];
    for (const feature of alerts.features || []) {
      const props = feature.properties || {};
      alertFeatures.push({
        type: 'Feature',
        id: String(feature.id || props.identifier || props.headline),
        geometry: feature.geometry || null,
        properties: {
          layerId: 'weather',
          weatherKind: 'alert',
          name: props.headline || props.alertType || props.identifier || 'Weather alert',
          headline: props.headline || null,
          alertType: props.alertType || props.event || null,
          severity: props.severity || null,
          certainty: props.certainty || null,
          urgency: props.urgency || null,
          area: props.areaDesc || props.area || null,
          sent: props.sent || props.onset || null,
          description: props.description || props.headline || null,
          source: 'ECCC MSC weather-alerts',
          retrievedAt: receivedAt,
          note: 'Alert text is reproduced without alteration.'
        }
      });
    }

    const alertState = alertFeatures.length ? 'LIVE' : 'EMPTY_COVERAGE';
    return okPayload(meta, 'LIVE', {
      geojson: fc([...stationFeatures, ...alertFeatures]),
      featureCount: stationFeatures.length + alertFeatures.length,
      stationCount: stationFeatures.length,
      alertCount: alertFeatures.length,
      alertState,
      citypageMatched: city.numberMatched ?? stationFeatures.length,
      alertsMatched: alerts.numberMatched ?? alertFeatures.length,
      radar: {
        status: 'LIVE',
        provider: 'ECCC GeoMet WMS',
        layer: URLS.geometRadarLayer,
        endpoint: URLS.geometWms,
        note: 'Not Spatial V2 /api/spatial/radar-frames (IPMA Azores).'
      },
      evidence: {
        citypage: { http: cityRes.status, url: URLS.ecccCitypage },
        alerts: { http: alertRes.status, url: URLS.ecccAlerts, numberReturned: alerts.numberReturned ?? alertFeatures.length }
      }
    });
  });
}

function polygonTouchesBbox(geometry, bbox) {
  const rings = geometry?.type === 'Polygon'
    ? geometry.coordinates
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates.flat()
      : [];
  for (const ring of rings) {
    for (const pair of ring || []) {
      const lon = Number(pair[0]);
      const lat = Number(pair[1]);
      if (inBbox(lat, lon, bbox)) return true;
    }
  }
  return false;
}

async function fetchHydro() {
  const meta = layerMeta('hydro');
  return cached('hydro', 15 * 60 * 1000, async () => {
    const receivedAt = nowIso();
    const versionRes = await fetchBuffer(`${URLS.hydroBase}/bisversion.json`, { accept: 'application/json, text/plain' });
    if (!versionRes.ok) return fail(meta, 'FAILED', `Hydro bisversion HTTP ${versionRes.status}`);
    const version = parseVersionBody(versionRes.buffer.toString('utf8'));
    if (!version) return fail(meta, 'FAILED', 'Hydro bisversion empty');
    const feedTimestamp = parseHydroVersionTimestamp(version);
    const markersUrl = `${URLS.hydroBase}/bismarkers${version}.json`;
    const markersRes = await fetchBuffer(markersUrl, { accept: 'application/json' });
    if (!markersRes.ok) return fail(meta, 'FAILED', `Hydro bismarkers HTTP ${markersRes.status}`);
    let payload;
    try {
      payload = JSON.parse(markersRes.buffer.toString('utf8'));
    } catch {
      return fail(meta, 'FAILED', 'Hydro bismarkers JSON parse failed');
    }
    const all = normalizeHydroMarkersPayload(payload, { version, feedTimestamp, receivedAt });
    const localPoints = all.filter((row) => inBbox(row.latitude, row.longitude, MONTREAL_AREA_BBOX));
    const pointById = new Map(all.map((row) => [row.outageId, row]));

    let polygonStatus = 'ERROR';
    let polygonError = null;
    let provincialAreas = [];
    const polyUrl = `${URLS.hydroBase}/bispoly${version}.kmz`;
    try {
      const polyRes = await fetchBuffer(polyUrl, {
        timeoutMs: 45000,
        accept: 'application/vnd.google-earth.kmz, application/octet-stream, */*'
      });
      if (!polyRes.ok) throw new Error(`Hydro bispoly HTTP ${polyRes.status}`);
      const kml = extractKmlFromKmzBuffer(polyRes.buffer);
      provincialAreas = linkHydroAreasToOutages(
        parseHydroOutageAreasFromKml(kml, {
          version,
          feedTimestamp,
          receivedAt,
          sourceName: 'Hydro-Québec Open Data'
        }),
        all
      );
      polygonStatus = 'CURRENT';
    } catch (error) {
      polygonError = error?.message || 'Hydro polygon fetch failed';
      polygonStatus = 'ERROR';
      provincialAreas = [];
    }

    const localAreas = provincialAreas.filter((area) => {
      if (area.centroidLatitude != null && area.centroidLongitude != null
        && inBbox(area.centroidLatitude, area.centroidLongitude, MONTREAL_AREA_BBOX)) {
        return true;
      }
      return polygonTouchesBbox(area.geometry, MONTREAL_AREA_BBOX);
    });

    const areaFeatures = localAreas.map((area) => {
      const linked = area.outageId ? pointById.get(area.outageId) : null;
      return {
        type: 'Feature',
        id: area.areaId,
        geometry: area.geometry,
        properties: {
          layerId: 'hydro',
          hydroKind: 'area',
          name: linked?.messageId ? `Outage area ${linked.messageId}` : 'Hydro-Québec outage area',
          areaId: area.areaId,
          outageId: area.outageId || null,
          customersAffected: linked?.customersAffected ?? null,
          outageStart: linked?.outageStart || null,
          estimatedRestoration: linked?.estimatedRestoration || null,
          crewStatusLabel: linked?.crewStatusLabel || null,
          causeCategory: linked?.causeCategory || null,
          municipalityId: linked?.municipalityId || null,
          sourceVersion: area.sourceVersion,
          feedTimestamp: area.feedTimestamp,
          spatialPrecision: area.spatialPrecision,
          licence: 'CC-BY-NC 4.0',
          rightsNote: meta.rightsBlocker,
          source: meta.provider,
          retrievedAt: receivedAt,
          locationNote: 'Approximate published outage area. Not exact affected buildings.'
        }
      };
    });

    const linkedAreaIds = new Set(localAreas.map((area) => area.outageId).filter(Boolean));
    const pointFeatures = localPoints.map((row) => pointFeature(row.outageId, row.longitude, row.latitude, {
      layerId: 'hydro',
      hydroKind: 'point',
      name: row.messageId ? `Outage ${row.messageId}` : 'Hydro-Québec outage',
      customersAffected: row.customersAffected,
      outageStart: row.outageStart,
      estimatedRestoration: row.estimatedRestoration,
      crewStatusLabel: row.crewStatusLabel,
      causeCategory: row.causeCategory || null,
      causeCode: row.causeCode,
      municipalityId: row.municipalityId,
      sourceVersion: row.sourceVersion,
      feedTimestamp: row.feedTimestamp,
      hasPublishedArea: linkedAreaIds.has(row.outageId),
      locationNote: row.locationNote,
      licence: 'CC-BY-NC 4.0',
      rightsNote: meta.rightsBlocker,
      source: meta.provider,
      retrievedAt: receivedAt
    }));

    const features = [...areaFeatures, ...pointFeatures];
    const status = features.length ? 'LIVE' : 'EMPTY_COVERAGE';
    return okPayload(meta, status, {
      geojson: fc(features),
      featureCount: features.length,
      pointCount: pointFeatures.length,
      polygonCount: areaFeatures.length,
      provincialOutageCount: all.length,
      provincialPolygonCount: provincialAreas.length,
      montrealAreaCount: localPoints.length,
      version,
      feedTimestamp,
      polygonStatus,
      polygonError,
      reusedAdapter: 'Brain hydro-quebec-kmz-parse + official bispoly{version}.kmz',
      evidence: {
        versionHttp: versionRes.status,
        markersHttp: markersRes.status,
        markersUrl,
        polyUrl,
        bbox: MONTREAL_AREA_BBOX
      },
      message: features.length
        ? `${areaFeatures.length} published area(s), ${pointFeatures.length} point(s) in Montréal-area bbox`
        : `BIS returned ${all.length} current outage(s) provincially; none inside the Montréal-area bbox.`
    });
  });
}

async function fetchStm(options = {}) {
  const meta = layerMeta('stm');
  const sandboxKeyPresent = Boolean(String(process.env.STM_API_KEY || '').trim());
  const wantedRoute = options.route && options.route !== 'all' ? String(options.route) : null;
  const payload = await cached('stm', 15 * 1000, async () => {
    try {
      const res = await fetchBuffer(URLS.spatialV2Stm, { timeoutMs: 20000, accept: 'application/json' });
      if (res.status === 503) {
        return fail(meta, 'AUTH_REQUIRED', 'Spatial V2 STM adapter reports the API key is not configured.', {
          sandboxKeyPresent: false,
          reusedAdapter: 'Spatial V2 /api/spatial/stm/live-buses',
          upstreamHttp: res.status
        });
      }
      if (!res.ok) {
        let message = `Spatial V2 STM HTTP ${res.status}`;
        try {
          const body = JSON.parse(res.buffer.toString('utf8'));
          if (body?.message) message = body.message;
        } catch {
          // ignore
        }
        if (/not configured|api key|apikey/i.test(message)) {
          return fail(meta, 'AUTH_REQUIRED', message, {
            sandboxKeyPresent: false,
            reusedAdapter: 'Spatial V2 /api/spatial/stm/live-buses',
            upstreamHttp: res.status
          });
        }
        return fail(meta, 'FAILED', message, { upstreamHttp: res.status });
      }
      const body = JSON.parse(res.buffer.toString('utf8'));
      if (!body?.ok) {
        const message = body?.message || 'STM adapter returned not-ok';
        const auth = /not configured|api key|apikey/i.test(message);
        return fail(meta, auth ? 'AUTH_REQUIRED' : 'FAILED', message);
      }
      const receivedAt = body.retrievedAt || nowIso();
      const features = [];
      const routeSet = new Set();
      for (const vehicle of body.vehicles || []) {
        const lat = Number(vehicle.latitude);
        const lon = Number(vehicle.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (vehicle.routeId) routeSet.add(String(vehicle.routeId));
        features.push(pointFeature(String(vehicle.vehicleId || `${lat},${lon}`), lon, lat, {
          layerId: 'stm',
          name: vehicle.routeId ? `STM ${vehicle.routeId}` : 'STM vehicle',
          vehicleId: vehicle.vehicleId || null,
          routeId: vehicle.routeId || null,
          tripId: vehicle.tripId || null,
          bearing: vehicle.bearing ?? null,
          speed: vehicle.speed ?? null,
          vehicleTimestamp: vehicle.timestamp ?? null,
          source: body.source || 'STM GTFS-Realtime',
          feedTimestampIso: body.feedTimestampIso || null,
          retrievedAt: receivedAt
        }));
      }
      return okPayload(meta, 'LIVE', {
        geojson: fc(features),
        featureCount: features.length,
        routes: [...routeSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        feedTimestampIso: body.feedTimestampIso || null,
        reusedAdapter: 'Spatial V2 /api/spatial/stm/live-buses (read-only; Spatial V2 not modified)',
        sandboxKeyPresent,
        refreshMs: 20000,
        evidence: { upstreamHttp: res.status, vehicleCount: body.vehicleCount }
      });
    } catch (error) {
      return fail(meta, 'AUTH_REQUIRED', 'STM credentials are not available in this sandbox process, and the Spatial V2 live-bus adapter was not reachable.', {
        sandboxKeyPresent: false,
        reusedAdapter: 'Spatial V2 /api/spatial/stm/live-buses',
        detail: error?.message || String(error)
      });
    }
  });
  if (!payload?.ok || !wantedRoute) return payload;
  const filtered = (payload.geojson?.features || []).filter((feature) => String(feature.properties?.routeId || '') === wantedRoute);
  return {
    ...payload,
    geojson: fc(filtered),
    featureCount: filtered.length,
    selectedRoute: wantedRoute,
    message: `${filtered.length} vehicles on route ${wantedRoute}`
  };
}

async function fetchRoadWorks() {
  const meta = layerMeta('road-works');
  return cached('road-works', 30 * 60 * 1000, async () => {
    const res = await fetchBuffer(URLS.infoTravauxCsv, { timeoutMs: 45000, accept: 'text/csv, */*' });
    if (!res.ok) return fail(meta, 'FAILED', `info-travaux CSV HTTP ${res.status}`);
    const text = decodeCsvBuffer(res.buffer, res.contentType);
    const rows = parseCsv(text);
    const receivedAt = nowIso();
    const features = [];
    let missingCoords = 0;
    for (const row of rows) {
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        missingCoords += 1;
        continue;
      }
      features.push(pointFeature(String(row.id || `${lat},${lon}`), lon, lat, {
        layerId: 'road-works',
        name: String(row.occupancy_name || row.reason_category || 'Travaux').trim() || 'Travaux',
        permitId: row.permit_permit_id || null,
        requestId: row.id || null,
        status: row.currentstatus || null,
        category: row.permitcategory || row.reason_category || null,
        boroughId: row.boroughid || null,
        start: row.duration_start_date || null,
        end: row.duration_end_date || null,
        loadDate: row.load_date || null,
        source: meta.provider,
        retrievedAt: receivedAt
      }));
    }
    if (!features.length) return fail(meta, 'EMPTY_COVERAGE', 'info-travaux CSV had no rows with coordinates');
    return okPayload(meta, 'LIVE', {
      geojson: fc(features),
      featureCount: features.length,
      sourceRowCount: rows.length,
      rowsWithoutCoordinates: missingCoords,
      evidence: { http: res.status, identity: URLS.infoTravauxCsv }
    });
  });
}

async function fetchSpvmSource() {
  return cached('spvm-source', 45 * 60 * 1000, async () => {
    const attempts = [
      { geo: URLS.spatialV2SpvmGeojson, status: URLS.spatialV2SpvmStatus, label: 'Spatial V2 /api/spatial/spvm/* (read-only)' },
      { geo: URLS.spvmGeojson, status: URLS.spvmStatus, label: 'iqai-spvm-data GitHub Pages' }
    ];
    let lastError = 'SPVM GeoJSON unavailable';
    for (const attempt of attempts) {
      try {
        const [statusRes, geoRes] = await Promise.all([
          fetchBuffer(attempt.status, { timeoutMs: 20000, accept: 'application/json' }),
          fetchBuffer(attempt.geo, { timeoutMs: 45000, accept: 'application/geo+json, application/json' })
        ]);
        if (!geoRes.ok) {
          lastError = `SPVM GeoJSON HTTP ${geoRes.status} (${attempt.label})`;
          continue;
        }
        const geojson = JSON.parse(geoRes.buffer.toString('utf8'));
        if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          lastError = 'SPVM upstream is not a FeatureCollection';
          continue;
        }
        let status = null;
        if (statusRes.ok) {
          try {
            status = JSON.parse(statusRes.buffer.toString('utf8'));
          } catch {
            status = null;
          }
        }
        return {
          ok: true,
          geojson,
          status,
          reusedAdapter: attempt.label,
          evidence: {
            geojsonHttp: geoRes.status,
            statusHttp: statusRes.status,
            geoUrl: attempt.geo,
            officialCsv: URLS.spvmOfficialCsv
          }
        };
      } catch (error) {
        lastError = error?.message || String(error);
      }
    }
    return { ok: false, error: lastError };
  });
}

function mapSpvmFeature(feature, layerId, receivedAt, status) {
  const props = feature.properties || {};
  const xy = coordsFromFeature(feature, props);
  if (!xy) return null;
  const date = String(props.date || props.DATE || '').slice(0, 10) || null;
  const shift = props.shift || props.QUART || null;
  const category = props.category || props.CATEGORIE || null;
  const known = SPVM_SOURCE_CATEGORIES.find((row) => row.french === category);
  return {
    type: 'Feature',
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      layerId,
      name: category || 'Criminal act',
      category,
      categoryEnglish: known?.english || null,
      date,
      shift,
      pdq: props.pdq || props.PDQ || null,
      sourceTimestamp: date,
      sourceFeatureId: feature.id || null,
      source: 'SPVM Actes criminels — IQAI derivative of official open data',
      spatialPrecision: status?.spatialPrecision || 'Privacy-obfuscated intersection',
      temporalPrecision: status?.temporalPrecision || 'Date + reporting shift (QUART). No clock hour.',
      fingerprintNote: status?.fingerprintNote || 'Feature.id is not an official SPVM incident identifier.',
      notCad: true,
      retrievedAt: receivedAt
    }
  };
}

async function fetchSpvmCrime() {
  const meta = layerMeta('spvm-crime');
  const source = await fetchSpvmSource();
  if (!source.ok) return fail(meta, 'FAILED', source.error);
  const receivedAt = nowIso();
  const features = [];
  for (const feature of source.geojson.features) {
    const mapped = mapSpvmFeature(feature, 'spvm-crime', receivedAt, source.status);
    if (mapped) features.push(mapped);
  }
  if (!features.length) return fail(meta, 'EMPTY_COVERAGE', 'SPVM 90d GeoJSON had no mappable points', { pipelineStatus: source.status });
  return okPayload(meta, 'HISTORICAL', {
    geojson: fc(features),
    featureCount: features.length,
    pipelineStatus: source.status,
    windowStart: source.status?.windowStart || null,
    windowEnd: source.status?.windowEnd || null,
    pipelineUpdatedAt: source.status?.pipelineUpdatedAt || null,
    latestCrimeDate: source.status?.latestCrimeDate || null,
    sourceLagDays: source.status?.sourceLagDays ?? null,
    reusedAdapter: source.reusedAdapter,
    evidence: source.evidence
  });
}

async function fetchRecentCrime(options = {}) {
  const meta = layerMeta('recent-crime');
  const requested = String(options.window || '1d').toLowerCase();
  if (UNSUPPORTED_CLOCK_WINDOWS.includes(requested)) {
    return fail(meta, 'UNSUPPORTED', `${requested.toUpperCase()} is not supported. SPVM publishes DATE + QUART only, not clock hours.`, {
      requestedWindow: requested,
      supportedWindows: Object.keys(CRIME_WINDOWS).filter((id) => id !== '24h'),
      unsupportedWindows: UNSUPPORTED_CLOCK_WINDOWS
    });
  }
  const windowId = normalizeCrimeWindow(requested);
  if (!windowId) {
    return fail(meta, 'UNSUPPORTED', `Unknown recent-crime window ${requested}. Supported: LATEST DAY / LAST 3 / 7 / 30 / 90 DAYS.`);
  }
  const category = options.category && options.category !== 'all' ? String(options.category) : null;
  const source = await fetchSpvmSource();
  if (!source.ok) return fail(meta, 'FAILED', source.error);
  const receivedAt = nowIso();
  const { bounds, features: raw, categories } = filterRecentSpvmFeatures(source.geojson, windowId, category);
  const features = [];
  for (const feature of raw) {
    const mapped = mapSpvmFeature(feature, 'recent-crime', receivedAt, source.status);
    if (!mapped?.properties?.date) continue;
    mapped.properties.timeWindow = windowId;
    mapped.properties.windowLabel = bounds.label;
    mapped.properties.windowStart = bounds.start;
    mapped.properties.windowEnd = bounds.end;
    mapped.properties.asOfDate = bounds.asOf;
    mapped.properties.note = `${bounds.label} is a published DATE window as-of ${bounds.asOf}. Not live CAD. Publication may lag the calendar day.`;
    features.push(mapped);
  }
  const status = features.length ? crimeStatusForWindow(windowId) : 'EMPTY_COVERAGE';
  const prevBounds = previousWindowFor(bounds);
  const minDate = minSpvmDate(source.geojson);
  const prevComparable = Boolean(prevBounds && minDate && prevBounds.start >= minDate);
  const previousWindow = prevBounds
    ? {
      start: prevBounds.start,
      end: prevBounds.end,
      count: countInDateRange(source.geojson, prevBounds.start, prevBounds.end, category),
      comparable: prevComparable
    }
    : null;
  return okPayload(meta, status, {
    geojson: fc(features),
    featureCount: features.length,
    timeWindow: windowId,
    windowLabel: bounds?.label || null,
    selectedCategory: category || 'all',
    categories,
    supportedWindows: Object.keys(CRIME_WINDOWS).filter((id) => id !== '24h'),
    unsupportedWindows: UNSUPPORTED_CLOCK_WINDOWS,
    windowStart: bounds?.start || null,
    windowEnd: bounds?.end || null,
    asOfDate: bounds?.asOf || null,
    previousWindow,
    latestSourceTimestamp: bounds?.end || source.status?.latestCrimeDate || null,
    pipelineStatus: source.status,
    pipelineUpdatedAt: source.status?.pipelineUpdatedAt || null,
    reusedAdapter: `${source.reusedAdapter} + Intelligence Lab ${bounds?.label || windowId} DATE filter`,
    evidence: source.evidence,
    message: features.length
      ? `${features.length} reports · ${bounds.label} ${bounds.start}${bounds.start === bounds.end ? '' : ` → ${bounds.end}`} (as-of ${bounds.asOf}${category ? `; ${category}` : ''})`
      : `No dated SPVM reports for ${bounds?.label || windowId} as-of ${bounds?.asOf || 'unknown'}${category ? ` / ${category}` : ''}.`
  });
}

async function fetchPdqTerritories() {
  const meta = layerMeta('pdq-territories');
  return cached('pdq-territories', 6 * 60 * 60 * 1000, async () => {
    const res = await fetchBuffer(URLS.pdqLimitesGeojson, { timeoutMs: 45000, accept: 'application/geo+json, application/json' });
    if (!res.ok) return fail(meta, 'FAILED', `Ville limitespdq GeoJSON HTTP ${res.status}`);
    let geojson;
    try {
      geojson = JSON.parse(res.buffer.toString('utf8'));
    } catch {
      return fail(meta, 'FAILED', 'Ville limitespdq GeoJSON parse failed');
    }
    const receivedAt = nowIso();
    const features = [];
    for (const feature of geojson.features || []) {
      if (!feature.geometry) continue;
      const geometry = looksLikeWgs84(feature.geometry)
        ? feature.geometry
        : reprojectGeometryToWgs84(feature.geometry);
      const pdqNum = feature.properties?.PDQ;
      const pdq = Number.isFinite(Number(pdqNum)) ? `PDQ ${Number(pdqNum)}` : String(pdqNum || 'PDQ');
      features.push({
        type: 'Feature',
        id: String(feature.properties?.OBJECTID || pdq),
        geometry,
        properties: {
          layerId: 'pdq-territories',
          name: pdq,
          pdq,
          pdqNumber: Number.isFinite(Number(pdqNum)) ? Number(pdqNum) : pdqNum,
          published: publishedScalars(feature.properties || {}),
          source: meta.provider,
          retrievedAt: receivedAt,
          sourceCrs: 'EPSG:32188 (NAD83 MTM zone 8)',
          note: 'Official Ville PDQ territory polygon. Not Voronoi. Not a live CAD region.'
        }
      });
    }
    if (!features.length) return fail(meta, 'EMPTY_COVERAGE', 'limitespdq GeoJSON returned no polygons');
    const sample = features[0].geometry?.coordinates;
    let pair = sample;
    while (Array.isArray(pair) && Array.isArray(pair[0])) pair = pair[0];
    const lon = Number(pair?.[0]);
    const lat = Number(pair?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -80 || lon > -70 || lat < 40 || lat > 50) {
      return fail(meta, 'FAILED', 'PDQ polygons did not reproject into a plausible Montréal WGS84 range');
    }
    return okPayload(meta, 'STATIC', {
      geojson: fc(features),
      featureCount: features.length,
      evidence: { http: res.status, identity: URLS.pdqLimitesGeojson, sampleLonLat: [lon, lat] }
    });
  });
}

async function fetchBixi() {
  const meta = layerMeta('bixi');
  return cached('bixi', 30 * 1000, async () => {
    try {
      const result = await fetchBixiStations();
      const status = result.features.length ? 'NEAR-LIVE' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        feedTimestamp: result.lastUpdated,
        ttl: result.ttl,
        refreshMs: 60000,
        reusedAdapter: 'Official BIXI GBFS (no prior IQAI adapter)',
        message: `${result.features.length} stations · bikes/docks at station · not individual bikes`
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'BIXI GBFS failed');
    }
  });
}

async function fetchAircraftLayer() {
  const meta = layerMeta('aircraft');
  return cached('aircraft', 10 * 1000, async () => {
    try {
      const result = await fetchAircraftMovement();
      const status = result.features.length ? 'LIVE' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        feedTimestamp: result.feedTimestamp,
        refreshMs: 10000,
        reusedAdapter: result.reusedAdapter,
        message: `${result.features.length} cooperative ADS-B objects. Not NAV CANADA. Not SAFE TO FLY.`
      });
    } catch (error) {
      return fail(meta, 'AUTH_REQUIRED', 'Aircraft adapter unreachable. No aircraft drawn. NAV CANADA is not scraped.', {
        detail: error?.message || String(error),
        reusedAdapter: 'Spatial V2 /api/spatial/live/aircraft'
      });
    }
  });
}

async function fetchQc511() {
  const meta = layerMeta('qc-511');
  return cached('qc-511', 15 * 60 * 1000, async () => {
    try {
      const result = await fetchQc511Works();
      const status = result.features.length ? 'LIVE' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        feedTimestamp: result.receivedAt,
        reusedAdapter: 'Official MTMD WFS ms:chantiers_mtmdet',
        message: `${result.features.length} MTMD works in Montréal-area bbox. Incident/avertissement typename not found on this WFS.`
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'MTMD chantiers WFS failed');
    }
  });
}

async function fetchTrafficCameraLayer() {
  const meta = layerMeta('traffic-cameras');
  return cached('traffic-cameras', 30 * 60 * 1000, async () => {
    try {
      const result = await fetchTrafficCameras();
      const status = result.features.length ? 'STALE' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        villeCount: result.villeCount,
        mtmdCount: result.mtmdCount,
        reusedAdapter: 'MTMD WFS infos_cameras + ArcGIS Ville TrafficCameras/0 (2022 index)',
        rightsBlocker: 'RIGHTS REVIEW REQUIRED FOR COMMERCIAL PRODUCT',
        message: `${result.villeCount} Ville still-index points + ${result.mtmdCount} current MTMD/511 locations. Stills probed on demand. Not live video.`
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'Traffic camera inventory failed');
    }
  });
}

async function fetchFireInterventions() {
  const meta = layerMeta('fire-interventions');
  return cached('fire-interventions', 30 * 60 * 1000, async () => {
    try {
      const result = await fetchSimInterventions();
      const status = result.features.length ? 'RECENT' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        latestSourceTimestamp: result.windowEnd,
        reusedAdapter: 'Ville CKAN datastore SIM interventions current extract',
        message: `${result.features.length} interventions ${result.windowStart} → ${result.windowEnd}. Official extract, not live CAD.`
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'SIM interventions datastore failed');
    }
  });
}

async function fetchAirQuality() {
  const meta = layerMeta('air-quality');
  return cached('air-quality', 10 * 60 * 1000, async () => {
    try {
      const result = await fetchRsqaAirQuality();
      const status = result.features.length ? 'NEAR-LIVE' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        asOfDate: result.asOfDate,
        asOfHour: result.asOfHour,
        latestSourceTimestamp: result.observedAt,
        retrievedAt: result.receivedAt,
        iqaTrend: result.iqaTrend || null,
        message: result.features.length
          ? `${result.features.length} RSQA stations · hour ${result.asOfHour} EST on ${result.asOfDate} · hourly IQA, not live`
          : 'No RSQA station-hour rows in the latest published hour.'
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'RSQA air quality fetch failed');
    }
  });
}

async function fetchHydrometricLayer() {
  const meta = layerMeta('hydrometric');
  return cached('hydrometric', 5 * 60 * 1000, async () => {
    try {
      const result = await fetchHydrometric();
      const status = result.features.length ? 'NEAR-LIVE' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        retrievedAt: result.receivedAt,
        message: result.features.length
          ? `${result.features.length} hydrometric station(s) in the Montréal-area bbox (latest observation in last 3 hours)`
          : 'No hydrometric observations in the Montréal-area bbox in the last 3 hours.'
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'ECCC hydrometric fetch failed');
    }
  });
}

async function fetchBikeCounterLayer() {
  const meta = layerMeta('bike-counters');
  return cached('bike-counters', 15 * 60 * 1000, async () => {
    try {
      const result = await fetchBikeCounters();
      const status = result.features.length ? 'RECENT' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        retrievedAt: result.receivedAt,
        message: result.features.length
          ? `${result.features.length} permanent bike counters with a latest 15-minute interval (${result.siteInventory || 'n'} sites in inventory). Not live tracking.`
          : 'No geocoded bike-counter intervals in the latest datastore page.'
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'Bike-counter datastore failed');
    }
  });
}

async function fetchCivic311Layer() {
  const meta = layerMeta('civic-311');
  return cached('civic-311', 15 * 60 * 1000, async () => {
    try {
      const result = await fetchCivic311();
      const status = result.features.length ? 'RECENT' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        windowStart: result.windowStart,
        retrievedAt: result.receivedAt,
        message: result.features.length
          ? `${result.features.length} geocoded 311 requests since ${result.windowStart}. Civic requests, not dispatch.`
          : `No geocoded 311 rows since ${result.windowStart}.`
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || '311 datastore SQL failed');
    }
  });
}

async function fetchIntersectionCountLayer() {
  const meta = layerMeta('intersection-counts');
  return cached('intersection-counts', 60 * 60 * 1000, async () => {
    try {
      const result = await fetchIntersectionCounts();
      const status = result.features.length ? 'HISTORICAL' : 'EMPTY_COVERAGE';
      return okPayload(meta, status, {
        geojson: fc(result.features),
        featureCount: result.features.length,
        retrievedAt: result.receivedAt,
        message: result.features.length
          ? `${result.features.length} signalized intersections with a published survey. Historical field counts, not live volume.`
          : 'No geocoded intersection surveys returned.'
      });
    } catch (error) {
      return fail(meta, 'FAILED', error?.message || 'Intersection-count datastore SQL failed');
    }
  });
}

async function fetchSnowOps() {
  const meta = layerMeta('snow-ops');
  return fail(
    meta,
    'AUTH_REQUIRED',
    'Ville Planif-Neige API requires a token requested by email to donneesouvertes@montreal.ca. Seasonal parking inventory is not live plow positions. No fake tracks drawn.'
  );
}

async function fetchExo() {
  const meta = layerMeta('exo');
  return fail(
    meta,
    'AUTH_REQUIRED',
    'Official exo realtime is token-gated. Request access at https://exo.quebec/en/about/open-data/RequestAccessForm (Chrono SAEIV API / Azure APIM signup). GTFS-RT https://opendata.exo.quebec/ServiceGTFSR/VehiclePosition.pb requires the issued token. Documented for commuter trains only. Static GTFS zip is schedule data and is not drawn as trains.',
    {
      accessRequestUrl: URLS.exoRequestForm,
      gtfsRtIdentity: URLS.exoGtfsRt,
      staticGtfs: URLS.exoStaticGtfs
    }
  );
}

async function fetchRem() {
  const meta = layerMeta('rem');
  return fail(
    meta,
    'UNAVAILABLE',
    'Official rem.info publishes human service-status / interruption notices. No official REM/ARTM developer vehicle-position or token path was identified. Not AUTH REQUIRED. No trains drawn.',
    { serviceStatusUrl: URLS.remService }
  );
}

async function fetchRoadTraffic() {
  const meta = layerMeta('road-traffic');
  return fail(meta, 'UNAVAILABLE', 'No official reusable live traffic-speed / congestion feed for Montréal was proven. Ontario 511 / DriveBC must not be labelled Québec. See Road Works and Québec 511 / MTMD works.');
}

async function fetchWildfireActive() {
  const meta = layerMeta('wildfire-active');
  return cached('wildfire-active', 15 * 60 * 1000, async () => {
    const result = await fetchActiveFires();
    const status = result.features.length ? 'CURRENT' : 'EMPTY_COVERAGE';
    return okPayload(meta, status, {
      geojson: fc(result.features),
      featureCount: result.features.length,
      quebecMatched: result.matched,
      loadedCount: result.loaded,
      uniqueFireIds: result.uniqueFireIds,
      fireYears: result.fireYears,
      seasonYear: result.seasonYear,
      seasonRecordCount: result.seasonRecordCount,
      recordNote: result.recordNote,
      stageBreakdown: result.stages,
      latestSourceTimestamp: result.newest,
      retrievedAt: result.receivedAt,
      endpoint: result.endpoint,
      refreshCadence: 'CWFIS agency reports are typically daily; this sandbox caches 15 minutes',
      reusedAdapter: 'NRCan CWFIF WFS public:cwfif_national_activefires',
      limitation: CWFIS_LIMITATION,
      message: result.features.length
        ? `${result.features.length} loaded of ${result.matched} Québec CWFIS active-fire records (status rows, not unique fires). ${result.seasonRecordCount != null ? `fire_year ${result.seasonYear}: ${result.seasonRecordCount} records. ` : ''}REPORTED/CURRENT, not real-time.`
        : 'CWFIS returned no Québec active-fire features in this request.'
    });
  });
}

async function fetchWildfireHotspots() {
  const meta = layerMeta('wildfire-hotspots');
  return cached('wildfire-hotspots', 15 * 60 * 1000, async () => {
    const result = await fetchHotspots();
    const status = result.features.length ? 'SATELLITE DETECTION' : 'EMPTY_COVERAGE';
    return okPayload(meta, status, {
      geojson: fc(result.features),
      featureCount: result.features.length,
      quebecMatched: result.matched,
      sensorBreakdown: result.sensors,
      latestSourceTimestamp: result.newest,
      retrievedAt: result.receivedAt,
      endpoint: result.endpoint,
      refreshCadence: 'CWFIS last-24h hotspot layer; sandbox cache 15 minutes',
      reusedAdapter: 'NRCan CWFIS WFS public:hotspots_last24hrs',
      limitation: CWFIS_LIMITATION,
      message: result.features.length
        ? `${result.features.length} satellite detections in the Québec window (last 24 h). Not confirmed wildfires.`
        : 'No CWFIS last-24h hotspots in the Québec lat/lon window. That is a valid zero, not a service failure.'
    });
  });
}

async function fetchWildfirePerimeters() {
  const meta = layerMeta('wildfire-perimeters');
  return cached('wildfire-perimeters', 30 * 60 * 1000, async () => {
    const result = await fetchPerimeters();
    const status = result.features.length ? 'SATELLITE-DERIVED ESTIMATE' : 'EMPTY_COVERAGE';
    return okPayload(meta, status, {
      geojson: fc(result.features),
      featureCount: result.features.length,
      nationalMatched: result.nationalMatched,
      latestSourceTimestamp: result.newest,
      retrievedAt: result.receivedAt,
      endpoint: result.endpoint,
      refreshCadence: 'Current-day M3 perimeter estimates; sandbox cache 30 minutes',
      reusedAdapter: 'NRCan CWFIS WFS public:m3_polygons_current',
      limitation: CWFIS_LIMITATION,
      message: result.features.length
        ? `${result.features.length} Québec-window estimates of ${result.nationalMatched} national current M3 polygons. SATELLITE-DERIVED ESTIMATE.`
        : 'No current M3 perimeter estimates touch the Québec window.'
    });
  });
}

async function fetchWildfireFwi() {
  const meta = layerMeta('wildfire-fwi');
  return cached('wildfire-fwi', 30 * 60 * 1000, async () => {
    const result = await fetchFireWeatherStations();
    const status = 'CURRENT';
    return okPayload(meta, status, {
      geojson: fc(result.features),
      featureCount: result.features.length,
      quebecMatched: result.matched,
      latestSourceTimestamp: result.newest,
      retrievedAt: result.receivedAt,
      endpoint: result.endpoint,
      fwi: {
        product: 'Fire Weather Index',
        layer: CWFIS.fwiLayer,
        wmsTime: 'CURRENT',
        timeDimension: 'WMS time default CURRENT; daily P1D',
        wms: '/api/spatial-v2/ops-layers/cwfis/fwi/wms',
        info: '/api/spatial-v2/ops-layers/cwfis/fwi/info',
        opacity: 0.32
      },
      refreshCadence: 'CWFIS daily FWI grids / station calculations; sandbox cache 30 minutes',
      reusedAdapter: 'NRCan CWFIS WMS public:fwi + WFS public:firewx_stns_current',
      limitation: CWFIS_LIMITATION,
      message: `${result.features.length} Québec fire-weather stations. FWI grid is a low-dominance WMS overlay.`
    });
  });
}

function parseBbox(options = {}) {
  const minLat = Number(options.minLat);
  const maxLat = Number(options.maxLat);
  const minLon = Number(options.minLon);
  const maxLon = Number(options.maxLon);
  if ([minLat, maxLat, minLon, maxLon].every(Number.isFinite)) {
    return { minLat, maxLat, minLon, maxLon };
  }
  return null;
}

export async function sunStatePayload(options = {}) {
  const lat = Number(options.lat);
  const lon = Number(options.lon);
  const at = Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : { lat: MONTREAL_VIEW.lat, lon: MONTREAL_VIEW.lon };
  const date = parseSolarInstant(options.at);
  const live = options.at == null || options.at === '' || options.at === 'now';
  const sunState = computeSunState(at.lat, at.lon, date);
  const solarState = toSolarState(sunState);
  let da = null;
  if (options.includeDa) {
    try {
      da = await identifyDa(at.lat, at.lon);
      if (da?.status === 'CURRENT' && da.lat != null) {
        da.illuminationState = computeSunState(da.lat, da.lon, date).illuminationState;
      } else if (da?.status === 'CURRENT') {
        da.illuminationState = sunState.illuminationState;
      }
    } catch (error) {
      da = { status: 'FAILED', message: error?.message || 'DA identify failed' };
    }
  }
  return { live, date, at, sunState, solarState, da };
}

async function fetchSunDaylight(options = {}) {
  const meta = layerMeta('sun-daylight');
  const pack = await sunStatePayload(options);
  const { live, date, at, sunState, solarState } = pack;
  const geojson = sunGeojson(date);
  const nearest = nearestOnLine(geojson.terminator, at.lat, at.lon);
  const population = await illuminationPopulationSummary({
    area: options.area || 'montreal',
    bbox: parseBbox(options),
    date
  });
  const illuminationPopulationSummaryContract = population?.available
    ? {
        analysisArea: population.analysisArea,
        censusYear: population.censusYear,
        method: population.method,
        daylightPopulation: population.daylightPopulation,
        civilPopulation: population.civilPopulation,
        nauticalPopulation: population.nauticalPopulation,
        astronomicalPopulation: population.astronomicalPopulation,
        nightPopulation: population.nightPopulation,
        totalPopulation: population.totalPopulation
      }
    : null;
  return okPayload(meta, live ? 'COMPUTED' : 'SIMULATED', {
    geojson,
    featureCount: geojson.features.length,
    sunState: {
      ...sunState,
      live,
      timeMode: live ? 'LIVE / NOW' : 'SIMULATED',
      terminatorNearest: nearest
    },
    solarState,
    illuminationPopulationSummary: illuminationPopulationSummaryContract,
    terminator: geojson.terminator,
    population,
    refreshMs: live ? 60000 : null,
    refreshCadence: live
      ? 'Recalculated about every 60 seconds while LIVE; also after map-centre moves'
      : 'Simulated instant — no live clock refresh',
    latestSourceTimestamp: sunState.calculatedAt,
    reusedAdapter: SUN_METHOD,
    limitation: sunState.limitation,
    message: `${sunState.illuminationState || sunState.phase} · az ${sunState.azimuthDeg}° · el ${sunState.elevationDeg}° · ${live ? 'LIVE' : 'SIMULATED'}`
  });
}

const FETCHERS = {
  fire: fetchFire,
  pdq: fetchPdq,
  'pdq-territories': fetchPdqTerritories,
  hospitals: fetchHospitals,
  weather: fetchWeather,
  hydro: fetchHydro,
  stm: fetchStm,
  exo: fetchExo,
  rem: fetchRem,
  bixi: fetchBixi,
  'road-traffic': fetchRoadTraffic,
  'road-works': fetchRoadWorks,
  'qc-511': fetchQc511,
  'traffic-cameras': fetchTrafficCameraLayer,
  aircraft: fetchAircraftLayer,
  'fire-interventions': fetchFireInterventions,
  'recent-crime': fetchRecentCrime,
  'spvm-crime': fetchSpvmCrime,
  'air-quality': fetchAirQuality,
  hydrometric: fetchHydrometricLayer,
  'bike-counters': fetchBikeCounterLayer,
  'civic-311': fetchCivic311Layer,
  'intersection-counts': fetchIntersectionCountLayer,
  'snow-ops': fetchSnowOps,
  'wildfire-active': fetchWildfireActive,
  'wildfire-hotspots': fetchWildfireHotspots,
  'wildfire-perimeters': fetchWildfirePerimeters,
  'wildfire-fwi': fetchWildfireFwi,
  'sun-daylight': fetchSunDaylight
};

export async function fetchLayer(id, options = {}) {
  const fn = FETCHERS[id];
  if (!fn) return { ok: false, status: 'FAILED', message: `Unknown layer ${id}` };
  try {
    return await fn(options);
  } catch (error) {
    const meta = layerMeta(id);
    return fail(meta || { id, title: id, establishes: [], doesNotEstablish: [], limitations: [] }, 'FAILED', error?.message || String(error));
  }
}

export async function buildCatalog() {
  const retrievedAt = nowIso();
  const stm = await fetchStm();
  let hydroProbe = { status: 'LIVE', detail: 'BIS identity known; live markers fetched on toggle' };
  try {
    const versionRes = await fetchBuffer(`${URLS.hydroBase}/bisversion.json`, { timeoutMs: 8000, accept: 'application/json, text/plain' });
    hydroProbe = versionRes.ok
      ? { status: 'LIVE', version: parseVersionBody(versionRes.buffer.toString('utf8')) }
      : { status: 'FAILED', detail: `bisversion HTTP ${versionRes.status}` };
  } catch (error) {
    hydroProbe = { status: 'FAILED', detail: error?.message || String(error) };
  }
  let spvmProbe = { status: 'HISTORICAL' };
  try {
    const statusRes = await fetchBuffer(URLS.spvmStatus, { timeoutMs: 8000, accept: 'application/json' });
    if (statusRes.ok) {
      const status = JSON.parse(statusRes.buffer.toString('utf8'));
      spvmProbe = {
        status: 'HISTORICAL',
        pipelineStatus: status.status || null,
        windowStart: status.windowStart,
        windowEnd: status.windowEnd,
        pipelineUpdatedAt: status.pipelineUpdatedAt,
        sourceLagDays: status.sourceLagDays
      };
    } else {
      spvmProbe = { status: 'FAILED', detail: `status HTTP ${statusRes.status}` };
    }
  } catch (error) {
    spvmProbe = { status: 'FAILED', detail: error?.message || String(error) };
  }

  return {
    title: 'IQAI Montréal operational layers sandbox V1.7',
    retrievedAt,
    defaultOn: false,
    port: Number(process.env.SANDBOX_PORT || 8793),
    groups: PANEL_GROUPS,
    layers: LAYERS.map((layer) => {
      let runtimeStatus = layer.expectedStatus;
      let runtimeNote = null;
      if (layer.id === 'stm') {
        runtimeStatus = stm.status;
        runtimeNote = stm.message || stm.reusedAdapter || null;
      }
      if (layer.id === 'hydro') {
        runtimeStatus = hydroProbe.status;
        runtimeNote = hydroProbe.version ? `BIS version ${hydroProbe.version}` : hydroProbe.detail;
      }
      if (layer.id === 'spvm-crime') {
        runtimeStatus = spvmProbe.status;
        runtimeNote = spvmProbe.windowEnd
          ? `window ${spvmProbe.windowStart} → ${spvmProbe.windowEnd}; pipeline ${spvmProbe.pipelineUpdatedAt || 'unknown'}`
          : spvmProbe.detail;
      }
      if (layer.id === 'recent-crime') {
        runtimeStatus = 'RECENT';
        runtimeNote = spvmProbe.windowEnd
          ? `Calendar DATE windows as-of latest published DATE ${spvmProbe.windowEnd}. Not LIVE. 1H/6H/12H unsupported.`
          : 'Calendar DATE filters. Not live CAD.';
      }
      if (layer.id === 'exo') {
        runtimeStatus = 'AUTH_REQUIRED';
        runtimeNote = 'Request form: https://exo.quebec/en/about/open-data/RequestAccessForm';
      }
      if (layer.id === 'rem') {
        runtimeStatus = 'UNAVAILABLE';
        runtimeNote = 'Service status is public on rem.info; no official developer vehicle-position path.';
      }
      if (layer.id === 'snow-ops') {
        runtimeStatus = 'AUTH_REQUIRED';
        runtimeNote = layer.authBlocker;
      }
      if (layer.id === 'road-traffic') {
        runtimeStatus = 'UNAVAILABLE';
        runtimeNote = 'No proven Québec live speed feed.';
      }
      if (layer.id === 'sun-daylight') {
        runtimeStatus = 'COMPUTED';
        runtimeNote = 'NOAA solar equations at map centre. Not measured weather. Default off.';
      }
      return {
        id: layer.id,
        title: layer.title,
        group: layer.group,
        family: layer.family,
        defaultOn: false,
        on: false,
        status: runtimeStatus,
        color: layer.color,
        provider: layer.provider,
        licence: layer.licence,
        sourceId: layer.sourceId,
        geometry: layer.geometry,
        officialUrl: layer.officialUrl,
        catalogueUrl: layer.catalogueUrl,
        adapter: layer.adapter,
        establishes: layer.establishes,
        doesNotEstablish: layer.doesNotEstablish,
        limitations: layer.limitations,
        rightsBlocker: layer.rightsBlocker || null,
        authBlocker: layer.authBlocker || null,
        timeWindows: layer.timeWindows || null,
        runtimeNote
      };
    }),
    probes: {
      stm: { status: stm.status, featureCount: stm.featureCount, reusedAdapter: stm.reusedAdapter || null, message: stm.message || null },
      hydro: hydroProbe,
      spvm: spvmProbe
    }
  };
}

export { cache };
export { computeSunState } from './sun.mjs';
