/**
 * At most one heavy interactive 360 viewer for the Camera Wall.
 * Detached from the Spatial Street360 specialist stage.
 * Token is never written into visible DOM text.
 */

import { VISUAL_PROVIDER } from './provider-representation.js';

const MAPILLARY_JS = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js';
const MAPILLARY_CSS = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.min.css';

let assetsPromise = null;
let googlePano = null;
let mapillaryViewer = null;
let boundKey = null;
let liveCount = 0;

function loadMapillaryAssets() {
  if (window.mapillary) return Promise.resolve(window.mapillary);
  if (assetsPromise) return assetsPromise;
  assetsPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-iqai-wall-mapillary-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPILLARY_CSS;
      link.setAttribute('data-iqai-wall-mapillary-css', 'true');
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = MAPILLARY_JS;
    script.async = true;
    script.onload = () => resolve(window.mapillary || null);
    script.onerror = () => reject(new Error('MAPILLARY_JS_LOAD_FAILED'));
    document.head.appendChild(script);
  });
  return assetsPromise;
}

function representationKey(representation) {
  if (!representation?.providerId) return null;
  return `${representation.provider}::${representation.providerId}`;
}

export function getLiveHeavyViewerCount() {
  return liveCount;
}

export async function parkWallHeavyViewer(stage) {
  boundKey = null;
  liveCount = 0;
  try { googlePano?.setVisible?.(false); } catch { /* parked */ }
  try { googlePano = null; } catch { /* parked */ }
  try { mapillaryViewer?.remove?.(); } catch { /* parked */ }
  mapillaryViewer = null;
  if (stage) stage.replaceChildren();
}

function mapsJsAuthFailed(root) {
  const node = root?.querySelector?.('.gm-err-container, .gm-err-message, .gm-err-title');
  if (!node) return false;
  return /didn't load Google Maps correctly|Oops! Something went wrong/i.test(node.textContent || '');
}

async function streetViewPanoramaCtor() {
  const google = window.google;
  if (typeof google?.maps?.StreetViewPanorama === 'function') return google.maps.StreetViewPanorama;
  try {
    const lib = await google?.maps?.importLibrary?.('streetView');
    return lib?.StreetViewPanorama || google?.maps?.StreetViewPanorama || null;
  } catch {
    return google?.maps?.StreetViewPanorama || null;
  }
}

export async function activateWallHeavyViewer(stage, representation) {
  const key = representationKey(representation);
  if (!stage || !key) {
    await parkWallHeavyViewer(stage);
    return { liveDecoders: 0, heavy: false };
  }
  if (key === boundKey && liveCount === 1 && !mapsJsAuthFailed(stage)) {
    return { liveDecoders: 1, heavy: true, provider: representation.provider };
  }
  await parkWallHeavyViewer(stage);
  if (representation.provider === VISUAL_PROVIDER.GOOGLE_STREET360) {
    const Panorama = await streetViewPanoramaCtor();
    if (typeof Panorama !== 'function') {
      return { liveDecoders: 0, heavy: false, status: 'GOOGLE_STREET_VIEW_UNAVAILABLE' };
    }
    const host = document.createElement('div');
    host.className = 'iqai-v2-camera-wall__pano';
    host.setAttribute('data-iqai-camera-wall-heavy-kind', 'google');
    stage.appendChild(host);
    googlePano = new Panorama(host, {
      pano: representation.providerId,
      pov: {
        heading: Number.isFinite(Number(representation.compassDeg)) ? Number(representation.compassDeg) : 0,
        pitch: 0
      },
      zoom: 1,
      visible: true,
      disableDefaultUI: true,
      addressControl: false,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
      clickToGo: true,
      linksControl: true,
      panControl: false,
      zoomControl: false,
      imageDateControl: true,
      showRoadLabels: false
    });
    boundKey = key;
    liveCount = 1;
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (mapsJsAuthFailed(host) || mapsJsAuthFailed(stage)) {
        await parkWallHeavyViewer(stage);
        return { liveDecoders: 0, heavy: false, status: 'GOOGLE_MAPS_JS_AUTH_FAILED' };
      }
      if (host.querySelector('.gm-style, canvas, iframe')) break;
    }
    return { liveDecoders: 1, heavy: true, provider: representation.provider };
  }
  if (representation.provider === VISUAL_PROVIDER.MAPILLARY) {
    const config = await fetch('/spatial-v2/api/camera-providers/mapillary-viewer-config', { cache: 'no-store' })
      .then((res) => res.json())
      .catch(() => ({ configured: false }));
    if (!config?.configured || !config.accessToken) {
      if (representation.thumbUrl) {
        const img = document.createElement('img');
        img.alt = 'MAPILLARY PROVIDER REPRESENTATION';
        img.src = representation.thumbUrl;
        stage.appendChild(img);
      }
      return {
        liveDecoders: 0,
        heavy: false,
        status: 'MAPILLARY_CREDENTIAL_REQUIRED'
      };
    }
    try {
      const lib = await loadMapillaryAssets();
      const Viewer = lib?.Viewer;
      if (!Viewer) throw new Error('MAPILLARY_JS_UNAVAILABLE');
      const host = document.createElement('div');
      host.className = 'iqai-v2-camera-wall__pano';
      host.setAttribute('data-iqai-camera-wall-heavy-kind', 'mapillary');
      stage.appendChild(host);
      mapillaryViewer = new Viewer({
        accessToken: config.accessToken,
        container: host,
        imageId: String(representation.providerId)
      });
      boundKey = key;
      liveCount = 1;
      return { liveDecoders: 1, heavy: true, provider: representation.provider };
    } catch {
      if (representation.thumbUrl) {
        const img = document.createElement('img');
        img.alt = 'MAPILLARY PROVIDER REPRESENTATION';
        img.src = representation.thumbUrl;
        stage.appendChild(img);
      }
      return { liveDecoders: 0, heavy: false, status: 'MAPILLARY_JS_UNAVAILABLE' };
    }
  }
  await parkWallHeavyViewer(stage);
  return { liveDecoders: 0, heavy: false };
}
