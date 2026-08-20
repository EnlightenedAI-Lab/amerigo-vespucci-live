/**
 * Operational-layer session overlay.
 *
 * ArcGIS 5.1 2D GraphicsLayer / GeoJSONLayer can hold features while the
 * LayerView does not composite them (F-37). Nested layers added after MapView
 * also fail to attach. This overlay projects GeoJSON through view.toScreen
 * onto one SVG attached to the live MapView container — the same paint path
 * as WorldView / WOA assets.
 */
import {
  getMapView,
  getOpsGraphicsLayer,
  subscribeMapFoundation,
  wakeIqaiMapSurface
} from '../map/map-foundation.js';
import { importArc } from '../map/arcgis-sdk.js';
import {
  CLUSTER_LAYERS,
  clusterSymbol,
  featureLabel,
  isInteractiveFeature,
  pathStyle,
  pointSymbol,
  visualClass
} from './symbology.js';

export const OPS_GROUP_ID = 'iqai-v2-ops-layers';
export const OPS_LAYER_PREFIX = 'ops-';
export const OPS_OVERLAY_ID = 'iqai-v2-ops-overlay';
export const OPS_GRAPHICS_ID = 'iqai-v2-ops-graphics';
export const OPS_HIT_ATTRIBUTE = '__iqaiOpsHit';
export const OPS_LAYER_ATTRIBUTE = '__iqaiLayerId';
export const OPS_FEATURE_ATTRIBUTE = '__iqaiFeatureId';

const NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const visibleLayers = new Map();
const wmsLayers = new Map();
const layerEmphasis = new Map();

let watchedView = null;
let viewHandles = [];
let paintTimer = 0;
let foundationBound = false;
let selectedFeatureKey = null;
let graphicCtorPromise = null;

function bindFoundation() {
  if (foundationBound) return;
  foundationBound = true;
  subscribeMapFoundation(() => {
    if (visibleLayers.size) paintOpsOverlay();
  });
}

async function waitForView(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const view = getMapView();
    if (view?.container) return view;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return getMapView();
}

function webMercator(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Math.max(-85.05112878, Math.min(85.05112878, Number(latitude)));
  const x = (lon * 20037508.342789244) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180))
    * (20037508.342789244) / 180;
  return { x, y };
}

function featureKey(layerId, featureId) {
  return `${String(layerId || '')}::${String(featureId || '')}`;
}

export function opsFeatureId(feature, layerId, index = 0) {
  const properties = feature?.properties || {};
  const candidate = feature?.id
    ?? properties.sourceFeatureId
    ?? properties.featureId
    ?? properties.feature_id
    ?? properties.id
    ?? properties.OBJECTID
    ?? properties.objectid;
  const value = String(candidate ?? '').trim();
  return value || `${String(layerId || 'ops')}-feature-${index}`;
}

function scalarAttributes(properties) {
  const attributes = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      attributes[key] = value;
    }
  }
  return attributes;
}

function mercatorPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const projected = webMercator(pair[0], pair[1]);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
  return [projected.x, projected.y];
}

function arcGeometry(geometry) {
  if (!geometry?.type) return null;
  const spatialReference = { wkid: 102100 };
  if (geometry.type === 'Point') {
    const point = mercatorPair(geometry.coordinates);
    return point ? { type: 'point', x: point[0], y: point[1], spatialReference } : null;
  }
  if (geometry.type === 'MultiPoint') {
    const points = (geometry.coordinates || []).map(mercatorPair).filter(Boolean);
    return points.length ? { type: 'multipoint', points, spatialReference } : null;
  }
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    const source = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    const paths = (source || [])
      .map((line) => (line || []).map(mercatorPair).filter(Boolean))
      .filter((line) => line.length >= 2);
    return paths.length ? { type: 'polyline', paths, spatialReference } : null;
  }
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const rings = (polygons || []).flatMap((polygon) => (
      (polygon || [])
        .map((ring) => (ring || []).map(mercatorPair).filter(Boolean))
        .filter((ring) => ring.length >= 3)
    ));
    return rings.length ? { type: 'polygon', rings, spatialReference } : null;
  }
  return null;
}

function hitSymbol(geometry) {
  if (geometry?.type === 'point' || geometry?.type === 'multipoint') {
    return {
      type: 'simple-marker',
      size: 18,
      color: [0, 0, 0, 0.01],
      outline: { color: [0, 0, 0, 0.01], width: 1 }
    };
  }
  if (geometry?.type === 'polyline') {
    return { type: 'simple-line', color: [0, 0, 0, 0.01], width: 12 };
  }
  return {
    type: 'simple-fill',
    color: [0, 0, 0, 0.01],
    outline: { color: [0, 0, 0, 0.01], width: 4 }
  };
}

async function syncOpsHitGraphics() {
  const layer = getOpsGraphicsLayer();
  if (!layer?.graphics) return 0;
  if (!graphicCtorPromise) graphicCtorPromise = importArc('@arcgis/core/Graphic.js');
  const Graphic = await graphicCtorPromise;
  const graphics = [];
  for (const entry of visibleLayers.values()) {
    const features = Array.isArray(entry.geojson?.features) ? entry.geojson.features : [];
    features.forEach((feature, index) => {
      if (!isInteractiveFeature(entry.meta.id, feature)) return;
      const geometry = arcGeometry(feature?.geometry);
      if (!geometry) return;
      const featureId = opsFeatureId(feature, entry.meta.id, index);
      graphics.push(new Graphic({
        geometry,
        attributes: {
          ...scalarAttributes(feature?.properties),
          [OPS_HIT_ATTRIBUTE]: true,
          [OPS_LAYER_ATTRIBUTE]: entry.meta.id,
          [OPS_FEATURE_ATTRIBUTE]: featureId
        },
        symbol: hitSymbol(geometry)
      }));
    });
  }
  layer.graphics.removeAll();
  if (graphics.length) layer.graphics.addMany(graphics);
  return graphics.length;
}

export function getOpsFeatureRecord(layerId, featureId) {
  const entry = visibleLayers.get(String(layerId || ''));
  if (!entry) return null;
  const features = Array.isArray(entry.geojson?.features) ? entry.geojson.features : [];
  const index = features.findIndex((feature, featureIndex) => (
    opsFeatureId(feature, entry.meta.id, featureIndex) === String(featureId || '')
  ));
  if (index < 0) return null;
  return {
    layerId: entry.meta.id,
    featureId: opsFeatureId(features[index], entry.meta.id, index),
    featureIndex: index,
    feature: features[index],
    meta: entry.meta,
    payload: entry.payload
  };
}

export function setSelectedOpsFeature(layerId, featureId) {
  const record = getOpsFeatureRecord(layerId, featureId);
  if (!record) return false;
  selectedFeatureKey = featureKey(record.layerId, record.featureId);
  paintOpsOverlay();
  return true;
}

export function clearSelectedOpsFeature() {
  const changed = selectedFeatureKey != null;
  selectedFeatureKey = null;
  if (changed) paintOpsOverlay();
  return changed;
}

export function getSelectedOpsFeature() {
  if (!selectedFeatureKey) return null;
  const splitAt = selectedFeatureKey.indexOf('::');
  return getOpsFeatureRecord(
    selectedFeatureKey.slice(0, splitAt),
    selectedFeatureKey.slice(splitAt + 2)
  );
}

function toScreen(view, lng, lat) {
  if (!view || typeof view.toScreen !== 'function') return null;
  const lon = Number(lng);
  const latitude = Number(lat);
  if (!Number.isFinite(lon) || !Number.isFinite(latitude)) return null;
  const attempts = [
    { type: 'point', longitude: lon, latitude, spatialReference: { wkid: 4326 } },
    { type: 'point', ...webMercator(lon, latitude), spatialReference: { wkid: 102100 } }
  ];
  for (const geometry of attempts) {
    try {
      const screen = view.toScreen(geometry);
      const x = Number(screen?.x);
      const y = Number(screen?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch {
      // next form
    }
  }
  return null;
}

function svgEl(name, attrs) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value != null) node.setAttribute(key, String(value));
  }
  return node;
}

function ensureSvg(view) {
  const host = view?.container;
  if (!host || typeof document === 'undefined') return null;
  let svg = host.querySelector(`#${OPS_OVERLAY_ID}`);
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.id = OPS_OVERLAY_ID;
    svg.setAttribute('data-iqai-ops-overlay', 'true');
    svg.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:22',
      'overflow:visible'
    ].join(';');
    host.appendChild(svg);
  }
  const width = Math.max(1, host.clientWidth || view.width || 1);
  const height = Math.max(1, host.clientHeight || view.height || 1);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  return svg;
}

function bindView(view) {
  if (!view || watchedView === view) return;
  for (const handle of viewHandles) {
    try { handle.remove?.(); } catch { /* ignore */ }
  }
  viewHandles = [];
  watchedView = view;
  const refreshSoon = () => {
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      paintTimer = 0;
      paintOpsOverlay();
    }, 40);
  };
  if (typeof view.watch === 'function') {
    viewHandles.push(view.watch('stationary', (stationary) => {
      if (stationary) refreshSoon();
    }));
    viewHandles.push(view.watch('extent', refreshSoon));
    viewHandles.push(view.watch('rotation', refreshSoon));
    viewHandles.push(view.watch('scale', refreshSoon));
    viewHandles.push(view.watch('size', refreshSoon));
  }
  view.on?.('resize', refreshSoon);
}

function htmlPointNode(symbol) {
  const size = Number(symbol?.size) || 18;
  const node = svgEl('foreignObject', {
    x: -size / 2,
    y: -size / 2,
    width: size,
    height: size,
    overflow: 'visible'
  });
  const host = document.createElementNS(XHTML_NS, 'div');
  host.className = 'sym-icon';
  host.style.width = `${size}px`;
  host.style.height = `${size}px`;
  host.innerHTML = symbol.html || '';
  node.appendChild(host);
  return node;
}

function pointNode(symbol) {
  if (symbol?.kind === 'html') return htmlPointNode(symbol);
  return svgEl('circle', {
    r: Number(symbol?.radius) || 4,
    fill: symbol?.fill || '#9aa8b5',
    'fill-opacity': symbol?.fillOpacity ?? 0.8,
    stroke: symbol?.stroke || 'none',
    'stroke-width': symbol?.strokeWidth ?? 0
  });
}

function selectedLabelNode(layerId, properties, size) {
  const label = featureLabel(layerId, properties);
  if (!label) return null;
  const node = svgEl('text', {
    class: 'iqai-ops-selected-label',
    x: Math.max(8, (Number(size) || 18) / 2 + 4),
    y: 3
  });
  node.textContent = label;
  return node;
}

function pathFromRing(view, ring, pad, width, height) {
  const parts = [];
  for (const pair of ring || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const screen = toScreen(view, pair[0], pair[1]);
    if (!screen) continue;
    if (screen.x < -pad || screen.y < -pad || screen.x > width + pad || screen.y > height + pad) {
      // still include so the path stays connected across the viewport
    }
    parts.push(`${parts.length ? 'L' : 'M'}${screen.x.toFixed(1)},${screen.y.toFixed(1)}`);
  }
  return parts.length ? `${parts.join(' ')} Z` : '';
}

function appendGeometry(svg, view, feature, meta, width, height) {
  const geom = feature?.geometry;
  if (!geom?.type) return 0;
  const properties = feature?.properties || {};
  const style = pathStyle(meta.id, feature, {
    selected: meta.selected,
    emphasize: meta.emphasize
  });
  const pad = 24;
  let count = 0;

  const addPoint = (coords) => {
    if (!Array.isArray(coords) || coords.length < 2) return;
    const screen = toScreen(view, coords[0], coords[1]);
    if (!screen) return;
    if (screen.x < -pad || screen.y < -pad || screen.x > width + pad || screen.y > height + pad) return;
    const g = svgEl('g', {
      'data-iqai-ops-mark': meta.id,
      'data-iqai-ops-feature-id': meta.featureId,
      'data-iqai-ops-selected': meta.selected ? 'true' : 'false',
      transform: `translate(${screen.x.toFixed(1)} ${screen.y.toFixed(1)})`
    });
    const symbol = pointSymbol(meta.id, properties, {
      selected: meta.selected,
      zoom: Number(view?.zoom) || 11
    });
    g.append(pointNode(symbol));
    if (meta.selected) {
      const label = selectedLabelNode(meta.id, properties, symbol?.size);
      if (label) g.append(label);
    }
    svg.appendChild(g);
    count += 1;
  };

  const addLine = (line) => {
    const parts = [];
    for (const pair of line || []) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const screen = toScreen(view, pair[0], pair[1]);
      if (!screen) continue;
      parts.push(`${parts.length ? 'L' : 'M'}${screen.x.toFixed(1)},${screen.y.toFixed(1)}`);
    }
    if (!parts.length) return;
    svg.appendChild(svgEl('path', {
      'data-iqai-ops-mark': meta.id,
      'data-iqai-ops-feature-id': meta.featureId,
      'data-iqai-ops-selected': meta.selected ? 'true' : 'false',
      d: parts.join(' '),
      fill: 'none',
      stroke: style.color || '#9aa8b5',
      'stroke-width': style.weight ?? 1,
      'stroke-opacity': style.opacity ?? 1,
      'stroke-dasharray': style.dashArray || null,
      'stroke-linejoin': 'round',
      'stroke-linecap': style.lineCap || 'round',
      class: style.className || null
    }));
    count += 1;
  };

  const addPolygon = (rings) => {
    const d = (rings || []).map((ring) => pathFromRing(view, ring, pad, width, height)).filter(Boolean).join(' ');
    if (!d) return;
    svg.appendChild(svgEl('path', {
      'data-iqai-ops-mark': meta.id,
      'data-iqai-ops-feature-id': meta.featureId,
      'data-iqai-ops-selected': meta.selected ? 'true' : 'false',
      d,
      fill: style.fill === false ? 'none' : (style.fillColor || style.color || '#9aa8b5'),
      'fill-opacity': style.fill === false ? 0 : (style.fillOpacity ?? 0.08),
      stroke: style.color || 'none',
      'stroke-width': style.weight ?? 0,
      'stroke-opacity': style.opacity ?? 1,
      'stroke-dasharray': style.dashArray || null,
      class: style.className || null
    }));
    count += 1;
  };

  if (geom.type === 'Point') addPoint(geom.coordinates);
  else if (geom.type === 'MultiPoint') for (const coords of geom.coordinates || []) addPoint(coords);
  else if (geom.type === 'LineString') addLine(geom.coordinates);
  else if (geom.type === 'MultiLineString') for (const line of geom.coordinates || []) addLine(line);
  else if (geom.type === 'Polygon') addPolygon(geom.coordinates);
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates || []) addPolygon(poly);
  return count;
}

function appendCluster(svg, screen, meta, count) {
  const config = CLUSTER_LAYERS[meta.id];
  const symbol = clusterSymbol(config?.kind || visualClass(meta.id), count);
  const group = svgEl('g', {
    'data-iqai-ops-mark': meta.id,
    'data-iqai-ops-cluster': 'true',
    transform: `translate(${screen.x.toFixed(1)} ${screen.y.toFixed(1)})`
  });
  group.append(htmlPointNode(symbol));
  svg.appendChild(group);
}

function clusteredFeatures(view, entry, width, height) {
  const config = CLUSTER_LAYERS[entry.meta.id];
  const zoom = Number(view?.zoom) || 11;
  if (!config || zoom >= config.disableAt) return null;
  const cells = new Map();
  const passthrough = [];
  const features = Array.isArray(entry.geojson?.features) ? entry.geojson.features : [];
  features.forEach((feature, index) => {
    if (feature?.geometry?.type !== 'Point') {
      passthrough.push({ feature, index });
      return;
    }
    const featureId = opsFeatureId(feature, entry.meta.id, index);
    if (selectedFeatureKey === featureKey(entry.meta.id, featureId)) {
      passthrough.push({ feature, index });
      return;
    }
    const pair = feature.geometry.coordinates;
    const screen = toScreen(view, pair?.[0], pair?.[1]);
    if (!screen || screen.x < -config.radius || screen.y < -config.radius
      || screen.x > width + config.radius || screen.y > height + config.radius) return;
    const key = `${Math.floor(screen.x / config.radius)}:${Math.floor(screen.y / config.radius)}`;
    const cell = cells.get(key) || { features: [], x: 0, y: 0 };
    cell.features.push({ feature, index });
    cell.x += screen.x;
    cell.y += screen.y;
    cells.set(key, cell);
  });
  return { cells, passthrough };
}

export function paintOpsOverlay() {
  const view = getMapView();
  const svg = ensureSvg(view);
  if (!svg) return { markCount: 0, layerCount: 0 };
  bindView(view);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const width = Number(svg.getAttribute('width') || 1);
  const height = Number(svg.getAttribute('height') || 1);
  let markCount = 0;
  for (const entry of visibleLayers.values()) {
    const features = Array.isArray(entry.geojson?.features) ? entry.geojson.features : [];
    const clustered = clusteredFeatures(view, entry, width, height);
    const renderFeature = (feature, index) => {
      const featureId = opsFeatureId(feature, entry.meta.id, index);
      markCount += appendGeometry(svg, view, feature, {
        ...entry.meta,
        featureId,
        selected: selectedFeatureKey === featureKey(entry.meta.id, featureId),
        emphasize: layerEmphasis.get(entry.meta.id) || null
      }, width, height);
    };
    if (!clustered) {
      features.forEach(renderFeature);
      continue;
    }
    clustered.passthrough.forEach(({ feature, index }) => renderFeature(feature, index));
    for (const cell of clustered.cells.values()) {
      if (cell.features.length === 1) {
        renderFeature(cell.features[0].feature, cell.features[0].index);
      } else {
        appendCluster(svg, {
          x: cell.x / cell.features.length,
          y: cell.y / cell.features.length
        }, entry.meta, cell.features.length);
        markCount += 1;
      }
    }
  }
  return { markCount, layerCount: visibleLayers.size };
}

export function setOpsLayerEmphasis(id, emphasize) {
  if (emphasize) layerEmphasis.set(id, emphasize);
  else layerEmphasis.delete(id);
  return paintOpsOverlay();
}

export function getOpsClusterAt(viewPoint) {
  const svg = document.getElementById(OPS_OVERLAY_ID);
  const host = svg?.parentElement;
  if (!svg || !host || !Number.isFinite(Number(viewPoint?.x)) || !Number.isFinite(Number(viewPoint?.y))) return null;
  const hostRect = host.getBoundingClientRect();
  const clientX = hostRect.left + Number(viewPoint.x);
  const clientY = hostRect.top + Number(viewPoint.y);
  for (const node of svg.querySelectorAll('[data-iqai-ops-cluster="true"]')) {
    const rect = node.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
    const layerId = node.getAttribute('data-iqai-ops-mark');
    return {
      layerId,
      disableAt: CLUSTER_LAYERS[layerId]?.disableAt || null
    };
  }
  return null;
}

export async function setOpsOverlay(meta, payload, visible) {
  bindFoundation();
  const view = await waitForView();
  if (!view) return { ok: false, reason: 'MAP_NOT_READY' };
  const id = meta.id;
  const radar = wmsLayers.get(`${id}-radar`);
  const fwi = wmsLayers.get(`${id}-fwi`);
  if (radar) radar.visible = false;
  if (fwi) fwi.visible = false;

  if (!visible) {
    visibleLayers.delete(id);
    await syncOpsHitGraphics();
    const painted = paintOpsOverlay();
    wakeIqaiMapSurface();
    return { ok: true, visible: false, markCount: painted.markCount };
  }

  const geojson = payload?.geojson || { type: 'FeatureCollection', features: [] };
  visibleLayers.set(id, { meta, payload, geojson });
  await syncOpsHitGraphics();
  let painted = paintOpsOverlay();
  const wanted = Array.isArray(geojson.features) ? geojson.features.length : 0;
  if (wanted > 0 && painted.markCount === 0) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    painted = paintOpsOverlay();
  }

  if (id === 'weather' && payload?.radar?.status === 'LIVE') {
    await ensureWms(`${id}-radar`, {
      title: 'ECCC Radar',
      url: '/api/spatial-v2/ops-layers/radar/wms',
      sublayer: 'RADAR_1KM_RRAI',
      opacity: 0.42
    });
  }
  if (id === 'wildfire-fwi' && payload?.fwi?.layer) {
    await ensureWms(`${id}-fwi`, {
      title: 'CWFIS FWI',
      url: '/api/spatial-v2/ops-layers/cwfis/fwi/wms',
      sublayer: payload.fwi.layer,
      opacity: 0.32
    });
  }

  wakeIqaiMapSurface();
  return {
    ok: true,
    visible: true,
    visualClass: visualClass(id),
    graphicCount: painted.markCount,
    markCount: painted.markCount
  };
}

async function ensureWms(key, spec) {
  const view = getMapView();
  const map = view?.map;
  if (!map) return;
  let layer = wmsLayers.get(key);
  if (layer) {
    layer.visible = true;
    return;
  }
  const WMSLayer = await importArc('@arcgis/core/layers/WMSLayer.js');
  layer = new WMSLayer({
    id: `${OPS_LAYER_PREFIX}${key}`,
    title: spec.title,
    url: spec.url,
    sublayers: [{ name: spec.sublayer, visible: true }],
    imageFormat: 'png',
    imageTransparency: true,
    opacity: spec.opacity,
    popupEnabled: false,
    listMode: 'hide'
  });
  map.add(layer);
  wmsLayers.set(key, layer);
}

export function isOpsOverlayVisible(id) {
  return visibleLayers.has(id);
}

export function listVisibleOpsIds(catalogLayers = []) {
  return (catalogLayers || [])
    .map((layer) => layer.id)
    .filter((id) => isOpsOverlayVisible(id));
}

export function getOpsView() {
  return getMapView();
}

export function getOpsMarkCount(id) {
  const view = getMapView();
  const svg = view?.container?.querySelector?.(`#${OPS_OVERLAY_ID}`);
  if (!svg) return 0;
  if (!id) return svg.querySelectorAll('[data-iqai-ops-mark]').length;
  return svg.querySelectorAll(`[data-iqai-ops-mark="${id}"]`).length;
}
