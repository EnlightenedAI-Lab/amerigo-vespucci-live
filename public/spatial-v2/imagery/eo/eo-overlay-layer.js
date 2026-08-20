/**
 * Paint an EO PNG and AOI box on the existing MapView.
 * HTML overlay (Leaflet-style imageOverlay) stays visible even when the
 * ArcGIS runtime plane is hidden. Does not create a second map.
 */

import { importArc } from '../../map/arcgis-sdk.js';
import { getMapView } from '../../map/map-foundation.js';

export const EO_OVERLAY_LAYER_ID = 'iqai-v2-eo-overlay';
export const EO_AOI_LAYER_ID = 'iqai-v2-eo-aoi';
export const EO_MAP_OVERLAY_ID = 'iqai-v2-eo-map-overlay';
export const EO_RASTER_ID = 'iqai-v2-eo-raster';
export const EO_BOX_ID = 'iqai-v2-eo-box';
export const EO_DRAW_ID = 'iqai-v2-eo-draw';
export const EO_PIN_ID = 'iqai-v2-eo-pin';
export const EO_COMPARE_BOX_ID = 'iqai-v2-eo-compare-box';
export const EO_CAPTION_ID = 'iqai-v2-eo-caption';
export const EO_STALE_ID = 'iqai-v2-eo-stale';

let overlayLayer = null;
let aoiLayer = null;
let rasterState = null;
let aoiState = null;
let compareState = null;
let pinState = null;
let captionState = null;
let staleState = null;
let watchHandles = [];
let watchedView = null;

function webMercator(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  const x = (lon * 20037508.342789244) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180))
    * (20037508.342789244) / 180;
  return { x, y };
}

function toScreen(view, longitude, latitude) {
  if (!view || typeof view.toScreen !== 'function') return null;
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const attempts = [
    { type: 'point', longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } },
    { type: 'point', ...webMercator(lon, lat), spatialReference: { wkid: 102100 } }
  ];
  for (const geometry of attempts) {
    try {
      const screen = view.toScreen(geometry);
      const x = Number(screen?.x);
      const y = Number(screen?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch {
      /* try next CRS */
    }
  }
  return null;
}

function overlayParent() {
  const view = getMapView();
  return view?.container?.closest?.('[data-iqai-map-host]')
    || view?.container
    || null;
}

function ensureOverlayHost() {
  const parent = overlayParent();
  if (!parent) return null;
  let host = parent.querySelector(`#${EO_MAP_OVERLAY_ID}`);
  if (!host) {
    host = document.createElement('div');
    host.id = EO_MAP_OVERLAY_ID;
    host.className = 'iqai-v2-eo-map-overlay';
    host.setAttribute('aria-hidden', 'true');
    parent.appendChild(host);
  }
  ensureWatch();
  return host;
}

function ensureChild(host, id, className, tag = 'div') {
  let node = host.querySelector(`#${id}`);
  if (!node) {
    node = document.createElement(tag);
    node.id = id;
    node.className = className;
    host.appendChild(node);
  }
  return node;
}

function positionRect(node, a, b) {
  if (!node || !a || !b) return;
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.width = `${Math.abs(b.x - a.x)}px`;
  node.style.height = `${Math.abs(b.y - a.y)}px`;
}

function corners(view, bbox) {
  if (!view || !bbox) return null;
  const sw = toScreen(view, bbox[0], bbox[1]);
  const ne = toScreen(view, bbox[2], bbox[3]);
  if (!sw || !ne) return null;
  return { sw, ne };
}

function syncMapOverlay() {
  const view = getMapView();
  const host = ensureOverlayHost();
  if (!view || !host) return;
  const raster = ensureChild(host, EO_RASTER_ID, 'iqai-v2-eo-raster', 'img');
  const box = ensureChild(host, EO_BOX_ID, 'iqai-v2-eo-box');
  if (rasterState?.dataUrl && rasterState.bounds) {
    if (raster.getAttribute('src') !== rasterState.dataUrl) {
      raster.src = rasterState.dataUrl;
      raster.alt = 'Remote sensing overlay';
    }
    const rect = corners(view, rasterState.bounds);
    raster.hidden = !rect;
    if (rect) positionRect(raster, rect.sw, rect.ne);
  } else {
    raster.removeAttribute('src');
    raster.hidden = true;
  }
  if (aoiState) {
    const rect = corners(view, aoiState);
    box.hidden = !rect;
    if (rect) positionRect(box, rect.sw, rect.ne);
  } else {
    box.hidden = true;
  }
  const compareBox = ensureChild(host, EO_COMPARE_BOX_ID, 'iqai-v2-eo-compare-box');
  if (compareState) {
    const rect = corners(view, compareState);
    compareBox.hidden = !rect;
    if (rect) positionRect(compareBox, rect.sw, rect.ne);
  } else {
    compareBox.hidden = true;
  }
  const pin = ensureChild(host, EO_PIN_ID, 'iqai-v2-eo-pin');
  if (!pin.querySelector('span')) {
    pin.appendChild(document.createElement('span'));
  }
  if (pinState) {
    const screen = toScreen(view, pinState.lon, pinState.lat);
    pin.hidden = !screen;
    if (screen) {
      pin.style.left = `${screen.x}px`;
      pin.style.top = `${screen.y}px`;
    }
  } else {
    pin.hidden = true;
  }
  const caption = ensureChild(host, EO_CAPTION_ID, 'iqai-v2-eo-caption');
  const captionAnchor = rasterState?.bounds || aoiState;
  if (captionState && captionAnchor) {
    const rect = corners(view, captionAnchor);
    caption.hidden = !rect;
    caption.textContent = captionState;
    if (rect) {
      caption.style.left = `${Math.min(rect.sw.x, rect.ne.x)}px`;
      caption.style.top = `${Math.max(rect.sw.y, rect.ne.y) + 6}px`;
    }
  } else {
    caption.hidden = true;
    caption.textContent = '';
  }
  const stale = ensureChild(host, EO_STALE_ID, 'iqai-v2-eo-stale');
  raster.classList.toggle('is-stale', Boolean(staleState));
  if (staleState) {
    stale.hidden = false;
    stale.textContent = staleState;
  } else {
    stale.hidden = true;
    stale.textContent = '';
  }
}

function ensureWatch() {
  const view = getMapView();
  if (!view || watchedView === view) return;
  for (const handle of watchHandles) {
    try { handle.remove?.(); } catch { /* ignore */ }
  }
  watchHandles = [];
  watchedView = view;
  for (const prop of ['extent', 'rotation', 'stationary', 'scale', 'zoom']) {
    try {
      watchHandles.push(view.watch(prop, syncMapOverlay));
    } catch {
      /* property may not be watchable */
    }
  }
  try {
    watchHandles.push(view.on('resize', syncMapOverlay));
  } catch {
    /* ignore */
  }
}

function layerHost() {
  const view = getMapView();
  return view?.map || null;
}

async function ensureAoiLayer() {
  const host = layerHost();
  if (!host) return null;
  if (aoiLayer) {
    if (!host.findLayerById?.(EO_AOI_LAYER_ID) && !host.layers?.find?.((layer) => layer.id === EO_AOI_LAYER_ID)) {
      host.add(aoiLayer);
    }
    aoiLayer.visible = true;
    return aoiLayer;
  }
  const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
  aoiLayer = new GraphicsLayer({
    id: EO_AOI_LAYER_ID,
    title: 'Remote sensing AOI',
    listMode: 'hide',
    visible: true
  });
  host.add(aoiLayer);
  return aoiLayer;
}

async function paintAoiGraphic(bbox) {
  const layer = await ensureAoiLayer();
  if (!layer) return;
  layer.removeAll?.();
  if (!bbox) return;
  const [Graphic, Polygon] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Polygon.js')
  ]);
  const [west, south, east, north] = bbox;
  const polygon = new Polygon({
    rings: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    spatialReference: { wkid: 4326 }
  });
  layer.add(new Graphic({
    geometry: polygon,
    symbol: {
      type: 'simple-fill',
      color: [140, 245, 255, 0.08],
      outline: { color: [140, 245, 255, 0.95], width: 2 }
    }
  }));
}

export function paintAoiBox(bbox) {
  aoiState = Array.isArray(bbox) && bbox.length === 4 ? bbox.map(Number) : null;
  const host = ensureOverlayHost();
  if (host) {
    const box = ensureChild(host, EO_BOX_ID, 'iqai-v2-eo-box');
    box.hidden = !aoiState;
    syncMapOverlay();
  }
  void paintAoiGraphic(aoiState);
}

export function clearAoiBox() {
  aoiState = null;
  aoiLayer?.removeAll?.();
  const box = overlayParent()?.querySelector?.(`#${EO_BOX_ID}`);
  if (box) box.hidden = true;
}

export function paintDrawPreviewScreen(start, end, { compare = false } = {}) {
  const host = ensureOverlayHost();
  if (!host || !start || !end) return;
  const preview = ensureChild(host, EO_DRAW_ID, 'iqai-v2-eo-draw-box');
  preview.classList.toggle('is-compare', compare === true);
  preview.hidden = false;
  positionRect(preview, start, end);
}

export function clearDrawPreview() {
  overlayParent()?.querySelector?.(`#${EO_DRAW_ID}`)?.remove?.();
}

export async function paintEoOverlay({ dataUrl, bounds }) {
  if (!dataUrl || !Array.isArray(bounds) || bounds.length !== 4) {
    await clearEoOverlay();
    return null;
  }
  rasterState = { dataUrl, bounds: bounds.map(Number) };
  const host = ensureOverlayHost();
  if (host) {
    const raster = ensureChild(host, EO_RASTER_ID, 'iqai-v2-eo-raster', 'img');
    raster.src = dataUrl;
    raster.alt = 'Remote sensing overlay';
    raster.hidden = false;
    syncMapOverlay();
  }
  return rasterState;
}

export async function clearEoOverlay() {
  rasterState = null;
  captionState = null;
  staleState = null;
  const raster = overlayParent()?.querySelector?.(`#${EO_RASTER_ID}`);
  if (raster) {
    raster.removeAttribute('src');
    raster.classList.remove('is-stale');
    raster.hidden = true;
  }
  const caption = overlayParent()?.querySelector?.(`#${EO_CAPTION_ID}`);
  if (caption) {
    caption.hidden = true;
    caption.textContent = '';
  }
  const stale = overlayParent()?.querySelector?.(`#${EO_STALE_ID}`);
  if (stale) {
    stale.hidden = true;
    stale.textContent = '';
  }
  const host = layerHost();
  if (overlayLayer) {
    try { host?.remove?.(overlayLayer); } catch { /* already gone */ }
    overlayLayer = null;
  }
}

export function paintCompareBox(bbox) {
  compareState = Array.isArray(bbox) && bbox.length === 4 ? bbox.map(Number) : null;
  const host = ensureOverlayHost();
  if (host) {
    const box = ensureChild(host, EO_COMPARE_BOX_ID, 'iqai-v2-eo-compare-box');
    box.hidden = !compareState;
    syncMapOverlay();
  }
}

export function clearCompareBox() {
  compareState = null;
  const box = overlayParent()?.querySelector?.(`#${EO_COMPARE_BOX_ID}`);
  if (box) box.hidden = true;
}

export function paintProbePin(lon, lat) {
  const x = Number(lon);
  const y = Number(lat);
  pinState = Number.isFinite(x) && Number.isFinite(y) ? { lon: x, lat: y } : null;
  const host = ensureOverlayHost();
  if (host) {
    const pin = ensureChild(host, EO_PIN_ID, 'iqai-v2-eo-pin');
    if (!pin.querySelector('span')) pin.appendChild(document.createElement('span'));
    pin.hidden = !pinState;
    syncMapOverlay();
  }
}

export function clearProbePin() {
  pinState = null;
  const pin = overlayParent()?.querySelector?.(`#${EO_PIN_ID}`);
  if (pin) pin.hidden = true;
}

export function paintOverlayCaption(text) {
  captionState = String(text || '').trim() || null;
  syncMapOverlay();
}

export function setOverlayStale(message) {
  staleState = String(message || '').trim() || null;
  syncMapOverlay();
}

export async function goToAoi(bbox, pad = 0.003) {
  const view = getMapView();
  if (!view || !Array.isArray(bbox) || bbox.length !== 4) return;
  const [west, south, east, north] = bbox.map(Number);
  try {
    const Extent = await importArc('@arcgis/core/geometry/Extent.js');
    const extent = new Extent({
      xmin: west - pad,
      ymin: south - pad,
      xmax: east + pad,
      ymax: north + pad,
      spatialReference: { wkid: 4326 }
    });
    await view.goTo(extent, { animate: false });
  } catch {
    try {
      await view.goTo({
        center: [(west + east) / 2, (south + north) / 2],
        zoom: 15
      }, { animate: false });
    } catch {
      /* keep current view */
    }
  }
  syncMapOverlay();
}
