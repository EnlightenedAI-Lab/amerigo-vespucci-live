/** Compact layer INFO from loaded payload + MapView viewport. No fabricated metrics. */

function featuresOf(payload) {
  return payload?.geojson?.features || [];
}

function pointInView(lon, lat, view) {
  if (!view || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  try {
    const screen = view.toScreen?.({
      type: 'point',
      longitude: lon,
      latitude: lat,
      spatialReference: { wkid: 4326 }
    });
    if (!screen) return false;
    return screen.x >= 0 && screen.y >= 0 && screen.x <= view.width && screen.y <= view.height;
  } catch {
    return false;
  }
}

function coordsOf(feature) {
  const geom = feature?.geometry;
  if (!geom) return null;
  if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    return { lon: Number(geom.coordinates[0]), lat: Number(geom.coordinates[1]) };
  }
  const first = geom.coordinates;
  let pair = first;
  while (Array.isArray(pair) && Array.isArray(pair[0])) pair = pair[0];
  if (Array.isArray(pair) && pair.length >= 2) return { lon: Number(pair[0]), lat: Number(pair[1]) };
  return null;
}

export function countInView(features, view) {
  let n = 0;
  for (const feature of features || []) {
    const xy = coordsOf(feature);
    if (xy && pointInView(xy.lon, xy.lat, view)) n += 1;
  }
  return n;
}

export function clock(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number'
    ? (value > 1e12 ? value : value * 1000)
    : (/^\d{10}$/.test(String(value))
      ? Number(value) * 1000
      : (/^\d{13}$/.test(String(value)) ? Number(value) : Date.parse(value)));
  if (!Number.isFinite(ms)) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(ms);
}

export function ageLabel(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number'
    ? (value > 1e12 ? value : value * 1000)
    : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 120) return `${sec} SEC`;
  const min = Math.round(sec / 60);
  if (min < 120) return `${min} MIN`;
  return `${Math.round(min / 60)} H`;
}

export function maxStamp(features, keys) {
  let best = null;
  for (const feature of features || []) {
    const props = feature.properties || {};
    for (const key of keys) {
      const raw = props[key];
      if (raw == null || raw === '') continue;
      const text = String(raw);
      if (!best || text > best) best = text;
    }
  }
  return best;
}

export function uniqueCount(features, key) {
  const set = new Set();
  for (const feature of features || []) {
    const value = feature.properties?.[key];
    if (value != null && value !== '') set.add(String(value));
  }
  return set.size;
}

export function sumFinite(features, key) {
  let sum = 0;
  let n = 0;
  for (const feature of features || []) {
    const value = Number(feature.properties?.[key]);
    if (!Number.isFinite(value)) continue;
    sum += value;
    n += 1;
  }
  return n ? { sum, n } : null;
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function viewCenter(view) {
  const c = view?.center;
  const lon = Number(c?.longitude);
  const lat = Number(c?.latitude);
  if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  return null;
}

function fact(label, value) {
  if (value == null || value === '' || value === false) return null;
  return { label, value: String(value) };
}

function buildFacts(layer, payload, ctx) {
  const features = featuresOf(payload);
  const inView = features.length ? countInView(features, ctx.view) : 0;
  const status = payload?.status || layer.status;
  const source = payload?.source || layer.provider;
  const id = layer.id;
  const rows = [];

  rows.push(fact('STATUS', String(status || '').replaceAll('_', ' ')));
  if (features.length || payload?.featureCount != null) {
    rows.push(fact('IN VIEW', String(inView)));
    rows.push(fact('OBSERVED', String(payload.featureCount ?? features.length)));
  }

  if (id === 'stm') {
    rows.push(fact('ROUTES', uniqueCount(features, 'routeId') || null));
    const latest = payload.feedTimestampIso || payload.feedTimestamp || maxStamp(features, ['vehicleTimestamp', 'feedTimestampIso']);
    rows.push(fact('LATEST', clock(latest)));
    rows.push(fact('FRESHNESS', ageLabel(latest)));
    rows.push(fact('SOURCE', source));
  } else if (id === 'aircraft') {
    const latest = payload.feedTimestamp || maxStamp(features, ['observedAt']);
    rows.push(fact('LATEST', clock(latest)));
    rows.push(fact('FRESHNESS', ageLabel(latest)));
    rows.push(fact('SOURCE', features[0]?.properties?.source || source));
    rows.push(fact('LIMIT', 'Cooperative ADS-B. Incomplete. Not NAV CANADA.'));
  } else if (id === 'recent-crime') {
    rows.push(fact('WINDOW', payload.windowLabel || layer.selectedWindow));
    rows.push(fact('NEWEST DATE', payload.asOfDate || payload.latestSourceTimestamp || payload.windowEnd));
    rows.push(fact('SOURCE', source));
    rows.push(fact('LIMIT', 'RECENT published DATE+QUART. Not live CAD.'));
  } else if (id === 'fire-interventions') {
    rows.push(fact('NEWEST', maxStamp(features, ['createdAt'])));
    rows.push(fact('SOURCE', source));
    rows.push(fact('LIMIT', 'RECENT extract. Not live fire CAD.'));
  } else if (id === 'bixi') {
    const bikes = sumFinite(features, 'bikesAvailable');
    const docks = sumFinite(features, 'docksAvailable');
    rows.push(fact('BIKES AVAIL.', bikes ? String(bikes.sum) : null));
    rows.push(fact('DOCKS AVAIL.', docks ? String(docks.sum) : null));
    rows.push(fact('LATEST', clock(payload.feedTimestamp || features[0]?.properties?.feedTimestamp)));
    rows.push(fact('SOURCE', source));
  } else if (id === 'hydro') {
    rows.push(fact('AREAS', payload.polygonCount != null ? String(payload.polygonCount) : String(features.filter((f) => f.properties?.hydroKind === 'area').length)));
    rows.push(fact('POINTS', payload.pointCount != null ? String(payload.pointCount) : String(features.filter((f) => f.properties?.hydroKind === 'point').length)));
    rows.push(fact('LATEST', clock(payload.feedTimestamp || maxStamp(features, ['feedTimestamp']))));
    rows.push(fact('SOURCE', source));
  } else if (id === 'air-quality') {
    rows.push(fact('LATEST', payload.latestSourceTimestamp || (payload.asOfDate && payload.asOfHour ? `${payload.asOfDate} ${payload.asOfHour}:00 EST` : null)));
    rows.push(fact('SOURCE', source));
  } else if (id === 'hydrometric') {
    rows.push(fact('LATEST', maxStamp(features, ['observedAt'])));
    rows.push(fact('FRESHNESS', ageLabel(maxStamp(features, ['observedAt']))));
    rows.push(fact('SOURCE', source));
  } else if (id === 'weather') {
    rows.push(fact('ALERTS', payload.alertCount != null ? String(payload.alertCount) : String(features.filter((f) => f.properties?.weatherKind === 'alert').length)));
    rows.push(fact('STATIONS', payload.stationCount != null ? String(payload.stationCount) : String(features.filter((f) => f.properties?.weatherKind === 'citypage').length)));
    rows.push(fact('RADAR', payload.radar?.status || null));
    rows.push(fact('SOURCE', source));
  } else if (id === 'wildfire-active') {
    rows.push(fact('QC RECORDS', payload.quebecMatched != null ? String(payload.quebecMatched) : null));
    rows.push(fact('NEWEST STATUS', payload.latestSourceTimestamp || maxStamp(features, ['statusDate', 'situationReportDate'])));
    rows.push(fact('SOURCE', source));
  } else if (id === 'wildfire-hotspots') {
    rows.push(fact('DETECTIONS', String(payload.featureCount ?? features.length)));
    rows.push(fact('NEWEST DETECTION', payload.latestSourceTimestamp || maxStamp(features, ['detectedAt'])));
    rows.push(fact('SOURCE', source));
  } else if (id === 'wildfire-perimeters') {
    rows.push(fact('PERIMETERS', String(payload.featureCount ?? features.length)));
    rows.push(fact('SOURCE', source));
  } else if (id === 'wildfire-fwi') {
    rows.push(fact('STATIONS QC', payload.quebecMatched != null ? String(payload.quebecMatched) : String(features.length)));
    rows.push(fact('SOURCE', source));
  } else {
    rows.push(fact('LATEST', clock(payload?.feedTimestamp || payload?.retrievedAt || maxStamp(features, ['retrievedAt', 'observedAt', 'createdAt']))));
    rows.push(fact('SOURCE', source));
  }

  const maxFacts = String(id).startsWith('wildfire-') ? 10 : 8;
  return rows.filter(Boolean).slice(0, maxFacts);
}

export function countMapBreakdown(map, labels = {}) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + (Number(n) || 0), 0);
  if (!total) return null;
  return entries.map(([key, count]) => ({
    label: labels[key] || key,
    count: Number(count) || 0,
    pct: Math.round(((Number(count) || 0) / total) * 100)
  }));
}

export function crimeBreakdown(payload) {
  const cats = payload?.categories;
  if (!Array.isArray(cats) || !cats.length) return null;
  const total = cats.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  if (!total) return null;
  return cats.map((row) => ({
    label: row.french || row.english || '—',
    count: Number(row.count) || 0,
    pct: Math.round(((Number(row.count) || 0) / total) * 100)
  }));
}

export function buildSnapshot(layer, payload, ctx = {}) {
  const id = layer.id;
  let warning = null;
  if (id === 'recent-crime') warning = 'Not live CAD.';
  else if (id === 'aircraft') warning = 'ADS-B is cooperative and incomplete.';
  else if (id === 'traffic-cameras') warning = 'Camera point does not prove a live image.';
  else if (id === 'wildfire-hotspots') warning = 'SATELLITE DETECTION. Not a confirmed wildfire.';
  else if (id === 'wildfire-perimeters') warning = 'SATELLITE-DERIVED ESTIMATE. Not an official final fire boundary.';
  else if (id === 'wildfire-fwi') warning = payload?.limitation || 'Low-dominance FWI context. Not a fire occurrence.';
  else if (id === 'wildfire-active') warning = payload?.recordNote || payload?.limitation || 'CWFIS Québec records are status rows, not unique current fires.';
  return {
    title: layer.title,
    status: payload?.status || layer.status,
    facts: buildFacts(layer, payload || {}, ctx),
    warning
  };
}

export function buildLayerInfo(layer, payload = {}, ctx = {}) {
  const features = payload?.geojson?.features || [];
  const inViewCount = features.length ? countInView(features, ctx.view) : 0;
  const latest = payload.latestSourceTimestamp
    || payload.feedTimestampIso
    || payload.feedTimestamp
    || payload.asOfDate
    || maxStamp(features, ['observedAt', 'detectedAt', 'statusDate', 'vehicleTimestamp', 'createdAt', 'date']);
  const freshness = ageLabel(latest)
    || (features[0]?.properties?.freshnessHours != null ? `${features[0].properties.freshnessHours} H after hour` : null);
  const what = Array.isArray(layer.establishes) ? layer.establishes[0] : (layer.establishes || payload.adapter);
  const limit = payload.limitation
    || (Array.isArray(layer.limitations) ? layer.limitations[0] : layer.limitations)
    || payload.message;
  return {
    title: layer.title,
    what: what || null,
    status: payload.status || layer.status,
    inView: String(inViewCount),
    latest: latest ? (clock(latest) || String(latest)) : null,
    freshness,
    source: payload.source || layer.provider,
    limitation: limit || null,
    officialUrl: layer.officialUrl || null,
    sourceRecord: {
      sourceId: layer.sourceId || null,
      licence: payload.licence || layer.licence || null,
      retrievedAt: payload.retrievedAt || null,
      adapter: payload.adapter || layer.adapter || null,
      featureCount: payload.featureCount ?? features.length,
      authBlocker: layer.authBlocker || payload.authBlocker || null,
      rightsBlocker: layer.rightsBlocker || payload.rightsBlocker || null
    }
  };
}
