import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MapApiService, createMapApiHandlers } from './map-api.js';
import { DemoMapApiService } from './demo-map-api.js';
import { MapCache } from './map-cache.js';
import { securityHeaders, sanitizeError } from './security.js';
import { getOceanViewConfig } from './ocean-view-config.js';
import { runArcGISDiagnostics } from './arcgis-diagnostics.js';
import { getSanitizedCatalog, getSpatialPublicConfig } from './spatial/spatial-api.js';
import { WpiPortService } from './spatial/wpi-ports.js';
import { registerIntelligenceLabRoutes } from './spatial/intelligence-lab-routes.js';
import { registerAgent2IntelligenceRoutes } from './spatial/intelligence-routes-loader.js';
import {
  initSpatialRuntimeInfo,
  getRuntimeInfoResponse,
  updateClientRuntimeState,
  buildSpatialIndexHtml
} from './spatial/spatial-runtime-info.js';
import {
  getLastAiMapRunReceipt,
  mergeLastAiMapRunReceipt
} from './spatial/ai-map-run-receipt.js';
import {
  registerAgent1SpatialRoutes,
  isPointIntelligenceRouteRegistered,
  arePointIntelligenceRoutesRegistered,
  POINT_INTELLIGENCE_QUERY_PATH,
  POINT_INTELLIGENCE_QUERY_BUNDLE_PATH
} from './spatial/agent1-spatial-routes.js';
import { registerImageryV2Routes } from './spatial-v2/imagery-routes.js';
import { registerTemporalCatalogProxy } from './spatial-v2/temporal-catalog-proxy.js';
import { registerEarthObservationBridge } from './spatial-v2/earth-observation-bridge.js';
import { registerOperationalLayerRoutes } from './spatial-v2/ops-layers/routes.js';
import { registerCameraProviderRoutes } from './spatial-v2/camera-provider-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createServer(state, config, arcgis, options = {}) {
  initSpatialRuntimeInfo({
    preview: options.preview === true,
    pid: process.pid
  });

  const app = express();
  const mapApi = options.preview
    ? new DemoMapApiService()
    : new MapApiService(arcgis, config, state);
  const cache = new MapCache(45_000);
  const handlers = createMapApiHandlers(mapApi, cache);
  const wpiService = new WpiPortService();

  app.use(securityHeaders);
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    if (options.preview) {
      return res.status(200).json({
        ok: true,
        preview: true,
        spatialEngine: 'compound-v1',
        layerAwareEngine: 'layer-aware-v1',
        conversationEngine: 'conversation-v1',
        aisConnected: false,
        aisFresh: true,
        mmsi: config.targetMmsi,
        historyEnabled: true,
        conditionsEnabled: true,
        message: 'Local demo preview — no live tracking services active'
      });
    }
    const last = state.lastPosition?.lastAIS;
    const aisFresh = Boolean(last && Date.now() - last.getTime() <= config.healthStaleAfterSeconds * 1000);
    res.status(200).json({
      ok: true,
      spatialEngine: 'compound-v1',
      layerAwareEngine: 'layer-aware-v1',
      conversationEngine: 'conversation-v1',
      aisConnected: state.aisConnected(),
      aisFresh,
      lastAIS: last?.toISOString() || null,
      lastArcGISUpdate: state.lastArcGISUpdate?.toISOString() || null,
      lastDataDockedAttempt: state.lastDataDockedAttempt?.toISOString() || null,
      lastDataDockedAccepted: state.lastDataDockedAccepted?.toISOString() || null,
      historyEnabled: config.enableHistory,
      lastHistoryWrite: state.lastHistoryWrite?.toISOString() || null,
      historyPointCount: state.historyPointCount,
      lastTravelledRouteUpdate: state.lastTravelledRouteUpdate?.toISOString() || null,
      lastDestinationUpdate: state.lastDestinationUpdate?.toISOString() || null,
      lastEstimatedRouteUpdate: state.lastEstimatedRouteUpdate?.toISOString() || null,
      distanceRemainingNM: state.distanceRemainingNM,
      estimatedETA: state.estimatedETA?.toISOString() || null,
      mmsi: config.targetMmsi,
      ...(state.openMeteoClient?.health?.() || { conditionsEnabled: config.enableConditions })
    });
  });

  async function sendJson(res, handler) {
    try {
      const data = await handler();
      res.json(data);
    } catch (error) {
      res.status(500).json(sanitizeError(error));
    }
  }

  app.get('/api/vessel', (req, res) => sendJson(res, handlers.vessel));
  app.get('/api/history', (req, res) => sendJson(res, handlers.history));
  app.get('/api/travelled-route', (req, res) => sendJson(res, handlers.travelledRoute));
  app.get('/api/destination', (req, res) => sendJson(res, handlers.destination));
  app.get('/api/estimated-route', (req, res) => sendJson(res, handlers.estimatedRoute));
  app.get('/api/conditions', (req, res) => sendJson(res, handlers.conditions));
  app.get('/api/map-data', (req, res) => sendJson(res, handlers.mapData));
  app.get('/api/ocean-view', (_req, res) => res.json(getOceanViewConfig()));

  app.get('/api/ocean-view/access', async (_req, res) => {
    if (options.preview) {
      return res.status(404).json({ error: 'ArcGIS access is unavailable in local preview mode.' });
    }
    if (!arcgis?.token) {
      return res.status(503).json({ error: 'ArcGIS access is not configured.' });
    }
    try {
      await arcgis.ensureValidToken();
      res.json({
        portalUrl: config.arcgisPortalUrl || 'https://www.arcgis.com',
        featureServiceUrl: config.arcgisFeatureServiceUrl,
        token: arcgis.token
      });
    } catch (error) {
      res.status(503).json(sanitizeError(error));
    }
  });

  app.get('/api/spatial/config', (_req, res) => {
    res.json(getSpatialPublicConfig(config, { preview: options.preview === true }));
  });

  app.get('/api/spatial/runtime-info', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getRuntimeInfoResponse());
  });

  app.get('/api/spatial/ai-map/last-receipt', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const receipt = getLastAiMapRunReceipt();
    if (!receipt) {
      return res.status(404).json({
        ok: false,
        available: false,
        error: 'No AI MAP run receipt persisted yet'
      });
    }
    return res.json({ ok: true, available: true, receipt });
  });

  app.post('/api/spatial/ai-map/last-receipt/client-completion', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    const allowed = [
      'mappedCount',
      'selectedEventId',
      'statusMessage',
      'streamed',
      'governedCandidateCount',
      'candidateIds',
      'candidates',
      'rejectionDiagnostics',
      'governanceCounts',
      'traceId',
      'receiptId',
      'query',
      'finalState',
      'interactiveDeadlineReached',
      'clientCompletedAt'
    ];
    const partial = {};
    for (const key of allowed) {
      if (key in body) partial[key] = body[key];
    }
    partial.clientCompletedAt = partial.clientCompletedAt || new Date().toISOString();
    const receipt = mergeLastAiMapRunReceipt(partial);
    return res.json({ ok: true, receipt });
  });

  if (options.preview) {
    app.post('/api/spatial/runtime-info/client-state', (req, res) => {
      res.set('Cache-Control', 'no-store');
      const allowed = [
        'rendererMode',
        'displayLayerId',
        'displayLayerTitle',
        'usesLayerViewFilter',
        'usesObjectIdFilter',
        'runtimeFallbackActive',
        'authoritativeWebMapLayerActive',
        'iqaiDeterministicResultsActive',
        'fallbackReason',
        'authNativeShortReason',
        'authNativeDiagnostic',
        'usesObjectIdFilter'
      ];
      const partial = {};
      for (const key of allowed) {
        if (key in (req.body || {})) partial[key] = req.body[key];
      }
      res.json(updateClientRuntimeState(partial));
    });
  }

  app.get('/api/spatial/catalog', (_req, res) => {
    res.json({ layers: getSanitizedCatalog() });
  });

  app.get('/api/spatial/radar-frames', (_req, res) => {
    if (!config.radarEnabled) {
      return res.json({
        enabled: false,
        frames: [],
        reason: 'Permission review required — RADAR_ENABLED is false'
      });
    }
    res.json({ enabled: true, frames: [], note: 'Radar adapter blocked pending IPMA permission' });
  });

  app.get('/api/spatial/operational-map/oauth-config', async (req, res) => {
    try {
      const { buildMontrealOAuthPublicConfig } = await import('./spatial/montreal-oauth-config.js');
      const origin = `${req.protocol}://${req.get('host')}`;
      res.json(buildMontrealOAuthPublicConfig(config, origin));
    } catch (error) {
      res.status(500).json(sanitizeError(error));
    }
  });

  app.post('/api/spatial/map', async (req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'no-store');
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ supported: false, message: 'Prompt is required.' });
    }
    if (prompt.length > 500) {
      return res.status(400).json({ supported: false, message: 'Prompt exceeds maximum length.' });
    }
    try {
      const { buildMapFromPrompt, clearMapDataCaches } = await import('./spatial/iqai-mapper.js');
      const { normalizeMapRequestCatalog } = await import('./spatial/webmap-layer-catalog.js');
      clearMapDataCaches();
      const context = {
        previousLocationText: String(req.body?.previousLocationText || '').trim()
          || String(req.body?.conversationState?.lastLocationText || '').trim()
          || undefined,
        previousMatchedAddress: String(req.body?.previousMatchedAddress || '').trim()
          || String(req.body?.conversationState?.lastMatchedAddress || '').trim()
          || undefined,
        webmapLayerCatalog: normalizeMapRequestCatalog(req.body?.webmapLayerCatalog || null),
        conversationState: req.body?.conversationState || null
      };
      const result = await buildMapFromPrompt(prompt, { context });
      if (!result.supported) {
        return res.status(422).json(result);
      }
      res.json(result);
    } catch (error) {
      res.status(503).json({
        supported: false,
        message: error.message || 'Map generation failed'
      });
    }
  });

  app.post('/api/spatial/gis-plan/validate', async (req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'no-store');
    try {
      const { validateAndAdaptGisPlan } = await import('./spatial/a1-gis-plan-service.js');
      const { GIS_CAPABILITY_REGISTRY } = await import('./spatial/a1-gis-capability-registry.js');
      const { formatPlanContractTrail } = await import('./spatial/a1-gis-plan-provenance.js');
      const context = {
        previousLocationText: String(req.body?.previousLocationText || '').trim()
          || String(req.body?.context?.previousLocationText || '').trim()
          || String(req.body?.conversationState?.lastLocationText || '').trim()
          || undefined,
        conversationState: req.body?.conversationState || req.body?.context?.conversationState || null
      };
      const processed = validateAndAdaptGisPlan(req.body?.plan ?? req.body, context);
      const audit = processed.audit || null;
      res.status(processed.valid ? 200 : 422).json({
        ...processed,
        contractVersion: GIS_CAPABILITY_REGISTRY.contractVersion,
        contractTrail: formatPlanContractTrail(audit)
      });
    } catch (error) {
      res.status(500).json({
        valid: false,
        errors: [{ code: 'VALIDATION_ERROR', message: error.message || 'GIS plan validation failed.' }]
      });
    }
  });

  app.post('/api/spatial/gis-plan/execute', async (req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'no-store');
    try {
      const { executeValidatedGisPlan } = await import('./spatial/a1-gis-plan-service.js');
      const { buildMapFromPrompt, clearMapDataCaches } = await import('./spatial/iqai-mapper.js');
      const { normalizeMapRequestCatalog } = await import('./spatial/webmap-layer-catalog.js');
      const { GIS_CAPABILITY_REGISTRY } = await import('./spatial/a1-gis-capability-registry.js');
      const { formatPlanContractTrail } = await import('./spatial/a1-gis-plan-provenance.js');
      clearMapDataCaches();
      const context = {
        previousLocationText: String(req.body?.previousLocationText || '').trim()
          || String(req.body?.context?.previousLocationText || '').trim()
          || String(req.body?.conversationState?.lastLocationText || '').trim()
          || undefined,
        previousMatchedAddress: String(req.body?.previousMatchedAddress || '').trim()
          || String(req.body?.context?.previousMatchedAddress || '').trim()
          || undefined,
        webmapLayerCatalog: normalizeMapRequestCatalog(req.body?.webmapLayerCatalog || null),
        conversationState: req.body?.conversationState || req.body?.context?.conversationState || null
      };
      const result = await executeValidatedGisPlan(req.body?.plan ?? req.body, context, buildMapFromPrompt);
      if (!result.valid) {
        return res.status(422).json({
          ...result,
          contractVersion: GIS_CAPABILITY_REGISTRY.contractVersion,
          contractTrail: formatPlanContractTrail(result.audit)
        });
      }
      res.json({
        ...result,
        contractVersion: GIS_CAPABILITY_REGISTRY.contractVersion,
        contractTrail: formatPlanContractTrail(result.audit)
      });
    } catch (error) {
      res.status(503).json({
        valid: false,
        executed: false,
        supported: false,
        errors: [{ code: 'EXECUTION_ERROR', message: error.message || 'GIS plan execution failed.' }]
      });
    }
  });

  app.get('/api/spatial/ai-config', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { getNaturalLanguageGisRuntimeConfig } = await import('./spatial/a1-gis-plan-natural-language-service.js');
      const { isSemanticFallbackAvailable } = await import('./spatial/spatial-semantic-fallback.js');
      const semanticFallback = await isSemanticFallbackAvailable();
      const ai = getNaturalLanguageGisRuntimeConfig();
      res.json({
        ai: {
          ...ai,
          role: 'GIS_PLAN_CANDIDATE_GENERATOR',
          governedPath: 'natural-language → envelope → validateGISPlan → adapter → engine'
        },
        deterministic: {
          path: 'deterministic-nlp',
          semanticFallback,
          semanticModel: semanticFallback ? 'Xenova/multilingual-e5-small' : null,
          llmCost: '$0.00'
        }
      });
    } catch (error) {
      res.status(503).json(sanitizeError(error));
    }
  });

  app.post('/api/spatial/ai-map/plan', async (req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'no-store');
    const prompt = String(req.body?.prompt || req.body?.text || '').trim();
    if (!prompt) {
      return res.status(400).json({ status: 'INVALID_MODEL_OUTPUT', message: 'Prompt is required.' });
    }
    if (prompt.length > 800) {
      return res.status(400).json({ status: 'INVALID_MODEL_OUTPUT', message: 'Prompt exceeds maximum length.' });
    }
    if (req.body?.alreadyValidated || req.body?.skipValidation) {
      return res.status(400).json({
        status: 'INVALID_MODEL_OUTPUT',
        failureCode: 'TRUST_BYPASS_REJECTED',
        message: 'Client trust-bypass flags are not permitted.'
      });
    }
    try {
      const { planNaturalLanguageGISRequest } = await import('./spatial/a1-gis-plan-natural-language-service.js');
      const { normalizeMapRequestCatalog } = await import('./spatial/webmap-layer-catalog.js');
      const { formatLiveModelContractTrail } = await import('./spatial/a1-gis-plan-provenance.js');
      const context = {
        previousLocationText: String(req.body?.previousLocationText || '').trim()
          || String(req.body?.conversationState?.lastLocationText || '').trim()
          || undefined,
        previousMatchedAddress: String(req.body?.previousMatchedAddress || '').trim()
          || String(req.body?.conversationState?.lastMatchedAddress || '').trim()
          || undefined,
        webmapLayerCatalog: normalizeMapRequestCatalog(req.body?.webmapLayerCatalog || null),
        conversationState: req.body?.conversationState || null
      };
      const result = await planNaturalLanguageGISRequest({ text: prompt, context });
      const statusCode = result.status === 'VALID_PLAN' ? 200 : 422;
      res.status(statusCode).json({
        ...result,
        gisExecuted: false,
        contractTrail: formatLiveModelContractTrail(result.audit)
      });
    } catch (error) {
      res.status(503).json({
        status: 'PROVIDER_ERROR',
        failureCode: 'MODEL_PROVIDER_ERROR',
        message: error.message || 'AI MAP planning failed',
        gisExecuted: false
      });
    }
  });

  app.post('/api/spatial/ai-map', async (req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'no-store');
    const prompt = String(req.body?.prompt || req.body?.text || '').trim();
    if (!prompt) {
      return res.status(400).json({ supported: false, status: 'INVALID_MODEL_OUTPUT', message: 'Prompt is required.' });
    }
    if (prompt.length > 800) {
      return res.status(400).json({ supported: false, status: 'INVALID_MODEL_OUTPUT', message: 'Prompt exceeds maximum length.' });
    }
    if (req.body?.alreadyValidated || req.body?.skipValidation) {
      return res.status(400).json({
        supported: false,
        status: 'INVALID_MODEL_OUTPUT',
        failureCode: 'TRUST_BYPASS_REJECTED',
        message: 'Client trust-bypass flags are not permitted.'
      });
    }
    try {
      const { executeNaturalLanguageGISRequest } = await import('./spatial/a1-gis-plan-natural-language-service.js');
      const { buildMapFromPrompt, clearMapDataCaches } = await import('./spatial/iqai-mapper.js');
      const { normalizeMapRequestCatalog } = await import('./spatial/webmap-layer-catalog.js');
      const { formatLiveModelContractTrail } = await import('./spatial/a1-gis-plan-provenance.js');
      const context = {
        previousLocationText: String(req.body?.previousLocationText || '').trim()
          || String(req.body?.conversationState?.lastLocationText || '').trim()
          || undefined,
        previousMatchedAddress: String(req.body?.previousMatchedAddress || '').trim()
          || String(req.body?.conversationState?.lastMatchedAddress || '').trim()
          || undefined,
        webmapLayerCatalog: normalizeMapRequestCatalog(req.body?.webmapLayerCatalog || null),
        conversationState: req.body?.conversationState || null
      };
      clearMapDataCaches();
      const result = await executeNaturalLanguageGISRequest({ text: prompt, context }, buildMapFromPrompt);
      if (result.status !== 'VALID_PLAN' || !result.supported) {
        return res.status(422).json({
          supported: false,
          ...result,
          contractTrail: formatLiveModelContractTrail(result.audit)
        });
      }
      res.json({
        ...result.execution,
        supported: true,
        prompt,
        gisExecuted: true,
        aiPlan: {
          requestId: result.requestId,
          status: result.status,
          normalizedPlan: result.normalizedPlan,
          adaptation: result.adaptation,
          provider: result.provider,
          model: result.model,
          planId: result.planId
        },
        contractTrail: formatLiveModelContractTrail(result.audit)
      });
    } catch (error) {
      res.status(503).json({
        supported: false,
        status: 'PROVIDER_ERROR',
        failureCode: 'MODEL_PROVIDER_ERROR',
        message: error.message || 'AI Spatial map generation failed',
        gisExecuted: false
      });
    }
  });

  registerAgent1SpatialRoutes(app, options);
  registerImageryV2Routes(app);
  registerTemporalCatalogProxy(app);
  registerEarthObservationBridge(app);
  registerOperationalLayerRoutes(app);
  registerCameraProviderRoutes(app);

  app.get('/api/spatial/stm/live-buses', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { fetchStmVehiclePositions } = await import('./spatial/stm-gtfs-rt-client.js');
      const result = await fetchStmVehiclePositions();
      if (!result.ok) {
        const status = result.error?.includes('not configured') ? 503 : 502;
        return res.status(status).json({ ok: false, message: result.error });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, message: sanitizeError(error).error || 'STM live buses failed' });
    }
  });

  app.get('/api/spatial/live/aircraft', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { fetchLiveAircraft } = await import('./spatial/adsb-lol-client.js');
      const lat = req.query.lat != null ? Number(req.query.lat) : undefined;
      const lon = req.query.lon != null ? Number(req.query.lon) : undefined;
      const radiusNm = req.query.radiusNm != null
        ? Number(req.query.radiusNm)
        : (req.query.radius != null ? Number(req.query.radius) : undefined);
      const result = await fetchLiveAircraft({ lat, lon, radiusNm });
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          status: result.status || 'ERROR',
          source: result.source || 'ADSB.lol',
          message: result.error || 'Live aircraft failed',
          aircraftCount: 0,
          objects: []
        });
      }
      res.json(result);
    } catch (error) {
      const message = sanitizeError(error).error || 'Live aircraft failed';
      const status = /invalid/i.test(message) ? 400 : 500;
      res.status(status).json({ ok: false, message });
    }
  });

  app.get('/api/spatial/spvm/crime-90d', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=1800');
    try {
      const { fetchSpvmCrimeGeojson } = await import('./spatial/spvm-crime-client.js');
      const result = await fetchSpvmCrimeGeojson();
      if (!result.ok || !result.geojson) {
        return res.status(502).json({
          ok: false,
          message: result.error || 'SPVM crime GeoJSON unavailable'
        });
      }
      if (result.stale) res.set('X-IQAI-Stale', '1');
      res.type('application/geo+json');
      res.send(JSON.stringify(result.geojson));
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: sanitizeError(error).error || 'SPVM crime GeoJSON failed'
      });
    }
  });

  app.get('/api/spatial/spvm/status', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=1800');
    try {
      const { fetchSpvmStatus } = await import('./spatial/spvm-crime-client.js');
      const result = await fetchSpvmStatus();
      if (!result.ok || !result.status) {
        return res.status(502).json({
          ok: false,
          message: result.error || 'SPVM status unavailable'
        });
      }
      if (result.stale) res.set('X-IQAI-Stale', '1');
      res.json(result.status);
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: sanitizeError(error).error || 'SPVM status failed'
      });
    }
  });

  app.get('/api/spatial/live/vessels', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { fetchLiveVessels } = await import('./spatial/aisstream-client.js');
      const result = await fetchLiveVessels();
      if (!result.ok) {
        const status = result.keyRequired ? 503 : 502;
        return res.status(status).json({
          ok: false,
          status: result.status || 'ERROR',
          source: result.source || 'AISStream.io',
          message: result.error || 'Live vessels failed',
          vesselCount: result.vesselCount ?? 0,
          objects: result.objects ?? [],
          keyRequired: Boolean(result.keyRequired),
          keyConfigured: Boolean(result.keyConfigured)
        });
      }
      res.json(result);
    } catch (error) {
      const message = sanitizeError(error).error || 'Live vessels failed';
      res.status(500).json({ ok: false, message });
    }
  });

  void import('./spatial/aisstream-client.js').then(async ({ startAisSpatialStream }) => {
    const { isAisSpatialStreamEnabled } = await import('./spatial/aisstream-config.js');
    if (!isAisSpatialStreamEnabled()) {
      console.warn('[IQAI] AIS spatial stream autostart disabled (IQAI_AIS_SPATIAL_STREAM)');
      return;
    }
    startAisSpatialStream({
      aisstreamApiKey: config.aisstreamApiKey || process.env.AISSTREAM_API_KEY,
      aisstreamUrl: config.aisstreamUrl || process.env.AISSTREAM_URL
    });
  }).catch((error) => {
    console.warn('[IQAI] AIS spatial stream failed to start', error?.message || error);
  });

  app.get('/api/spatial/hydro-quebec/outage-areas', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { fetchHydroQuebecOutageAreas } = await import('./spatial/hydro-quebec-outages-client.js');
      const result = await fetchHydroQuebecOutageAreas();
      if (!result.ok && !result.areas?.length) {
        return res.status(502).json({
          ok: false,
          status: result.status || 'ERROR',
          source: result.source || 'Hydro-Québec Open Data',
          message: result.error || 'Hydro-Québec outage areas failed',
          version: result.version || null,
          feedTimestamp: result.feedTimestamp || null,
          receivedAt: result.receivedAt || new Date().toISOString(),
          polygonCount: 0,
          areas: [],
          stale: true,
          error: result.error || 'Hydro-Québec outage areas failed'
        });
      }
      res.json({
        ok: true,
        status: result.status,
        source: result.source,
        version: result.version,
        feedTimestamp: result.feedTimestamp,
        receivedAt: result.receivedAt,
        polygonCount: result.polygonCount,
        areas: result.areas,
        stale: result.stale,
        error: result.error
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        status: 'ERROR',
        message: sanitizeError(error).error || 'Hydro-Québec outage areas failed',
        areas: []
      });
    }
  });

  app.get('/api/spatial/hydro-quebec/outages', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { fetchHydroQuebecOutages } = await import('./spatial/hydro-quebec-outages-client.js');
      const result = await fetchHydroQuebecOutages();
      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          status: result.status || 'ERROR',
          source: result.source || 'Hydro-Québec Open Data',
          message: result.error || 'Hydro-Québec outages failed',
          version: result.version || null,
          feedTimestamp: result.feedTimestamp || null,
          receivedAt: result.receivedAt || new Date().toISOString(),
          outageCount: 0,
          outages: [],
          stale: true,
          error: result.error || 'Hydro-Québec outages failed'
        });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({
        ok: false,
        status: 'ERROR',
        message: sanitizeError(error).error || 'Hydro-Québec outages failed'
      });
    }
  });

  app.get('/api/spatial/ports', async (req, res) => {
    if (!wpiService) {
      return res.json({ type: 'FeatureCollection', features: [], meta: { preview: true } });
    }
    try {
      const west = Number(req.query.west);
      const south = Number(req.query.south);
      const east = Number(req.query.east);
      const north = Number(req.query.north);
      await wpiService.refresh(false);
      const ports = [west, south, east, north].every(Number.isFinite)
        ? wpiService.queryViewport({ west, south, east, north })
        : wpiService.cache.ports.slice(0, 500);
      res.json(wpiService.toGeoJson(ports));
    } catch (error) {
      res.status(503).json(sanitizeError(error));
    }
  });

  registerIntelligenceLabRoutes(app);
  void registerAgent2IntelligenceRoutes(app).catch((error) => {
    console.warn('[IQAI] Agent 2 intelligence routes failed to load:', error?.message || error);
  });

  let diagnosticsCache = { at: 0, data: null };
  app.get('/api/arcgis-diagnostics', async (_req, res) => {
    if (options.preview) {
      return res.status(503).json({ error: 'ArcGIS diagnostics are unavailable in local preview mode.' });
    }
    if (!arcgis?.featureServiceUrl) {
      return res.status(503).json({ error: 'ArcGIS diagnostics are not ready yet.' });
    }
    try {
      const now = Date.now();
      if (!diagnosticsCache.data || now - diagnosticsCache.at > 60_000) {
        diagnosticsCache = {
          at: now,
          data: await runArcGISDiagnostics(arcgis, config)
        };
      }
      res.json(diagnosticsCache.data);
    } catch (error) {
      res.status(500).json(sanitizeError(error));
    }
  });

  if (options.preview) {
    const serveSpatialIndex = (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.type('html').send(buildSpatialIndexHtml());
    };
    app.get(['/spatial', '/spatial/'], serveSpatialIndex);
    app.get('/spatial/index.html', serveSpatialIndex);
  } else {
    app.get(['/spatial', '/spatial/'], (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.redirect(302, '/spatial/index.html');
    });
  }

  app.use('/spatial', (req, res, next) => {
    if (/\.(js|css|mjs|html)$/i.test(req.path)) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  });

  app.get(['/spatial-v2', '/spatial-v2/', '/spatial-v2/index.html'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'spatial-v2', 'index.html'));
  });

  app.use('/spatial-v2', (req, res, next) => {
    if (/\.(js|css|mjs|html)$/i.test(req.path)) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  });

  app.use(express.static(PUBLIC_DIR));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  if (options.preview) {
    app.get('/api/preview-mode', (_req, res) => {
      res.json({ preview: true, badge: 'LOCAL DEMO DATA' });
    });
  }

  if (!arePointIntelligenceRoutesRegistered(app)) {
    throw new Error(
      `Agent 1 spatial routes missing: ${POINT_INTELLIGENCE_QUERY_PATH} and/or ${POINT_INTELLIGENCE_QUERY_BUNDLE_PATH}`
    );
  }

  return app;
}
