import {
  DATE_KIND,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  PROVIDER_KIND,
  PROVIDER_READINESS_STATE,
  RIGHTS,
  emptyObservation,
  emptyRights
} from '../imagery-contract.js';
import { importArc } from '../../map/arcgis-sdk.js';

export const NEARMAP_WMS_PROXY = '/api/spatial-v2/imagery/nearmap/wms';
export const NEARMAP_WMS_STATUS = '/api/spatial-v2/imagery/nearmap/wms/status';
export const NEARMAP_WMS_LAYER = 'Nearmap/Nearmap/Canada';
export const AUTHORED_NEARMAP_WMS_TITLE = 'Aerial 3.5cm';
export const NEARMAP_GROUND_LAYER_ID = 'iqai-ground-nearmap-wms';
export const NEARMAP_WMS_VERSION = '1.1.1';
export const NEARMAP_WMS_FORMAT = 'image/jpeg';
export const NEARMAP_WMS_SRS = 'EPSG:3857';

function wmsProxyUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${NEARMAP_WMS_PROXY}`;
  }
  return NEARMAP_WMS_PROXY;
}

const NEARMAP_WMS_PATH = /\/wms\/v1\/(?:latest\/)?apikey\//i;

function readinessFromEntitlement(entitlement) {
  if (entitlement === ENTITLEMENT_STATE.READY) return PROVIDER_READINESS_STATE.READY;
  if (entitlement === ENTITLEMENT_STATE.ENTITLEMENT_MISSING) {
    return PROVIDER_READINESS_STATE.NOT_CONFIGURED;
  }
  if (entitlement === ENTITLEMENT_STATE.DENIED || entitlement === ENTITLEMENT_STATE.AUTH_REQUIRED) {
    return PROVIDER_READINESS_STATE.ENTITLEMENT_REQUIRED;
  }
  return PROVIDER_READINESS_STATE.UNAVAILABLE;
}

function rewriteNearmapWmsUrl(urlString) {
  const proxy = wmsProxyUrl();
  let incoming = null;
  try {
    incoming = new URL(String(urlString || ''), typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1');
  } catch {
    return proxy;
  }
  if (!NEARMAP_WMS_PATH.test(incoming.pathname) && !NEARMAP_WMS_PATH.test(incoming.href)) {
    return String(urlString || '');
  }
  const outgoing = new URL(proxy, typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1');
  incoming.searchParams.forEach((value, key) => {
    if (!/apikey|token|password|secret/i.test(key)) {
      outgoing.searchParams.set(key, value);
    }
  });
  return outgoing.toString();
}

let interceptPromise = null;
let authoredVisibilitySnapshot = null;

function layerList(collection) {
  if (!collection) return [];
  if (typeof collection.toArray === 'function') return collection.toArray();
  if (typeof collection.forEach === 'function') {
    const found = [];
    collection.forEach((item) => found.push(item));
    return found;
  }
  return [...collection];
}

function collectionHas(collection, layer) {
  if (!collection || !layer) return false;
  return layerList(collection).some((item) => item === layer || item?.id === layer.id);
}

function layerUrl(layer) {
  return String(layer?.url || layer?.mapUrl || '');
}

function layerNames(layer) {
  const sublayers = layerList(layer?.sublayers);
  const named = sublayers.map((item) => item?.name).filter(Boolean);
  const visible = Array.isArray(layer?.visibleLayers) ? layer.visibleLayers : [];
  return [...named, ...visible];
}

export function isAuthoredNearmapWmsLayer(layer) {
  if (!layer) return false;
  const url = layerUrl(layer);
  if (NEARMAP_WMS_PATH.test(url)) return true;
  const title = String(layer.title || '');
  const type = String(layer.type || layer.declaredClass || '').toLowerCase();
  if (type.includes('wms') && title === AUTHORED_NEARMAP_WMS_TITLE) return true;
  return layerNames(layer).includes(NEARMAP_WMS_LAYER);
}

export function findAuthoredNearmapWmsLayer(webmap) {
  return layerList(webmap?.allLayers).find(isAuthoredNearmapWmsLayer) || null;
}

export function findNearmapGroundLayer(webmap) {
  return layerList(webmap?.allLayers).find((layer) => layer?.id === NEARMAP_GROUND_LAYER_ID)
    || findAuthoredNearmapWmsLayer(webmap);
}

export function buildNearmapWmsGetMapUrl({ bbox, width = 256, height = 256, origin } = {}) {
  const url = new URL(
    NEARMAP_WMS_PROXY,
    origin || (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1')
  );
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('REQUEST', 'GetMap');
  url.searchParams.set('VERSION', NEARMAP_WMS_VERSION);
  url.searchParams.set('LAYERS', NEARMAP_WMS_LAYER);
  url.searchParams.set('STYLES', '');
  url.searchParams.set('FORMAT', NEARMAP_WMS_FORMAT);
  url.searchParams.set('SRS', NEARMAP_WMS_SRS);
  url.searchParams.set('BBOX', String(bbox || ''));
  url.searchParams.set('WIDTH', String(width));
  url.searchParams.set('HEIGHT', String(height));
  url.searchParams.set('TRANSPARENT', 'true');
  return url.toString();
}

export function webMercatorBboxAround(longitude, latitude, halfMeters = 160) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = lon * 20037508.342789244 / 180;
  const latRad = lat * Math.PI / 180;
  const y = Math.log(Math.tan((Math.PI / 4) + (latRad / 2))) * 6378137;
  return `${x - halfMeters},${y - halfMeters},${x + halfMeters},${y + halfMeters}`;
}

export async function probeNearmapGetMapAt(longitude, latitude) {
  const bbox = webMercatorBboxAround(longitude, latitude);
  if (!bbox) return { ok: false, reason: 'invalid-point' };
  try {
    const response = await fetch(buildNearmapWmsGetMapUrl({ bbox, width: 64, height: 64 }), {
      cache: 'no-store'
    });
    const contentType = String(response.headers.get('content-type') || '');
    const buffer = await response.arrayBuffer();
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    if (/xml|html|text/i.test(contentType)) return { ok: false, reason: 'service-exception' };
    const bytes = new Uint8Array(buffer);
    const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!jpeg && !png && !contentType.startsWith('image/')) {
      return { ok: false, reason: 'not-image' };
    }
    if (buffer.byteLength < 32) return { ok: false, reason: 'empty' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

function snapshotVisibility(layer, seen) {
  if (!layer || seen.has(layer)) return;
  seen.add(layer);
  authoredVisibilitySnapshot.push({
    layer,
    visible: layer.visible !== false
  });
}

export function restoreAuthoredNearmapGround() {
  if (!authoredVisibilitySnapshot) return;
  for (const item of authoredVisibilitySnapshot) {
    if (item.layer && !item.layer.destroyed) item.layer.visible = item.visible;
  }
  authoredVisibilitySnapshot = null;
}

let tileLayerClassPromise = null;

async function nearMapWmsTileLayerClass() {
  if (tileLayerClassPromise) return tileLayerClassPromise;
  tileLayerClassPromise = Promise.all([
    importArc('@arcgis/core/layers/BaseTileLayer.js'),
    importArc('@arcgis/core/layers/support/TileInfo.js'),
    importArc('@arcgis/core/geometry/SpatialReference.js'),
    importArc('@arcgis/core/geometry/Extent.js'),
    importArc('@arcgis/core/request.js')
  ]).then(([BaseTileLayer, TileInfo, SpatialReference, Extent, esriRequest]) => {
    const webMercator = SpatialReference.WebMercator || new SpatialReference({ wkid: 3857 });
    const worldExtent = new Extent({
      xmin: -20037508.342789244,
      ymin: -20037508.342789244,
      xmax: 20037508.342789244,
      ymax: 20037508.342789244,
      spatialReference: webMercator
    });
    return BaseTileLayer.createSubclass({
      declaredClass: 'iqai.spatial.NearmapWmsTileLayer',

      constructor() {
        this.tileInfo = TileInfo.create();
        this.spatialReference = webMercator;
        this.fullExtent = worldExtent;
      },

      fetchTile(level, row, col, options) {
        const bounds = typeof this.getTileBounds === 'function'
          ? this.getTileBounds(level, row, col)
          : null;
        const bbox = bounds
          ? `${bounds[0]},${bounds[1]},${bounds[2]},${bounds[3]}`
          : null;
        if (!bbox) {
          return Promise.reject(new Error('Nearmap WMS tile bounds are missing.'));
        }
        const width = this.tileInfo?.size?.[0] || 256;
        const height = this.tileInfo?.size?.[1] || width;
        const url = buildNearmapWmsGetMapUrl({ bbox, width, height });
        return esriRequest(url, {
          responseType: 'image',
          signal: options?.signal
        }).then((response) => response.data);
      }
    });
  });
  return tileLayerClassPromise;
}

export async function createNearmapCurrentTileLayer(options = {}) {
  const NearmapWmsTileLayer = await nearMapWmsTileLayerClass();
  return new NearmapWmsTileLayer({
    id: NEARMAP_GROUND_LAYER_ID,
    title: 'Nearmap current ground',
    copyright: 'Nearmap',
    visible: options.visible !== false,
    opacity: 1,
    popupEnabled: false,
    listMode: 'hide'
  });
}

export async function ensureAuthoredNearmapGroundSlot(webmap, existingLayer = null) {
  const existing = layerList(webmap?.allLayers).find((layer) => layer?.id === NEARMAP_GROUND_LAYER_ID)
    || existingLayer
    || null;
  if (existing) {
    return existing;
  }
  const layer = await createNearmapCurrentTileLayer({ visible: false });
  webmap.layers.add(layer, 0);
  return layer;
}

export async function applyAuthoredNearmapGround(webmap) {
  const layer = findNearmapGroundLayer(webmap);
  if (!layer) {
    throw new Error('Nearmap current-ground slot was not created before MapView construction.');
  }
  restoreAuthoredNearmapGround();
  authoredVisibilitySnapshot = [];
  snapshotVisibility(layer, new Set());
  const authored = findAuthoredNearmapWmsLayer(webmap);
  if (authored && authored !== layer) {
    snapshotVisibility(authored, new Set([layer]));
    authored.visible = false;
  }
  layer.visible = true;
  layer.opacity = 1;
  if (typeof layer.refresh === 'function') layer.refresh();
  return layer;
}

export function ensureNearmapWmsInterceptor() {
  if (interceptPromise) return interceptPromise;
  interceptPromise = (async () => {
    const esriConfig = await importArc('@arcgis/core/config.js');
    esriConfig.request.interceptors.push({
      urls: NEARMAP_WMS_PATH,
      before: (params) => {
        params.url = rewriteNearmapWmsUrl(params.url);
      }
    });
    if (typeof window === 'undefined') return;
    if (!window.__iqaiNearmapFetchGuard) {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === 'string') return originalFetch(rewriteNearmapWmsUrl(input), init);
        if (input instanceof Request) {
          const nextUrl = rewriteNearmapWmsUrl(input.url);
          if (nextUrl !== input.url) return originalFetch(new Request(nextUrl, input), init);
        }
        return originalFetch(input, init);
      };
      window.__iqaiNearmapFetchGuard = true;
    }
    if (!window.__iqaiNearmapXhrGuard && window.XMLHttpRequest) {
      const originalOpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        return originalOpen.call(this, method, rewriteNearmapWmsUrl(url), ...rest);
      };
      window.__iqaiNearmapXhrGuard = true;
    }
    if (!window.__iqaiNearmapImageGuard && window.HTMLImageElement) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');
      if (descriptor?.set && descriptor?.get) {
        Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
          configurable: true,
          enumerable: descriptor.enumerable,
          get() {
            return descriptor.get.call(this);
          },
          set(value) {
            descriptor.set.call(this, rewriteNearmapWmsUrl(value));
          }
        });
      }
      window.__iqaiNearmapImageGuard = true;
    }
  })().catch((error) => {
    interceptPromise = null;
    throw error;
  });
  return interceptPromise;
}

export const nearmapWmsGroundProvider = {
  id: 'nearmap-wms-latest',
  title: 'Nearmap latest',
  kind: PROVIDER_KIND.CURRENT_GROUND,

  describe() {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      modeId: GROUND_MODE.NEARMAP,
      proxy: NEARMAP_WMS_PROXY
    };
  },

  async probeReadiness() {
    try {
      const response = await fetch(NEARMAP_WMS_STATUS, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      const entitlement = payload.entitlement || ENTITLEMENT_STATE.FAILED;
      const readinessState = payload.readinessState || readinessFromEntitlement(entitlement);
      return {
        providerId: this.id,
        readinessState,
        entitlement,
        configured: readinessState !== PROVIDER_READINESS_STATE.NOT_CONFIGURED,
        historical: payload.historical === true,
        serviceType: payload.serviceType || 'WMS',
        limitation: payload.error || (
          payload.readinessState === PROVIDER_READINESS_STATE.READY
            ? 'Nearmap latest WMS is current ground only; it exposes no dated observations.'
            : null
        )
      };
    } catch (error) {
      return {
        providerId: this.id,
        readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
        entitlement: ENTITLEMENT_STATE.FAILED,
        configured: null,
        historical: false,
        serviceType: 'WMS',
        limitation: String(error?.message || error)
      };
    }
  },

  async probeEntitlement() {
    return (await this.probeReadiness()).entitlement;
  },

  observationFor() {
    return emptyObservation({
      id: 'nearmap-wms-latest',
      providerId: this.id,
      productName: 'Nearmap latest vertical WMS',
      dateKindUsed: DATE_KIND.SERVICE_CURRENT,
      rights: emptyRights({
        display: RIGHTS.PERMITTED,
        export: RIGHTS.UNKNOWN,
        cache: RIGHTS.UNKNOWN,
        analysis: RIGHTS.PROHIBITED
      }),
      limitation: 'Current Nearmap latest mosaic only. This WMS does not expose survey dates, TIME, or vintages.',
      establishes: 'Latest Nearmap vertical display.',
      doesNotEstablish: 'A dated capture, Time Machine archive, or Situation time.',
      sourceIdentity: {
        kind: 'authored-wms-latest',
        layer: NEARMAP_WMS_LAYER,
        title: AUTHORED_NEARMAP_WMS_TITLE,
        version: '1.1.1',
        proxy: NEARMAP_WMS_PROXY
      }
    });
  },

  async createBasemap() {
    throw new Error('Nearmap current ground uses a pre-MapView operational WMS tile layer. Do not construct a post-MapView WMS basemap.');
  }
};
