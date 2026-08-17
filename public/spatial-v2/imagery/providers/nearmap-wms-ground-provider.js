import {
  DATE_KIND,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  PROVIDER_KIND,
  RIGHTS,
  emptyObservation,
  emptyRights
} from '../imagery-contract.js';
import { importArc } from '../../map/arcgis-sdk.js';

export const NEARMAP_WMS_PROXY = '/api/spatial-v2/imagery/nearmap/wms';
export const NEARMAP_WMS_STATUS = '/api/spatial-v2/imagery/nearmap/wms/status';
export const NEARMAP_WMS_LAYER = 'Nearmap';

function wmsProxyUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${NEARMAP_WMS_PROXY}`;
  }
  return NEARMAP_WMS_PROXY;
}

const NEARMAP_WMS_PATH = /\/wms\/v1\/(?:latest\/)?apikey\//i;

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

  async probeEntitlement() {
    try {
      const response = await fetch(NEARMAP_WMS_STATUS, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      return payload.entitlement || ENTITLEMENT_STATE.FAILED;
    } catch {
      return ENTITLEMENT_STATE.FAILED;
    }
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
      sourceIdentity: { kind: 'wms-latest', layer: NEARMAP_WMS_LAYER, proxy: NEARMAP_WMS_PROXY }
    });
  },

  async createBasemap() {
    const entitlement = await this.probeEntitlement();
    if (entitlement === ENTITLEMENT_STATE.ENTITLEMENT_MISSING) {
      throw new Error('Nearmap latest WMS is not configured on the server.');
    }
    if (entitlement === ENTITLEMENT_STATE.DENIED) {
      throw new Error('Nearmap latest WMS denied this session.');
    }
    if (entitlement !== ENTITLEMENT_STATE.READY) {
      throw new Error('Nearmap latest WMS is unavailable.');
    }
    await ensureNearmapWmsInterceptor();
    const [Basemap, WMSLayer] = await Promise.all([
      importArc('@arcgis/core/Basemap.js'),
      importArc('@arcgis/core/layers/WMSLayer.js')
    ]);
    const wms = new WMSLayer({
      id: 'iqai-ground-nearmap-wms',
      title: 'Nearmap latest',
      url: wmsProxyUrl(),
      version: '1.1.1',
      sublayers: [{ name: NEARMAP_WMS_LAYER }],
      imageFormat: 'png',
      customParameters: {
        VERSION: '1.1.1',
        FORMAT: 'image/png'
      },
      copyright: 'Nearmap',
      popupEnabled: false,
      listMode: 'hide'
    });
    const basemap = new Basemap({
      id: 'iqai-ground-nearmap',
      title: 'Nearmap latest',
      baseLayers: [wms]
    });
    await wms.load();
    return basemap;
  }
};
