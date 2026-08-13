/**
 * Live dynamic place search acceptance against local Montréal Spatial.
 * Does not print secrets, tokens, or passwords.
 */
const BASE = process.env.IQAI_SPATIAL_BASE_URL || 'http://127.0.0.1:3000';

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000)
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

function summarizePlace(result) {
  const body = result.json || {};
  const places = Array.isArray(body.places) ? body.places : [];
  return {
    http: result.http,
    ok: body.ok,
    status: body.status || body.code || null,
    route: body.route || body.provenance?.route || null,
    provider: body.provider?.service || body.provenance?.provider || null,
    esriPlacesApi: body.provider?.esriPlacesApi ?? null,
    resultCount: places.length,
    radiusMeters: body.intent?.radiusMeters ?? body.provenance?.radiusMeters ?? null,
    anchor: body.geocodeReceipt?.matchedAddress || body.geocodeReceipt?.locationText || null,
    layerTitle: body.layerTitle || null,
    sample: places.slice(0, 3).map((place) => ({
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      provider: place.provider,
      providerId: place.providerId || null,
      hasCoords: Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
    })),
    fabricated: places.some((place) => !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude))
  };
}

const report = {
  url: `${BASE}/spatial/`,
  tests: {}
};

report.tests.starbucks = summarizePlace(
  await postJson('/api/spatial/place-poi/search', {
    prompt: 'map Starbucks within 2 km of 997 de la Commune'
  })
);

report.tests.pharmacy = summarizePlace(
  await postJson('/api/spatial/place-poi/search', {
    prompt: 'map pharmacies within 2 km of McGill University'
  })
);

report.tests.coffee = summarizePlace(
  await postJson('/api/spatial/place-poi/search', {
    prompt: 'find coffee shops within 1 km of Place Ville Marie'
  })
);

report.tests.gas = summarizePlace(
  await postJson('/api/spatial/place-poi/search', {
    prompt: 'nearest gas station to Montreal airport'
  })
);

report.tests.hotels = summarizePlace(
  await postJson('/api/spatial/place-poi/search', {
    prompt: 'map hotels around Bell Centre'
  })
);

report.tests.empty = summarizePlace(
  await postJson('/api/spatial/place-poi/search', {
    prompt: 'map Zzyzxq Qorblat Coffeeworks within 2 km of 997 de la Commune'
  })
);

const fire = await postJson('/api/spatial/map', {
  prompt: 'map fire stations within 3 km of 997 de la Commune'
});
report.tests.fire = {
  http: fire.http,
  supported: fire.json.supported,
  action: fire.json.request?.action || fire.json.summary?.action || null,
  datasetIds: fire.json.request?.datasetIds || fire.json.summary?.datasetIds || null,
  matched: fire.json.summary?.matchedFeatures ?? null,
  capability: fire.json.capability || null
};

const toilets = await postJson('/api/spatial/map', {
  prompt: 'map toilets 500 meters from 997 de la commune'
});
report.tests.toilets = {
  http: toilets.http,
  supported: toilets.json.supported,
  action: toilets.json.request?.action || toilets.json.summary?.action || null,
  conceptId: toilets.json.request?.conceptId || toilets.json.summary?.conceptId || null,
  radiusMeters: toilets.json.request?.radiusMeters || toilets.json.summary?.radiusMeters || null,
  matched: toilets.json.summary?.matchedFeatures ?? null
};

const { planSpatialCapability, SPATIAL_CAPABILITY } = await import('../public/spatial/spatial-capability-router.js');
report.routing = {
  starbucks: planSpatialCapability('map Starbucks within 2 km of 997 de la Commune').capability,
  fire: planSpatialCapability('map fire stations within 3 km of 997 de la Commune').capability,
  toilets: planSpatialCapability('map toilets 500 meters from 997 de la commune').capability,
  expectedPlace: SPATIAL_CAPABILITY.PLACE_POI_SEARCH,
  expectedGis: SPATIAL_CAPABILITY.DETERMINISTIC_GIS
};

const s = report.tests;
report.pass = {
  starbucks: s.starbucks.ok && s.starbucks.route === 'DYNAMIC_PLACE_SEARCH' && s.starbucks.radiusMeters === 2000 && s.starbucks.resultCount > 0 && !s.starbucks.fabricated,
  pharmacy: s.pharmacy.ok && s.pharmacy.resultCount > 0 && !s.pharmacy.fabricated,
  coffee: s.coffee.ok && s.coffee.resultCount > 0 && !s.coffee.fabricated,
  gas: s.gas.ok && s.gas.resultCount > 0 && !s.gas.fabricated,
  fireGis: report.routing.fire === SPATIAL_CAPABILITY.DETERMINISTIC_GIS && s.fire.supported !== false,
  toiletsGis: report.routing.toilets === SPATIAL_CAPABILITY.DETERMINISTIC_GIS && s.toilets.conceptId === 'TOILETS' && s.toilets.radiusMeters === 500,
  empty: s.empty.status === 'NO_VERIFIED_RESULTS' && s.empty.resultCount === 0 && s.empty.fabricated === false
};

console.log(JSON.stringify(report, null, 2));
const failed = Object.entries(report.pass).filter(([, ok]) => !ok).map(([name]) => name);
process.exit(failed.length ? 1 : 0);
