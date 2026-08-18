/**
 * IQAI Spatial V2 — Google Maps JavaScript photorealistic 3D specialist stage.
 *
 * Official path: Maps JS + importLibrary("maps3d") + Map3DElement.
 * Visual context only. Not an ArcGIS 3D view. Not Map Tiles API mesh.
 * Do not use the Map Tiles server key here.
 */

import {
  isGreaterMontrealLongitudeLatitude
} from '../../spatial/montreal-operational-config.js';

export const GOOGLE_MAPS_JS_CONFIG = '/api/spatial/config';
export const GOOGLE_MAPS_JS_3D_MODE = 'SATELLITE';
export const GOOGLE_MAPS_JS_3D_RANGE_METERS = 1000;
export const GOOGLE_MAPS_JS_3D_TILT_DEG = 60;
export const GOOGLE_MAPS_JS_3D_HEADING_DEG = 38;
export const GOOGLE_MAPS_JS_3D_TILT_STEP_DEG = 12;
export const GOOGLE_MAPS_JS_3D_HEADING_STEP_DEG = 30;
export const GOOGLE_MAPS_JS_3D_TOP_TILT_DEG = 8;
export const GOOGLE_MAPS_JS_3D_TOP_RANGE_METERS = 1600;
export const GOOGLE_MAPS_JS_3D_MIN_TILT_DEG = 5;
export const GOOGLE_MAPS_JS_3D_MAX_TILT_DEG = 85;

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
let maps3dLib = null;
let cameraInitGeneration = 0;
let referenceRestoreGeneration = 0;

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

function modeName(mode) {
  if (mode == null) return '';
  if (typeof mode === 'string') return mode;
  return String(mode.value || mode.name || mode);
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
    mode: modeName(map3d.mode)
  };
}

function clampTilt(value) {
  const tilt = Number(value);
  const baseline = Number.isFinite(tilt) ? tilt : GOOGLE_MAPS_JS_3D_TILT_DEG;
  return Math.min(GOOGLE_MAPS_JS_3D_MAX_TILT_DEG, Math.max(GOOGLE_MAPS_JS_3D_MIN_TILT_DEG, baseline));
}

function wrapHeading(value) {
  const heading = Number(value) || 0;
  return (heading + 360) % 360;
}

function selectedCenter(altitude) {
  if (!selectedPoint) return null;
  return {
    lat: selectedPoint.latitude,
    lng: selectedPoint.longitude,
    altitude: Number.isFinite(altitude) ? altitude : 400
  };
}

function currentOrSelectedCenter() {
  const camera = cameraSnapshot() || {};
  if (Number.isFinite(camera.lat) && Number.isFinite(camera.lng)) {
    return {
      lat: camera.lat,
      lng: camera.lng,
      altitude: Number.isFinite(camera.altitude) ? camera.altitude : 400
    };
  }
  return selectedCenter(400);
}

function standardSelectedCamera() {
  const center = selectedCenter(400);
  return {
    center,
    range: GOOGLE_MAPS_JS_3D_RANGE_METERS,
    tilt: GOOGLE_MAPS_JS_3D_TILT_DEG,
    heading: GOOGLE_MAPS_JS_3D_HEADING_DEG
  };
}

function restoreCamera(camera) {
  if (!camera) return;
  assignLiveCamera({
    center: Number.isFinite(camera.lat) && Number.isFinite(camera.lng)
      ? { lat: camera.lat, lng: camera.lng, altitude: camera.altitude }
      : null,
    range: camera.range,
    tilt: camera.tilt,
    heading: camera.heading
  });
}

function assignLiveCamera(camera) {
  if (!map3d || !camera) return;
  map3d.stopCameraAnimation?.();
  if (camera.center && Number.isFinite(camera.center.lat) && Number.isFinite(camera.center.lng)) {
    map3d.center = {
      lat: camera.center.lat,
      lng: camera.center.lng,
      altitude: Number.isFinite(camera.center.altitude) ? camera.center.altitude : 400
    };
  }
  if (Number.isFinite(camera.range)) map3d.range = camera.range;
  if (Number.isFinite(camera.tilt)) map3d.tilt = clampTilt(camera.tilt);
  if (Number.isFinite(camera.heading)) map3d.heading = wrapHeading(camera.heading);
}

async function flyOrAssignCamera(camera, durationMillis = 1600) {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  map3d.stopCameraAnimation?.();
  if (typeof map3d.flyCameraTo === 'function' && camera?.center) {
    await map3d.flyCameraTo({
      endCamera: {
        center: camera.center,
        range: camera.range,
        tilt: camera.tilt,
        heading: camera.heading
      },
      durationMillis
    });
    return getGoogleMapsJs3dSnapshot();
  }
  assignLiveCamera(camera);
  return getGoogleMapsJs3dSnapshot();
}

function resolveMapMode(referenceEnabled) {
  const MapMode = maps3dLib?.MapMode;
  if (referenceEnabled) return MapMode?.HYBRID || 'HYBRID';
  return MapMode?.SATELLITE || 'SATELLITE';
}

export function isGoogleMapsJs3dReferenceEnabled() {
  return /HYBRID/i.test(modeName(map3d?.mode));
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
    mode: map3d ? (modeName(map3d.mode) || GOOGLE_MAPS_JS_3D_MODE) : null,
    referenceEnabled: isGoogleMapsJs3dReferenceEnabled(),
    defaultUIHidden: map3d ? map3d.defaultUIHidden === true : null,
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
  cameraInitGeneration += 1;
  referenceRestoreGeneration += 1;
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
  maps3dLib = maps3d;
  maps3dLoaded = true;
  if (token !== generation) return getGoogleMapsJs3dSnapshot();

  const Map3DElement = maps3d.Map3DElement;
  const Marker3DElement = maps3d.Marker3DElement;
  if (!Map3DElement) throw new Error('Map3DElement is unavailable.');
  const mode = resolveMapMode(false);

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
    defaultUIHidden: false,
    description: 'Google photorealistic 3D Montréal visual context'
  });
  map3d.defaultUIHidden = false;
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
  const initToken = ++cameraInitGeneration;
  await customElements.whenDefined('gmp-map-3d').catch(() => {});
  if (initToken === cameraInitGeneration && map3d) {
    map3d.defaultUIHidden = false;
    map3d.gestureHandling = maps3d.GestureHandling?.GREEDY || 'GREEDY';
  }
  try {
    await waitForSteady(map3d);
  } catch (error) {
    lastError = String(error?.message || error);
    // Keep the stage; live capture may still show tiles after a late settle.
  }
  if (initToken === cameraInitGeneration && map3d) {
    map3d.defaultUIHidden = false;
  }
  map3d?.addEventListener?.('gmp-click', () => {
    map3d?.stopCameraAnimation?.();
  });
  return getGoogleMapsJs3dSnapshot();
}

export async function nudgeGoogleMapsJs3dHeading(deltaDeg = GOOGLE_MAPS_JS_3D_HEADING_STEP_DEG) {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  map3d.stopCameraAnimation?.();
  map3d.heading = wrapHeading((Number(map3d.heading) || 0) + Number(deltaDeg || 0));
  return getGoogleMapsJs3dSnapshot();
}

export async function nudgeGoogleMapsJs3dTilt(deltaDeg = GOOGLE_MAPS_JS_3D_TILT_STEP_DEG) {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  map3d.stopCameraAnimation?.();
  const current = Number(map3d.tilt);
  const baseline = Number.isFinite(current) ? current : GOOGLE_MAPS_JS_3D_TILT_DEG;
  map3d.tilt = clampTilt(baseline + Number(deltaDeg || 0));
  return getGoogleMapsJs3dSnapshot();
}

export async function resetGoogleMapsJs3dNorth() {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  map3d.stopCameraAnimation?.();
  map3d.heading = 0;
  return getGoogleMapsJs3dSnapshot();
}

export async function setGoogleMapsJs3dTopView() {
  const camera = cameraSnapshot() || {};
  return flyOrAssignCamera({
    center: currentOrSelectedCenter(),
    range: GOOGLE_MAPS_JS_3D_TOP_RANGE_METERS,
    tilt: GOOGLE_MAPS_JS_3D_TOP_TILT_DEG,
    heading: Number.isFinite(camera.heading) ? camera.heading : GOOGLE_MAPS_JS_3D_HEADING_DEG
  });
}

export async function setGoogleMapsJs3dObliqueView() {
  const camera = cameraSnapshot() || {};
  return flyOrAssignCamera({
    center: currentOrSelectedCenter(),
    range: GOOGLE_MAPS_JS_3D_RANGE_METERS,
    tilt: GOOGLE_MAPS_JS_3D_TILT_DEG,
    heading: Number.isFinite(camera.heading) ? camera.heading : GOOGLE_MAPS_JS_3D_HEADING_DEG
  });
}

export async function flyGoogleMapsJs3dToSelectedPoint() {
  if (!selectedPoint) throw new Error('No selected point is available to fly to.');
  const camera = cameraSnapshot() || {};
  return flyOrAssignCamera({
    center: selectedCenter(Number.isFinite(camera.altitude) ? camera.altitude : 400),
    range: Number.isFinite(camera.range) ? camera.range : GOOGLE_MAPS_JS_3D_RANGE_METERS,
    tilt: Number.isFinite(camera.tilt) ? clampTilt(camera.tilt) : GOOGLE_MAPS_JS_3D_TILT_DEG,
    heading: Number.isFinite(camera.heading) ? wrapHeading(camera.heading) : GOOGLE_MAPS_JS_3D_HEADING_DEG
  });
}

export async function resetGoogleMapsJs3dView() {
  if (!selectedPoint) throw new Error('No selected point is available to reset.');
  return flyOrAssignCamera(standardSelectedCamera());
}

export async function orbitGoogleMapsJs3d(options = {}) {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  if (!selectedPoint) throw new Error('No selected point is available to orbit.');
  const camera = cameraSnapshot() || {};
  map3d.stopCameraAnimation?.();
  await map3d.flyCameraAround({
    camera: {
      center: {
        lat: selectedPoint.latitude,
        lng: selectedPoint.longitude,
        altitude: Number.isFinite(camera.altitude) ? camera.altitude : 400
      },
      range: Number.isFinite(camera.range) ? camera.range : GOOGLE_MAPS_JS_3D_RANGE_METERS,
      tilt: Number.isFinite(camera.tilt) ? camera.tilt : GOOGLE_MAPS_JS_3D_TILT_DEG,
      heading: Number.isFinite(camera.heading) ? camera.heading : GOOGLE_MAPS_JS_3D_HEADING_DEG
    },
    durationMillis: Number(options.durationMillis) > 0 ? Number(options.durationMillis) : 14000,
    repeatCount: Number.isFinite(Number(options.repeatCount)) ? Number(options.repeatCount) : 1
  });
  return getGoogleMapsJs3dSnapshot();
}

export async function setGoogleMapsJs3dReference(enabled) {
  if (!map3d) throw new Error('Google Map3DElement is not open.');
  const camera = cameraSnapshot();
  const token = ++referenceRestoreGeneration;
  map3d.stopCameraAnimation?.();
  map3d.mode = resolveMapMode(Boolean(enabled));
  restoreCamera(camera);
  const onSteady = (event) => {
    const steady = event?.isSteady ?? event?.detail?.isSteady;
    if (steady === false) return;
    map3d?.removeEventListener?.('gmp-steadychange', onSteady);
    if (token !== referenceRestoreGeneration || !map3d) return;
    restoreCamera(camera);
  };
  map3d.addEventListener('gmp-steadychange', onSteady);
  return getGoogleMapsJs3dSnapshot();
}

export function getSelectedPoint() {
  return selectedPoint ? { ...selectedPoint } : null;
}

export function getGoogleMapsJs3dElement() {
  return map3d;
}

export function getGoogleMapsJs3dStageCreateCount() {
  return stageCreateCount;
}
