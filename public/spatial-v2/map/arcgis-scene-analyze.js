/**
 * IQAI Spatial V2 — ArcGIS SceneView analytical 3D specialist.
 *
 * 3D ANALYZE only. Not Google 3D VISUAL. Not a second MapView.
 * Downtown Montréal Building_Montreal SceneLayer. No Portal writes.
 */

import { getArcgisWorkerDiagnostics, importArc } from './arcgis-sdk.js';
import { getMapView } from './map-foundation.js';
import { getActiveSpatialFocus } from './spatial-focus.js';
import { getWorldviewNavigation } from './worldview-navigation.js';
import { createAnalyticalHit } from '../foundation/contracts/analytical-hit.js';
import { createSensorPose, SENSOR_POSE_SOURCE } from '../foundation/contracts/sensor-pose.js';
import { measureAnalyticalHits } from '../foundation/contracts/analytical-measure.js';

export const ANALYZE_3D_WEBSCENE_ITEM_ID = '63a16e0c9f364d0fab9d55f40bf71771';
export const ANALYZE_3D_BUILDING_SCENE_URL =
  'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/Building_Montreal/SceneServer';
export const ANALYZE_3D_BUILDING_PORTAL_ITEM_ID = 'f4b4881270124343a4cc2f847f86f54c';
export const ANALYZE_3D_BUILDING_HOSTED_ITEM_ID = 'd6cae675188949c2a6140afdfd065c2d';
export const ANALYZE_3D_TERRAIN_URL =
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer';
export const ANALYZE_3D_COVERAGE_LABEL = 'ANALYTICAL 3D COVERAGE UNAVAILABLE';
export const ANALYZE_3D_PROVENANCE =
  'City of Montréal / Esri Canada / Esri. Building_Montreal SceneLayer. Downtown Montréal only. Not NRCan Focus. Not Google 3D VISUAL.';

/** Service store.extent — not the inflated portal item bbox. */
export const DOWNTOWN_MONTREAL_SCENE_EXTENT = Object.freeze({
  xmin: -73.60385570826058,
  ymin: 45.485815767958044,
  xmax: -73.52044398972039,
  ymax: 45.539693141743676
});

const HOST_STYLE_ID = 'iqai-v2-analyze-3d-host-css';
const LOAD_PATH = Object.freeze({
  WEBSCENE: 'WEBSCENE',
  SCENE_LAYER_DIRECT: 'SCENE_LAYER_DIRECT'
});

let sceneView = null;
let buildingLayer = null;
let clickHandle = null;
let layerViewHandles = [];
let generation = 0;
let sceneViewCreateCount = 0;
let loadPath = null;
let lastError = null;
let coverageAvailable = null;
let buildingsReady = false;
let hits = [];
let measure = null;
let lastSensorPose = null;
let lastRenderDiagnostics = null;
let mapViewQualityBefore = null;

let lastLayerViewCreateError = null;
let layerViewCreateCount = 0;

function installAnalyze3dHostCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(HOST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HOST_STYLE_ID;
  style.textContent = `
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-zoom,
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-navigation-toggle,
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-compass,
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-search,
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-popup,
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-features,
    #iqai-spatial-v2 .iqai-v2-analyze-3d-canvas .esri-expand {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function buildingSceneLayerProperties() {
  return {
    url: `${ANALYZE_3D_BUILDING_SCENE_URL}/layers/0`,
    title: 'Building_Montreal',
    outFields: ['*'],
    visible: true,
    opacity: 1,
    minScale: 0,
    maxScale: 0,
    elevationInfo: { mode: 'absolute-height' }
  };
}

async function pinMatchingCdnAssets() {
  try {
    const esriConfig = await importArc('@arcgis/core/config.js');
    if (esriConfig) esriConfig.assetsPath = 'https://js.arcgis.com/5.1';
    if (typeof window !== 'undefined') {
      window.esriConfig = window.esriConfig || {};
      window.esriConfig.assetsPath = 'https://js.arcgis.com/5.1';
    }
  } catch {
    // importArc already pins the AMD CDN root
  }
}

function throttleHiddenMapView() {
  const view = getMapView();
  if (!view) return;
  try {
    if (mapViewQualityBefore == null) mapViewQualityBefore = view.qualityProfile || 'medium';
    view.qualityProfile = 'low';
  } catch {
    // MapView must remain; GPU throttle is best-effort
  }
}

function restoreHiddenMapView() {
  const view = getMapView();
  if (!view) {
    mapViewQualityBefore = null;
    return;
  }
  try {
    if (mapViewQualityBefore) view.qualityProfile = mapViewQualityBefore;
  } catch {
    // keep MapView
  }
  mapViewQualityBefore = null;
}

function collectRenderDiagnostics(layerView) {
  const container = sceneView?.container;
  const canvases = container
    ? Array.from(container.querySelectorAll('canvas')).map((node) => ({
      width: node.width,
      height: node.height,
      cssWidth: node.clientWidth,
      cssHeight: node.clientHeight,
      className: String(node.className || '')
    }))
    : [];
  lastRenderDiagnostics = {
    viewingMode: optionalSourceId(sceneView?.viewingMode),
    ready: sceneView?.ready === true,
    qualityProfile: optionalSourceId(sceneView?.qualityProfile),
    spatialReferenceWkid: optionalNumber(sceneView?.spatialReference?.wkid),
    scale: optionalNumber(sceneView?.scale),
    zoom: optionalNumber(sceneView?.zoom),
    layerLoadStatus: optionalSourceId(buildingLayer?.loadStatus),
    layerLoadError: optionalSourceId(buildingLayer?.loadError?.message),
    layerVisible: buildingLayer?.visible === true,
    layerOpacity: optionalNumber(buildingLayer?.opacity),
    elevationMode: optionalSourceId(buildingLayer?.elevationInfo?.mode),
    layerViewSuspended: layerView ? layerView.suspended === true : null,
    layerViewUpdating: layerView ? layerView.updating === true : null,
    layerViewCount: optionalNumber(sceneView?.allLayerViews?.length),
    layerViewCreateCount,
    layerViewCreateError: lastLayerViewCreateError,
    layerViewTypes: sceneView?.allLayerViews?.toArray?.()?.map((entry) => String(entry?.declaredClass || entry?.layer?.type || '')) || [],
    mapLayerTypes: sceneView?.map?.allLayers?.toArray?.()?.map((entry) => String(entry?.type || '')) || [],
    worker: getArcgisWorkerDiagnostics(),
    canvasCount: canvases.length,
    canvases,
    cameraZ: optionalNumber(sceneView?.camera?.position?.z)
  };
  return lastRenderDiagnostics;
}

export function isDowntownMontrealAnalyticalCoverage(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  return lon >= DOWNTOWN_MONTREAL_SCENE_EXTENT.xmin
    && lon <= DOWNTOWN_MONTREAL_SCENE_EXTENT.xmax
    && lat >= DOWNTOWN_MONTREAL_SCENE_EXTENT.ymin
    && lat <= DOWNTOWN_MONTREAL_SCENE_EXTENT.ymax;
}

export function getAnalyze3dSceneViewCreateCount() {
  return sceneViewCreateCount;
}

function optionalSourceId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  return text || null;
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function layerIdentity(layer) {
  if (!layer) return { url: null, portalItemId: null, title: null };
  return {
    url: optionalSourceId(layer.url) || optionalSourceId(layer.source?.url),
    portalItemId: optionalSourceId(layer.portalItem?.id),
    title: optionalSourceId(layer.title)
  };
}

export function isBuildingMontrealLayer(layer) {
  const identity = layerIdentity(layer);
  if (identity.portalItemId === ANALYZE_3D_BUILDING_PORTAL_ITEM_ID) return true;
  if (identity.portalItemId === ANALYZE_3D_BUILDING_HOSTED_ITEM_ID) return true;
  if (String(identity.url || '').includes('Building_Montreal')) return true;
  if (/building.*montr/i.test(String(identity.title || ''))) return true;
  return false;
}

function findBuildingLayer(scene) {
  const layers = scene?.allLayers?.toArray?.() || scene?.layers?.toArray?.() || [];
  const named = layers.find((layer) => isBuildingMontrealLayer(layer));
  if (named) return named;
  return layers.find((layer) => String(layer.type || '') === 'scene') || null;
}

async function ensureBuildingMontrealLayer(scene) {
  const existing = findBuildingLayer(scene);
  if (existing && isBuildingMontrealLayer(existing)) {
    existing.visible = true;
    existing.opacity = 1;
    if ('outFields' in existing) existing.outFields = ['*'];
    try { existing.elevationInfo = { mode: 'absolute-height' }; } catch { /* keep service elevation */ }
    return existing;
  }
  const SceneLayer = await importArc('@arcgis/core/layers/SceneLayer.js');
  const layer = new SceneLayer(buildingSceneLayerProperties());
  scene.add(layer);
  return layer;
}

function currentLocation() {
  const focus = getActiveSpatialFocus();
  if (Number.isFinite(Number(focus?.longitude)) && Number.isFinite(Number(focus?.latitude))) {
    return {
      longitude: Number(focus.longitude),
      latitude: Number(focus.latitude),
      heading: null,
      source: 'FOCUS'
    };
  }
  const nav = getWorldviewNavigation();
  if (Number.isFinite(Number(nav?.longitude)) && Number.isFinite(Number(nav?.latitude))) {
    return {
      longitude: Number(nav.longitude),
      latitude: Number(nav.latitude),
      heading: Number.isFinite(Number(nav.heading)) ? Number(nav.heading) : null,
      source: 'WORLDVIEW_NAV'
    };
  }
  const view = getMapView();
  const lon = Number(view?.center?.longitude);
  const lat = Number(view?.center?.latitude);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return { longitude: lon, latitude: lat, heading: null, source: 'MAP_CENTER' };
  }
  return null;
}

async function waitForLaidOut(container, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (container.clientWidth >= 64 && container.clientHeight >= 64) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return container.clientWidth >= 32 && container.clientHeight >= 32;
}

async function withTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitUntil(predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return predicate();
}

function bindLayerViewEvents(view) {
  layerViewHandles.forEach((handle) => handle?.remove?.());
  layerViewHandles = [];
  lastLayerViewCreateError = null;
  layerViewCreateCount = 0;
  if (!view?.on) return;
  try {
    layerViewHandles.push(view.on('layerview-create', () => {
      layerViewCreateCount += 1;
    }));
    layerViewHandles.push(view.on('layerview-create-error', (event) => {
      lastLayerViewCreateError = {
        layerTitle: optionalSourceId(event?.layer?.title),
        layerType: optionalSourceId(event?.layer?.type),
        error: optionalSourceId(event?.error?.message || event?.error) || 'LAYERVIEW_CREATE_ERROR'
      };
    }));
  } catch {
    // keep SceneView even if event wiring fails
  }
}

function stripSceneViewerChrome(view) {
  if (!view) return;
  try {
    if (view.popup) {
      view.popup.autoOpenEnabled = false;
      view.popup.dockEnabled = false;
    }
  } catch {
    // popup API varies slightly across 5.x builds
  }
  try {
    view.ui.components = ['attribution'];
  } catch {
    try {
      view.ui.empty('top-left');
      view.ui.empty('top-right');
      view.ui.empty('bottom-left');
      view.ui.empty('bottom-right');
    } catch {
      // keep going; CSS hides leftover widgets
    }
  }
}

function attributesOf(graphic) {
  const raw = graphic?.attributes || {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'number' && !Number.isFinite(value) ? null : value;
      continue;
    }
    if (typeof value === 'string') {
      const text = value.trim();
      if (text) out[key] = text;
    }
  }
  return Object.keys(out).length ? out : null;
}

function hitFromGraphic({ graphic, layer, mapPoint, screenPoint }) {
  if (!graphic || !mapPoint) return null;
  const longitude = Number(mapPoint.longitude);
  const latitude = Number(mapPoint.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (!isDowntownMontrealAnalyticalCoverage(longitude, latitude)) return null;
  const identity = layerIdentity(layer || graphic.layer);
  const attrs = attributesOf(graphic);
  const objectId = optionalNumber(graphic.attributes?.OBJECTID ?? graphic.attributes?.objectid ?? graphic.getObjectId?.());
  return createAnalyticalHit({
    screen: {
      x: Number(screenPoint?.x),
      y: Number(screenPoint?.y)
    },
    mapPoint: {
      x: Number.isFinite(Number(mapPoint.x)) ? Number(mapPoint.x) : longitude,
      y: Number.isFinite(Number(mapPoint.y)) ? Number(mapPoint.y) : latitude,
      z: optionalNumber(mapPoint.z),
      spatialReferenceWkid: optionalNumber(mapPoint.spatialReference?.wkid)
    },
    longitude,
    latitude,
    z: optionalNumber(mapPoint.z),
    layerTitle: identity.title,
    serviceUrl: identity.url || ANALYZE_3D_BUILDING_SCENE_URL,
    portalItemId: identity.portalItemId,
    webSceneItemId: ANALYZE_3D_WEBSCENE_ITEM_ID,
    objectId,
    buildingFID: optionalSourceId(graphic.attributes?.buildingFID ?? graphic.attributes?.BuildingFID),
    buildingShellFID: optionalSourceId(graphic.attributes?.BuildingShellFID ?? graphic.attributes?.buildingShellFID),
    attributes: attrs,
    provenance: ANALYZE_3D_PROVENANCE
  });
}

function pickBuildingResult(response) {
  const results = response?.results || [];
  for (const result of results) {
    const graphic = result.graphic;
    const layer = graphic?.layer || result.layer;
    if (!graphic) continue;
    const allowed = !layer
      || layer === buildingLayer
      || (buildingLayer && layer?.id && layer.id === buildingLayer.id)
      || isBuildingMontrealLayer(layer);
    if (!allowed) continue;
    if (!result.mapPoint && !graphic.geometry) continue;
    return {
      graphic,
      layer: layer || buildingLayer,
      mapPoint: result.mapPoint || graphic.geometry,
      screenPoint: result.screenPoint
    };
  }
  return null;
}

function recordHit(hit) {
  if (!hit) return null;
  if (hits.length >= 2) hits = [];
  hits = [...hits, hit];
  if (hits.length === 2 && Number.isFinite(hits[0].z) && Number.isFinite(hits[1].z)) {
    try {
      measure = measureAnalyticalHits(hits[0], hits[1]);
    } catch {
      measure = null;
    }
  } else {
    measure = null;
  }
  return hit;
}

function sampleSensorPose() {
  const camera = sceneView?.camera;
  const position = camera?.position;
  if (!position) return null;
  const longitude = Number(position.longitude);
  const latitude = Number(position.latitude);
  const x = Number(position.x);
  const y = Number(position.y);
  const tilt = Number(camera.tilt);
  lastSensorPose = createSensorPose({
    x: Number.isFinite(x) ? x : longitude,
    y: Number.isFinite(y) ? y : latitude,
    z: optionalNumber(position.z),
    longitude: Number.isFinite(longitude) ? longitude : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    heading: optionalNumber(camera.heading),
    pitch: Number.isFinite(tilt) ? tilt - 90 : null,
    roll: null,
    crs: {
      horizontalCrsId: 'EPSG:4326',
      verticalDatumId: null,
      verticalUnits: 'meters'
    },
    source: SENSOR_POSE_SOURCE.SCENE_CAMERA_SAMPLE,
    provenance: 'SceneView camera sample. Not PLACE CAMERA. Not WorldState.cameras. Z is scene camera position, not a certified vertical datum.'
  });
  return lastSensorPose;
}

async function applyCamera(location) {
  if (!sceneView || !location) return;
  const heading = Number.isFinite(Number(location.heading))
    ? Number(location.heading)
    : 32;
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  const metersPerDegLat = 111320;
  const metersPerDegLon = Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
  const backM = 620;
  const headingRad = heading * Math.PI / 180;
  const target = {
    position: {
      longitude: lon - (backM * Math.sin(headingRad)) / metersPerDegLon,
      latitude: lat - (backM * Math.cos(headingRad)) / metersPerDegLat,
      z: 420
    },
    heading,
    tilt: 68
  };
  try {
    sceneView.camera = target;
  } catch {
    await sceneView.goTo(target, { animate: false }).catch(() => {});
  }
  await sceneView.goTo(target, { animate: false }).catch(() => {});
  try {
    sceneView.padding = { bottom: 72 };
  } catch {
    // readout overlay is pointer-events none
  }
  sampleSensorPose();
}

async function loadWebScene() {
  const WebScene = await importArc('@arcgis/core/WebScene.js');
  const scene = new WebScene({
    portalItem: { id: ANALYZE_3D_WEBSCENE_ITEM_ID }
  });
  await scene.load();
  return scene;
}

async function loadDirectScene() {
  const EsriMap = await importArc('@arcgis/core/Map.js');
  const SceneLayer = await importArc('@arcgis/core/layers/SceneLayer.js');
  // No WebMercator basemap. Hybrid/satellite force SceneView into 102100, which
  // misreads Building_Montreal I3S MBS (EPSG:4326) and never fetches child nodes.
  return new EsriMap({
    ground: 'world-elevation',
    layers: [
      new SceneLayer(buildingSceneLayerProperties())
    ]
  });
}

async function waitForBuildings(view, layer) {
  if (!view || !layer) return false;
  let layerView = null;
  try {
    layer.visible = true;
    layer.opacity = 1;
    if (layer.elevationInfo?.mode !== 'absolute-height') {
      try { layer.elevationInfo = { mode: 'absolute-height' }; } catch { /* keep service elevation */ }
    }
    if (typeof layer.load === 'function') {
      await withTimeout(layer.load(), 6000, 'BUILDING_LAYER_LOAD_TIMEOUT').catch(() => {});
    }
    layerView = await withTimeout(view.whenLayerView(layer), 8000, 'LAYERVIEW_TIMEOUT').catch(() => null);
    if (layerView) {
      await waitUntil(() => layerView.suspended !== true, 4000);
      await waitUntil(() => layerView.updating !== true, 6000);
    }
    buildingsReady = layer?.loaded === true || Boolean(layerView);
    collectRenderDiagnostics(layerView);
    return buildingsReady;
  } catch {
    buildingsReady = layer?.loaded === true;
    collectRenderDiagnostics(layerView);
    return buildingsReady;
  }
}

function bindClick(view) {
  clickHandle?.remove?.();
  clickHandle = view.on('click', async (event) => {
    if (event?.button != null && event.button !== 0) return;
    try {
      const hit = await hitTestScreen(event.x, event.y);
      if (hit) recordHit(hit);
    } catch {
      // pointer miss is not a fabricated building
    }
  });
}

export async function hitTestScreen(x, y) {
  if (!sceneView) return null;
  const sx = Number(x);
  const sy = Number(y);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  let response = await withTimeout(
    sceneView.hitTest(
      { x: sx, y: sy },
      buildingLayer ? { include: [buildingLayer] } : undefined
    ),
    4000,
    'HITTEST_INCLUDE_TIMEOUT'
  ).catch(() => null);
  let picked = pickBuildingResult(response);
  if (!picked) {
    response = await withTimeout(
      sceneView.hitTest({ x: sx, y: sy }),
      4000,
      'HITTEST_TIMEOUT'
    ).catch(() => null);
    picked = pickBuildingResult(response);
  }
  if (!picked) return null;
  picked.screenPoint = picked.screenPoint || { x: sx, y: sy };
  return hitFromGraphic(picked);
}

export async function pickAndRecord(x, y) {
  const hit = await hitTestScreen(x, y);
  if (hit) recordHit(hit);
  return hit;
}

export function getAnalyze3dHits() {
  return hits.slice();
}

export function getAnalyze3dMeasure() {
  return measure;
}

export function getAnalyze3dSensorPose() {
  return sampleSensorPose() || lastSensorPose;
}

export function getAnalyze3dSnapshot() {
  if (sceneView) {
    try {
      const layerView = buildingLayer
        ? (sceneView.allLayerViews?.toArray?.() || []).find((entry) => (
          entry.layer === buildingLayer || isBuildingMontrealLayer(entry.layer)
        ))
        : null;
      collectRenderDiagnostics(layerView);
    } catch {
      collectRenderDiagnostics();
    }
  }
  const location = currentLocation();
  return {
    open: Boolean(sceneView),
    sceneViewCreateCount,
    mapViewCreateCount: null,
    loadPath,
    webSceneItemId: ANALYZE_3D_WEBSCENE_ITEM_ID,
    buildingServiceUrl: ANALYZE_3D_BUILDING_SCENE_URL,
    coverageAvailable,
    coverageLabel: coverageAvailable === false ? ANALYZE_3D_COVERAGE_LABEL : null,
    buildingsReady,
    buildingLayerTitle: layerIdentity(buildingLayer).title,
    buildingLayerUrl: layerIdentity(buildingLayer).url,
    hits: hits.slice(),
    hitCount: hits.length,
    measure,
    sensorPose: lastSensorPose,
    location,
    error: lastError,
    renderDiagnostics: lastRenderDiagnostics,
    worker: getArcgisWorkerDiagnostics(),
    attribution: 'City of Montréal / Esri Canada / Esri',
    coverageNote: 'Downtown Montréal only',
    portalWrites: 'NONE'
  };
}

export async function openAnalyze3dScene(options = {}) {
  const container = options.container;
  if (!container) {
    lastError = 'ANALYZE_3D_CONTAINER_MISSING';
    throw new Error(lastError);
  }
  installAnalyze3dHostCss();
  const location = options.location || currentLocation();
  coverageAvailable = isDowntownMontrealAnalyticalCoverage(location?.longitude, location?.latitude);
  if (!coverageAvailable) {
    lastError = null;
    buildingsReady = false;
    return getAnalyze3dSnapshot();
  }
  if (sceneView) {
    await applyCamera(location);
    return getAnalyze3dSnapshot();
  }
  const token = ++generation;
  lastError = null;
  buildingsReady = false;
  hits = [];
  measure = null;
  lastSensorPose = null;
  lastRenderDiagnostics = null;
  lastLayerViewCreateError = null;
  layerViewCreateCount = 0;
  await waitForLaidOut(container);
  if (token !== generation) return getAnalyze3dSnapshot();
  throttleHiddenMapView();
  await pinMatchingCdnAssets();

  lastError = 'IMPORTING_SCENEVIEW';
  const [sceneViewImport, spatialRefImport] = [
    withTimeout(importArc('@arcgis/core/views/SceneView.js'), 25000, 'SCENEVIEW_IMPORT_TIMEOUT'),
    importArc('@arcgis/core/geometry/SpatialReference.js').catch(() => null)
  ];
  lastError = 'LOADING_SCENE_LAYER_DIRECT';
  const sceneLoad = withTimeout(loadDirectScene(), 20000, 'DIRECT_SCENE_TIMEOUT').then((scene) => {
    loadPath = LOAD_PATH.SCENE_LAYER_DIRECT;
    return scene;
  });
  const SceneView = await sceneViewImport;
  const SpatialReference = await spatialRefImport;
  const scene = await sceneLoad;
  lastError = null;
  if (token !== generation) {
    scene?.destroy?.();
    return getAnalyze3dSnapshot();
  }
  buildingLayer = await ensureBuildingMontrealLayer(scene);
  if (!(container instanceof HTMLElement)) {
    lastError = 'ANALYZE_3D_CONTAINER_NOT_ELEMENT';
    throw new Error(lastError);
  }
  if (container.clientWidth < 8 || container.clientHeight < 8) {
    lastError = `ANALYZE_3D_CONTAINER_TOO_SMALL (${container.clientWidth}x${container.clientHeight})`;
    throw new Error(lastError);
  }
  const wgs84 = SpatialReference?.WGS84 || SpatialReference?.fromJSON?.({ wkid: 4326 }) || { wkid: 4326 };
  try {
    sceneView = new SceneView({
      container,
      map: scene,
      viewingMode: 'global',
      qualityProfile: 'high',
      spatialReference: wgs84
    });
  } catch (error) {
    try {
      sceneView = new SceneView({
        container,
        map: scene,
        viewingMode: 'global'
      });
    } catch (fallbackError) {
      lastError = String(fallbackError?.message || error?.message || error || 'SCENEVIEW_CONSTRUCT_FAILED');
      throw fallbackError;
    }
  }
  sceneViewCreateCount += 1;
  bindLayerViewEvents(sceneView);
  stripSceneViewerChrome(sceneView);
  try {
    await withTimeout(sceneView.when(), 12000, 'SCENEVIEW_WHEN_TIMEOUT');
  } catch {
    lastError = lastError === 'SCENEVIEW_WHEN_TIMEOUT' || !lastError ? null : lastError;
  }
  if (token !== generation) {
    await closeAnalyze3dScene();
    return getAnalyze3dSnapshot();
  }
  stripSceneViewerChrome(sceneView);
  try { sceneView.qualityProfile = 'high'; } catch { /* keep default profile */ }
  try { sceneView.environment.lighting.directShadowsEnabled = true; } catch { /* lighting optional */ }
  try { sceneView.resize(); } catch { /* layout already polled */ }
  if (!buildingLayer) buildingLayer = await ensureBuildingMontrealLayer(sceneView.map);
  await applyCamera(location);
  await waitForBuildings(sceneView, buildingLayer);
  collectRenderDiagnostics();
  bindClick(sceneView);
  sampleSensorPose();
  return getAnalyze3dSnapshot();
}

export async function closeAnalyze3dScene() {
  generation += 1;
  clickHandle?.remove?.();
  clickHandle = null;
  layerViewHandles.forEach((handle) => handle?.remove?.());
  layerViewHandles = [];
  lastLayerViewCreateError = null;
  layerViewCreateCount = 0;
  const view = sceneView;
  sceneView = null;
  buildingLayer = null;
  buildingsReady = false;
  coverageAvailable = null;
  hits = [];
  measure = null;
  lastSensorPose = null;
  lastError = null;
  loadPath = null;
  lastRenderDiagnostics = null;
  restoreHiddenMapView();
  if (view) {
    try {
      view.container = null;
      view.destroy();
    } catch {
      // destroy is best-effort; MapView must remain
    }
  }
  return getAnalyze3dSnapshot();
}
