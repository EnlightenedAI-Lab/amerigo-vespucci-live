/**
 * IQAI Spatial V2 — ArcGIS Maps SDK 5.1 loader.
 * Independent of the V1 MapView singleton.
 */

export const ARCGIS_SDK_VERSION = '5.1';
export const ARCGIS_CDN_URL = `https://js.arcgis.com/${ARCGIS_SDK_VERSION}/`;
export const ARCGIS_THEME_HREF = `https://js.arcgis.com/${ARCGIS_SDK_VERSION}/esri/themes/light/main.css`;
export const ARCGIS_ASSETS_PATH = 'https://js.arcgis.com/5.1.16/@arcgis/core/assets';

let sdkPromise = null;
let assetsPinned = false;

async function pinAssetsPath() {
  if (assetsPinned || !window.$arcgis) return;
  try {
    const mod = await window.$arcgis.import('@arcgis/core/config.js');
    const esriConfig = mod?.default || mod;
    if (esriConfig) {
      esriConfig.assetsPath = ARCGIS_ASSETS_PATH;
    }
    assetsPinned = true;
  } catch {
    assetsPinned = false;
  }
}

export function loadArcgisSdk(cdnUrl = ARCGIS_CDN_URL) {
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
