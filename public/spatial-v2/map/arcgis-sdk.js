/**
 * IQAI Spatial V2 — ArcGIS Maps SDK 5.1 loader.
 * Independent of the V1 MapView singleton.
 *
 * $arcgis CDN 5.1 uses classic workers that importScripts
 * `{assetsPath}/esri/core/workers/init.js` from the AMD CDN root.
 */

export const ARCGIS_SDK_VERSION = '5.1';
export const ARCGIS_CDN_URL = `https://js.arcgis.com/${ARCGIS_SDK_VERSION}/`;
export const ARCGIS_THEME_HREF = `https://js.arcgis.com/${ARCGIS_SDK_VERSION}/esri/themes/light/main.css`;
/** AMD CDN root. Workers load init.js from here. */
export const ARCGIS_ASSETS_PATH = `https://js.arcgis.com/${ARCGIS_SDK_VERSION}`;
export const ARCGIS_WORKER_INIT_URL = `${ARCGIS_ASSETS_PATH}/esri/core/workers/init.js`;

let sdkPromise = null;
let assetsPinned = false;

function applyAssetsPath(esriConfig) {
  const path = ARCGIS_ASSETS_PATH;
  if (esriConfig) esriConfig.assetsPath = path;
  if (typeof window !== 'undefined') {
    window.esriConfig = window.esriConfig || {};
    window.esriConfig.assetsPath = path;
  }
}

applyAssetsPath(typeof window !== 'undefined' ? window.esriConfig : null);

async function pinAssetsPath() {
  if (!window.$arcgis) {
    applyAssetsPath(window.esriConfig);
    return;
  }
  try {
    const mod = await window.$arcgis.import('@arcgis/core/config.js');
    const esriConfig = mod?.default || mod;
    applyAssetsPath(esriConfig);
    assetsPinned = true;
  } catch {
    applyAssetsPath(window.esriConfig);
    assetsPinned = false;
  }
}

export function loadArcgisSdk(cdnUrl = ARCGIS_CDN_URL) {
  applyAssetsPath(typeof window !== 'undefined' ? window.esriConfig : null);
  if (window.$arcgis) {
    return pinAssetsPath();
  }
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = cdnUrl;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Failed to load ArcGIS Maps SDK'));
    };
    document.head.appendChild(script);
  }).then(() => pinAssetsPath());
  return sdkPromise;
}

export async function importArc(path) {
  if (!window.$arcgis) {
    await loadArcgisSdk();
  } else {
    await pinAssetsPath();
  }
  const mod = await window.$arcgis.import(path);
  return mod?.default || mod;
}

export function getArcgisWorkerDiagnostics() {
  return {
    assetsPath: ARCGIS_ASSETS_PATH,
    workerInitUrl: ARCGIS_WORKER_INIT_URL,
    createCount: null,
    errorCount: null,
    lastError: null,
    records: []
  };
}
