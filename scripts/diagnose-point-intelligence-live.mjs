/**
 * Diagnose live Point Intelligence bundle for Montréal clicks.
 */
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:3000';

const POINTS = {
  central: { name: 'Central Montréal', coordinates: [-73.5673, 45.5017] },
  stLawrence: { name: 'St. Lawrence', coordinates: [-73.55, 45.508] },
  westIsland: { name: 'Greater Montréal (Dorval)', coordinates: [-73.75, 45.457] }
};

async function probe(path) {
  const started = Date.now();
  try {
    const res = await fetch(path, { signal: AbortSignal.timeout(4000) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ms: Date.now() - started, body };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: error.message };
  }
}

async function queryBundle(coordinates) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/spatial/point-intelligence/query-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      geometry: { type: 'Point', coordinates },
      radiusMeters: 3000,
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    })
  });
  const body = await res.json().catch(() => ({}));
  const families = Array.isArray(body.families) ? body.families : [];
  return {
    http: res.status,
    ms: Date.now() - started,
    bundleState: body.bundleState || body.queryState || null,
    error: body.error || null,
    familyCount: families.length,
    families: families.map((f) => ({
      informationFamily: f.informationFamily,
      status: f.status || f.queryState,
      resultCount: f.resultCount ?? f.results?.length ?? 0,
      error: f.error || null,
      nativeId: f.nativeId || null,
      provider: f.results?.[0]?.providerName || null,
      station: f.results?.[0]?.stationName || f.results?.[0]?.title || null
    })),
    keys: Object.keys(body)
  };
}

const health = {
  spatial: await probe(`${BASE}/health`),
  broker3015: await probe('http://127.0.0.1:3015/health'),
  broker3025: await probe('http://127.0.0.1:3025/health')
};

const results = {};
for (const [key, point] of Object.entries(POINTS)) {
  try {
    results[key] = { ...point, ...(await queryBundle(point.coordinates)) };
  } catch (error) {
    results[key] = { ...point, error: error.message };
  }
}

console.log(JSON.stringify({ health, results }, null, 2));
