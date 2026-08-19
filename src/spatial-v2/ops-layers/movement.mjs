import { URLS, USER_AGENT, MONTREAL_AREA_BBOX, inBbox } from './catalog.mjs';

export async function fetchText(url, { timeoutMs = 30000, accept = '*/*' } = {}) {
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

export async function fetchBixiStations() {
  const [infoRes, statusRes] = await Promise.all([
    fetchText(URLS.bixiStationInformation, { accept: 'application/json' }),
    fetchText(URLS.bixiStationStatus, { accept: 'application/json' })
  ]);
  if (!infoRes.ok) throw new Error(`BIXI station_information HTTP ${infoRes.status}`);
  if (!statusRes.ok) throw new Error(`BIXI station_status HTTP ${statusRes.status}`);
  const info = JSON.parse(infoRes.buffer.toString('utf8'));
  const status = JSON.parse(statusRes.buffer.toString('utf8'));
  const byId = new Map();
  for (const row of status.data?.stations || []) byId.set(String(row.station_id), row);
  const lastUpdated = status.last_updated
    ? new Date(Number(status.last_updated) * 1000).toISOString()
    : null;
  const receivedAt = new Date().toISOString();
  const features = [];
  for (const station of info.data?.stations || []) {
    if (station.is_virtual) continue;
    const lon = Number(station.lon);
    const lat = Number(station.lat);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const st = byId.get(String(station.station_id)) || {};
    features.push({
      type: 'Feature',
      id: station.station_id,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'bixi',
        name: station.name || `BIXI ${station.station_id}`,
        stationId: station.station_id,
        shortName: station.short_name || null,
        capacity: station.capacity ?? null,
        hasKiosk: station.has_kiosk ?? null,
        rentalMethods: Array.isArray(station.rental_methods) ? station.rental_methods.join(', ') : null,
        bikesAvailable: st.num_bikes_available ?? null,
        docksAvailable: st.num_docks_available ?? null,
        isRenting: st.is_renting ?? null,
        isReturning: st.is_returning ?? null,
        lastReported: st.last_reported
          ? new Date(Number(st.last_reported) * 1000).toISOString()
          : null,
        feedTimestamp: lastUpdated,
        source: 'BIXI Montréal GBFS',
        retrievedAt: receivedAt,
        note: 'Station capacity. Not individual bicycle tracking.'
      }
    });
  }
  return {
    features,
    lastUpdated,
    receivedAt,
    ttl: status.ttl ?? null
  };
}

export async function fetchAircraft() {
  const url = `${URLS.spatialV2Aircraft}?lat=45.5017&lon=-73.5673&radiusNm=40`;
  const res = await fetchText(url, { timeoutMs: 20000, accept: 'application/json' });
  if (!res.ok) throw new Error(`Aircraft adapter HTTP ${res.status}`);
  const body = JSON.parse(res.buffer.toString('utf8'));
  if (!body?.ok) throw new Error(body?.message || 'Aircraft adapter not-ok');
  const receivedAt = body.receivedAt || new Date().toISOString();
  const features = [];
  for (const obj of body.objects || []) {
    const lat = Number(obj.latitude);
    const lon = Number(obj.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      id: obj.liveObjectId || obj.sourceObjectId,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'aircraft',
        name: obj.displayName || obj.callsign || obj.liveObjectId,
        callsign: obj.callsign || null,
        registration: obj.registration || null,
        typeCode: obj.typeCode || null,
        altitude: obj.altitude ?? null,
        speed: obj.speed ?? null,
        heading: obj.headingDegrees ?? null,
        observedAt: obj.observedAt || body.feedTimestamp || null,
        ageSeconds: obj.ageSeconds ?? null,
        freshness: obj.freshness || null,
        source: obj.sourceName || 'ADSB.lol',
        licence: obj.sourceLicense || 'ODbL 1.0',
        retrievedAt: receivedAt,
        note: 'Cooperative ADS-B. Incomplete. Not NAV CANADA. Not SAFE TO FLY.'
      }
    });
  }
  return {
    features,
    feedTimestamp: body.feedTimestamp || null,
    receivedAt,
    status: body.status || 'CURRENT',
    aircraftCount: body.aircraftCount,
    reusedAdapter: 'Spatial V2 /api/spatial/live/aircraft (read-only; ADSB.lol)'
  };
}

function featureTouchesMontreal(feature) {
  const geom = feature.geometry;
  if (geom?.type === 'Point') {
    return inBbox(geom.coordinates[1], geom.coordinates[0], MONTREAL_AREA_BBOX);
  }
  const rings = geom?.type === 'LineString'
    ? [geom.coordinates]
    : geom?.type === 'MultiLineString'
      ? geom.coordinates
      : geom?.type === 'Polygon'
        ? geom.coordinates
        : geom?.type === 'MultiPolygon'
          ? geom.coordinates.flat()
          : [];
  for (const ring of rings) {
    for (const pair of ring || []) {
      if (inBbox(Number(pair[1]), Number(pair[0]), MONTREAL_AREA_BBOX)) return true;
    }
  }
  return false;
}

export async function fetchQc511Works() {
  const res = await fetchText(URLS.qc511Chantiers, { timeoutMs: 45000, accept: 'application/json, application/geo+json' });
  if (!res.ok) throw new Error(`MTMD chantiers WFS HTTP ${res.status}`);
  const geojson = JSON.parse(res.buffer.toString('utf8'));
  if (geojson?.type !== 'FeatureCollection') throw new Error('MTMD chantiers is not GeoJSON');
  const receivedAt = new Date().toISOString();
  const features = [];
  for (const feature of geojson.features || []) {
    if (!featureTouchesMontreal(feature)) continue;
    const props = feature.properties || {};
    features.push({
      type: 'Feature',
      id: feature.id || props.identifiant,
      geometry: feature.geometry,
      properties: {
        layerId: 'qc-511',
        name: props.identificationDesTravaux || props.routeAutoroute || `Chantier ${props.identifiant || ''}`.trim(),
        identifiant: props.identifiant || null,
        chantierId: props.identifiantChantier || null,
        route: props.routeAutoroute || null,
        obstruction: props.entraveType || props.entrave || null,
        from: props.debut || null,
        to: props.fin || null,
        updatedAt: props.miseAJour || null,
        description: props.identificationDesTravaux || null,
        source: 'MTMD WFS chantiers_mtmdet (Québec 511-tagged provincial works)',
        retrievedAt: receivedAt,
        note: 'MTMD-managed roads only, not municipal streets. Not the 511 human viewer. Not live traffic speeds. Incident/avertissement typename was not found on this WFS.'
      }
    });
  }
  return {
    features,
    provincialCount: geojson.features?.length || 0,
    receivedAt
  };
}

export async function fetchTrafficCameras() {
  const res = await fetchText(URLS.qc511Cameras, { timeoutMs: 30000, accept: 'application/json, application/geo+json' });
  if (!res.ok) throw new Error(`MTMD cameras WFS HTTP ${res.status}`);
  const geojson = JSON.parse(res.buffer.toString('utf8'));
  const receivedAt = new Date().toISOString();
  const features = [];
  for (const feature of geojson.features || []) {
    if (!featureTouchesMontreal(feature)) continue;
    const props = feature.properties || {};
    features.push({
      type: 'Feature',
      id: feature.id || props.IDEcamera || props.NumeroCamera,
      geometry: feature.geometry,
      properties: {
        layerId: 'traffic-cameras',
        name: props.NumeroCamera || props.IDEcamera || 'Camera',
        cameraId: props.IDEcamera || null,
        source: 'MTMD WFS infos_cameras',
        retrievedAt: receivedAt,
        note: 'Camera LOCATION inventory only. Live video/stream not proven and not displayed.'
      }
    });
  }
  return { features, receivedAt, provincialCount: geojson.features?.length || 0 };
}

function subtractDaysIso(iso, days) {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function fetchSimInterventions() {
  const url = `${URLS.simDatastore}&limit=8000&sort=${encodeURIComponent('CREATION_DATE_TIME desc')}`;
  const res = await fetchText(url, { timeoutMs: 45000, accept: 'application/json' });
  if (!res.ok) throw new Error(`SIM datastore HTTP ${res.status}`);
  const body = JSON.parse(res.buffer.toString('utf8'));
  if (!body?.success) throw new Error('SIM datastore returned not-success');
  const records = body.result?.records || [];
  const receivedAt = new Date().toISOString();
  let maxDate = '';
  for (const row of records) {
    const d = String(row.CREATION_DATE_TIME || '').slice(0, 10);
    if (d > maxDate) maxDate = d;
  }
  const start = maxDate ? subtractDaysIso(maxDate, 6) : null;
  const features = [];
  for (const row of records) {
    const created = String(row.CREATION_DATE_TIME || '');
    const day = created.slice(0, 10);
    if (!day || !start || day < start) continue;
    const lon = Number(row.LONGITUDE);
    const lat = Number(row.LATITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      id: String(row.INCIDENT_NBR || row._id || `${lat},${lon}`),
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'fire-interventions',
        name: row.INCIDENT_TYPE_DESC || row.DESCRIPTION_GROUPE || 'SIM intervention',
        incidentNbr: row.INCIDENT_NBR ?? null,
        createdAt: created,
        group: row.DESCRIPTION_GROUPE || null,
        caserne: row.CASERNE ?? null,
        borough: row.NOM_ARROND || null,
        units: row.NOMBRE_UNITES ?? null,
        source: 'Ville de Montréal — Interventions du SIM (CKAN datastore of official extract)',
        retrievedAt: receivedAt,
        spatialPrecision: 'Obfuscated / published coordinates',
        note: 'Official periodic extract from RAO. NOT live fire CAD.'
      }
    });
  }
  return {
    features,
    receivedAt,
    sourceRowCount: body.result?.total || records.length,
    fetchedRowCount: records.length,
    windowStart: start,
    windowEnd: maxDate
  };
}
