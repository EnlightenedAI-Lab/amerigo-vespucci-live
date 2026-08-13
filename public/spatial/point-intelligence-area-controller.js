/**
 * Minimal IQAI Sketch interaction for Point Intelligence Area Acquisition.
 * Dedicated SketchViewModel — not the map Distance/Area measurement widgets.
 */
import {
  getMapView,
  importArc
} from './spatial-arcgis-runtime.js';
import { toGeoJsonPolygon } from './point-intelligence-aoi-geometry.js';
import {
  buildAcquisitionMeshSymbol,
  clearAcquisitionMesh,
  ensureAcquisitionLayers,
  getCurrentAoiPolygon,
  hideDistanceConnector,
  renderAcquisitionMesh
} from './point-intelligence-aoi-layer.js';
import {
  resetPointIntelligenceAcquisitionResults,
  runPointIntelligenceAreaQuery,
  setPointIntelligenceAcquisitionMode
} from './point-intelligence-service.js';
import { clearPointIntelligenceQueryPresentation } from './point-intelligence-layer.js';

let sketchViewModel = null;
let sketchLayer = null;
let createHandle = null;
let drawTool = 'polygon';
let sketchActive = false;
let lastAoiPolygon = null;

function bindTestHook() {
  if (typeof window === 'undefined') return;
  window.__IQAI_PI_AREA__ = {
    acquirePolygon,
    startDraw,
    redraw,
    clearAcquisition,
    getActiveAoi: () => lastAoiPolygon || getCurrentAoiPolygon(),
    isSketchActive: isPointIntelligenceAreaSketchActive,
    setDrawTool,
    getDrawTool: () => drawTool
  };
}

async function ensureSketch() {
  const view = getMapView();
  if (!view) return null;
  await ensureAcquisitionLayers();
  if (sketchViewModel) return sketchViewModel;

  const [GraphicsLayer, SketchViewModel, SimpleFillSymbol] = await Promise.all([
    importArc('@arcgis/core/layers/GraphicsLayer.js'),
    importArc('@arcgis/core/widgets/Sketch/SketchViewModel.js'),
    importArc('@arcgis/core/symbols/SimpleFillSymbol.js')
  ]);

  sketchLayer = view.map.findLayerById('iqai-point-intel-sketch') || new GraphicsLayer({
    id: 'iqai-point-intel-sketch',
    title: 'Point Intelligence sketch',
    listMode: 'hide',
    popupEnabled: false
  });
  if (!view.map.findLayerById('iqai-point-intel-sketch')) {
    view.map.add(sketchLayer);
  }

  sketchViewModel = new SketchViewModel({
    view,
    layer: sketchLayer,
    polygonSymbol: new SimpleFillSymbol(buildAcquisitionMeshSymbol()),
    updateOnGraphicClick: false,
    defaultCreateOptions: { mode: 'click', hasZ: false },
    defaultUpdateOptions: {
      tool: 'reshape',
      enableRotation: false,
      enableScaling: false,
      multipleSelectionEnabled: false,
      toggleToolOnClick: false
    }
  });

  createHandle?.remove?.();
  createHandle = sketchViewModel.on('create', (event) => {
    if (event.state === 'start' || event.state === 'active') {
      sketchActive = true;
    }
    if (event.state === 'cancel') {
      sketchActive = false;
    }
    if (event.state === 'complete') {
      sketchActive = false;
      void onSketchComplete(event.graphic);
    }
  });

  bindTestHook();
  return sketchViewModel;
}

async function graphicToGeoJsonPolygon(graphic) {
  if (!graphic?.geometry) return null;
  let geometry = graphic.geometry;
  if (geometry.spatialReference?.isWebMercator || geometry.spatialReference?.wkid === 3857) {
    const webMercatorUtils = await importArc('@arcgis/core/geometry/support/webMercatorUtils.js');
    geometry = webMercatorUtils.webMercatorToGeographic(geometry);
  }
  const rings = (geometry.rings || []).map((ring) => ring.map((pt) => [pt[0], pt[1]]));
  return toGeoJsonPolygon(rings);
}

async function onSketchComplete(graphic) {
  const polygon = await graphicToGeoJsonPolygon(graphic);
  sketchLayer?.removeAll?.();
  if (!polygon) return null;
  return acquirePolygon(polygon);
}

export function isPointIntelligenceAreaSketchActive() {
  return sketchActive || sketchViewModel?.state === 'active';
}

export function setDrawTool(tool) {
  drawTool = tool === 'rectangle' ? 'rectangle' : 'polygon';
  return drawTool;
}

export async function startDraw(tool = drawTool) {
  setPointIntelligenceAcquisitionMode('AREA');
  const svm = await ensureSketch();
  if (!svm) return false;
  drawTool = tool === 'rectangle' ? 'rectangle' : 'polygon';
  sketchActive = true;
  try {
    svm.cancel();
  } catch {
    // ignore idle cancel
  }
  sketchLayer?.removeAll?.();
  svm.create(drawTool);
  return true;
}

export async function redraw() {
  resetPointIntelligenceAcquisitionResults();
  await clearPointIntelligenceQueryPresentation();
  await clearAcquisitionMesh();
  lastAoiPolygon = null;
  return startDraw(drawTool);
}

export async function clearAcquisition() {
  sketchActive = false;
  try {
    sketchViewModel?.cancel();
  } catch {
    // ignore
  }
  sketchLayer?.removeAll?.();
  lastAoiPolygon = null;
  await hideDistanceConnector();
  await clearAcquisitionMesh();
  await clearPointIntelligenceQueryPresentation();
  try {
    const focus = await import('./point-intelligence-focus-controller.js');
    await focus.resetPointIntelligenceMapContext();
  } catch {
    // ignore
  }
  resetPointIntelligenceAcquisitionResults();
  bindTestHook();
}

export async function acquirePolygon(polygon) {
  if (!polygon) return null;
  lastAoiPolygon = polygon;
  setPointIntelligenceAcquisitionMode('AREA');
  await renderAcquisitionMesh(polygon);
  const response = await runPointIntelligenceAreaQuery(polygon, { force: true });
  await fitViewToAcquisition(polygon, response);
  bindTestHook();
  return response;
}

export async function fitViewToAcquisition(polygon, response) {
  const view = getMapView();
  if (!view) return;
  const Polygon = await importArc('@arcgis/core/geometry/Polygon.js');
  const rings = polygon?.coordinates || polygon?.rings;
  if (!rings?.length) return;
  const aoi = new Polygon({ rings, spatialReference: { wkid: 4326 } });
  const extent = aoi.extent?.clone?.();
  if (!extent) return;
  const padDeg = 0.02;
  for (const station of response?.acquisition?.stations || []) {
    if (!Number.isFinite(station.longitude) || !Number.isFinite(station.latitude)) continue;
    if (station.longitude < extent.xmin) extent.xmin = station.longitude;
    if (station.latitude < extent.ymin) extent.ymin = station.latitude;
    if (station.longitude > extent.xmax) extent.xmax = station.longitude;
    if (station.latitude > extent.ymax) extent.ymax = station.latitude;
  }
  extent.xmin -= padDeg;
  extent.ymin -= padDeg;
  extent.xmax += padDeg;
  extent.ymax += padDeg;
  try {
    await view.goTo({ target: extent, padding: { top: 80, right: 80, bottom: 80, left: 80 } }, { duration: 280 });
  } catch {
    // best-effort
  }
}

export function getLastAoiPolygon() {
  return lastAoiPolygon;
}

export async function cancelAreaSketch() {
  sketchActive = false;
  try {
    sketchViewModel?.cancel();
  } catch {
    // ignore
  }
}

bindTestHook();
