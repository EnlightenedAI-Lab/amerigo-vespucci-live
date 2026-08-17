/**
 * IQAI Spatial V2 — Google Maps JavaScript photorealistic 3D specialist stage.
 *
 * Official path: Maps JS + importLibrary("maps3d") + Map3DElement.
 * Visual context only. Not an ArcGIS 3D view. Not Map Tiles API mesh.
 * Do not use the Map Tiles server key here.
 */

import {
  MONTREAL_OPERATIONAL_CENTER,
  isGreaterMontrealLongitudeLatitude
} from '../../spatial/montreal-operational-config.js';

export const GOOGLE_MAPS_JS_CONFIG = '/api/spatial/config';
export const GOOGLE_MAPS_JS_3D_MODE = 'HYBRID';
export const GOOGLE_MAPS_JS_3D_RANGE_METERS = 1000;
export const GOOGLE_MAPS_JS_3D_TILT_DEG = 60;
export const GOOGLE_MAPS_JS_3D_HEADING_DEG = 38;

const BOOTSTRAP_SCRIPT_ID = 'iqai-google-maps-js-3d-bootstrap';

let map3d = null;
let marker = null;
let selectedPoint = null;
let lastError = null;
let mapsJsLoaded = false;
let maps3dLoaded = false;
let stageCreateCount = 0;
let generation = 0;
let lastSteady = false;
let browserKeyPresent = false;
let restoreAmdDetection = null;

function suppressArcgisAmdDetection() {
  const define = window.define;
  if (typeof define !== 'function' || !define.amd) return () => {};
  const descriptor = Object.getOwnPropertyDescriptor(define, 'amd');
  const amd = define.amd;
  try {
    if (descriptor?.configurable) delete define.amd;
    else define.amd = undefined;
  } catch {
    return () => {};
  }
  return () => {
    try {
      if (descriptor) Object.defineProperty(define, 'amd', descriptor);
      else define.amd = amd;
    } catch {
      // ArcGIS may replace its loader while the specialist stage is open.
    }
  };
}

function installMapsJsBootstrap(apiKey) {
  if (window.google?.maps?.importLibrary) return;
  if (document.getElementById(BOOTSTRAP_SCRIPT_ID)) return;
  const script = document.createElement('script');
  script.id = BOOTSTRAP_SCRIPT_ID;
  script.textContent = `
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=\`https://maps.\${c}apis.com/maps/api/js?\`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
      key: ${JSON.stringify(apiKey)},
      v: "weekly"
    });
  `;
  document.head.appendChild(script);
}

async function fetchBrowserKey() {
  const response = await fetch(GOOGLE_MAPS_JS_CONFIG, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  const key = String(payload?.streetLevelContext?.googleMapsBrowserApiKey || '').trim();
  browserKeyPresent = Boolean(key);
  return key;
}

function waitForSteady(element, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      element.removeEventListener('gmp-steadychange', onSteady);
      element.removeEventListener('gmp-error', onError);
      reject(new Error('Google Map3DElement did not become steady.'));
    }, timeoutMs);
    const onError = (event) => {
      lastError = String(event?.message || event?.detail || 'gmp-error');
    };
    const onSteady = (event) => {
      const steady = event?.isSteady ?? event?.detail?.isSteady;
      if (steady === false) return;
      lastSteady = true;
      clearTimeout(timer);
      element.removeEventListener('gmp-error', onError);
      element.removeEventListener('gmp-steadychange', onSteady);
      resolve();
    };
    element.addEventListener('gmp-error', onError, { once: true });
    element.addEventListener('gmp-steadychange', onSteady);
  });
}

function cameraSnapshot() {
  if (!map3d) return null;
  const center = map3d.center || {};
  return {
    lat: Number(center.lat),
    lng: Number(center.lng),
    altitude: Number(center.altitude),
    tilt: Number(map3d.tilt),
    heading: Number(map3d.heading),
    range: Number(map3d.range),
    mode: String(map3d.mode || '')
  };
}

export async function probeGoogleMapsJs3d() {
  try {
    const key = await fetchBrowserKey();
    return {
      ok: Boolean(key),
      providerId: 'google-maps-js-maps3d',
      renderer: 'Map3DElement',
      configured: Boolean(key),
      credentialUsable: Boolean(key),
      visualContextOnly: true,
      analysis: 'PROHIBITED',
      limitation: key
        ? 'Browser-restricted Maps JavaScript API key is present. Photorealistic 3D is visual context only.'
        : 'GOOGLE_MAPS_BROWSER_API_KEY is not configured on the server.'
    };
  } catch (error) {
    return {
      ok: false,
      providerId: 'google-maps-js-maps3d',
      renderer: 'Map3DElement',
      configured: false,
      credentialUsable: false,
      visualContextOnly: true,
      analysis: 'PROHIBITED',
      limitation: String(error?.message || error)
    };
  }
}

export function getGoogleMapsJs3dSnapshot() {
  const host = map3d?.parentElement || null;
  const attribution = Boolean(
    host?.querySelector?.('.gm-style-cc, [aria-label*="Google" i], img[alt*="Google" i]')
    || document.querySelector('gmp-map-3d')
  );
  return {
    open: Boolean(map3d),
    renderer: 'Map3DElement',
    mapsJsLoaded,
    maps3dLoaded,
    mode: map3d ? String(map3d.mode || GOOGLE_MAPS_JS_3D_MODE) : null,
    stageCreateCount,
    selectedPoint: selectedPoint ? { ...selectedPoint } : null,
    camera: cameraSnapshot(),
    markerPresent: Boolean(marker),
    steady: lastSteady,
    browserKeyPresent,
    attributionLikely: attribution,
    error: lastError,
    visualContextOnly: true,
    analysis: 'PROHIBITED'
  };
}

export async function closeGoogleMapsJs3d() {
  generation += 1;
  try {
    marker?.remove?.();
  } catch {
    // already gone
  }
  try {
    map3d?.stopCameraAnimation?.();
  } catch {
    // ignore
  }
  try {
    map3d?.remove?.();
  } catch {
    // already gone
  }
  marker = null;
  map3d = null;
  lastSteady = false;
  restoreAmdDetection?.();
  restoreAmdDetection = null;
}

export async function openGoogleMapsJs3d(options = {}) {
  const container = options.container;
  if (!container) throw new Error('Google Maps JS 3D host is missing.');
  const longitude = Number(options.longitude);
  const latitude = Number(options.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) {
    throw new Error('Selected point is outside Greater Montréal.');
  }
  await closeGoogleMapsJs3d();
  const token = ++generation;
  lastError = null;
  lastSteady = false;
  selectedPoint = {
    longitude,
    latitude,
    spatialReferenceWkid: 4326,
    source: options.source || 'mapview-center'
  };

  const apiKey = await fetchBrowserKey();
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_BROWSER_API_KEY is not configured on the server.');
  }
  restoreAmdDetection = suppressArcgisAmdDetection();
  installMapsJsBootstrap(apiKey);
  if (!window.google?.maps?.importLibrary) {
    restoreAmdDetection();
    restoreAmdDetection = null;
    throw new Error('google.maps.importLibrary is unavailable.');
  }
  mapsJsLoaded = true;
  let maps3d;
  try {
    maps3d = await window.google.maps.importLibrary('maps3d');
  } catch (error) {
    restoreAmdDetection();
    restoreAmdDetection = null;
    throw error;
  }
  maps3dLoaded = true;
  if (token !== generation) return getGoogleMapsJs3dSnapshot();

  const Map3DElement = maps3d.Map3DElement;
  const Marker3DElement = maps3d.Marker3DElement;
  const MapMode = maps3d.MapMode;
  if (!Map3DElement) throw new Error('Map3DElement is unavailable.');
  const mode = MapMode?.HYBRID || MapMode?.SATELLITE || GOOGLE_MAPS_JS_3D_MODE;

  container.hidden = false;
  container.removeAttribute('hidden');
  container.innerHTML = '';

  map3d = new Map3DElement({
    center: { lat: latitude, lng: longitude, altitude: 400 },
    range: GOOGLE_MAPS_JS_3D_RANGE_METERS,
    tilt: GOOGLE_MAPS_JS_3D_TILT_DEG,
    heading: GOOGLE_MAPS_JS_3D_HEADING_DEG,
    mode,
    gestureHandling: 'GREEDY',
    description: 'Google photorealistic 3D Montréal visual context'
  });
  map3d.style.cssText = 'display:block;width:100%;height:100%;';
  if (Marker3DElement) {
    marker = new Marker3DElement({
      position: { lat: latitude, lng: longitude, altitude: 40 },
      altitudeMode: maps3d.AltitudeMode?.RELATIVE_TO_MESH || 'RELATIVE_TO_MESH',
      extruded: true,
      label: 'SELECTED POINT'
    });
    map3d.append(marker);
  }
  container.append(map3d);
  stageCreateCount += 1;
  await customElements.whenDefined('gmp-map-3d').catch(() => {});
  try {
    await waitForSteady(map3d);
  } catch (error) {
    lastError = String(error?.message || error);
    // Keep the stage; live capture may still show tiles after a late settle.
  }
  return getGoogleMapsJs3dSnapshot();
}

export async function nudgeGoogleMapsJs3dHeading(deltaDeg = 28) {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  const current = Number(map3d.heading) || 0;
  const next = (current + Number(deltaDeg || 0) + 360) % 360;
  map3d.heading = next;
  return getGoogleMapsJs3dSnapshot();
}

export function getSelectedPoint() {
  return selectedPoint ? { ...selectedPoint } : {
    longitude: MONTREAL_OPERATIONAL_CENTER.longitude,
    latitude: MONTREAL_OPERATIONAL_CENTER.latitude,
    spatialReferenceWkid: 4326,
    source: 'montreal-operational-center'
  };
}

export function getGoogleMapsJs3dElement() {
  return map3d;
}

export function getGoogleMapsJs3dStageCreateCount() {
  return stageCreateCount;
}
