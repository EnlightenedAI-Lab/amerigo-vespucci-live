/**
 * Render deterministic MAP results on the existing Montreal 1 MapView.
 */
import {
  clearRuntimeLayers,
  addRuntimeLayer,
  zoomTo,
  getMapView,
  getWebMap,
  importArc
} from './spatial-arcgis-runtime.js';
import { getResultSymbol } from './result-symbol-registry.js';
import { describePopupTemplate } from './agol-feature-details.js';
import {
  markMapDiagStage,
  captureMapCommandFailure,
  snapshotFirstFeature,
  wrapMapCommandError,
  getCurrentMapDiagStage
} from './map-command-diagnostics.js';
import { inheritSourceRenderer, sanitizeRendererForScopedLayer, clearPresentationFidelityRecords, getArcgisPresentation, resolveLiveWebMapSourceLayer, inferScopedGeometryTypeFromFeatures, normalizeLayerGeometryType, resolveScopedRenderer, resolveScopedPopup, recordPresentationFidelity } from './source-presentation.js';
import { findLayerByIdRecursive } from './runtime-layer-groups.js';
import { SPVM_LAYER_ID } from './spvm-recent-crime-config.js';

const RUNTIME_GROUP_ID = 'iqai-map-result';

/** @type {import('@arcgis/core/core/Handles').Handle[]} */
let popupWatchHandles = [];
/** @type {import('@arcgis/core/core/Handles').Handle | null} */
let clickHandle = null;
/** @type {object | null} */
let lastClickDiagnostic = null;
/** @type {object | null} */
let webMapLayerInspect = null;
/** @type {import('@arcgis/core/layers/FeatureLayer').default[]} */
let iqaiResultFeatureLayers = [];
/** @type {{ action?: string, radiusMeters?: number, originLon?: number, originLat?: number, isLocate?: boolean, searchCircleGeometry?: object } | null} */
let lastScopedQueryContext = null;
/** @type {import('@arcgis/core/core/Handles').Handle[]} */
let highlightHandles = [];

function clearSelectionHighlight() {
  for (const handle of highlightHandles) {
    try {
      handle.remove();
    } catch {
      // ignore
    }
  }
  highlightHandles = [];
}

async function highlightIqaiFeature(view, layer, graphic) {
  clearSelectionHighlight();
  if (!view || !layer || !graphic) return;
  try {
    const layerView = await view.whenLayerView(layer);
    if (!layerView?.highlight) return;
    const objectId = graphic.attributes?.OBJECTID ?? graphic.attributes?.ObjectID;
    let handle = null;
    if (objectId != null && objectId !== '') {
      handle = layerView.highlight(Number(objectId));
    }
    if (!handle) {
      handle = layerView.highlight(graphic);
    }
    if (handle) highlightHandles.push(handle);
  } catch {
    // ignore highlight failures
  }
}

function isIqaiRuntimeFeatureLayer(layer) {
  if (!layer?.id?.startsWith('iqai-')) return false;
  if (
    layer.id === 'iqai-search-location'
    || layer.id === 'iqai-search-area'
    || layer.id === 'iqai-map-result'
    || layer.id === 'iqai-features'
  ) {
    return false;
  }
  return layer.type === 'feature';
}

function layerSourceFeatureCount(layer) {
  if (!layer?.source) return 0;
  if (typeof layer.source.length === 'number') return layer.source.length;
  if (typeof layer.source?.items?.length === 'number') return layer.source.items.length;
  return 0;
}

export function getLastClickDiagnostic() {
  return lastClickDiagnostic;
}

export function getWebMapLayerInspect() {
  return webMapLayerInspect;
}

function logClickDiagnostic(diagnostic) {
  lastClickDiagnostic = diagnostic;
  if (typeof window !== 'undefined') {
    window.__IQAI_CLICK_DIAGNOSTIC__ = diagnostic;
  }
}

function collectMapLayers(layerCollection) {
  const layers = [];
  const items = layerCollection?.items || layerCollection || [];
  for (const layer of items) {
    layers.push(layer);
    if (layer.type === 'group' && layer.layers) {
      layers.push(...collectMapLayers(layer.layers));
    }
  }
  return layers;
}

async function inspectLayerEntry(layer, view) {
  const entry = {
    title: layer.title || null,
    id: layer.id || null,
    type: layer.type || null,
    url: layer.url || layer.parsedUrl?.path || null,
    popupEnabled: layer.popupEnabled,
    popupTemplateExists: Boolean(layer.popupTemplate),
    geometryType: layer.geometryType || null,
    visible: layer.visible,
    loaded: layer.loaded
  };
  try {
    if (!layer.loaded) await layer.load();
    entry.loaded = true;
    entry.popupEnabled = layer.popupEnabled;
    entry.popupTemplateExists = Boolean(layer.popupTemplate);
    if (layer.capabilities?.operations) {
      entry.queryable = layer.capabilities.operations.supportsQuery ?? null;
    }
    if (view && layer.type === 'feature') {
      try {
        const layerView = await view.whenLayerView(layer);
        entry.layerViewExists = Boolean(layerView);
      } catch (error) {
        entry.layerViewExists = false;
        entry.layerViewError = String(error?.message || error);
      }
    }
  } catch (error) {
    entry.loadError = String(error?.message || error);
  }
  return entry;
}

/**
 * Runtime inspect Montreal 1 WebMap layers (Cameras + one other FeatureLayer).
 */
export async function inspectWebMapFeatureLayers() {
  const webMap = getWebMap();
  const view = getMapView();
  const report = {
    viewPopupEnabled: view?.popupEnabled ?? null,
    viewPopupNull: view?.popup == null,
    cameras: null,
    otherFeatureLayer: null,
    featureLayerTitles: []
  };
  if (!webMap) {
    webMapLayerInspect = report;
    window.__IQAI_LAYER_INSPECT__ = report;
    return report;
  }

  const allLayers = collectMapLayers(webMap.layers);
  report.featureLayerTitles = allLayers
    .filter((layer) => layer.type === 'feature')
    .map((layer) => layer.title || layer.id);

  const camerasLayer = allLayers.find(
    (layer) => /camera/i.test(layer.title || '') || /camera/i.test(layer.id || '')
  );
  const otherFeatureLayer = allLayers.find(
    (layer) => layer.type === 'feature'
      && layer !== camerasLayer
      && !/camera/i.test(layer.title || '')
  );

  if (camerasLayer) {
    report.cameras = await inspectLayerEntry(camerasLayer, view);
    report.cameras.popupSchema = describePopupTemplate(camerasLayer.popupTemplate);
    if (typeof window !== 'undefined') {
      window.__IQAI_CAMERAS_LAYER__ = report.cameras;
    }
  }
  if (otherFeatureLayer) {
    report.otherFeatureLayer = await inspectLayerEntry(otherFeatureLayer, view);
  }

  webMapLayerInspect = report;
  window.__IQAI_LAYER_INSPECT__ = report;
  console.log('[IQAI Feature Picking] WebMap layer inspect', report);
  return report;
}

async function inspectIqaiRuntimeLayer(layer, view) {
  const entry = {
    popupEnabled: layer.popupEnabled,
    popupTemplateExists: Boolean(layer.popupTemplate),
    objectIdField: layer.objectIdField,
    sourceFeatureCount: layerSourceFeatureCount(layer),
    loaded: layer.loaded,
    visible: layer.visible
  };
  if (view) {
    try {
      const layerView = await view.whenLayerView(layer);
      entry.layerViewExists = Boolean(layerView);
    } catch (error) {
      entry.layerViewExists = false;
      entry.layerViewError = String(error?.message || error);
    }
  }
  return entry;
}

export function getIqaiRuntimeLayerInspect() {
  const view = getMapView();
  const inspect = {};
  for (const layer of iqaiResultFeatureLayers) {
    inspect[layer.id] = {
      popupEnabled: layer.popupEnabled,
      popupTemplateExists: Boolean(layer.popupTemplate),
      objectIdField: layer.objectIdField,
      sourceFeatureCount: layerSourceFeatureCount(layer),
      visible: layer.visible,
      loaded: layer.loaded
    };
  }
  return inspect;
}

export function setIqaiResultFeatureLayers(layers = []) {
  iqaiResultFeatureLayers = layers.filter(Boolean);
}

export function getIqaiResultLayerIds() {
  const ids = iqaiResultFeatureLayers.map((layer) => layer.id).filter(Boolean);
  const webMap = getWebMap();
  if (webMap?.findLayerById(RUNTIME_GROUP_ID)) {
    ids.push(RUNTIME_GROUP_ID);
  }
  return [...new Set(ids)];
}

function findSearchAreaCircleGeometry() {
  const webMap = getWebMap();
  const group = webMap?.findLayerById(RUNTIME_GROUP_ID);
  if (!group || group.type !== 'group') return null;
  const searchArea = group.findLayerById('iqai-search-area');
  if (!searchArea) return null;
  const graphics = searchArea.graphics?.items || searchArea.graphics || [];
  for (const graphic of graphics) {
    const geom = graphic?.geometry;
    if (geom && (geom.type === 'polygon' || geom.type === 'extent' || geom.extent)) {
      return geom;
    }
  }
  return null;
}

function snapshotViewState(view) {
  if (!view) return null;
  const extent = view.extent;
  const center = view.center;
  return {
    scale: view.scale,
    zoom: view.zoom,
    extent: extent ? {
      xmin: extent.xmin,
      ymin: extent.ymin,
      xmax: extent.xmax,
      ymax: extent.ymax,
      width: extent.width,
      height: extent.height,
      spatialReference: extent.spatialReference?.wkid ?? extent.spatialReference?.latestWkid
    } : null,
    center: center ? {
      x: center.x,
      y: center.y,
      longitude: center.longitude,
      latitude: center.latitude,
      spatialReference: center.spatialReference?.wkid ?? center.spatialReference?.latestWkid
    } : null,
    spatialReference: view.spatialReference?.wkid ?? view.spatialReference?.latestWkid
  };
}

async function projectExtentToView(extent, view, projectionModule) {
  if (!extent || !view?.spatialReference) return extent;
  const viewWkid = view.spatialReference.wkid ?? view.spatialReference.latestWkid;
  const extentWkid = extent.spatialReference?.wkid ?? extent.spatialReference?.latestWkid;
  if (!extentWkid || extentWkid === viewWkid) {
    return extent;
  }
  if (!projectionModule.isLoaded()) {
    await projectionModule.load();
  }
  return projectionModule.project(extent, view.spatialReference);
}

async function resolveScopedFeatureTargetExtent(featureLayers, Extent, geometryEngine) {
  const extents = [];
  let totalFeatures = 0;
  const featureCounts = {};

  for (const layer of featureLayers) {
    if (!layer.loaded) await layer.load();

    let count = 0;
    let extent = null;

    if (layer.queryExtent) {
      const queryResult = await layer.queryExtent();
      count = queryResult?.count ?? 0;
      extent = queryResult?.extent || null;
    }

    if (!extent || count === 0) {
      const sourceItems = layer.source;
      const points = [];
      const iterable = sourceItems?.items || sourceItems || [];
      for (const graphic of iterable) {
        const geom = graphic?.geometry;
        if (!geom) continue;
        if (geom.longitude != null && geom.latitude != null) {
          points.push([geom.longitude, geom.latitude]);
        } else if (geom.x != null && geom.y != null) {
          points.push([geom.x, geom.y]);
        } else if (geom.extent) {
          extents.push(geom.extent);
        }
      }
      count = points.length || layerSourceFeatureCount(layer);
      if (points.length) {
        const extentObj = extentFromPoints(points);
        if (extentObj) extent = new Extent(extentObj);
      }
    }

    featureCounts[layer.id] = count;
    totalFeatures += count;
    if (extent) extents.push(extent);
  }

  if (!extents.length) return null;

  const merged = extents.length === 1 ? extents[0].clone() : geometryEngine.union(extents);
  return {
    extent: merged,
    featureCounts,
    scopedFeatureCount: totalFeatures,
    featureSR: merged.spatialReference?.wkid ?? merged.spatialReference?.latestWkid
  };
}

async function resolveScopedQueryAoiExtent(Point, Circle) {
  const ctx = lastScopedQueryContext;
  let circleGeom = ctx?.searchCircleGeometry || findSearchAreaCircleGeometry();

  if (!circleGeom && ctx?.radiusMeters && ctx.originLon != null && ctx.originLat != null) {
    circleGeom = new Circle({
      center: new Point({
        longitude: ctx.originLon,
        latitude: ctx.originLat,
        spatialReference: { wkid: 4326 }
      }),
      radius: ctx.radiusMeters,
      radiusUnit: 'meters',
      geodesic: true
    });
  }

  if (!circleGeom?.extent) return null;
  return {
    extent: circleGeom.extent,
    aoiSR: circleGeom.extent.spatialReference?.wkid ?? circleGeom.extent.spatialReference?.latestWkid,
    radiusMeters: ctx?.radiusMeters
  };
}

function calculateCenterAndScaleForExtent(projectedExtent, view, fillRatio = 0.825) {
  const center = projectedExtent.center;
  const viewWidth = view.width;
  const viewHeight = view.height;

  if (!viewWidth || !viewHeight || !view.extent || !Number.isFinite(view.scale)) {
    return { center, targetScale: view.scale };
  }

  const currentMapUnitsPerPixel = Math.max(
    view.extent.width / viewWidth,
    view.extent.height / viewHeight
  );

  const targetMapUnitsPerPixel = Math.max(
    projectedExtent.width / (viewWidth * fillRatio),
    projectedExtent.height / (viewHeight * fillRatio)
  );

  const targetScale = view.scale * (targetMapUnitsPerPixel / currentMapUnitsPerPixel);
  return { center, targetScale };
}

function findScopedResultFeatureLayers(layerIds = []) {
  const tracked = iqaiResultFeatureLayers.filter(
    (layer) => layer?.type === 'feature' && isIqaiRuntimeFeatureLayer(layer)
  );
  if (tracked.length) return tracked;

  const webMap = getWebMap();
  if (!webMap) return [];

  const scopedIds = new Set(
    layerIds.filter((id) => id?.startsWith('iqai-webmap-'))
  );
  const allLayers = collectMapLayers(webMap.layers);
  const scoped = allLayers.filter((layer) => isIqaiRuntimeFeatureLayer(layer));
  if (scopedIds.size) {
    return scoped.filter((layer) => scopedIds.has(layer.id));
  }
  return scoped;
}

/**
 * Zoom to extent of scoped IQAI result feature layers (not full WebMap).
 * @param {string[]} [layerIds]
 */
export async function zoomToScopedResults(layerIds = []) {
  const view = getMapView();
  if (!view) throw new Error('MapView is not ready');

  const featureLayers = findScopedResultFeatureLayers(layerIds);
  const scaleBefore = view.scale;

  const diag = {
    receivedLayerIds: [...layerIds],
    resolvedLayerIds: featureLayers.map((layer) => layer.id),
    visibleScopedLayers: featureLayers.filter((layer) => layer.visible).map((layer) => layer.id),
    featureCounts: {},
    scopedFeatureCount: 0,
    extentSource: null,
    featureSR: null,
    aoiSR: null,
    viewSR: view.spatialReference?.wkid ?? view.spatialReference?.latestWkid,
    method: 'center-scale',
    scaleBefore,
    calculatedTargetScale: null,
    scaleAfter: null,
    scaleMatchedTarget: false,
    visibleZoom: 'UNKNOWN',
    goToExecuted: false,
    before: snapshotViewState(view),
    target: null,
    after: null,
    queryRadiusMeters: lastScopedQueryContext?.radiusMeters ?? null
  };

  const [
    Extent,
    geometryEngine,
    projection,
    Point,
    Circle
  ] = await Promise.all([
    importArc('@arcgis/core/geometry/Extent.js'),
    importArc('@arcgis/core/geometry/geometryEngine.js'),
    importArc('@arcgis/core/geometry/projection.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Circle.js')
  ]);

  const ctx = lastScopedQueryContext;
  const useAoi = Boolean(
    ctx?.radiusMeters
    && !ctx?.isLocate
    && (ctx?.action === 'WITHIN' || ctx?.action === 'COUNT' || ctx?.radiusMeters)
  );

  let rawExtent = null;

  if (useAoi) {
    const aoi = await resolveScopedQueryAoiExtent(Point, Circle);
    if (aoi?.extent) {
      rawExtent = aoi.extent;
      diag.extentSource = 'query-aoi';
      diag.aoiSR = aoi.aoiSR;
      diag.queryRadiusMeters = aoi.radiusMeters;
    }
  }

  if (!rawExtent && featureLayers.length) {
    const featureTarget = await resolveScopedFeatureTargetExtent(featureLayers, Extent, geometryEngine);
    if (featureTarget) {
      rawExtent = featureTarget.extent;
      diag.extentSource = 'scoped-features';
      diag.featureCounts = featureTarget.featureCounts;
      diag.scopedFeatureCount = featureTarget.scopedFeatureCount;
      diag.featureSR = featureTarget.featureSR;
    }
  }

  if (!rawExtent) {
    if (typeof window !== 'undefined') window.__IQAI_SCOPED_ZOOM_DIAG__ = diag;
    throw new Error('No scoped result zoom target available.');
  }

  const projected = await projectExtentToView(rawExtent, view, projection);
  const paddedExtent = typeof projected.clone === 'function'
    ? projected.clone().expand(1.05)
    : projected;

  const { center, targetScale } = calculateCenterAndScaleForExtent(paddedExtent, view, 0.825);

  diag.calculatedTargetScale = targetScale;
  diag.target = {
    center: {
      x: center.x,
      y: center.y,
      longitude: center.longitude,
      latitude: center.latitude,
      spatialReference: center.spatialReference?.wkid ?? center.spatialReference?.latestWkid
    },
    scale: targetScale,
    extentWidth: paddedExtent.width,
    extentHeight: paddedExtent.height,
    spatialReference: paddedExtent.spatialReference?.wkid ?? paddedExtent.spatialReference?.latestWkid
  };

  await view.goTo({ center, scale: targetScale }, { animate: false });
  await view.when();

  diag.goToExecuted = true;
  diag.scaleAfter = view.scale;
  diag.after = snapshotViewState(view);

  if (Number.isFinite(targetScale) && Number.isFinite(diag.scaleAfter)) {
    diag.scaleMatchedTarget = Math.abs(diag.scaleAfter - targetScale) / targetScale < 0.10;
    diag.visibleZoom = diag.scaleMatchedTarget ? 'PASS' : 'FAIL';
    if (Number.isFinite(scaleBefore)) {
      diag.actualScaleChanged = diag.scaleAfter < scaleBefore * 0.9;
    }
  }

  if (typeof window !== 'undefined') {
    window.__IQAI_SCOPED_ZOOM_DIAG__ = diag;
    const history = window.__IQAI_SCOPED_ZOOM_HISTORY__ || [];
    history.push({
      queryRadiusMeters: diag.queryRadiusMeters,
      scaleBefore: diag.scaleBefore,
      calculatedTargetScale: diag.calculatedTargetScale,
      scaleAfter: diag.scaleAfter,
      scaleMatchedTarget: diag.scaleMatchedTarget,
      visibleZoom: diag.visibleZoom,
      at: Date.now()
    });
    window.__IQAI_SCOPED_ZOOM_HISTORY__ = history;
  }

  return diag;
}

export function clearIqaiSelection(closePopup = false) {
  clearSelectionHighlight();
  if (closePopup) {
    const view = getMapView();
    if (view?.popup?.visible) {
      view.closePopup();
    }
  }
}

function findGraphicInLayer(layer, datasetId, mapObjectId) {
  if (!layer?.source) return null;
  const items = layer.source.items || layer.source;
  for (const graphic of items) {
    const attrs = graphic?.attributes || {};
    const objectId = attrs.OBJECTID ?? attrs.ObjectID;
    if (Number(objectId) !== Number(mapObjectId)) continue;
    if (datasetId && attrs.datasetId && attrs.datasetId !== datasetId) continue;
    return graphic;
  }
  return null;
}

/**
 * Select a scoped IQAI result feature from the results table.
 * @param {{ layerId?: string, datasetId?: string, mapObjectId: number|string }} identity
 * @returns {Promise<{ ok: boolean, graphic?: object, layer?: object }>}
 */
export async function selectIqaiResultFeature(identity) {
  const view = getMapView();
  if (!view || !identity?.mapObjectId) return { ok: false };

  let layer = null;
  if (identity.layerId) {
    layer = iqaiResultFeatureLayers.find((entry) => entry.id === identity.layerId);
  }
  if (!layer && identity.datasetId) {
    layer = iqaiResultFeatureLayers.find((entry) => {
      const graphic = findGraphicInLayer(entry, identity.datasetId, identity.mapObjectId);
      return Boolean(graphic);
    });
  }
  if (!layer) {
    for (const entry of iqaiResultFeatureLayers) {
      const graphic = findGraphicInLayer(entry, identity.datasetId, identity.mapObjectId);
      if (graphic) {
        layer = entry;
        break;
      }
    }
  }
  if (!layer) return { ok: false };

  let graphic = findGraphicInLayer(layer, identity.datasetId, identity.mapObjectId);
  if (!graphic && layer.url && identity.mapObjectId) {
    try {
      const query = layer.createQuery();
      const oidField = layer.objectIdField || 'OBJECTID';
      query.where = `${oidField} = ${Number(identity.mapObjectId)}`;
      query.outFields = ['*'];
      query.returnGeometry = true;
      if (layer.filter?.geometry) {
        query.geometry = layer.filter.geometry;
        query.distance = layer.filter.distance;
        query.units = layer.filter.units;
        query.spatialRelationship = layer.filter.spatialRelationship || 'intersects';
      }
      const result = await layer.queryFeatures(query);
      graphic = result.features?.[0] || null;
    } catch {
      graphic = null;
    }
  }
  if (!graphic) return { ok: false };

  try {
    if (graphic.geometry) {
      await view.goTo({
        center: graphic.geometry,
        zoom: Math.max(view.zoom || 14, 15)
      }, { duration: 400 });
    }
    await highlightIqaiFeature(view, layer, graphic);
    if (view.popup) {
      view.openPopup({
        features: [graphic],
        location: graphic.geometry
      });
    }
    return { ok: true, graphic, layer };
  } catch {
    return { ok: false };
  }
}

/**
 * Select a runtime WebMap layer feature (live feeds).
 * @param {{ layerId?: string, mapObjectId: number|string }} identity
 */
export async function selectRuntimeLayerFeature(identity) {
  const view = getMapView();
  const webMap = getWebMap();
  if (!view || !webMap || !identity?.layerId || !identity?.mapObjectId) return { ok: false };

  const entry = findLayerByIdRecursive(webMap, identity.layerId);
  const layer = entry?.layer;
  if (!layer || layer.type !== 'feature') return { ok: false };

  if (!layer.loaded) await layer.load();

  let graphic = null;
  try {
    const query = layer.createQuery();
    const oidField = layer.objectIdField || 'OBJECTID';
    query.where = `${oidField} = ${Number(identity.mapObjectId)}`;
    query.outFields = ['*'];
    query.returnGeometry = true;
    const result = await layer.queryFeatures(query);
    graphic = result.features?.[0] || null;
  } catch {
    graphic = null;
  }
  if (!graphic) return { ok: false };

  try {
    if (graphic.geometry) {
      await view.goTo({
        center: graphic.geometry,
        zoom: Math.max(view.zoom || 14, 12)
      }, { duration: 400 });
    }
    if (view.popup) {
      view.openPopup({
        features: [graphic],
        location: graphic.geometry
      });
    }
    return { ok: true, graphic, layer };
  } catch {
    return { ok: false };
  }
}

function radiusKmLabel(radiusMeters) {
  if (!radiusMeters) return null;
  const km = radiusMeters / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}

export function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function extentFromPoints(points, paddingDegrees = 0) {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const [lon, lat] of points) {
    xmin = Math.min(xmin, lon);
    ymin = Math.min(ymin, lat);
    xmax = Math.max(xmax, lon);
    ymax = Math.max(ymax, lat);
  }
  if (!Number.isFinite(xmin)) return null;
  return {
    xmin: xmin - paddingDegrees,
    ymin: ymin - paddingDegrees,
    xmax: xmax + paddingDegrees,
    ymax: ymax + paddingDegrees,
    spatialReference: { wkid: 4326 }
  };
}

async function zoomToQueryResult({
  originLon,
  originLat,
  radiusMeters,
  isLocate,
  points,
  searchCircleGeometry
}) {
  markMapDiagStage('zoomToQueryResult_entered', {
    pointCount: points?.length || 0,
    radiusMeters,
    isLocate
  });
  const view = getMapView();
  if (!view) {
    markMapDiagStage('zoomToQueryResult_no_view');
    return;
  }

  const Extent = await importArc('@arcgis/core/geometry/Extent.js');
  const goToPadding = { top: 48, bottom: 48, left: 48, right: 48 };
  let target = null;

  if (radiusMeters && !isLocate && searchCircleGeometry?.extent) {
    const circleExtent = searchCircleGeometry.extent;
    target = typeof circleExtent.clone === 'function'
      ? circleExtent.clone().expand(1.08)
      : circleExtent;
  } else if (points.length > 0) {
    const extentObj = extentFromPoints(points);
    if (extentObj) {
      target = new Extent(extentObj).expand(1.15);
    }
  }

  if (target) {
    try {
      await view.goTo(target, { duration: 800, padding: goToPadding });
      markMapDiagStage('zoomToQueryResult_goTo_completed');
    } catch (goToError) {
      captureMapCommandFailure('zoomToQueryResult_goTo', goToError, {
        hasTarget: Boolean(target),
        pointCount: points?.length || 0
      });
    }
    return;
  }

  if (isLocate) {
    await zoomTo({ center: [originLon, originLat], zoom: 17 }, { duration: 800 });
    markMapDiagStage('zoomToQueryResult_locate_zoom_completed');
    return;
  }

  await zoomTo({ center: [originLon, originLat], zoom: 14 }, { duration: 800 });
  markMapDiagStage('zoomToQueryResult_center_zoom_completed');
}

function plainSymbolConfig(dataset) {
  if (dataset?.symbol) return dataset.symbol;
  const datasetId = dataset?.datasetId || dataset?.id;
  return getResultSymbol(datasetId);
}

function inheritRendererFromMeta(result) {
  const presentation = result.renderMeta?.sourcePresentation;
  if (!presentation) return result.renderMeta?.inheritedRenderer || null;
  const semanticField = result.renderMeta?.semanticField || result.provenance?.semanticField;
  const semanticValue = result.renderMeta?.semanticValue || result.provenance?.semanticValue;
  return inheritSourceRenderer(presentation, semanticField, semanticValue);
}

/** Plain Esri symbol JSON for FeatureLayer renderer (never pass Accessor instances). */
function markerSymbolJson(dataset) {
  const symbol = plainSymbolConfig(dataset);
  const style = String(symbol.style || 'circle').toLowerCase();
  const allowed = new Set(['circle', 'square', 'cross', 'x', 'diamond', 'triangle', 'path']);
  const markerStyle = allowed.has(style) ? style : 'circle';
  const json = {
    type: 'simple-marker',
    style: markerStyle,
    color: symbol.color,
    size: symbol.size || 10,
    outline: {
      color: symbol.outline?.color || [255, 255, 255, 1],
      width: symbol.outline?.width ?? 2
    }
  };
  if (markerStyle === 'path' && symbol.path) {
    json.path = symbol.path;
    json.size = symbol.size || 14;
  }
  return json;
}

function markerSymbol(SimpleMarkerSymbol, Color, dataset) {
  const symbol = plainSymbolConfig(dataset);
  const style = String(symbol.style || 'circle').toLowerCase();
  const allowed = new Set(['circle', 'square', 'cross', 'x', 'diamond', 'triangle', 'path']);
  const markerStyle = allowed.has(style) ? style : 'circle';
  const color = Array.isArray(symbol.color)
    ? Color.fromArray(symbol.color)
    : symbol.color;
  const outlineColor = symbol.outline?.color
    ? Color.fromArray(symbol.outline.color)
    : Color.fromArray([255, 255, 255, 1]);
  const outlineWidth = symbol.outline?.width ?? 2;
  const markerOptions = {
    style: markerStyle,
    color,
    size: symbol.size || 10,
    outline: { color: outlineColor, width: outlineWidth }
  };
  if (markerStyle === 'path' && symbol.path) {
    markerOptions.path = symbol.path;
    markerOptions.size = symbol.size || 14;
  }
  return new SimpleMarkerSymbol(markerOptions);
}

function featuresForDatasetResult(result, mapResult) {
  if (result.features?.length) return result.features;
  return (mapResult.features || []).filter((feature) => feature.datasetId === result.datasetId);
}

function featureCoordinates(feature) {
  const longitude = Number(feature.longitude ?? feature.LONGITUDE);
  const latitude = Number(feature.latitude ?? feature.LATITUDE);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function buildGroupTitle(mapResult) {
  const action = mapResult.request?.action || mapResult.summary?.action;
  const datasetLabel = mapResult.summary?.dataset || 'Results';
  if (action === 'LOCATE') return 'IQAI — Locate';
  if (action === 'COUNT') {
    const radius = radiusKmLabel(mapResult.summary?.radiusMeters);
    return radius
      ? `IQAI — Count ${datasetLabel} within ${radius} km`
      : `IQAI — Count ${datasetLabel}`;
  }
  if (action === 'NEAREST') {
    return `IQAI — ${mapResult.summary?.limit || ''} nearest ${datasetLabel}`.trim();
  }
  const radius = radiusKmLabel(mapResult.summary?.radiusMeters);
  if (radius) return `IQAI — ${datasetLabel} within ${radius} km`;
  return `IQAI — ${datasetLabel}`;
}

function featureLayerFields() {
  return [
    { name: 'OBJECTID', type: 'oid' },
    { name: 'iqaiType', type: 'string' },
    { name: 'datasetId', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'address', type: 'string' },
    { name: 'distanceMeters', type: 'double', nullable: true },
    { name: 'distanceLabel', type: 'string' },
    { name: 'sourceName', type: 'string' },
    { name: 'authority', type: 'string' },
    { name: 'spatialPrecision', type: 'string' },
    { name: 'stationNumber', type: 'string' },
    { name: 'operationalStatus', type: 'string' },
    { name: 'pdq', type: 'string' },
    { name: 'schoolType', type: 'string' },
    { name: 'facilityType', type: 'string' },
    { name: 'transitMode', type: 'string' }
  ];
}

function featureAttributes(feature, dataset) {
  const attrs = {
    iqaiType: feature.iqaiType || dataset?.iqaiType || 'feature',
    datasetId: feature.datasetId,
    name: feature.name || '—',
    address: feature.address || '—',
    distanceMeters: feature.distanceMeters,
    distanceLabel: feature.distanceLabel || formatDistanceMeters(feature.distanceMeters),
    sourceName: feature.sourceName || dataset?.displayName || '—',
    authority: feature.authority || dataset?.authority || '',
    spatialPrecision: feature.spatialPrecision || 'Deterministic GIS',
    stationNumber: feature.stationNumber || '',
    operationalStatus: feature.operationalStatus || '',
    pdq: feature.pdq || '',
    schoolType: feature.schoolType || '',
    facilityType: feature.facilityType || '',
    transitMode: feature.transitMode || ''
  };
  return attrs;
}

function isScopedGraphicsResult(result) {
  return result?.sourceType === 'CURRENT_WEBMAP'
    || result?.renderMeta?.sourceType === 'WEBMAP_LAYER'
    || result?.sourceType === 'TRUSTED_EXTERNAL'
    || result?.renderMeta?.sourceType === 'TRUSTED_EXTERNAL';
}

function isWebMapLayerResult(result) {
  return isScopedGraphicsResult(result);
}

function arcgisFieldType(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('double') || normalized.includes('float')) return 'double';
  if (normalized.includes('int') || normalized === 'oid') return 'integer';
  if (normalized.includes('date')) return 'date';
  return 'string';
}

function buildWebMapLayerFields(fieldDefs = []) {
  const fields = [{ name: 'OBJECTID', type: 'oid' }];
  const seen = new Set(['OBJECTID']);
  for (const field of fieldDefs) {
    if (!field?.name || seen.has(field.name)) continue;
    seen.add(field.name);
    fields.push({
      name: field.name,
      type: arcgisFieldType(field.type),
      alias: field.alias || field.name,
      nullable: true
    });
  }
  if (!seen.has('distanceLabel')) {
    fields.push({ name: 'distanceLabel', type: 'string', alias: 'Distance', nullable: true });
  }
  return fields;
}

function buildWebMapPopupTemplate(result) {
  const displayName = result.displayName || 'Feature';
  const popupTemplate = result.renderMeta?.popupTemplate;
  if (popupTemplate) {
    return {
      title: popupTemplate.title || displayName,
      outFields: popupTemplate.outFields || ['*'],
      content: popupTemplate.content || undefined,
      fieldInfos: popupTemplate.fieldInfos || undefined
    };
  }

  const fieldInfos = (result.renderMeta?.fields || [])
    .filter((field) => field?.name)
    .slice(0, 12)
    .map((field) => ({
      fieldName: field.name,
      label: field.alias || field.name
    }));

  if (fieldInfos.length) {
    fieldInfos.push({ fieldName: 'distanceLabel', label: 'Distance' });
    return {
      title: displayName,
      outFields: ['*'],
      content: [{ type: 'fields', fieldInfos }]
    };
  }

  return buildPopupTemplate(result.datasetId, displayName);
}

async function buildWebMapScopedFeatureLayer(result, modules) {
  markMapDiagStage('buildWebMapScopedFeatureLayer_entered', {
    datasetId: result.datasetId,
    conceptId: result.conceptId,
    sourceType: result.sourceType,
    featureCount: result.features?.length || 0
  });

  const { FeatureLayer, Graphic } = modules;

  const geometryInference = inferScopedGeometryTypeFromFeatures(result.features || []);
  if (geometryInference.mixed) {
    recordPresentationFidelity({
      sourceLayerTitle: result.displayName,
      scopedLayerId: null,
      mode: 'IQAI_OVERRIDE',
      geometry: 'CHANGED',
      renderer: 'FALLBACK',
      popup: 'NONE',
      labels: 'UNSUPPORTED',
      error: 'mixed_geometry_types'
    });
    return null;
  }

  const inferredType = geometryInference.geometryType
    || normalizeLayerGeometryType(result.webmapLayer?.geometryType)
    || 'point';
  const catalogGeometryType = normalizeLayerGeometryType(result.webmapLayer?.geometryType);

  const graphics = [];
  let fallbackObjectId = 1;

  try {
    const { fromJSON } = await importArc('@arcgis/core/geometry/support/jsonUtils.js');

    for (const feature of result.features || []) {
      const raw = feature.rawAttributes || {};
      const objectId = feature.objectId ?? raw.OBJECTID ?? raw.ObjectID ?? raw.FID ?? fallbackObjectId;
      fallbackObjectId += 1;

      let geometry = null;
      if (feature.geometry) {
        try {
          geometry = fromJSON(feature.geometry);
        } catch {
          geometry = null;
        }
      }
      if (!geometry) {
        const coords = featureCoordinates(feature);
        if (!coords) continue;
        geometry = fromJSON({
          type: 'point',
          x: coords.longitude,
          y: coords.latitude,
          spatialReference: { wkid: 4326 }
        });
      }
      if (!geometry) continue;

      graphics.push(new Graphic({
        geometry,
        attributes: {
          ...raw,
          OBJECTID: objectId,
          datasetId: result.datasetId,
          conceptId: result.conceptId || null,
          iqaiType: result.iqaiType || 'webmap_feature',
          distanceLabel: feature.distanceLabel || formatDistanceMeters(feature.distanceMeters),
          authority: feature.authority || result.authority,
          sourceName: result.displayName
        }
      }));
    }

    markMapDiagStage('graphics_built', {
      graphicsCount: graphics.length,
      inputFeatureCount: result.features?.length || 0,
      geometryType: inferredType,
      firstFeature: snapshotFirstFeature({ datasetResults: [result] })
    });

    if (!graphics.length) return null;

    const layerKey = result.conceptId
      || result.webmapLayer?.catalogId
      || String(result.datasetId || 'scoped').replace(/[^a-zA-Z0-9_-]/g, '-');
    const layerIdPrefix = result.sourceType === 'TRUSTED_EXTERNAL' ? 'iqai-concept' : 'iqai-webmap';
    const layerId = `${layerIdPrefix}-${layerKey}`;
    const layerTitle = `IQAI — ${result.displayName} (scoped)`;

    const sourceLayer = await resolveLiveWebMapSourceLayer(result);
    const presentation = sourceLayer ? getArcgisPresentation(sourceLayer) : null;

    const fallbackRenderer = {
      type: 'simple',
      symbol: markerSymbolJson({
        displayName: result.displayName,
        iqaiType: result.iqaiType || 'webmap_feature',
        datasetId: result.conceptId || result.datasetId,
        symbol: result.renderMeta?.symbol || null
      })
    };

    const inheritedRenderer = result.renderMeta?.inheritedRenderer
      || inheritRendererFromMeta(result);
    const rendererResolution = resolveScopedRenderer(
      presentation,
      sanitizeRendererForScopedLayer(inheritedRenderer) || fallbackRenderer
    );

    const serializedPopup = result.renderMeta?.popupTemplate || null;
    const genericPopup = buildWebMapPopupTemplate(result);
    const popupResolution = resolveScopedPopup(presentation, serializedPopup, genericPopup);

    const labelsStatus = presentation?.labelingInfo?.length ? 'PRESERVED' : 'NONE';
    const geometryStatus = catalogGeometryType && inferredType === catalogGeometryType
      ? 'PRESERVED'
      : 'CHANGED';

    recordPresentationFidelity({
      sourceLayerTitle: presentation?.sourceLayerTitle || sourceLayer?.title || result.displayName,
      scopedLayerId: layerId,
      mode: rendererResolution.mode || 'INHERITED',
      geometry: geometryStatus,
      renderer: rendererResolution.rendererStatus,
      popup: popupResolution.popupStatus,
      labels: labelsStatus
    });

    const layerConfig = {
      id: layerId,
      title: layerTitle,
      source: graphics,
      objectIdField: 'OBJECTID',
      fields: buildWebMapLayerFields(result.renderMeta?.fields || []),
      geometryType: inferredType,
      spatialReference: { wkid: 4326 },
      renderer: rendererResolution.renderer,
      popupEnabled: true,
      popupTemplate: popupResolution.popupTemplate,
      listMode: 'show',
      visible: true
    };

    if (presentation?.opacity != null) layerConfig.opacity = presentation.opacity;
    if (presentation?.minScale != null) layerConfig.minScale = presentation.minScale;
    if (presentation?.maxScale != null) layerConfig.maxScale = presentation.maxScale;
    if (presentation?.labelingInfo) layerConfig.labelingInfo = presentation.labelingInfo;
    if (presentation?.labelsVisible != null) layerConfig.labelsVisible = presentation.labelsVisible;

    const layer = new FeatureLayer(layerConfig);

    markMapDiagStage('featureLayer_constructed', {
      layerId,
      layerTitle,
      graphicsCount: graphics.length,
      geometryType: inferredType
    });

    markMapDiagStage('featureLayer_load_started', { layerId });
    await layer.load();
    markMapDiagStage('featureLayer_load_completed', {
      layerId,
      loadStatus: layer.loadStatus,
      sourceFeatureCount: graphics.length
    });
    return layer;
  } catch (error) {
    throw wrapMapCommandError(error.iqaiMapStage || getCurrentMapDiagStage() || 'buildWebMapScopedFeatureLayer', error, {
      layerId: result.conceptId ? `iqai-concept-${result.conceptId}` : result.datasetId,
      layerTitle: result.displayName,
      featureCount: result.features?.length || 0,
      graphicsCount: graphics.length,
      firstFeature: snapshotFirstFeature({ datasetResults: [result] })
    });
  }
}

function buildPopupTemplate(datasetId, displayName) {
  const outFields = ['*'];
  if (datasetId === 'POLICE_STATIONS') {
    return {
      title: displayName || 'Police station',
      outFields,
      content: [{
        type: 'fields',
        fieldInfos: [
          { fieldName: 'pdq', label: 'PDQ' },
          { fieldName: 'stationNumber', label: 'Station' },
          { fieldName: 'address', label: 'Address' },
          { fieldName: 'distanceLabel', label: 'Distance' },
          { fieldName: 'sourceName', label: 'Source' }
        ]
      }]
    };
  }
  if (datasetId === 'FIRE_STATIONS') {
    return {
      title: displayName || 'Fire station',
      outFields,
      content: [{
        type: 'fields',
        fieldInfos: [
          { fieldName: 'stationNumber', label: 'Station' },
          { fieldName: 'address', label: 'Address' },
          { fieldName: 'distanceLabel', label: 'Distance' },
          { fieldName: 'operationalStatus', label: 'Operational status' },
          { fieldName: 'sourceName', label: 'Source' }
        ]
      }]
    };
  }
  if (datasetId === 'HOSPITALS') {
    return {
      title: displayName || 'Hospital',
      outFields,
      content: [{
        type: 'fields',
        fieldInfos: [
          { fieldName: 'name', label: 'Name' },
          { fieldName: 'facilityType', label: 'Facility type' },
          { fieldName: 'address', label: 'Address' },
          { fieldName: 'distanceLabel', label: 'Distance' },
          { fieldName: 'sourceName', label: 'Source' }
        ]
      }]
    };
  }
  return {
    title: displayName || 'Feature',
    outFields,
    content: [{
      type: 'fields',
      fieldInfos: [
        { fieldName: 'name', label: 'Name' },
        { fieldName: 'address', label: 'Address' },
        { fieldName: 'distanceLabel', label: 'Distance' },
        { fieldName: 'sourceName', label: 'Source' }
      ]
    }]
  };
}

/**
 * fetchPopupFeatures + openPopup click path; IQAI Details follows popup selection.
 * @param {(attributes: object, graphic: object) => void} onFeatureSelect
 * @param {() => void} onClearSelection
 */
export async function wireFeaturePicking(onFeatureSelect, onClearSelection) {
  const view = getMapView();
  if (!view) return;

  for (const handle of popupWatchHandles) {
    handle.remove();
  }
  popupWatchHandles = [];
  if (clickHandle) {
    clickHandle.remove();
    clickHandle = null;
  }

  view.popupEnabled = true;

  const reactiveUtils = await importArc('@arcgis/core/core/reactiveUtils.js');

  popupWatchHandles.push(
    reactiveUtils.watch(
      () => {
        const popup = view.popup;
        if (!popup?.visible) return null;
        return popup.selectedFeature ?? popup.features?.[0] ?? null;
      },
      async (graphic) => {
        if (!graphic?.attributes) return;
        const layer = graphic.layer || graphic.sourceLayer;
        if (isIqaiRuntimeFeatureLayer(layer) || layer?.id === SPVM_LAYER_ID) {
          await highlightIqaiFeature(view, layer, graphic);
        }
        onFeatureSelect(graphic.attributes, graphic);
      }
    ),
    reactiveUtils.watch(
      () => view.popup?.visible,
      (visible) => {
        if (!visible) {
          clearSelectionHighlight();
          onClearSelection();
        }
      }
    )
  );

  clickHandle = view.on('click', async (event) => {
    const diagnostic = {
      mapClickReceived: true,
      screenX: event.x,
      screenY: event.y,
      mapLongitude: null,
      mapLatitude: null,
      mapPoint: event.mapPoint ? {
        x: event.mapPoint.x,
        y: event.mapPoint.y,
        spatialReference: event.mapPoint.spatialReference?.wkid ?? null
      } : null,
      popupFeatureCount: 0,
      features: [],
      openPopupCalled: false,
      popupVisible: false,
      viewPopupEnabled: view.popupEnabled,
      popupExists: view.popup != null,
      popupFeaturesCount: view.popup?.features?.length ?? 0,
      selectedFeature: null,
      message: null,
      error: null
    };

    if (event.mapPoint) {
      if (Number.isFinite(event.mapPoint.longitude) && Number.isFinite(event.mapPoint.latitude)) {
        diagnostic.mapLongitude = event.mapPoint.longitude;
        diagnostic.mapLatitude = event.mapPoint.latitude;
      } else {
        try {
          const webMercatorUtils = await importArc(
            '@arcgis/core/geometry/support/webMercatorUtils.js'
          );
          const geo = webMercatorUtils.webMercatorToGeographic(event.mapPoint);
          diagnostic.mapLongitude = geo?.longitude ?? null;
          diagnostic.mapLatitude = geo?.latitude ?? null;
        } catch {
          diagnostic.mapLongitude = event.mapPoint.x ?? null;
          diagnostic.mapLatitude = event.mapPoint.y ?? null;
        }
      }
    }

    try {
      if (!view.fetchPopupFeatures) {
        diagnostic.message = 'fetchPopupFeatures unavailable on MapView';
        logClickDiagnostic(diagnostic);
        return;
      }

      const features = [];
      for await (const feature of view.fetchPopupFeatures(
        { x: event.x, y: event.y },
        { pointerType: event.pointerType }
      )) {
        const layer = feature.layer || feature.sourceLayer;
        const objectId = feature.attributes?.OBJECTID ?? feature.attributes?.ObjectID ?? null;
        features.push(feature);
        diagnostic.features.push({
          layerTitle: layer?.title || layer?.id || 'unknown',
          layerId: layer?.id || null,
          layerType: layer?.type || null,
          objectId,
          popupEnabled: layer?.popupEnabled ?? null,
          popupTemplateExists: Boolean(layer?.popupTemplate),
          datasetId: feature.attributes?.datasetId || null,
          origin: isIqaiRuntimeFeatureLayer(layer) ? 'IQAI' : 'Montreal 1'
        });
      }

      diagnostic.popupFeatureCount = features.length;

      if (!features.length) {
        diagnostic.message = 'NO POPUP FEATURES RETURNED';
        clearSelectionHighlight();
        diagnostic.popupFeaturesCount = view.popup?.features?.length ?? 0;
        diagnostic.selectedFeature = formatSelectedFeatureLabel(view.popup?.selectedFeature);
        logClickDiagnostic(diagnostic);
        return;
      }

      await view.openPopup({
        features,
        location: event.mapPoint
      });
      diagnostic.openPopupCalled = true;
      diagnostic.popupVisible = Boolean(view.popup?.visible);
      diagnostic.popupFeaturesCount = view.popup?.features?.length ?? features.length;
      diagnostic.selectedFeature = formatSelectedFeatureLabel(view.popup?.selectedFeature);
    } catch (error) {
      diagnostic.error = String(error?.message || error);
      console.error('[IQAI Feature Picking] click handler error', error);
    }

    diagnostic.viewPopupEnabled = view.popupEnabled;
    diagnostic.popupExists = view.popup != null;
    if (!diagnostic.selectedFeature) {
      diagnostic.selectedFeature = formatSelectedFeatureLabel(view.popup?.selectedFeature);
    }
    if (!diagnostic.popupFeaturesCount) {
      diagnostic.popupFeaturesCount = view.popup?.features?.length ?? 0;
    }

    logClickDiagnostic(diagnostic);
  });
}

function formatSelectedFeatureLabel(graphic) {
  if (!graphic?.attributes) return '—';
  const objectId = graphic.attributes.OBJECTID ?? graphic.attributes.ObjectID;
  const datasetId = graphic.attributes.datasetId;
  const layer = graphic.layer || graphic.sourceLayer;
  const layerTitle = layer?.title || layer?.id || 'feature';
  if (datasetId) return `${layerTitle} · ${datasetId} · OBJECTID ${objectId ?? '—'}`;
  return `${layerTitle} · OBJECTID ${objectId ?? '—'}`;
}

/** @deprecated Use wireFeaturePicking */
export async function wirePopupFeatureSync(onFeatureSelect, onClearSelection) {
  return wireFeaturePicking(onFeatureSelect, onClearSelection);
}

/**
 * @param {object} mapResult
 */
export async function renderMapResultOnRuntime(mapResult) {
  if (!mapResult?.supported) return;

  if (mapResult.action === 'CLEAR') {
    await clearRuntimeLayers();
    setIqaiResultFeatureLayers([]);
    clearIqaiSelection(true);
    return;
  }

  try {
    markMapDiagStage('renderMapResultOnRuntime_entered', {
      action: mapResult.action,
      datasetResultCount: mapResult.datasetResults?.length,
      matchedFeatures: mapResult.summary?.matchedFeatures
    });

    await clearRuntimeLayers();
    setIqaiResultFeatureLayers([]);
    clearIqaiSelection(true);
    clearPresentationFidelityRecords();
    markMapDiagStage('clearRuntimeLayers_completed');

    const [
      GroupLayer,
      GraphicsLayer,
      FeatureLayer,
      Graphic,
      Point,
      Circle,
      SimpleMarkerSymbol,
      SimpleFillSymbol,
      Color
    ] = await Promise.all([
      importArc('@arcgis/core/layers/GroupLayer.js'),
      importArc('@arcgis/core/layers/GraphicsLayer.js'),
      importArc('@arcgis/core/layers/FeatureLayer.js'),
      importArc('@arcgis/core/Graphic.js'),
      importArc('@arcgis/core/geometry/Point.js'),
      importArc('@arcgis/core/geometry/Circle.js'),
      importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
      importArc('@arcgis/core/symbols/SimpleFillSymbol.js'),
      importArc('@arcgis/core/Color.js')
    ]);

    const originLon = mapResult.origin.longitude;
    const originLat = mapResult.origin.latitude;
    const radiusMeters = mapResult.summary?.radiusMeters;
    const radiusKm = radiusKmLabel(radiusMeters);
    const isLocate = mapResult.request?.action === 'LOCATE' || mapResult.summary?.displayMode === 'locate';
    const isCategoryCounts = mapResult.action === 'CATEGORY_COUNTS_WITHIN'
      || mapResult.summary?.displayMode === 'category_counts';

    const searchLocationLayer = new GraphicsLayer({
      id: 'iqai-search-location',
      title: 'Search Location',
      listMode: 'hide',
      popupEnabled: false
    });

    const searchAreaLayer = new GraphicsLayer({
      id: 'iqai-search-area',
      title: 'Search Area',
      listMode: 'hide',
      popupEnabled: false
    });

    const originPoint = new Point({
      longitude: originLon,
      latitude: originLat
    });

    searchLocationLayer.add(new Graphic({
      geometry: originPoint,
      symbol: new SimpleMarkerSymbol({
        style: 'circle',
        color: [0, 112, 255, 0.9],
        size: isLocate ? 12 : 10,
        outline: { color: [255, 255, 255, 1], width: 1.5 }
      }),
      attributes: {
        iqaiType: 'search_location',
        matchedAddress: mapResult.origin.matchedAddress || 'Query location'
      }
    }));

    let searchCircleGeometry = null;

    if (radiusMeters && !isLocate) {
      const radiusCircle = new Circle({
        center: originPoint,
        radius: radiusMeters,
        radiusUnit: 'meters',
        geodesic: true
      });
      searchCircleGeometry = radiusCircle;
      lastScopedQueryContext = {
        action: mapResult.request?.action || mapResult.summary?.action,
        radiusMeters,
        originLon,
        originLat,
        isLocate,
        searchCircleGeometry
      };
      searchAreaLayer.add(new Graphic({
        geometry: radiusCircle,
        symbol: new SimpleFillSymbol({
          color: [0, 112, 255, 0.08],
          outline: { color: [0, 112, 255, 0.55], width: 1.5 }
        }),
        attributes: {
          iqaiType: 'search_area',
          radiusMeters,
          radiusLabel: `${radiusKm} km`
        }
      }));
    } else {
      lastScopedQueryContext = {
        action: mapResult.request?.action || mapResult.summary?.action,
        radiusMeters: radiusMeters || null,
        originLon,
        originLat,
        isLocate,
        searchCircleGeometry: null
      };
    }

    const featureLayers = [];
    const datasetResults = mapResult.datasetResults || [];

    if (datasetResults.length && !isCategoryCounts) {
      const layerModules = {
        FeatureLayer,
        Graphic,
        Point,
        SimpleMarkerSymbol,
        Color
      };

      for (const result of datasetResults) {
        if (isWebMapLayerResult(result)) {
          const webmapLayer = await buildWebMapScopedFeatureLayer(result, layerModules);
          if (webmapLayer) featureLayers.push(webmapLayer);
          continue;
        }

        const dataset = {
          datasetId: result.datasetId,
          displayName: result.displayName,
          iqaiType: result.iqaiType,
          detailFields: result.renderMeta?.detailFields
        };
        const layerFeatures = featuresForDatasetResult(result, mapResult);
        const graphics = [];
        let objectId = 1;
        for (const feature of layerFeatures) {
          const coords = featureCoordinates(feature);
          if (!coords) continue;
          const attrs = featureAttributes(feature, dataset);
          graphics.push(new Graphic({
            geometry: new Point({
              longitude: coords.longitude,
              latitude: coords.latitude,
              spatialReference: { wkid: 4326 }
            }),
            attributes: {
              OBJECTID: objectId,
              ...attrs
            }
          }));
          objectId += 1;
        }

        if (!graphics.length) continue;

        markMapDiagStage('featureLayer_constructed', {
          layerId: `iqai-${result.datasetId.toLowerCase()}`,
          graphicsCount: graphics.length
        });
        const layer = new FeatureLayer({
          id: `iqai-${result.datasetId.toLowerCase()}`,
          title: dataset?.displayName || result.displayName,
          source: graphics,
          objectIdField: 'OBJECTID',
          fields: featureLayerFields(),
          geometryType: 'point',
          spatialReference: { wkid: 4326 },
          renderer: {
            type: 'simple',
            symbol: markerSymbolJson(dataset)
          },
          popupEnabled: true,
          popupTemplate: buildPopupTemplate(result.datasetId, dataset?.displayName || result.displayName),
          listMode: 'show',
          visible: true
        });
        markMapDiagStage('featureLayer_load_started', { layerId: layer.id });
        await layer.load();
        markMapDiagStage('featureLayer_load_completed', {
          layerId: layer.id,
          loadStatus: layer.loadStatus
        });
        featureLayers.push(layer);
      }
    } else if (mapResult.features?.length && !isCategoryCounts) {
      const layer = new GraphicsLayer({
        id: 'iqai-features',
        title: mapResult.summary?.dataset || 'Results',
        listMode: 'show',
        popupEnabled: false
      });
      for (const feature of mapResult.features) {
        const coords = featureCoordinates(feature);
        if (!coords) continue;
        const dataset = {
          displayName: mapResult.summary?.dataset,
          iqaiType: feature.iqaiType,
          symbol: null,
          detailFields: []
        };
        layer.add(new Graphic({
          geometry: new Point({
            longitude: coords.longitude,
            latitude: coords.latitude,
            spatialReference: { wkid: 4326 }
          }),
          symbol: markerSymbol(SimpleMarkerSymbol, Color, dataset),
          attributes: featureAttributes(feature, dataset)
        }));
      }
      featureLayers.push(layer);
    }

    const overlayLayers = [];
    if (radiusMeters && !isLocate) overlayLayers.push(searchAreaLayer);
    overlayLayers.push(searchLocationLayer);

    const childLayers = [...featureLayers, ...overlayLayers];

    const existingGroup = getWebMap()?.findLayerById(RUNTIME_GROUP_ID);
    markMapDiagStage('runtime_group_created', {
      groupId: RUNTIME_GROUP_ID,
      existingGroupFound: Boolean(existingGroup),
      childLayerCount: childLayers.length,
      featureLayerIds: featureLayers.map((layer) => layer.id)
    });

    const group = new GroupLayer({
      id: RUNTIME_GROUP_ID,
      title: buildGroupTitle(mapResult),
      listMode: 'show',
      layers: childLayers
    });

    await addRuntimeLayer(group);
    markMapDiagStage('webMap_add_completed', {
      groupId: RUNTIME_GROUP_ID,
      groupTitle: group.title,
      childLayerCount: childLayers.length
    });
    setIqaiResultFeatureLayers(featureLayers);

    const view = getMapView();
    if (view) {
      for (const layer of featureLayers) {
        try {
          await view.whenLayerView(layer);
        } catch {
          // layer view may still initialize asynchronously
        }
      }
      const iqaiInspect = {};
      for (const layer of featureLayers) {
        iqaiInspect[layer.id] = await inspectIqaiRuntimeLayer(layer, view);
      }
      window.__IQAI_RUNTIME_LAYER_INSPECT__ = iqaiInspect;
      console.log('[IQAI Feature Picking] Runtime IQAI layers', iqaiInspect);
    }

    const points = [[originLon, originLat]];
    if (datasetResults.length) {
      for (const result of datasetResults) {
        for (const feature of featuresForDatasetResult(result, mapResult)) {
          const coords = featureCoordinates(feature);
          if (coords) points.push([coords.longitude, coords.latitude]);
        }
      }
    } else {
      for (const feature of mapResult.features || []) {
        const coords = featureCoordinates(feature);
        if (coords) points.push([coords.longitude, coords.latitude]);
      }
    }

    await zoomToQueryResult({
      originLon,
      originLat,
      radiusMeters,
      isLocate,
      points,
      searchCircleGeometry
    });
    markMapDiagStage('renderMapResultOnRuntime_success', {
      featureLayerCount: featureLayers.length,
      matchedFeatures: mapResult.summary?.matchedFeatures
    });
  } catch (error) {
    if (error?.iqaiMapDiagnostic) throw error;
    throw wrapMapCommandError(
      error?.iqaiMapStage || getCurrentMapDiagStage() || 'renderMapResultOnRuntime',
      error,
      {
        firstFeature: snapshotFirstFeature(mapResult),
        featureCount: mapResult.summary?.matchedFeatures,
        layerId: mapResult.datasetResults?.[0]?.conceptId
          ? `iqai-concept-${mapResult.datasetResults[0].conceptId}`
          : mapResult.datasetResults?.[0]?.datasetId
      }
    );
  }
}

export async function clearMapResultsOnRuntime() {
  await clearRuntimeLayers();
  setIqaiResultFeatureLayers([]);
  lastScopedQueryContext = null;
  clearIqaiSelection(true);
}
