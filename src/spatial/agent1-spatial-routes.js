/**
 * Shared Agent 1 spatial API route registration.
 * Used by createServer() for both preview and production runtimes.
 */
import {
  buildPointIntelligenceBrokerRequest,
  buildPointIntelligenceBrokerBundleRequest,
  queryPointIntelligenceBroker,
  queryPointIntelligenceBundleBroker
} from './point-intelligence-broker-client.js';
import { handleOpenWorldIntelligenceSearch } from './open-world-intelligence-search-handler.js';
import { handleIntelligenceLayerSearch, handleIntelligenceProviderRegistry } from './intelligence-layer-search-handler.js';
import {
  handleOrchestratorDeterministic,
  ORCHESTRATOR_DETERMINISTIC_PATH
} from './orchestrator/orchestrator-routes.js';
import {
  handleOrchestratorProgressiveIntelligence,
  ORCHESTRATOR_PROGRESSIVE_PATH
} from './orchestrator/progressive-orchestrator-routes.js';
import {
  handleOrchestratorCrossAgentSpatialAnalysis,
  ORCHESTRATOR_CROSS_AGENT_PATH
} from './orchestrator/cross-agent-spatial-routes.js';
import {
  handleOrchestratorEsriMapAgent,
  ORCHESTRATOR_ESRI_MAP_AGENT_PATH
} from './orchestrator/esri-map-agent-routes.js';
import {
  handlePlacePoiSearch,
  PLACE_POI_SEARCH_PATH
} from './place-poi-routes.js';

export const POINT_INTELLIGENCE_QUERY_PATH = '/api/spatial/point-intelligence/query';
export const POINT_INTELLIGENCE_QUERY_BUNDLE_PATH = '/api/spatial/point-intelligence/query-bundle';
export const OPEN_WORLD_INTELLIGENCE_SEARCH_PATH = '/api/spatial/open-world-intelligence/search';
export const INTELLIGENCE_LAYER_RESEARCH_PATH = '/api/spatial/intelligence-layers/research';
export const INTELLIGENCE_PROVIDER_REGISTRY_PATH = '/api/spatial/intelligence-layers/providers';
export { ORCHESTRATOR_DETERMINISTIC_PATH, ORCHESTRATOR_PROGRESSIVE_PATH, ORCHESTRATOR_CROSS_AGENT_PATH, ORCHESTRATOR_ESRI_MAP_AGENT_PATH, PLACE_POI_SEARCH_PATH };

/** @type {readonly string[]} */
export const AGENT1_SPATIAL_ROUTE_PATHS = Object.freeze([
  POINT_INTELLIGENCE_QUERY_PATH,
  POINT_INTELLIGENCE_QUERY_BUNDLE_PATH,
  OPEN_WORLD_INTELLIGENCE_SEARCH_PATH,
  INTELLIGENCE_LAYER_RESEARCH_PATH,
  INTELLIGENCE_PROVIDER_REGISTRY_PATH,
  ORCHESTRATOR_DETERMINISTIC_PATH,
  ORCHESTRATOR_PROGRESSIVE_PATH,
  ORCHESTRATOR_CROSS_AGENT_PATH,
  ORCHESTRATOR_ESRI_MAP_AGENT_PATH,
  PLACE_POI_SEARCH_PATH
]);

/**
 * Register Agent 1 governed spatial routes on the shared Express app.
 * @param {import('express').Express} app
 * @param {object} [_options]
 */
export function registerAgent1SpatialRoutes(app, _options = {}) {
  app.post(POINT_INTELLIGENCE_QUERY_PATH, handlePointIntelligenceQuery);
  app.post(POINT_INTELLIGENCE_QUERY_BUNDLE_PATH, handlePointIntelligenceQueryBundle);
  app.post(OPEN_WORLD_INTELLIGENCE_SEARCH_PATH, handleOpenWorldIntelligenceSearch);
  app.post(INTELLIGENCE_LAYER_RESEARCH_PATH, handleIntelligenceLayerSearch);
  app.get(INTELLIGENCE_PROVIDER_REGISTRY_PATH, handleIntelligenceProviderRegistry);
  app.post(ORCHESTRATOR_DETERMINISTIC_PATH, handleOrchestratorDeterministic);
  app.post(ORCHESTRATOR_PROGRESSIVE_PATH, handleOrchestratorProgressiveIntelligence);
  app.post(ORCHESTRATOR_CROSS_AGENT_PATH, handleOrchestratorCrossAgentSpatialAnalysis);
  app.post(ORCHESTRATOR_ESRI_MAP_AGENT_PATH, handleOrchestratorEsriMapAgent);
  app.post(PLACE_POI_SEARCH_PATH, handlePlacePoiSearch);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handlePointIntelligenceQuery(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  try {
    if (process.env.POINT_INTELLIGENCE_MOCK_STATE) {
      const mockState = String(process.env.POINT_INTELLIGENCE_MOCK_STATE).toUpperCase();
      return res.status(mockState === 'INVALID_REQUEST' ? 400 : 200).json({
        queryState: mockState,
        resultCount: 0,
        results: [],
        error: mockState === 'PROVIDER_UNAVAILABLE' ? 'Mock provider unavailable' : null
      });
    }

    const parsed = buildPointIntelligenceBrokerRequest(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({
        queryState: 'INVALID_REQUEST',
        error: parsed.error,
        resultCount: 0,
        results: []
      });
    }

    const broker = await queryPointIntelligenceBroker(parsed.value);
    return res.status(broker.status).json(broker.body);
  } catch (error) {
    return res.status(503).json({
      queryState: 'PROVIDER_UNAVAILABLE',
      error: error?.message || 'Point Intelligence broker unavailable',
      resultCount: 0,
      results: []
    });
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handlePointIntelligenceQueryBundle(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = buildPointIntelligenceBrokerBundleRequest(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({
        bundleState: 'INVALID_REQUEST',
        error: parsed.error,
        families: [],
        queryReceipts: []
      });
    }

    const broker = await queryPointIntelligenceBundleBroker(parsed.value);
    const status = broker.body?.bundleState === 'INVALID_REQUEST' ? 400 : broker.status;
    return res.status(status).json(broker.body);
  } catch (error) {
    return res.status(503).json({
      bundleState: 'PARTIAL_FAILURE',
      error: error?.message || 'Point Intelligence broker unavailable',
      families: [],
      queryReceipts: []
    });
  }
}

/**
 * @param {import('express').Express} app
 * @returns {boolean}
 */
export function isPointIntelligenceRouteRegistered(app) {
  const stack = app?._router?.stack || [];
  return stack.some((layer) => {
    if (!layer?.route) return false;
    return layer.route.path === POINT_INTELLIGENCE_QUERY_PATH
      && layer.route.methods?.post;
  });
}

/**
 * @param {import('express').Express} app
 * @returns {boolean}
 */
export function isPointIntelligenceBundleRouteRegistered(app) {
  const stack = app?._router?.stack || [];
  return stack.some((layer) => {
    if (!layer?.route) return false;
    return layer.route.path === POINT_INTELLIGENCE_QUERY_BUNDLE_PATH
      && layer.route.methods?.post;
  });
}

/**
 * @param {import('express').Express} app
 * @returns {boolean}
 */
export function arePointIntelligenceRoutesRegistered(app) {
  return isPointIntelligenceRouteRegistered(app)
    && isPointIntelligenceBundleRouteRegistered(app);
}
