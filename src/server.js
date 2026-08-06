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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createServer(state, config, arcgis, options = {}) {
  const app = express();
  const mapApi = options.preview
    ? new DemoMapApiService()
    : new MapApiService(arcgis, config, state);
  const cache = new MapCache(45_000);
  const handlers = createMapApiHandlers(mapApi, cache);
  const wpiService = new WpiPortService();

  app.use(securityHeaders);

  app.get('/health', (_req, res) => {
    if (options.preview) {
      return res.status(200).json({
        ok: true,
        preview: true,
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

  app.use(express.static(PUBLIC_DIR));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  if (options.preview) {
    app.get('/api/preview-mode', (_req, res) => {
      res.json({ preview: true, badge: 'LOCAL DEMO DATA' });
    });
  }

  return app;
}
