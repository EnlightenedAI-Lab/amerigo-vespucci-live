/**
 * Remote approved FeatureLayer operational display for X-ray category selection.
 * No IQAI feature materialization — ArcGIS renders with AOI + category filter.
 */

import {
  getMapView,
  getWebMap,
  importArc
} from './spatial-arcgis-runtime.js';
import {
  buildCategoryDefinitionExpression
} from './source-presentation.js';
import { setIqaiResultFeatureLayers } from './spatial-map-command.js';

export const XRAY_OPERATIONAL_LAYER_ID = 'iqai-xray-operational';
const RUNTIME_GROUP_ID = 'iqai-map-result';
const FEATURE_QUERY_LIMIT = 500;

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let operationalLayer = null;
/** @type {string[]} */
let activeCategories = [];
/** @type {{ geometry: object, distanceMeters: number } | null} */
let aoiQueryContext = null;

export function getActiveOperationalCategories() {
  return [...activeCategories];
}

export function getXrayOperationalLayer() {
  return operationalLayer;
}

function layerStillInMap(layer) {
  if (!layer) return false;
  const webMap = getWebMap();
  if (!webMap) return false;
  const group = webMap.findLayerById(RUNTIME_GROUP_ID);
  if (group?.findLayerById?.(XRAY_OPERATIONAL_LAYER_ID)) return true;
  return Boolean(webMap.findLayerById(XRAY_OPERATIONAL_LAYER_ID));
}

async function ensureOperationalLayer(sourceDef) {
  const FeatureLayer = await importArc('@arcgis/core/layers/FeatureLayer.js');
  const layerUrl = `${String(sourceDef.serviceUrl).replace(/\/$/, '')}/${sourceDef.layerId ?? 0}`;

  if (operationalLayer && !layerStillInMap(operationalLayer)) {
    operationalLayer = null;
  }

  if (!operationalLayer) {
    operationalLayer = new FeatureLayer({
      id: XRAY_OPERATIONAL_LAYER_ID,
      url: layerUrl,
      title: 'IQAI — Selected amenities (operational)',
      listMode: 'show',
      popupEnabled: true,
      visible: true,
      minScale: 0,
      maxScale: 0
    });
    const webMap = getWebMap();
    const group = webMap?.findLayerById(RUNTIME_GROUP_ID);
    if (group) {
      group.add(operationalLayer);
    } else if (webMap) {
      webMap.add(operationalLayer);
    }
  }

  return operationalLayer;
}

async function applyOperationalLayerViewFilter(layer, origin, radiusMeters) {
  const view = getMapView();
  if (!view || !layer || !origin || !radiusMeters) return null;

  const FeatureFilter = await importArc('@arcgis/core/layers/support/FeatureFilter.js');
  const Circle = await importArc('@arcgis/core/geometry/Circle.js');
  const layerView = await view.whenLayerView(layer);

  const aoiGeometry = new Circle({
    center: origin,
    radius: radiusMeters,
    radiusUnit: 'meters',
    geodesic: true
  });

  layerView.filter = new FeatureFilter({
    geometry: aoiGeometry,
    spatialRelationship: 'intersects'
  });

  return { layerView, aoiGeometry };
}

async function clearOperationalLayerViewFilter() {
  const view = getMapView();
  if (!view || !operationalLayer) return;
  try {
    const layerView = await view.whenLayerView(operationalLayer);
    layerView.filter = null;
  } catch {
    // layer view may not exist
  }
}

/**
 * @param {{
 *   originLat: number,
 *   originLon: number,
 *   radiusMeters: number,
 *   semanticField: string,
 *   categoryValues: string[],
 *   presentation: object,
 *   sourceDef: object
 * }} options
 */
export async function syncXrayOperationalDisplay(options) {
  const {
    originLat,
    originLon,
    radiusMeters,
    semanticField,
    categoryValues,
    presentation,
    sourceDef
  } = options;

  activeCategories = [...(categoryValues || [])].filter(Boolean);

  const Point = await importArc('@arcgis/core/geometry/Point.js');
  const layer = await ensureOperationalLayer(sourceDef);
  const origin = new Point({
    longitude: originLon,
    latitude: originLat,
    spatialReference: { wkid: 4326 }
  });

  const definitionExpression = buildCategoryDefinitionExpression(semanticField, activeCategories);
  layer.definitionExpression = definitionExpression;
  if (presentation?.popupTemplate) layer.popupTemplate = presentation.popupTemplate;
  layer.visible = true;

  await layer.load();

  const filterResult = await applyOperationalLayerViewFilter(layer, origin, radiusMeters);
  aoiQueryContext = filterResult?.aoiGeometry
    ? { geometry: filterResult.aoiGeometry }
    : null;

  setIqaiResultFeatureLayers([layer]);

  return {
    ok: true,
    visible: true,
    layerId: XRAY_OPERATIONAL_LAYER_ID,
    categoryCount: activeCategories.length,
    remote: true,
    layerViewReady: Boolean(filterResult?.layerView)
  };
}

export async function clearXrayOperationalDisplay() {
  activeCategories = [];
  aoiQueryContext = null;
  await clearOperationalLayerViewFilter();
  if (operationalLayer) {
    operationalLayer.visible = false;
    operationalLayer.definitionExpression = '1=0';
  }
  setIqaiResultFeatureLayers([]);
  return { ok: true, visible: false };
}

/**
 * Query features for FEATURES table — bounded by existing 500 limit.
 */
export async function queryXrayOperationalFeatures(limit = FEATURE_QUERY_LIMIT) {
  if (!operationalLayer || !activeCategories.length) {
    return { ok: true, features: [], total: 0, truncated: false };
  }

  const query = operationalLayer.createQuery();
  query.where = operationalLayer.definitionExpression || '1=1';
  query.outFields = ['*'];
  query.returnGeometry = true;
  query.num = limit + 1;

  if (aoiQueryContext?.geometry) {
    query.geometry = aoiQueryContext.geometry;
    query.spatialRelationship = 'intersects';
  }

  const result = await operationalLayer.queryFeatures(query);
  const features = result.features || [];
  const truncated = features.length > limit;
  return {
    ok: true,
    features: truncated ? features.slice(0, limit) : features,
    total: truncated ? limit + 1 : features.length,
    truncated
  };
}

export function getOperationalFeatureQueryLimit() {
  return FEATURE_QUERY_LIMIT;
}
