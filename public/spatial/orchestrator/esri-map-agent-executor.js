/**
 * Esri map agent plan executor — applies validated MapActionPlans on MapView.
 */
import { createMapExecutionReceipt } from './orchestrator-contracts.js';
import { getMapView, zoomTo, importArc } from '../spatial-arcgis-runtime.js';

const executionStore = new Map();

/**
 * @param {object} plan
 * @param {object} options
 */
export async function executeEsriMapAgentPlan(plan, options = {}) {
  const started = performance.now();
  const view = getMapView();
  const payload = plan.mapResultPayload || {};
  let mutatedMap = false;

  if (!view || options.simulateMapUnavailable) {
    return createMapExecutionReceipt({
      planId: plan.planId,
      success: false,
      latencyMs: performance.now() - started,
      mutatedMap: false
    });
  }

  for (const action of plan.actions || []) {
    if (action.type === 'ZOOM') {
      if (action.mode === 'CENTER' && action.center) {
        await zoomTo({ center: [action.center.longitude, action.center.latitude], zoom: action.zoom || 14 });
        mutatedMap = true;
      } else if (action.mode === 'FIT_LAYER' && action.layerId) {
        const layer = view.map?.findLayerById(action.layerId);
        if (layer?.graphics?.length) {
          await zoomTo(layer.graphics);
          mutatedMap = true;
        } else if (layer?.queryExtent) {
          const extent = await layer.queryExtent();
          if (extent?.extent) await zoomTo(extent.extent);
          mutatedMap = true;
        }
      } else {
        await zoomTo({ zoom: action.zoom || view.zoom });
        mutatedMap = true;
      }
    }

    if (action.type === 'HIGHLIGHT' && action.layerId) {
      const layer = view.map?.findLayerById(action.layerId);
      if (layer?.graphics) {
        const [SimpleMarkerSymbol] = await Promise.all([
          importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js')
        ]);
        for (const graphic of layer.graphics) {
          graphic.symbol = new SimpleMarkerSymbol({
            style: 'circle',
            color: [0, 122, 194, 0.9],
            size: 14,
            outline: { color: [255, 255, 0, 1], width: 2 }
          });
        }
        mutatedMap = true;
      }
    }

    if (action.type === 'FILTER' && action.layerId) {
      const layer = view.map?.findLayerById(action.layerId);
      if (layer?.graphics) {
        for (const graphic of layer.graphics) {
          graphic.visible = true;
        }
        mutatedMap = true;
      }
    }
  }

  const receipt = createMapExecutionReceipt({
    planId: plan.planId,
    graphId: options.graphId,
    traceId: options.traceId,
    actionIds: (plan.actions || []).map((a) => a.actionId),
    layerIds: (plan.actions || []).map((a) => a.layerId).filter(Boolean),
    featureKeys: plan.stableFeatureKeys || [],
    success: true,
    skippedDuplicate: false,
    latencyMs: performance.now() - started
  });
  receipt.mutatedMap = mutatedMap;
  receipt.statistics = payload.statistics || null;
  receipt.readOnly = payload.readOnly === true;
  executionStore.set(plan.planId, receipt);
  return receipt;
}

export function resetEsriMapAgentExecutorStore() {
  executionStore.clear();
}

/**
 * @param {object} map
 */
export function collectMapContextFromView(map) {
  const layers = [];
  if (!map?.layers?.items) return { layers };
  for (const layer of map.layers.items) {
    const graphicCount = layer.graphics?.length ?? layer.source?.length ?? null;
    layers.push({
      id: layer.id,
      title: layer.title,
      type: layer.type,
      visible: layer.visible,
      graphicCount: Number.isFinite(graphicCount) ? graphicCount : 0
    });
  }
  return { layers };
}
