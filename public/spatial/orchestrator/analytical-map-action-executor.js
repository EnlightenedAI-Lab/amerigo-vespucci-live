/**
 * Analytical MapActionPlan executor — governed events + reference features.
 */
import { createMapExecutionReceipt } from './orchestrator-contracts.js';
import { executeIntelligenceMapActionPlan } from './intelligence-map-action-executor.js';
import { addRuntimeLayer, getMapView, importArc } from '../spatial-arcgis-runtime.js';
import { getResultSymbol } from '../result-symbol-registry.js';

const executionStore = new Map();
const referenceLayerRegistry = new Map();

function buildReferenceSymbol(datasetId) {
  const symbol = getResultSymbol(datasetId || 'HOSPITALS');
  if (symbol.style === 'path' && symbol.path) {
    return {
      type: 'simple-marker',
      style: 'path',
      path: symbol.path,
      color: symbol.color,
      size: symbol.size,
      outline: symbol.outline
    };
  }
  return {
    type: 'simple-marker',
    style: symbol.style || 'circle',
    color: symbol.color,
    size: symbol.size,
    outline: symbol.outline
  };
}

/**
 * @param {string} layerId
 * @param {object[]} features
 * @param {object} options
 */
export async function renderAnalyticalReferenceLayer(layerId, features = [], options = {}) {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap || !layerId || !features.length) return { rendered: 0, layerId };

  const [GraphicsLayer, Graphic, Point, SimpleMarkerSymbol] = await Promise.all([
    importArc('@arcgis/core/layers/GraphicsLayer.js'),
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js')
  ]);

  let layer = webMap.findLayerById(layerId) || referenceLayerRegistry.get(layerId);
  if (!layer) {
    layer = new GraphicsLayer({
      id: layerId,
      title: options.title || 'Analytical reference features',
      listMode: 'show'
    });
    addRuntimeLayer(layer);
    referenceLayerRegistry.set(layerId, layer);
  }

  const existing = new Set();
  for (const graphic of layer.graphics?.toArray?.() || []) {
    if (graphic.attributes?.featureId) existing.add(graphic.attributes.featureId);
  }

  let rendered = 0;
  for (const feature of features) {
    const featureId = String(feature.featureId || feature.id || feature.name);
    if (existing.has(featureId)) continue;
    const lat = Number(feature.latitude);
    const lon = Number(feature.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const symbolJson = buildReferenceSymbol(options.referenceDatasetId);
    const graphic = new Graphic({
      geometry: new Point({ latitude: lat, longitude: lon }),
      symbol: SimpleMarkerSymbol.fromJSON(symbolJson),
      attributes: {
        featureId,
        name: feature.name || featureId,
        datasetId: options.referenceDatasetId || null,
        distanceMeters: feature.distanceMeters ?? null,
        iqaiType: feature.iqaiType || 'reference_feature'
      }
    });
    layer.add(graphic);
    existing.add(featureId);
    rendered += 1;
  }

  return { rendered, layerId };
}

/**
 * @param {object} plan
 * @param {object} options
 */
export async function executeAnalyticalMapActionPlan(plan, options = {}) {
  const started = performance.now();
  const payload = plan.mapResultPayload;
  const key = options.idempotencyKey || plan.planId;

  if (!payload?.analytical) {
    return executeIntelligenceMapActionPlan(plan, options);
  }

  const intelligenceLayerId = payload.layerId || payload.intelligenceLayerId;
  const candidate = payload.events?.[0];
  const mappableEvents = payload.mappableEvents?.length
    ? payload.mappableEvents
    : (candidate?.mappable && candidate?.geometry ? [candidate] : []);

  const intelligencePlan = {
    ...plan,
    mapResultPayload: {
      ...payload,
      layerId: intelligenceLayerId,
      mappableEvents,
      conceptId: payload.conceptId || 'events'
    }
  };

  const intelligenceReceipt = await executeIntelligenceMapActionPlan(intelligencePlan, {
    ...options,
    idempotencyKey: `${key}:intel`
  });

  const referenceLayerId = payload.referenceLayerId || payload.hospitalLayerId;
  const referenceReceipt = await renderAnalyticalReferenceLayer(
    referenceLayerId,
    payload.referenceFeatures || payload.hospitals || [],
    {
      title: payload.referenceDatasetId === 'PUBLIC_BUILDINGS'
        ? 'Government buildings (proximity)'
        : 'Hospitals (proximity)',
      referenceDatasetId: payload.referenceDatasetId || 'HOSPITALS'
    }
  );

  const mutated = intelligenceReceipt.mutatedMap || referenceReceipt.rendered > 0;
  executionStore.set(key, { intelligenceReceipt, referenceReceipt });

  const receipt = createMapExecutionReceipt({
    planId: plan.planId,
    graphId: options.graphId,
    traceId: options.traceId,
    actionIds: (plan.actions || []).map((a) => a.actionId),
    layerIds: [intelligenceLayerId, referenceLayerId].filter(Boolean),
    featureKeys: plan.stableFeatureKeys || [],
    success: true,
    skippedDuplicate: false,
    latencyMs: performance.now() - started
  });
  receipt.mutatedMap = mutated;
  receipt.referenceRendered = referenceReceipt.rendered;
  receipt.eventsRendered = intelligenceReceipt.mutatedMap ? 1 : 0;
  return receipt;
}

export function resetAnalyticalMapActionExecutorStore() {
  executionStore.clear();
  referenceLayerRegistry.clear();
}
