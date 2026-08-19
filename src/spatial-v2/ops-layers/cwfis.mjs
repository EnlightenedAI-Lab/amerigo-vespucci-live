import { USER_AGENT } from './catalog.mjs';

export const CWFIS = {
  cwfifWfs: 'https://geoserver.cwfif.nrcan.gc.ca/geoserver/ows',
  legacyWfs: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows',
  legacyWms: 'https://cwfis.cfs.nrcan.gc.ca/geoserver/wms',
  placemat: 'https://cwfis.cfs.nrcan.gc.ca/downloads/docs/en/references/cwfif/cwfis-data-placemat.pdf',
  howTo: 'https://cwfis.cfs.nrcan.gc.ca/downloads/docs/en/how-tos/how-to-access-cwfis-data-services.pdf',
  home: 'https://cwfis.cfs.nrcan.gc.ca/',
  activeType: 'public:cwfif_national_activefires',
  hotspotType: 'public:hotspots_last24hrs',
  perimeterType: 'public:m3_polygons_current',
  fwiLayer: 'public:fwi',
  firewxType: 'public:firewx_stns_current'
};

export const QUEBEC_BBOX = {
  minLat: 44.6,
  maxLat: 62.8,
  minLon: -80.0,
  maxLon: -55.5
};

export const STAGE_LABEL = {
  OC: 'Out of control',
  BH: 'Being held',
  UC: 'Under control',
  EX: 'Extinguished',
  UN: 'Unknown'
};

export const LIMITATION = 'CWFIS national products may not represent the latest local agency / SOPFEU situation. Not real-time CAD. Not InciWeb.';

async function wfsJson(base, params, timeoutMs = 45000) {
  const url = new URL(base);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'EPSG:4326');
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/geo+json' },
      signal: controller.signal
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`CWFIS WFS non-JSON HTTP ${response.status}: ${text.slice(0, 180)}`);
    }
    if (!response.ok) throw new Error(`CWFIS WFS HTTP ${response.status}`);
    return { url: url.toString(), body, http: response.status };
  } finally {
    clearTimeout(timer);
  }
}

async function wfsHits(base, params, timeoutMs = 20000) {
  const url = new URL(base);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('resultType', 'hits');
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, text/xml' },
      signal: controller.signal
    });
    const text = await response.text();
    const match = text.match(/numberMatched="([0-9]+)"/) || text.match(/numberMatched>([0-9]+)</);
    return {
      url: url.toString(),
      http: response.status,
      matched: match ? Number(match[1]) : null
    };
  } finally {
    clearTimeout(timer);
  }
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

function inQuebec(lon, lat) {
  return lat >= QUEBEC_BBOX.minLat && lat <= QUEBEC_BBOX.maxLat
    && lon >= QUEBEC_BBOX.minLon && lon <= QUEBEC_BBOX.maxLon;
}

function geomTouchesQuebec(geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Point') {
    return inQuebec(Number(geometry.coordinates[0]), Number(geometry.coordinates[1]));
  }
  const walk = (coords) => {
    if (typeof coords[0] === 'number') return inQuebec(Number(coords[0]), Number(coords[1]));
    return coords.some(walk);
  };
  return walk(geometry.coordinates);
}

export async function fetchActiveFires() {
  const receivedAt = new Date().toISOString();
  const [{ url, body, http }, seasonHits] = await Promise.all([
    wfsJson(CWFIS.cwfifWfs, {
      typeNames: CWFIS.activeType,
      cql_filter: "agency_code='QC'",
      count: 4000,
      sortBy: 'status_date D'
    }),
    wfsHits(CWFIS.cwfifWfs, {
      typeNames: CWFIS.activeType,
      cql_filter: "agency_code='QC' AND fire_year=2026"
    })
  ]);
  const features = [];
  const stages = {};
  const fireYears = {};
  const uniqueIds = new Set();
  for (const feature of body.features || []) {
    const props = feature.properties || {};
    const lon = Number(props.longitude ?? feature.geometry?.coordinates?.[0]);
    const lat = Number(props.latitude ?? feature.geometry?.coordinates?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const stage = String(props.stage_of_control_status || '').trim() || 'UN';
    stages[stage] = (stages[stage] || 0) + 1;
    const year = props.fire_year != null ? String(props.fire_year) : 'unknown';
    fireYears[year] = (fireYears[year] || 0) + 1;
    if (props.national_fire_id) uniqueIds.add(String(props.national_fire_id));
    features.push({
      type: 'Feature',
      id: String(props.national_fire_id || props.id || `${lon},${lat}`),
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'wildfire-active',
        name: props.agency_fire_id ? `QC ${props.agency_fire_id}` : (props.national_fire_id || 'CWFIS active fire'),
        fireId: props.national_fire_id || null,
        agencyFireId: props.agency_fire_id || null,
        agency: props.agency_code || null,
        stage: stage,
        stageLabel: STAGE_LABEL[stage] || stage,
        fireSize: props.fire_size ?? null,
        percentContained: props.percent_contained != null && Number(props.percent_contained) >= 0
          ? props.percent_contained
          : null,
        statusDate: props.status_date || null,
        statusYear: props.status_year ?? null,
        fireYear: props.fire_year ?? null,
        recordStart: props.record_start || null,
        recordEnd: props.record_end || null,
        situationReportDate: props.situation_report_date || null,
        responseType: props.response_type || null,
        cause: props.national_fire_cause || null,
        published: publishedScalars(props),
        source: 'NRCan CWFIS / CWFIF — public:cwfif_national_activefires',
        retrievedAt: receivedAt,
        note: LIMITATION
      }
    });
  }
  const matched = Number(body.numberMatched);
  return {
    features,
    receivedAt,
    endpoint: url,
    http,
    matched: Number.isFinite(matched) ? matched : features.length,
    loaded: features.length,
    uniqueFireIds: uniqueIds.size,
    fireYears,
    seasonYear: 2026,
    seasonRecordCount: seasonHits.matched,
    recordNote: 'numberMatched is Québec rows in public:cwfif_national_activefires (status/situation records). Not unique fires and not a single-day count. Extinguished (EX) rows are not in this layer. fire_year=2026 is the current-season record count. Duplicate national_fire_id rows are successive status records (record_start/record_end).',
    stages,
    newest: features.map((f) => f.properties.statusDate).filter(Boolean).sort().at(-1) || null
  };
}

export async function fetchHotspots() {
  const receivedAt = new Date().toISOString();
  const { url, body, http } = await wfsJson(CWFIS.legacyWfs, {
    typeNames: CWFIS.hotspotType,
    cql_filter: 'lat>=44.6 AND lat<=62.8 AND lon>=-80 AND lon<=-55.5',
    count: 5000
  });
  const features = [];
  const sensors = {};
  for (const feature of body.features || []) {
    const props = feature.properties || {};
    const lon = Number(props.lon ?? feature.geometry?.coordinates?.[0]);
    const lat = Number(props.lat ?? feature.geometry?.coordinates?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const sensor = String(props.sensor || props.satellite || props.source || 'unknown');
    sensors[sensor] = (sensors[sensor] || 0) + 1;
    features.push({
      type: 'Feature',
      id: `${lon},${lat},${props.rep_date || ''}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'wildfire-hotspots',
        name: `${sensor} hotspot`,
        sensor: props.sensor || null,
        satellite: props.satellite || null,
        sourceName: props.source || null,
        agency: props.agency || null,
        detectedAt: props.rep_date || null,
        frp: props.frp ?? null,
        fwi: props.fwi ?? null,
        estArea: props.estarea ?? null,
        published: publishedScalars(props),
        source: 'NRCan CWFIS — public:hotspots_last24hrs (Fire M3 / satellite detection)',
        retrievedAt: receivedAt,
        note: 'SATELLITE DETECTION. Not a confirmed wildfire. Cloud and small fires are missed. Industrial sources are filtered by CWFIS where applied.'
      }
    });
  }
  const matched = Number(body.numberMatched);
  return {
    features,
    receivedAt,
    endpoint: url,
    http,
    matched: Number.isFinite(matched) ? matched : features.length,
    sensors,
    newest: features.map((f) => f.properties.detectedAt).filter(Boolean).sort().at(-1) || null
  };
}

export async function fetchPerimeters() {
  const receivedAt = new Date().toISOString();
  const { url, body, http } = await wfsJson(CWFIS.legacyWfs, {
    typeNames: CWFIS.perimeterType,
    count: 2000
  }, 60000);
  const features = [];
  for (const feature of body.features || []) {
    if (!geomTouchesQuebec(feature.geometry)) continue;
    const props = feature.properties || {};
    features.push({
      type: 'Feature',
      id: String(props.uid || props.consis_id || `${props.firstdate}-${props.area}`),
      geometry: feature.geometry,
      properties: {
        layerId: 'wildfire-perimeters',
        name: 'Satellite-derived perimeter estimate',
        areaHa: props.area ?? null,
        hotspotCount: props.hcount ?? null,
        firstDate: props.firstdate || props.mindate || null,
        lastDate: props.lastdate || props.maxdate || null,
        published: publishedScalars(props),
        source: 'NRCan CWFIS — public:m3_polygons_current',
        retrievedAt: receivedAt,
        note: 'SATELLITE-DERIVED ESTIMATE. Not an official final fire boundary.'
      }
    });
  }
  const matched = Number(body.numberMatched);
  return {
    features,
    receivedAt,
    endpoint: url,
    http,
    nationalMatched: Number.isFinite(matched) ? matched : (body.features || []).length,
    newest: features.map((f) => f.properties.lastDate).filter(Boolean).sort().at(-1) || null
  };
}

export async function fetchFireWeatherStations() {
  const receivedAt = new Date().toISOString();
  const { url, body, http } = await wfsJson(CWFIS.legacyWfs, {
    typeNames: CWFIS.firewxType,
    cql_filter: "prov='QC'",
    count: 500
  });
  const features = [];
  for (const feature of body.features || []) {
    const props = feature.properties || {};
    const lon = Number(props.lon ?? feature.geometry?.coordinates?.[0]);
    const lat = Number(props.lat ?? feature.geometry?.coordinates?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      id: String(props.wmo || props.aes || `${lon},${lat}`),
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'wildfire-fwi',
        name: String(props.name || '').trim() || 'CWFIS fire-weather station',
        agency: props.agency || null,
        province: props.prov || null,
        observedAt: props.rep_date || null,
        temp: props.temp ?? null,
        rh: props.rh ?? null,
        fwi: props.fwi ?? null,
        ffmc: props.ffmc ?? null,
        dmc: props.dmc ?? null,
        dc: props.dc ?? null,
        isi: props.isi ?? null,
        bui: props.bui ?? null,
        dsr: props.dsr ?? null,
        published: publishedScalars(props),
        source: 'NRCan CWFIS — public:firewx_stns_current (station FWI) + public:fwi WMS grid',
        retrievedAt: receivedAt,
        note: LIMITATION
      }
    });
  }
  const matched = Number(body.numberMatched);
  return {
    features,
    receivedAt,
    endpoint: url,
    http,
    matched: Number.isFinite(matched) ? matched : features.length,
    newest: features.map((f) => f.properties.observedAt).filter(Boolean).sort().at(-1) || null
  };
}

export function fwiWmsUpstream(searchParams) {
  const request = String(searchParams.get('REQUEST') || searchParams.get('request') || 'GetMap');
  const kind = request.toLowerCase();
  if (kind !== 'getmap' && kind !== 'getfeatureinfo') {
    throw new Error('CWFIS proxy allows GetMap and GetFeatureInfo only');
  }
  const upstream = new URL(CWFIS.legacyWms);
  for (const [key, value] of searchParams) {
    const lower = key.toLowerCase();
    if (lower === 'layers' || lower === 'query_layers') continue;
    upstream.searchParams.set(key, value);
  }
  if (!upstream.searchParams.get('SERVICE') && !upstream.searchParams.get('service')) {
    upstream.searchParams.set('SERVICE', 'WMS');
  }
  upstream.searchParams.set('LAYERS', CWFIS.fwiLayer);
  if (kind === 'getfeatureinfo') {
    upstream.searchParams.set('QUERY_LAYERS', CWFIS.fwiLayer);
  }
  return upstream;
}

export function parseFwiFeatureInfo(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, message: 'CWFIS GetFeatureInfo was not JSON', raw: String(text).slice(0, 240) };
  }
  const props = body.features?.[0]?.properties || {};
  const raw = props.FWI ?? props.fwi ?? props.GRAY_INDEX;
  const fwi = Number(raw);
  return {
    ok: true,
    product: 'Fire Weather Index',
    layer: CWFIS.fwiLayer,
    fwi: Number.isFinite(fwi) ? fwi : null,
    properties: publishedScalars(props),
    wmsTime: 'CURRENT',
    responseTime: body.timeStamp || null
  };
}

export async function fetchFwiInfo(lat, lon) {
  const d = 0.08;
  const url = new URL(CWFIS.legacyWms);
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('VERSION', '1.3.0');
  url.searchParams.set('REQUEST', 'GetFeatureInfo');
  url.searchParams.set('LAYERS', CWFIS.fwiLayer);
  url.searchParams.set('QUERY_LAYERS', CWFIS.fwiLayer);
  url.searchParams.set('CRS', 'EPSG:4326');
  url.searchParams.set('BBOX', `${lat - d},${lon - d},${lat + d},${lon + d}`);
  url.searchParams.set('WIDTH', '101');
  url.searchParams.set('HEIGHT', '101');
  url.searchParams.set('I', '50');
  url.searchParams.set('J', '50');
  url.searchParams.set('INFO_FORMAT', 'application/json');
  url.searchParams.set('FEATURE_COUNT', '1');
  url.searchParams.set('TIME', 'CURRENT');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, http: response.status, message: `CWFIS GetFeatureInfo HTTP ${response.status}`, raw: text.slice(0, 240) };
    }
    return { ...parseFwiFeatureInfo(text), endpoint: url.toString(), retrievedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}
