/**
 * IQAI Spatial V2 — Google Street View (STREET 360) specialist stage.
 *
 * Official path: Maps JS StreetViewService.getPanorama + StreetViewPanorama.
 * Visual context only. Not current/live imagery. Not an ArcGIS view.
 * Use the browser-restricted Maps JS key. Do not use the Map Tiles server key.
 */

import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';

export const GOOGLE_MAPS_JS_CONFIG = '/api/spatial/config';
export const STREET_360_SEARCH_RADIUS_METERS = 80;
export const STREET_360_OPERATOR_UNAVAILABLE = 'STREET 360 NOT AVAILABLE HERE';
export const STREET_360_OPERATOR_PRESERVED = 'POINT PRESERVED';

const BOOTSTRAP_SCRIPT_ID = 'iqai-google-maps-js-3d-bootstrap';

let panorama = null;
let selectedPoint = null;
let lastError = null;
let mapsJsLoaded = false;
let streetViewLoaded = false;
let stageCreateCount = 0;
let generation = 0;
let browserKeyPresent = false;
let restoreAmdDetection = null;
let lastAvailability = null;
let lastPov = null;
let lastZoom = null;
let lastPanoramaPosition = null;
let lastCapture = formatStreetViewCaptureDate(null);
let lastLinksCount = 0;
let panoPresent = false;
let streetViewLib = null;
let lastOutdoorPanoId = null;

function outdoorSource(google) {
  return streetViewLib?.StreetViewSource?.OUTDOOR
    || google?.maps?.StreetViewSource?.OUTDOOR
    || 'outdoor';
}

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

export function offsetMetersBetween(a, b) {
  const lat1 = Number(a?.latitude ?? a?.lat);
  const lon1 = Number(a?.longitude ?? a?.lng);
  const lat2 = Number(b?.latitude ?? b?.lat);
  const lon2 = Number(b?.longitude ?? b?.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sine = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthMeters * Math.asin(Math.min(1, Math.sqrt(sine)));
}

export function formatStreetViewCaptureDate(imageDate) {
  const raw = String(imageDate || '').trim();
  if (!raw) {
    return { text: null, precision: 'UNKNOWN', value: null };
  }
  const day = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return { text: raw, precision: 'DAY', value: raw };
  const month = raw.match(/^(\d{4})-(\d{2})$/);
  if (month) return { text: `${month[1]}-${month[2]}`, precision: 'MONTH', value: raw };
  const year = raw.match(/^(\d{4})$/);
  if (year) return { text: year[1], precision: 'YEAR', value: raw };
  const namedMonth = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (namedMonth) {
    return { text: `${namedMonth[1]} ${namedMonth[2]}`, precision: 'MONTH', value: raw };
  }
  return { text: raw, precision: 'AS_PROVIDED', value: raw };
}

export function decideStreetViewAvailability(input = {}) {
  const requested = input.requested || null;
  const panoramaLocation = input.panorama || null;
  const radius = Number(input.radiusMeters) || STREET_360_SEARCH_RADIUS_METERS;
  const status = String(input.status || '');
  const offsetMeters = panoramaLocation ? offsetMetersBetween(requested, panoramaLocation) : null;
  const statusOk = !status || status === 'OK';
  const within = Number.isFinite(offsetMeters) && offsetMeters <= radius;
  if (!statusOk || !panoramaLocation || !within) {
    return {
      available: false,
      operatorStatus: STREET_360_OPERATOR_UNAVAILABLE,
      offsetMeters,
      capture: formatStreetViewCaptureDate(null),
      visualContextOnly: true,
      currentLive: false
    };
  }
  return {
    available: true,
    operatorStatus: STREET_360_OPERATOR_PRESERVED,
    offsetMeters,
    capture: formatStreetViewCaptureDate(input.imageDate),
    visualContextOnly: true,
    currentLive: false
  };
}

function latLngOf(value) {
  if (!value) return null;
  const lat = typeof value.lat === 'function' ? value.lat() : Number(value.lat ?? value.latitude);
  const lng = typeof value.lng === 'function' ? value.lng() : Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function readPanoramaState() {
  if (!panorama) {
    lastPov = null;
    lastZoom = null;
    lastPanoramaPosition = null;
    lastLinksCount = 0;
    panoPresent = false;
    return;
  }
  try {
    const pov = panorama.getPov?.();
    lastPov = pov
      ? { heading: Number(pov.heading), pitch: Number(pov.pitch) }
      : lastPov;
    lastZoom = Number.isFinite(Number(panorama.getZoom?.())) ? Number(panorama.getZoom()) : lastZoom;
    lastPanoramaPosition = latLngOf(panorama.getPosition?.()) || lastPanoramaPosition;
    const links = panorama.getLinks?.() || [];
    lastLinksCount = Array.isArray(links) ? links.length : 0;
    panoPresent = Boolean(panorama.getPano?.());
  } catch {
    // Street View may briefly report empty state while links load.
  }
}

export function getGoogleStreetViewSnapshot() {
  readPanoramaState();
  return {
    open: Boolean(panorama),
    renderer: 'StreetViewPanorama',
    mapsJsLoaded,
    streetViewLoaded,
    browserKeyPresent,
    visualContextOnly: true,
    analysis: 'PROHIBITED',
    currentLive: false,
    available: lastAvailability?.available === true,
    operatorStatus: lastAvailability?.operatorStatus || null,
    offsetMeters: Number.isFinite(lastAvailability?.offsetMeters)
      ? lastAvailability.offsetMeters
      : null,
    capture: lastCapture ? { ...lastCapture } : formatStreetViewCaptureDate(null),
    selectedPoint: selectedPoint ? { ...selectedPoint } : null,
    panoramaPosition: lastPanoramaPosition ? { ...lastPanoramaPosition } : null,
    pov: lastPov ? { ...lastPov } : null,
    zoom: lastZoom,
    linksCount: lastLinksCount,
    panoPresent,
    stageCreateCount,
    error: lastError,
    searchRadiusMeters: STREET_360_SEARCH_RADIUS_METERS
  };
}

async function ensureStreetViewLibrary() {
  const key = await fetchBrowserKey();
  if (!key && !window.google?.maps?.importLibrary) {
    throw new Error('Google Maps browser API key is not configured.');
  }
  restoreAmdDetection = suppressArcgisAmdDetection();
  try {
    if (key) installMapsJsBootstrap(key);
    const started = Date.now();
    while (!window.google?.maps?.importLibrary && Date.now() - started < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.google?.maps?.importLibrary) {
      throw new Error('Google Maps JavaScript API failed to initialize.');
    }
    mapsJsLoaded = true;
    streetViewLib = await window.google.maps.importLibrary('streetView');
    streetViewLoaded = Boolean(
      window.google?.maps?.StreetViewService
      || streetViewLib?.StreetViewService
    );
    if (!streetViewLoaded) {
      await window.google.maps.importLibrary('maps');
      streetViewLoaded = Boolean(window.google?.maps?.StreetViewService);
    }
    if (!streetViewLoaded) {
      throw new Error('Google Street View library failed to initialize.');
    }
    return window.google;
  } finally {
    restoreAmdDetection?.();
    restoreAmdDetection = null;
  }
}

async function queryPanorama(google, request) {
  const Service = google.maps.StreetViewService || streetViewLib?.StreetViewService;
  const service = new Service();
  const maybe = service.getPanorama(request);
  if (maybe && typeof maybe.then === 'function') {
    try {
      const result = await maybe;
      if (result && !result.location && result.data) return { result: result.data, status: 'OK' };
      return { result, status: 'OK' };
    } catch (error) {
      const status = String(error?.code || error?.status || error?.message || 'ZERO_RESULTS');
      return { result: null, status: /OK/.test(status) ? 'ZERO_RESULTS' : status };
    }
  }
  return new Promise((resolve) => {
    service.getPanorama(request, (result, status) => {
      resolve({ result, status: String(status || 'ZERO_RESULTS') });
    });
  });
}

function panoramaLocationOf(result) {
  return latLngOf(result?.location?.latLng) || latLngOf(result?.location) || null;
}

export async function checkGoogleStreetView(options = {}) {
  const longitude = Number(options.longitude);
  const latitude = Number(options.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) {
    lastAvailability = decideStreetViewAvailability({
      requested: { longitude, latitude },
      status: 'INVALID_LOCATION'
    });
    lastCapture = lastAvailability.capture;
    lastError = STREET_360_OPERATOR_UNAVAILABLE;
    return { ...lastAvailability, requested: { longitude, latitude } };
  }

  selectedPoint = {
    longitude,
    latitude,
    spatialReferenceWkid: 4326,
    source: String(options.source || 'operator')
  };

  const google = await ensureStreetViewLibrary();
  const request = {
    location: { lat: latitude, lng: longitude },
    radius: STREET_360_SEARCH_RADIUS_METERS,
    source: outdoorSource(google)
  };
  const queried = await queryPanorama(google, request);
  const panoramaLocation = panoramaLocationOf(queried.result);
  lastOutdoorPanoId = queried.result?.location?.pano || null;
  lastAvailability = decideStreetViewAvailability({
    requested: selectedPoint,
    panorama: panoramaLocation,
    radiusMeters: STREET_360_SEARCH_RADIUS_METERS,
    imageDate: queried.result?.imageDate,
    status: queried.status
  });
  lastCapture = lastAvailability.capture;
  lastError = lastAvailability.available ? null : STREET_360_OPERATOR_UNAVAILABLE;
  return {
    ...lastAvailability,
    requested: { ...selectedPoint },
    panorama: panoramaLocation,
    imageDate: queried.result?.imageDate || null
  };
}

function waitForPanoramaReady(instance, google, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let listener = null;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (listener && google.maps.event?.removeListener) {
        google.maps.event.removeListener(listener);
      }
      if (ok) resolve();
      else reject(error || new Error('Street View panorama is not available.'));
    };
    const timer = setTimeout(() => {
      finish(false, new Error('Street View panorama did not become ready.'));
    }, timeoutMs);
    const isOk = (status) => (
      status === 'OK' || status === String(google.maps.StreetViewStatus?.OK || 'OK')
    );
    const check = () => {
      const status = String(instance.getStatus?.() || '');
      if (isOk(status)) {
        finish(true);
        return;
      }
      if (status && status !== 'UNKNOWN' && status !== String(google.maps.StreetViewStatus?.UNKNOWN || '')) {
        finish(false);
      }
    };
    listener = instance.addListener?.('status_changed', check);
    check();
  });
}

function waitForLinks(instance, google, timeoutMs = 5000) {
  const current = () => {
    try {
      return instance.getLinks?.() || [];
    } catch {
      return [];
    }
  };
  if (current().length) return Promise.resolve(current());
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(current()), timeoutMs);
    const listener = instance.addListener?.('links_changed', () => {
      if (current().length) {
        clearTimeout(timer);
        google.maps.event?.removeListener?.(listener);
        resolve(current());
      }
    });
  });
}

export async function openGoogleStreetView(options = {}) {
  const container = options.container;
  if (!container) throw new Error('Street 360 container is required.');
  const availability = await checkGoogleStreetView(options);
  if (!availability.available || !availability.panorama) {
    return getGoogleStreetViewSnapshot();
  }

  await closeGoogleStreetView();
  const google = await ensureStreetViewLibrary();
  const token = ++generation;
  stageCreateCount += 1;
  const Panorama = streetViewLib?.StreetViewPanorama || google.maps.StreetViewPanorama;
  const panoramaOptions = {
    pov: { heading: 0, pitch: 0 },
    zoom: 1,
    visible: true,
    addressControl: false,
    fullscreenControl: false,
    enableCloseButton: false,
    motionTracking: false,
    clickToGo: true,
    linksControl: true,
    panControl: true,
    zoomControl: true,
    imageDateControl: false
  };
  if (lastOutdoorPanoId) panoramaOptions.pano = lastOutdoorPanoId;
  else {
    panoramaOptions.position = {
      lat: availability.panorama.latitude,
      lng: availability.panorama.longitude
    };
  }
  panorama = new Panorama(container, panoramaOptions);
  panorama.addListener?.('pov_changed', () => readPanoramaState());
  panorama.addListener?.('zoom_changed', () => readPanoramaState());
  panorama.addListener?.('position_changed', () => readPanoramaState());
  panorama.addListener?.('links_changed', () => readPanoramaState());
  panorama.addListener?.('pano_changed', async () => {
    readPanoramaState();
    try {
      const googleMaps = window.google;
      if (!googleMaps?.maps?.StreetViewService || !panorama?.getPano?.()) return;
      const queried = await queryPanorama(googleMaps, { pano: panorama.getPano() });
      if (token !== generation) return;
      lastCapture = formatStreetViewCaptureDate(queried.result?.imageDate);
    } catch {
      // Keep the last honest capture date rather than inventing one.
    }
  });

  await waitForPanoramaReady(panorama, google);
  await waitForLinks(panorama, google);
  if (token !== generation) return getGoogleStreetViewSnapshot();
  readPanoramaState();
  lastError = null;
  return getGoogleStreetViewSnapshot();
}

export async function closeGoogleStreetView() {
  generation += 1;
  if (panorama) {
    try {
      panorama.setVisible?.(false);
    } catch {
      // ignore
    }
  }
  panorama = null;
  lastPov = null;
  lastZoom = null;
  lastPanoramaPosition = null;
  lastLinksCount = 0;
  panoPresent = false;
  lastError = null;
  return getGoogleStreetViewSnapshot();
}

export function lookGoogleStreetView(headingDelta = 45, pitchDelta = 0) {
  if (!panorama) throw new Error('Street 360 is not open.');
  const pov = panorama.getPov?.() || { heading: 0, pitch: 0 };
  panorama.setPov?.({
    heading: ((Number(pov.heading) || 0) + Number(headingDelta) + 360) % 360,
    pitch: Math.max(-90, Math.min(90, (Number(pov.pitch) || 0) + Number(pitchDelta)))
  });
  readPanoramaState();
  return getGoogleStreetViewSnapshot();
}

export function zoomGoogleStreetView(delta = 1) {
  if (!panorama) throw new Error('Street 360 is not open.');
  const current = Number(panorama.getZoom?.());
  panorama.setZoom?.(Math.max(0, (Number.isFinite(current) ? current : 1) + Number(delta)));
  readPanoramaState();
  return getGoogleStreetViewSnapshot();
}

export async function moveGoogleStreetViewAlongCoverage() {
  if (!panorama) throw new Error('Street 360 is not open.');
  const google = window.google;
  const links = await waitForLinks(panorama, google, 4000);
  if (!Array.isArray(links) || links.length === 0) {
    return { ...getGoogleStreetViewSnapshot(), moved: false };
  }
  const beforePano = panorama.getPano?.();
  const beforePosition = lastPanoramaPosition ? { ...lastPanoramaPosition } : null;
  const next = links.find((link) => link?.pano && link.pano !== beforePano) || links[0];
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    const listener = panorama.addListener?.('pano_changed', () => {
      clearTimeout(timer);
      google?.maps?.event?.removeListener?.(listener);
      resolve();
    });
    if (next?.pano) panorama.setPano(next.pano);
    else resolve();
  });
  readPanoramaState();
  const moved = (panorama.getPano?.() && panorama.getPano() !== beforePano)
    || (
      beforePosition
      && lastPanoramaPosition
      && (
        Math.abs(Number(beforePosition.latitude) - Number(lastPanoramaPosition.latitude)) > 0.00005
        || Math.abs(Number(beforePosition.longitude) - Number(lastPanoramaPosition.longitude)) > 0.00005
      )
    );
  return {
    ...getGoogleStreetViewSnapshot(),
    moved
  };
}
