/**
 * Agent 1 governed open-world intelligence search — orchestrates Agent 2 API truth.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { INTELLIGENCE_CONNECTORS_ROOT } from './intelligence-routes-loader.js';

let connectorsModules = null;

async function loadConnectorsModules() {
  if (connectorsModules) return connectorsModules;
  const base = INTELLIGENCE_CONNECTORS_ROOT;
  const [archive, incidentsGeo, eventsGeo] = await Promise.all([
    import(pathToFileURL(resolve(base, 'src/intelligence/pipeline/observation-archive-search.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/api/incidents-geojson-builder.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/api/geojson-builder.js')).href)
  ]);
  connectorsModules = { archive, incidentsGeo, eventsGeo };
  return connectorsModules;
}

function appendQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} deps
 */
export async function executeOpenWorldIntelligenceSearch(body, deps = {}) {
  const store = deps.store;
  if (!store) {
    return { searchState: 'UNAVAILABLE', error: 'Agent 2 store unavailable' };
  }

  const plan = body?.plan;
  if (!plan) {
    return { searchState: 'INVALID_REQUEST', error: 'Missing governed query plan' };
  }

  const mods = await loadConnectorsModules();
  const payload = { queryPlan: plan, archive: null, incidentsGeoJson: null, eventsGeoJson: null };

  if (plan.archive) {
    payload.archive = mods.archive.searchObservationArchive(store, {
      ...plan.archive,
      freeText: plan.archive.freeText || plan.keyword || body.keyword || undefined,
      province: plan.spatial?.province || body.province || undefined
    });
    const events = await import(pathToFileURL(resolve(
      INTELLIGENCE_CONNECTORS_ROOT,
      'src/intelligence/storage/store-read.js'
    )).href);
    const eventRows = events.readLatestById(store, 'event-candidates', 'eventCandidateId');
    const eventMap = new Map(eventRows.map((e) => [e.eventCandidateId, e]));
    payload.archive.observations = (payload.archive.observations || []).map((item) => {
      const derived = (item.derivedEvents || []).map((row) => {
        const full = eventMap.get(row.eventCandidateId);
        return full ? { ...row, geometry: full.geometry || null } : row;
      });
      return { ...item, derivedEvents: derived };
    });
  }

  if (plan.incidents) {
    payload.incidentsGeoJson = mods.incidentsGeo.buildIncidentsGeoJson(store, {
      ...plan.incidents,
      province: plan.spatial?.province || body.province || undefined
    });
  }

  if (plan.events) {
    payload.eventsGeoJson = mods.eventsGeo.buildOperationalGeoJson(store, {
      ...plan.events,
      province: plan.spatial?.province || body.province || undefined
    });
  }

  return {
    searchState: 'SUCCESS',
    queryPlan: plan,
    agent2Endpoints: {
      archive: `/api/spatial/intelligence/observations/archive${appendQuery(plan.archive)}`,
      incidentsGeoJson: `/api/spatial/intelligence/incidents.geojson${appendQuery(plan.incidents)}`,
      eventsGeoJson: `/api/spatial/intelligence/events.geojson${appendQuery(plan.events)}`
    },
    ...payload
  };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleOpenWorldIntelligenceSearch(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  try {
    const storeRoot = process.env.INTELLIGENCE_STORE_ROOT
      || resolve(INTELLIGENCE_CONNECTORS_ROOT, 'data/intelligence/store');
    const storeMod = await import(pathToFileURL(resolve(
      INTELLIGENCE_CONNECTORS_ROOT,
      'src/intelligence/storage/store-singleton.js'
    )).href);
    const store = storeMod.getIntelligenceStore(storeRoot);
    const result = await executeOpenWorldIntelligenceSearch(req.body || {}, { store });
    const status = result.searchState === 'INVALID_REQUEST' ? 400
      : result.searchState === 'UNAVAILABLE' ? 503 : 200;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(503).json({
      searchState: 'ERROR',
      error: error?.message || 'Open-world intelligence search failed'
    });
  }
}
