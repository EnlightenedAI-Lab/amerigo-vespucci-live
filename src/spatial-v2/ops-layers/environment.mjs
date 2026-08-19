import { URLS, MONTREAL_AREA_BBOX, inBbox } from './catalog.mjs';
import { fetchText } from './movement.mjs';

async function datastoreRecords(resourceId, { limit = 32000, sort = null, timeoutMs = 30000 } = {}) {
  const url = new URL(URLS.ckanDatastore);
  url.searchParams.set('resource_id', resourceId);
  url.searchParams.set('limit', String(limit));
  if (sort) url.searchParams.set('sort', sort);
  const res = await fetchText(url.toString(), { timeoutMs, accept: 'application/json' });
  if (!res.ok) throw new Error(`CKAN datastore HTTP ${res.status}`);
  const body = JSON.parse(res.buffer.toString('utf8'));
  if (!body?.success) throw new Error('CKAN datastore returned not-success');
  return body.result?.records || [];
}

async function datastoreSql(sql, timeoutMs = 30000) {
  const url = `${URLS.ckanSql}?sql=${encodeURIComponent(sql)}`;
  const res = await fetchText(url, { timeoutMs, accept: 'application/json' });
  if (!res.ok) throw new Error(`CKAN SQL HTTP ${res.status}`);
  const body = JSON.parse(res.buffer.toString('utf8'));
  if (!body?.success) throw new Error(body?.error?.info?.orig?.[0] || 'CKAN SQL failed');
  return body.result?.records || [];
}

function iqaLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 25) return 'Good';
  if (n <= 50) return 'Acceptable';
  return 'Poor';
}

export async function fetchRsqaAirQuality() {
  const receivedAt = new Date().toISOString();
  const [stationRows, detailRows] = await Promise.all([
    datastoreRecords(URLS.rsqaStationIqaResource, { limit: 4000, sort: '_id desc' }),
    datastoreRecords(URLS.rsqaDetailResource, { limit: 8000, sort: '_id desc' })
  ]);
  let maxKey = '';
  for (const row of stationRows) {
    const key = `${String(row.date || '').slice(0, 10)}T${String(row.heure ?? '').padStart(2, '0')}`;
    if (key > maxKey) maxKey = key;
  }
  const asOfDate = maxKey.slice(0, 10);
  const asOfHour = maxKey.slice(11, 13);
  const detailsByStation = new Map();
  for (const row of detailRows) {
    if (String(row.date || '').slice(0, 10) !== asOfDate) continue;
    if (String(row.heure).padStart(2, '0') !== asOfHour) continue;
    const id = String(row.stationId);
    const bag = detailsByStation.get(id) || {};
    const code = String(row.pollutant || row.polluant || '').toUpperCase();
    const mapped = code === 'PM' || code === 'PM2.5' || code === 'PM25' ? 'PM2.5' : code;
    bag[mapped] = row.valeur != null ? Number(row.valeur) : null;
    detailsByStation.set(id, bag);
  }
  const features = [];
  for (const row of stationRows) {
    if (String(row.date || '').slice(0, 10) !== asOfDate) continue;
    if (String(row.heure).padStart(2, '0') !== asOfHour) continue;
    const lon = Number(row.longitude);
    const lat = Number(row.latitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pollutants = detailsByStation.get(String(row.stationId)) || {};
    const iqa = Number(row.valeur);
    const hour = String(row.heure).padStart(2, '0');
    const observedAt = `${asOfDate}T${hour}:00:00-05:00`;
    const ageHours = Number.isFinite(Date.parse(observedAt))
      ? Math.max(0, (Date.parse(receivedAt) - Date.parse(observedAt)) / 3600000)
      : null;
    features.push({
      type: 'Feature',
      id: `rsqa-${row.stationId}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'air-quality',
        name: row.address || `RSQA ${row.stationId}`,
        stationId: row.stationId,
        iqa: Number.isFinite(iqa) ? iqa : null,
        iqaClass: iqaLabel(iqa),
        dominantPollutant: row.pollutant || row.polluant || null,
        pm25: pollutants['PM2.5'] ?? null,
        no2: pollutants.NO2 ?? null,
        o3: pollutants.O3 ?? null,
        so2: pollutants.SO2 ?? null,
        co: pollutants.CO ?? null,
        observedAt,
        freshnessHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
        source: 'Ville de Montréal RSQA — IQA horaire (CKAN)',
        retrievedAt: receivedAt,
        temporalPrecision: 'Hourly IQA, ~50 minutes after the hour, Eastern Standard Time year-round',
        note: 'NEAR-LIVE hourly index, not a continuous analyser stream. Pollutant fields are IQA sub-indices as published, not raw µg/m³ unless the source says so.'
      }
    });
  }
  const prev = asOfHour === '00'
    ? (() => {
      const [y, m, d] = asOfDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 1);
      return { date: dt.toISOString().slice(0, 10), hour: '23' };
    })()
    : { date: asOfDate, hour: String(Math.max(0, Number(asOfHour) - 1)).padStart(2, '0') };
  const currentByStation = new Map();
  const previousByStation = new Map();
  for (const row of stationRows) {
    const date = String(row.date || '').slice(0, 10);
    const hour = String(row.heure ?? '').padStart(2, '0');
    const id = String(row.stationId);
    const iqa = Number(row.valeur);
    if (!Number.isFinite(iqa) || !id) continue;
    if (date === asOfDate && hour === asOfHour) currentByStation.set(id, iqa);
    if (date === prev.date && hour === prev.hour) previousByStation.set(id, iqa);
  }
  let up = 0;
  let down = 0;
  let same = 0;
  for (const [id, iqa] of currentByStation) {
    if (!previousByStation.has(id)) continue;
    const delta = iqa - previousByStation.get(id);
    if (delta > 0) up += 1;
    else if (delta < 0) down += 1;
    else same += 1;
  }
  const compared = up + down + same;
  return {
    features,
    receivedAt,
    asOfDate,
    asOfHour,
    observedAt: features[0]?.properties?.observedAt || null,
    iqaTrend: compared
      ? { compared, up, down, same, previousDate: prev.date, previousHour: prev.hour }
      : null
  };
}

export async function fetchHydrometric() {
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 60 * 60 * 1000);
  const bbox = `${MONTREAL_AREA_BBOX.minLon},${MONTREAL_AREA_BBOX.minLat},${MONTREAL_AREA_BBOX.maxLon},${MONTREAL_AREA_BBOX.maxLat}`;
  const url = `${URLS.ecccHydrometric}?f=json&limit=500&bbox=${bbox}&datetime=${start.toISOString()}/${end.toISOString()}`;
  const res = await fetchText(url, { timeoutMs: 25000, accept: 'application/geo+json, application/json' });
  if (!res.ok) throw new Error(`ECCC hydrometric HTTP ${res.status}`);
  const body = JSON.parse(res.buffer.toString('utf8'));
  const latest = new Map();
  for (const feature of body.features || []) {
    const props = feature.properties || {};
    const id = String(props.STATION_NUMBER || props.station_number || '');
    if (!id) continue;
    const xy = feature.geometry?.coordinates;
    if (!xy || !inBbox(Number(xy[1]), Number(xy[0]), MONTREAL_AREA_BBOX)) continue;
    const stamp = String(props.DATETIME || props.datetime || '');
    const prev = latest.get(id);
    const prevStamp = String(prev?.properties?.DATETIME || prev?.properties?.datetime || '');
    if (!prev || stamp > prevStamp) latest.set(id, feature);
  }
  const receivedAt = new Date().toISOString();
  const features = [];
  for (const feature of latest.values()) {
    const props = feature.properties || {};
    const xy = feature.geometry.coordinates;
    features.push({
      type: 'Feature',
      id: props.STATION_NUMBER,
      geometry: { type: 'Point', coordinates: [xy[0], xy[1]] },
      properties: {
        layerId: 'hydrometric',
        name: props.STATION_NAME || props.station_name || props.STATION_NUMBER,
        stationId: props.STATION_NUMBER || props.station_number,
        level: props.LEVEL ?? props.level ?? null,
        discharge: props.DISCHARGE ?? props.discharge ?? null,
        observedAt: props.DATETIME || props.datetime || props.DATETIME_LST || null,
        source: 'ECCC MSC hydrometric-realtime',
        retrievedAt: receivedAt,
        note: 'Official water level/discharge observations. Not a flood-warning CAD product.'
      }
    });
  }
  return { features, receivedAt, matched: body.numberMatched };
}

export async function fetchBikeCounters() {
  const receivedAt = new Date().toISOString();
  const sql = `SELECT DISTINCT ON (id_compteur) id_compteur, date, heure, nb_passages, longitude, latitude FROM "${URLS.bikeCount2026Resource}" ORDER BY id_compteur, date DESC, heure DESC`;
  const [rows, sites] = await Promise.all([
    datastoreSql(sql, 45000),
    datastoreRecords(URLS.bikeSitesResource, { limit: 500 })
  ]);
  const nameById = new Map();
  for (const site of sites) {
    nameById.set(String(site.instance), site['Nom Rue Global'] || site.instance);
  }
  const features = [];
  for (const row of rows) {
    const lon = Number(row.longitude);
    const lat = Number(row.latitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      id: row.id_compteur,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'bike-counters',
        name: nameById.get(String(row.id_compteur)) || `Counter ${row.id_compteur}`,
        stationId: row.id_compteur,
        passages: row.nb_passages != null ? Number(row.nb_passages) : null,
        observedAt: `${row.date}T${row.heure}`,
        source: 'Ville de Montréal — compteurs cyclistes permanents (Eco-Compteur 2026)',
        retrievedAt: receivedAt,
        temporalPrecision: '15-minute aggregation. Latest published interval, not a live CAD count.',
        note: 'RECENT volume at a fixed Eco-Compteur site. Not individual cyclist tracking. Site inventory can be larger than counters present in the current-year extract.'
      }
    });
  }
  return { features, receivedAt, siteInventory: sites.length };
}

export async function fetchCivic311() {
  const receivedAt = new Date().toISOString();
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sql = `SELECT "NATURE", "ACTI_NOM", "ARRONDISSEMENT", "DDS_DATE_CREATION", "LOC_LONG", "LOC_LAT", "DERNIER_STATUT", "RUE" FROM "${URLS.civic311Resource}" WHERE "LOC_LAT" IS NOT NULL AND "DDS_DATE_CREATION" >= '${start}' ORDER BY "DDS_DATE_CREATION" DESC LIMIT 2000`;
  const rows = await datastoreSql(sql, 45000);
  const features = [];
  for (const row of rows) {
    const lon = Number(row.LOC_LONG);
    const lat = Number(row.LOC_LAT);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      id: `${row.DDS_DATE_CREATION}-${lat},${lon}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'civic-311',
        name: row.ACTI_NOM || row.NATURE || '311 request',
        category: row.ACTI_NOM || null,
        nature: row.NATURE || null,
        status: row.DERNIER_STATUT || null,
        borough: row.ARRONDISSEMENT || null,
        street: row.RUE || null,
        createdAt: row.DDS_DATE_CREATION || null,
        source: 'Ville de Montréal — Requêtes 311 (open extract)',
        retrievedAt: receivedAt,
        note: 'Civic service requests, not live dispatch. Request ≠ intervention occurred. Daily extract; lagged.'
      }
    });
  }
  return { features, receivedAt, windowStart: start };
}

export async function fetchIntersectionCounts() {
  const receivedAt = new Date().toISOString();
  const sql = `SELECT DISTINCT ON ("Id_Intersection") "Id_Intersection" AS id, "Nom_Intersection" AS name, "Date" AS last_date, "Longitude" AS lon, "Latitude" AS lat FROM "${URLS.intersectionCountResource}" WHERE "Longitude" IS NOT NULL ORDER BY "Id_Intersection", "Date" DESC`;
  const rows = await datastoreSql(sql, 45000);
  const features = [];
  for (const row of rows) {
    const lon = Number(row.lon);
    const lat = Number(row.lat);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      id: String(row.id),
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'intersection-counts',
        name: row.name || `Intersection ${row.id}`,
        lastSurvey: row.last_date || null,
        source: 'Ville de Montréal — comptages véhicules/piétons/cyclistes aux feux',
        retrievedAt: receivedAt,
        note: 'HISTORICAL field surveys at signalized intersections. Not live traffic, pedestrian, or cyclist counts.'
      }
    });
  }
  return { features, receivedAt };
}
