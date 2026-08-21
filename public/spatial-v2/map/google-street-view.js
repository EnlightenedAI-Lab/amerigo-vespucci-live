/**
 * IQAI Spatial V2 — Google Street View (STREET 360) specialist stage.
 *
 * Official path: Maps JS StreetViewService.getPanorama + StreetViewPanorama.
 * Visual context only. Not current/live imagery. Not an ArcGIS view.
 * Use the browser-restricted Maps JS key. Do not use the Map Tiles server key.
 */

import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { beginProgrammaticTraversal } from './worldview-traversal.js';
import { HYDRANT_INVENTORY_POSITION_LABEL } from './woa/hydrant-object.js';
import { hydrantTrace } from './woa/hydrant-trace.js';

export const GOOGLE_MAPS_JS_CONFIG = '/api/spatial/config';
export const STREET_360_SEARCH_RADIUS_METERS = 80;
export const STREET_360_OPERATOR_UNAVAILABLE = 'STREET 360 NOT AVAILABLE HERE';
export const STREET_360_OPERATOR_PRESERVED = 'POINT PRESERVED';

const BOOTSTRAP_SCRIPT_ID = 'iqai-google-maps-js-3d-bootstrap';

let panorama = null;
let panoramaContainer = null;
let panoramaListeners = [];
let stageDisposeCount = 0;
let streetLifecycleQueue = Promise.resolve();
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
let coverageVisitedPanos = [];
const navigationListeners = new Set();
let hydrantStreetMarker = null;
let hydrantStreetAim = null;
let hydrantStreetClickListener = null;
let hydrantAimLockUntil = 0;
let traversalMuteUntil = 0;
let streetApplyGeneration = 0;
let nearbyPanoSearchCount = 0;

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

function readPanoramaState(options = {}) {
  if (!panorama) {
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
  if (options.emit !== false) emitStreetNavigation();
}

function emitStreetNavigation() {
  const position = lastPanoramaPosition;
  if (!position) return;
  const snapshot = {
    longitude: position.longitude,
    latitude: position.latitude,
    heading: Number.isFinite(Number(lastPov?.heading)) ? Number(lastPov.heading) : null,
    zoom: lastZoom,
    pitch: Number.isFinite(Number(lastPov?.pitch)) ? Number(lastPov.pitch) : null,
    panoId: panorama?.getPano?.() || lastOutdoorPanoId || null,
    panoPresent,
    programmatic: isStreetViewTraversalMuted()
  };
  for (const listener of navigationListeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI V2] Street 360 navigation listener failed', error);
    }
  }
}

function bindPanoramaListener(instance, eventName, handler) {
  const listener = instance?.addListener?.(eventName, handler);
  if (listener) panoramaListeners.push(listener);
  return listener;
}

function forgetPanoramaListeners() {
  for (const listener of panoramaListeners) {
    try {
      listener?.remove?.();
      window.google?.maps?.event?.removeListener?.(listener);
    } catch {
      // Listener may already be gone with the instance.
    }
  }
  panoramaListeners = [];
}

function disposePanoramaInstance({ restoreAmd = false } = {}) {
  generation += 1;
  if (panorama) stageDisposeCount += 1;
  forgetPanoramaListeners();
  try {
    window.google?.maps?.event?.clearInstanceListeners?.(panorama);
  } catch {
    // Instance may already be inert.
  }
  try { hydrantStreetMarker?.setMap?.(null); } catch { /* already gone */ }
  hydrantStreetMarker = null;
  try { panorama?.unbindAll?.(); } catch { /* not all constructors expose unbindAll */ }
  try { panorama?.setVisible?.(false); } catch { /* ignore */ }
  const host = panoramaContainer;
  panorama = null;
  panoramaContainer = null;
  lastLinksCount = 0;
  panoPresent = false;
  lastError = null;
  coverageVisitedPanos = [];
  if (host) {
    try {
      host.replaceChildren();
    } catch {
      try { host.innerHTML = ''; } catch { /* host already gone */ }
    }
  }
  if (restoreAmd) {
    restoreAmdDetection?.();
    restoreAmdDetection = null;
  }
  hydrantTrace('street.panorama.dispose', {
    restoreAmd,
    disposed: stageDisposeCount,
    hostCleared: Boolean(host)
  });
}

function enqueueStreetLifecycle(work) {
  const next = streetLifecycleQueue.then(work, work);
  streetLifecycleQueue = next.catch(() => {});
  return next;
}

export function resizeGoogleStreetView() {
  try {
    window.google?.maps?.event?.trigger?.(panorama, 'resize');
  } catch {
    // Street 360 may not be open.
  }
}

export function hasKnownStreetPano() {
  return Boolean(lastOutdoorPanoId);
}

export function hasRetainedGoogleStreetView() {
  return Boolean(panorama && lastOutdoorPanoId);
}

export async function parkGoogleStreetView() {
  return enqueueStreetLifecycle(async () => {
    const saved = {
      panoId: lastOutdoorPanoId,
      aim: hydrantStreetAim ? { ...hydrantStreetAim } : null,
      pov: lastPov ? { ...lastPov } : null,
      position: lastPanoramaPosition
        ? { ...lastPanoramaPosition }
        : (hydrantStreetAim?.panorama ? { ...hydrantStreetAim.panorama } : null)
    };
    disposePanoramaInstance({ restoreAmd: false });
    lastOutdoorPanoId = saved.panoId;
    hydrantStreetAim = saved.aim;
    lastPov = saved.pov;
    lastPanoramaPosition = saved.position;
    if (saved.position) {
      lastAvailability = { available: true, panorama: saved.position };
    }
    hydrantTrace('street.panorama.park', {
      pano: lastOutdoorPanoId,
      retained: Boolean(lastOutdoorPanoId),
      disposed: stageDisposeCount
    });
    return getGoogleStreetViewSnapshot();
  });
}

export function concealGoogleStreetView() {
  return parkGoogleStreetView();
}

export async function revealGoogleStreetView(container) {
  return enqueueStreetLifecycle(async () => {
    if (!lastOutdoorPanoId) return getGoogleStreetViewSnapshot();
    const w = Number(container?.offsetWidth) || 0;
    const h = Number(container?.offsetHeight) || 0;
    hydrantTrace('street.panorama.reconstruct', {
      pano: lastOutdoorPanoId,
      w,
      h,
      created: stageCreateCount,
      disposed: stageDisposeCount
    });
    if (w < 8 || h < 8) {
      hydrantTrace('street.panorama.reconstruct-unmeasurable', { w, h });
      return getGoogleStreetViewSnapshot();
    }
    return constructGoogleStreetView({
      container,
      heading: Number.isFinite(Number(hydrantStreetAim?.heading))
        ? hydrantStreetAim.heading
        : lastPov?.heading,
      pitch: 0,
      source: 'hydrant-inventory',
      availability: hydrantStreetAim?.panorama || lastPanoramaPosition
        ? {
          available: true,
          panorama: hydrantStreetAim?.panorama || lastPanoramaPosition
        }
        : undefined
    });
  });
}

export function getGoogleStreetViewSnapshot() {
  readPanoramaState({ emit: false });
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
    panoId: panorama?.getPano?.() || lastOutdoorPanoId || null,
    stageCreateCount,
    stageDisposeCount,
    error: lastError,
    searchRadiusMeters: STREET_360_SEARCH_RADIUS_METERS,
    hydrantAim: hydrantStreetAim ? { ...hydrantStreetAim } : null,
    hydrantMarkerPresent: Boolean(hydrantStreetMarker),
    hydrantMarkerApi: hydrantStreetAim?.markerApi || null,
    physicalHydrantVisibility: hydrantStreetAim?.physicalVisibility || 'NOT CONFIRMED',
    retained: Boolean(panorama && lastOutdoorPanoId),
    nearbyPanoSearchCount
  };
}

export function getStreetNearbySearchCount() {
  return nearbyPanoSearchCount;
}

async function ensureStreetViewLibrary({ holdAmd = false } = {}) {
  const maps = window.google?.maps;
  if (maps?.StreetViewService && maps?.StreetViewPanorama) {
    streetViewLoaded = true;
    mapsJsLoaded = true;
    if (holdAmd && !restoreAmdDetection) {
      restoreAmdDetection = suppressArcgisAmdDetection();
    }
    return window.google;
  }
  if (streetViewLoaded && maps) {
    if (holdAmd && !restoreAmdDetection) {
      restoreAmdDetection = suppressArcgisAmdDetection();
    }
    return window.google;
  }
  const key = await fetchBrowserKey();
  if (!key && !window.google?.maps?.importLibrary) {
    throw new Error('Google Maps browser API key is not configured.');
  }
  restoreAmdDetection = suppressArcgisAmdDetection();
  try {
    if (key) installMapsJsBootstrap(key);
    const started = Date.now();
    while (!window.google?.maps?.importLibrary && Date.now() - started < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.google?.maps?.importLibrary) {
      throw new Error('Google Maps JavaScript API failed to initialize.');
    }
    mapsJsLoaded = true;
    if (window.google.maps.StreetViewService && window.google.maps.StreetViewPanorama) {
      streetViewLoaded = true;
      return window.google;
    }
    streetViewLib = await Promise.race([
      window.google.maps.importLibrary('streetView'),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500))
    ]);
    streetViewLoaded = Boolean(
      window.google?.maps?.StreetViewService
      || streetViewLib?.StreetViewService
      || window.google?.maps?.StreetViewPanorama
      || streetViewLib?.StreetViewPanorama
    );
    if (!streetViewLoaded) {
      await Promise.race([
        window.google.maps.importLibrary('maps'),
        new Promise((resolve) => setTimeout(() => resolve(null), 2500))
      ]);
      streetViewLoaded = Boolean(window.google?.maps?.StreetViewService || window.google?.maps?.StreetViewPanorama);
    }
    if (!streetViewLoaded) {
      throw new Error('Google Street View library failed to initialize.');
    }
    return window.google;
  } catch (error) {
    restoreAmdDetection?.();
    restoreAmdDetection = null;
    throw error;
  } finally {
    if (!holdAmd) {
      restoreAmdDetection?.();
      restoreAmdDetection = null;
    }
  }
}

function googleMapsJsFailedVisually(container) {
  const node = container?.querySelector?.('.gm-err-container, .gm-err-message, .gm-err-title');
  if (!node) return false;
  return /didn't load Google Maps correctly|Oops! Something went wrong/i.test(node.textContent || '');
}

async function queryPanorama(google, request) {
  if (request?.location && Number(request?.radius) > 0) {
    nearbyPanoSearchCount += 1;
  }
  const Service = google.maps.StreetViewService || streetViewLib?.StreetViewService;
  const service = new Service();
  const maybe = service.getPanorama(request);
  const queried = (async () => {
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
  })();
  const timed = await Promise.race([
    queried,
    new Promise((resolve) => setTimeout(() => resolve({ result: null, status: 'TIMEOUT' }), 12000))
  ]);
  return timed;
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

function statusTextOf(instance, google) {
  const status = instance?.getStatus?.();
  if (status == null || status === '') return '';
  if (typeof status === 'string') return status;
  return String(status.value || status.name || status);
}

function panoramaStatusIsOk(instance, google) {
  const status = instance?.getStatus?.();
  const text = statusTextOf(instance, google);
  const Ok = google?.maps?.StreetViewStatus?.OK;
  return text === 'OK'
    || status === Ok
    || status === 0
    || (Ok != null && String(Ok) === text);
}

function panoramaHasIdentity(instance) {
  return Boolean(instance?.getPano?.() || lastOutdoorPanoId);
}

function waitForPanoramaReady(instance, google, container, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const listeners = [];
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(visualTimer);
      clearInterval(poll);
      for (const listener of listeners) {
        try {
          if (listener && google?.maps?.event?.removeListener) {
            google.maps.event.removeListener(listener);
          }
        } catch {
          /* ignore */
        }
      }
      if (ok) resolve();
      else reject(error || new Error('STREET 360 UNAVAILABLE'));
    };
    const isReady = () => {
      if (googleMapsJsFailedVisually(container || instance?.getContainer?.())) return 'fail';
      if (instance?.getPano?.()) return 'ok';
      if (panoramaStatusIsOk(instance, google)) return 'ok';
      if (container?.querySelector?.('.gm-style canvas, .gm-style img, .gm-style')) return 'ok';
      return 'wait';
    };
    const visualTimer = setInterval(() => {
      if (googleMapsJsFailedVisually(container || instance?.getContainer?.())) {
        finish(false, new Error(STREET_360_OPERATOR_UNAVAILABLE));
      }
    }, 200);
    const poll = setInterval(() => {
      const state = isReady();
      if (state === 'ok') {
        hydrantTrace('street.ready', {
          status: statusTextOf(instance, google) || null,
          pano: instance?.getPano?.() || lastOutdoorPanoId || null
        });
        finish(true);
      }
    }, 150);
    const knownPano = Boolean(lastOutdoorPanoId);
    const timer = setTimeout(() => {
      hydrantTrace('street.ready.timeout', {
        status: statusTextOf(instance, google) || null,
        pano: instance?.getPano?.() || lastOutdoorPanoId || null
      });
      if (isReady() === 'ok' || panoramaHasIdentity(instance) || knownPano) {
        finish(true);
        return;
      }
      finish(false, new Error('Street View panorama did not become ready.'));
    }, knownPano ? Math.min(timeoutMs, 8000) : timeoutMs);
    const check = () => {
      const state = isReady();
      if (state === 'ok') {
        hydrantTrace('street.ready', {
          status: statusTextOf(instance, google) || null,
          pano: instance?.getPano?.() || lastOutdoorPanoId || null
        });
        finish(true);
        return;
      }
      const text = statusTextOf(instance, google);
      if (
        state === 'fail'
        || (
          text
          && text !== 'UNKNOWN'
          && text !== 'OK'
          && text !== String(google?.maps?.StreetViewStatus?.UNKNOWN || '')
        )
      ) {
        finish(false, new Error(text === 'ZERO_RESULTS' ? 'NO STREET CAPTURE NEAR THIS HYDRANT' : 'STREET 360 UNAVAILABLE'));
      }
    };
    listeners.push(instance.addListener?.('status_changed', check));
    listeners.push(instance.addListener?.('pano_changed', check));
    listeners.push(instance.addListener?.('position_changed', check));
    check();
  });
}

export function muteStreetViewTraversal(ms = 700) {
  const until = Date.now() + Math.max(0, Number(ms) || 0);
  traversalMuteUntil = Math.max(traversalMuteUntil, until);
  beginProgrammaticTraversal(ms);
}

export function beginProgrammaticStreetApply(ms = 3500) {
  streetApplyGeneration += 1;
  muteStreetViewTraversal(ms);
  return streetApplyGeneration;
}

export function settleProgrammaticStreetApply(generation = streetApplyGeneration) {
  if (generation !== streetApplyGeneration) return;
  muteStreetViewTraversal(480);
}

export function isStreetViewTraversalMuted() {
  return Date.now() < traversalMuteUntil;
}

function destinationAlongHeading(origin, headingDeg, meters) {
  const lat1 = Number(origin?.latitude) * Math.PI / 180;
  const lon1 = Number(origin?.longitude) * Math.PI / 180;
  const bearing = Number(headingDeg) * Math.PI / 180;
  const angular = Number(meters) / 6371000;
  if (![lat1, lon1, bearing, angular].every(Number.isFinite)) return null;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180
  };
}

function waitForLinks(instance, google, timeoutMs = 5000) {
  const current = () => {
    try {
      const links = instance.getLinks?.() || [];
      return Array.isArray(links) ? links : [];
    } catch {
      return [];
    }
  };
  if (current().length) return Promise.resolve(current());
  return new Promise((resolve) => {
    let settled = false;
    const finish = (links) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (listener && google?.maps?.event?.removeListener) {
        google.maps.event.removeListener(listener);
      }
      resolve(links);
    };
    const timer = setTimeout(() => finish(current()), timeoutMs);
    const poll = setInterval(() => {
      const links = current();
      if (links.length) finish(links);
    }, 150);
    const listener = instance.addListener?.('links_changed', () => {
      const links = current();
      if (links.length) finish(links);
    });
  });
}

export async function openGoogleStreetView(options = {}) {
  return enqueueStreetLifecycle(() => constructGoogleStreetView(options));
}

async function constructGoogleStreetView(options = {}) {
  const container = options.container;
  if (!container) throw new Error('Street 360 container is required.');
  const availability = options.availability?.available && options.availability?.panorama
    ? options.availability
    : await checkGoogleStreetView(options);
  if (!availability.available || !availability.panorama) {
    return getGoogleStreetViewSnapshot();
  }

  if (panorama) disposePanoramaInstance({ restoreAmd: false });
  const google = await ensureStreetViewLibrary({ holdAmd: true });
  const token = ++generation;
  stageCreateCount += 1;
  const Panorama = streetViewLib?.StreetViewPanorama || google.maps.StreetViewPanorama;
  const requestedPov = povFromSensorPose(options);
  const panoramaOptions = {
    pov: { heading: requestedPov.heading, pitch: requestedPov.pitch },
    zoom: 1,
    visible: true,
    disableDefaultUI: true,
    addressControl: false,
    fullscreenControl: false,
    enableCloseButton: false,
    motionTracking: false,
    motionTrackingControl: false,
    clickToGo: true,
    linksControl: true,
    panControl: false,
    zoomControl: false,
    imageDateControl: false,
    showRoadLabels: false
  };
  if (lastOutdoorPanoId) {
    panoramaOptions.pano = lastOutdoorPanoId;
  } else {
    panoramaOptions.position = {
      lat: availability.panorama.latitude,
      lng: availability.panorama.longitude
    };
  }
  hydrantTrace('street.panorama.construct', {
    hasCtor: typeof Panorama === 'function',
    pano: lastOutdoorPanoId,
    w: Number(container?.offsetWidth) || 0,
    h: Number(container?.offsetHeight) || 0,
    created: stageCreateCount,
    disposed: stageDisposeCount
  });
  if (typeof Panorama !== 'function') {
    throw new Error('STREET 360 UNAVAILABLE');
  }
  panorama = new Panorama(container, panoramaOptions);
  panoramaContainer = container;
  restoreAmdDetection?.();
  restoreAmdDetection = null;
  hydrantTrace('street.panorama.constructed', { pano: lastOutdoorPanoId });
  try {
    google.maps.event?.trigger?.(panorama, 'resize');
  } catch {
    // Layout may settle after the first paint.
  }
  bindPanoramaListener(panorama, 'pov_changed', () => readPanoramaState());
  bindPanoramaListener(panorama, 'zoom_changed', () => readPanoramaState());
  bindPanoramaListener(panorama, 'position_changed', () => readPanoramaState());
  bindPanoramaListener(panorama, 'links_changed', () => readPanoramaState());
  bindPanoramaListener(panorama, 'pano_changed', async () => {
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

  const settle = async () => {
    try {
      await waitForPanoramaReady(panorama, google, container, lastOutdoorPanoId ? 4000 : 8000);
    } catch (error) {
      lastError = String(error?.message || error);
      hydrantTrace('street.open.ready-failed', { message: lastError, pano: lastOutdoorPanoId });
      if (!panoramaHasIdentity(panorama) && !lastOutdoorPanoId) throw error;
    }
    if (token !== generation) return;
    if (lastOutdoorPanoId && !panorama.getPano?.()) {
      try { panorama.setPano?.(lastOutdoorPanoId); } catch { /* keep constructed stage */ }
    }
    await waitForLinks(panorama, google, lastOutdoorPanoId ? 800 : 1500);
    if (token !== generation) return;
    if (requestedPov.specified) applyStreetViewPov(requestedPov);
    else if (Number.isFinite(Number(hydrantStreetAim?.heading))) {
      applyStreetViewPov({ heading: hydrantStreetAim.heading, pitch: 0 });
    }
    if (googleMapsJsFailedVisually(container)) {
      lastError = STREET_360_OPERATOR_UNAVAILABLE;
      return;
    }
    readPanoramaState();
    if (panoramaHasIdentity(panorama)) {
      lastError = lastError && /did not become ready/i.test(lastError) ? null : lastError;
    }
    hydrantTrace('street.open.settled', {
      pano: panorama.getPano?.() || lastOutdoorPanoId || null,
      error: lastError
    });
    if (hydrantStreetAim?.hydrant) {
      await attachHydrantStreetMarker(hydrantStreetAim.hydrant, hydrantStreetAim).catch(() => {});
    }
  };
  if (lastOutdoorPanoId) {
    void settle().catch((error) => {
      hydrantTrace('street.open.settle-error', { message: String(error?.message || error) });
    });
    readPanoramaState();
    hydrantTrace('street.open.end', {
      pano: lastOutdoorPanoId,
      deferredSettle: true
    });
    return getGoogleStreetViewSnapshot();
  }
  await settle();
  return getGoogleStreetViewSnapshot();
}

export async function closeGoogleStreetView() {
  return enqueueStreetLifecycle(async () => {
    disposePanoramaInstance({ restoreAmd: true });
    lastPov = null;
    lastZoom = null;
    lastPanoramaPosition = null;
    return getGoogleStreetViewSnapshot();
  });
}

export function sphericalHeadingDegrees(from, to) {
  const googleHeading = window.google?.maps?.geometry?.spherical?.computeHeading;
  if (typeof googleHeading === 'function' && window.google?.maps?.LatLng) {
    return wrapStreetHeading(googleHeading(
      new window.google.maps.LatLng(Number(from.latitude), Number(from.longitude)),
      new window.google.maps.LatLng(Number(to.latitude), Number(to.longitude))
    ));
  }
  const φ1 = Number(from.latitude) * Math.PI / 180;
  const φ2 = Number(to.latitude) * Math.PI / 180;
  const Δλ = (Number(to.longitude) - Number(from.longitude)) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrapStreetHeading(Math.atan2(y, x) * 180 / Math.PI);
}

export function isStreetHydrantAimLocked() {
  return Date.now() < hydrantAimLockUntil;
}

export function setGoogleStreetViewHydrantClickListener(listener) {
  hydrantStreetClickListener = typeof listener === 'function' ? listener : null;
}

export function notifyGoogleStreetViewHydrantClick(record) {
  hydrantStreetClickListener?.(record);
  return record || null;
}

export function hydrantStreetInventoryLabel(idBi) {
  const id = String(idBi || '').trim();
  return id
    ? `HYDRANT · ID_BI ${id} · ${HYDRANT_INVENTORY_POSITION_LABEL}`
    : `HYDRANT · ${HYDRANT_INVENTORY_POSITION_LABEL}`;
}

async function attachHydrantStreetMarker(record, aim = hydrantStreetAim) {
  const longitude = Number(record?.longitude);
  const latitude = Number(record?.latitude);
  const sourceId = String(record?.idBi || record?.sourceId || '').trim();
  try { hydrantStreetMarker?.setMap?.(null); } catch { /* previous */ }
  hydrantStreetMarker = null;
  if (!panorama || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    if (aim) aim.markerApi = null;
    return null;
  }
  const google = window.google;
  try {
    await google?.maps?.importLibrary?.('maps');
  } catch {
    /* Marker lives on maps library when present. */
  }
  const Marker = google?.maps?.Marker;
  if (typeof Marker !== 'function') {
    if (aim) {
      aim.markerApi = null;
      aim.markerUnavailable = true;
    }
    hydrantTrace('street.marker.unavailable', { idBi: sourceId });
    return null;
  }
  const label = hydrantStreetInventoryLabel(sourceId);
  hydrantStreetMarker = new Marker({
    position: { lat: latitude, lng: longitude },
    map: panorama,
    title: label,
    clickable: true
  });
  hydrantStreetMarker.addListener?.('click', () => notifyGoogleStreetViewHydrantClick(record));
  if (aim) {
    aim.markerApi = 'Marker';
    aim.markerUnavailable = false;
    aim.label = label;
  }
  hydrantTrace('street.marker.attached', { idBi: sourceId, api: 'Marker' });
  return hydrantStreetMarker;
}

export async function aimGoogleStreetViewAtHydrant(record) {
  if (!record) {
    try { hydrantStreetMarker?.setMap?.(null); } catch { /* ignore */ }
    hydrantStreetMarker = null;
    hydrantStreetAim = null;
    hydrantTrace('street.aim.cleared');
    return { available: false, cleared: true, physicalVisibility: 'NOT CONFIRMED' };
  }
  const longitude = Number(record?.longitude);
  const latitude = Number(record?.latitude);
  const sourceId = String(record?.idBi || record?.sourceId || '').trim();
  hydrantTrace('street.aim.start', { idBi: sourceId, longitude, latitude });
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    hydrantStreetAim = {
      available: false,
      message: 'NO STREET CAPTURE NEAR THIS HYDRANT',
      physicalVisibility: 'NOT CONFIRMED',
      searchRadiusMeters: STREET_360_SEARCH_RADIUS_METERS
    };
    return hydrantStreetAim;
  }
  const sameHydrantKnown = Boolean(panorama)
    && hydrantStreetAim?.available === true
    && String(hydrantStreetAim?.hydrant?.sourceId || '') === sourceId
    && Boolean(lastOutdoorPanoId || hydrantStreetAim?.panoId);
  if (sameHydrantKnown) {
    hydrantStreetAim = {
      ...hydrantStreetAim,
      needsOpen: !panorama,
      hydrant: { longitude, latitude, sourceId, objectRef: record.objectRef || null }
    };
    hydrantTrace('street.aim.reuse', {
      idBi: sourceId,
      panoId: lastOutdoorPanoId || hydrantStreetAim.panoId,
      heading: hydrantStreetAim.heading
    });
    if (!panorama) return hydrantStreetAim;
    hydrantAimLockUntil = Date.now() + 8000;
    muteStreetViewTraversal(8000);
    beginProgrammaticStreetApply(1600);
    if (hydrantStreetAim.panoId && typeof panorama.setPano === 'function') {
      panorama.setPano(hydrantStreetAim.panoId);
    }
    applyStreetViewPov({ heading: hydrantStreetAim.heading, pitch: 0 });
    await attachHydrantStreetMarker(record, hydrantStreetAim);
    return hydrantStreetAim;
  }
  const google = await ensureStreetViewLibrary();
  try {
    await google.maps.importLibrary?.('geometry');
  } catch {
    // Heading fallback remains available without the geometry library.
  }
  const queried = await queryPanorama(google, {
    location: { lat: latitude, lng: longitude },
    radius: STREET_360_SEARCH_RADIUS_METERS,
    source: outdoorSource(google)
  });
  const pano = panoramaLocationOf(queried.result);
  const panoId = queried.result?.location?.pano || queried.result?.location?.panoId || null;
  const ok = String(queried.status || '') === 'OK' || String(queried.status || '').endsWith('OK');
  if (!ok || !pano) {
    try { hydrantStreetMarker?.setMap?.(null); } catch { /* ignore */ }
    hydrantStreetMarker = null;
    hydrantStreetAim = {
      available: false,
      needsOpen: false,
      message: 'NO STREET CAPTURE NEAR THIS HYDRANT',
      physicalVisibility: 'NOT CONFIRMED',
      searchRadiusMeters: STREET_360_SEARCH_RADIUS_METERS,
      hydrant: { longitude, latitude, sourceId, objectRef: record.objectRef || null },
      markerApi: null
    };
    hydrantTrace('street.aim.no-pano', { idBi: sourceId, status: queried.status || null });
    return hydrantStreetAim;
  }
  lastOutdoorPanoId = panoId || lastOutdoorPanoId;
  const heading = sphericalHeadingDegrees(pano, { longitude, latitude });
  hydrantStreetAim = {
    available: true,
    needsOpen: !panorama,
    message: 'INVENTORY POSITION PROJECTED INTO STREET VIEW',
    physicalVisibility: 'NOT CONFIRMED',
    searchRadiusMeters: STREET_360_SEARCH_RADIUS_METERS,
    panorama: { ...pano },
    panoId,
    heading,
    hydrant: { longitude, latitude, sourceId, objectRef: record.objectRef || null },
    label: hydrantStreetInventoryLabel(sourceId),
    markerApi: null
  };
  hydrantTrace('street.aim.resolved', {
    idBi: sourceId,
    panoId,
    heading,
    panoLongitude: pano.longitude,
    panoLatitude: pano.latitude
  });
  if (!panorama) return hydrantStreetAim;
  hydrantAimLockUntil = Date.now() + 8000;
  muteStreetViewTraversal(8000);
  beginProgrammaticStreetApply(1600);
  if (hydrantStreetAim.panoId && typeof panorama.setPano === 'function') {
    panorama.setPano(hydrantStreetAim.panoId);
  } else {
    panorama.setPosition?.({ lat: pano.latitude, lng: pano.longitude });
  }
  applyStreetViewPov({ heading, pitch: 0 });
  await attachHydrantStreetMarker(record, hydrantStreetAim);
  return hydrantStreetAim;
}

function wrapStreetHeading(value) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

function clampStreetPitch(value) {
  const pitch = Number(value);
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-90, Math.min(90, pitch));
}

export function povFromSensorPose(input = {}) {
  const hasHeading = Number.isFinite(Number(input.heading));
  const hasPitch = Number.isFinite(Number(input.pitch));
  return {
    heading: hasHeading ? wrapStreetHeading(input.heading) : 0,
    pitch: hasPitch ? clampStreetPitch(input.pitch) : 0,
    specified: hasHeading || hasPitch
  };
}

function applyStreetViewPov(pov) {
  if (!panorama?.setPov || !pov) return false;
  beginProgrammaticStreetApply(400);
  panorama.setPov({
    heading: wrapStreetHeading(pov.heading),
    pitch: clampStreetPitch(pov.pitch)
  });
  readPanoramaState();
  return true;
}

export function setGoogleStreetViewPov(input = {}) {
  if (!panorama) return getGoogleStreetViewSnapshot();
  const current = panorama.getPov?.() || lastPov || { heading: 0, pitch: 0 };
  applyStreetViewPov({
    heading: Number.isFinite(Number(input.heading)) ? input.heading : current.heading,
    pitch: Number.isFinite(Number(input.pitch)) ? input.pitch : current.pitch
  });
  return getGoogleStreetViewSnapshot();
}

export function lookGoogleStreetView(headingDelta = 45, pitchDelta = 0) {
  if (!panorama) throw new Error('Street 360 is not open.');
  const pov = panorama.getPov?.() || { heading: 0, pitch: 0 };
  applyStreetViewPov({
    heading: wrapStreetHeading((Number(pov.heading) || 0) + Number(headingDelta)),
    pitch: clampStreetPitch((Number(pov.pitch) || 0) + Number(pitchDelta))
  });
  return getGoogleStreetViewSnapshot();
}

export function zoomGoogleStreetView(delta = 1) {
  if (!panorama) throw new Error('Street 360 is not open.');
  const current = Number(panorama.getZoom?.());
  panorama.setZoom?.(Math.max(0, (Number.isFinite(current) ? current : 1) + Number(delta)));
  readPanoramaState();
  return getGoogleStreetViewSnapshot();
}

function headingDeltaDeg(a, b) {
  return Math.abs(((Number(a) - Number(b) + 540) % 360) - 180);
}

async function nextOutdoorPanoAlongLook(google, beforePosition, beforePano) {
  if (!beforePosition) return null;
  const heading = Number.isFinite(Number(lastPov?.heading)) ? Number(lastPov.heading) : 0;
  const recent = new Set(coverageVisitedPanos.slice(-16));
  for (const meters of [18, 36, 55, 80, 120, 170]) {
    const dest = destinationAlongHeading(beforePosition, heading, meters);
    if (!dest) continue;
    const queried = await queryPanorama(google, {
      location: { lat: dest.latitude, lng: dest.longitude },
      radius: 55,
      source: outdoorSource(google)
    });
    const pano = queried.result?.location?.pano || queried.result?.location?.panoId || null;
    if (pano && pano !== beforePano && !recent.has(pano)) return pano;
  }
  return null;
}

export async function moveGoogleStreetViewAlongCoverage() {
  if (!panorama) throw new Error('Street 360 is not open.');
  const google = window.google;
  const beforePano = panorama.getPano?.();
  const beforePosition = lastPanoramaPosition ? { ...lastPanoramaPosition } : null;
  if (beforePano) {
    coverageVisitedPanos = [...coverageVisitedPanos.filter((id) => id !== beforePano), beforePano].slice(-16);
  }
  const recent = new Set(coverageVisitedPanos);
  const heading = Number.isFinite(Number(lastPov?.heading)) ? Number(lastPov.heading) : 0;
  const links = await waitForLinks(panorama, google, 4000);
  const candidates = (Array.isArray(links) ? links : [])
    .filter((item) => item?.pano && !recent.has(item.pano))
    .sort((a, b) => headingDeltaDeg(a.heading, heading) - headingDeltaDeg(b.heading, heading));
  let nextPano = null;
  if (String(beforePano || '').startsWith('CAo')) {
    nextPano = await nextOutdoorPanoAlongLook(google, beforePosition, beforePano);
  }
  if (!nextPano) nextPano = candidates[0]?.pano || null;
  if (!nextPano) {
    nextPano = await nextOutdoorPanoAlongLook(google, beforePosition, beforePano);
  }
  if (!nextPano) {
    return { ...getGoogleStreetViewSnapshot(), moved: false };
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    const listener = panorama.addListener?.('pano_changed', () => {
      clearTimeout(timer);
      google?.maps?.event?.removeListener?.(listener);
      resolve();
    });
    panorama.setPano(nextPano);
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

export function subscribeGoogleStreetViewNavigation(listener) {
  navigationListeners.add(listener);
  if (lastPanoramaPosition) {
    listener({
      longitude: lastPanoramaPosition.longitude,
      latitude: lastPanoramaPosition.latitude,
      heading: Number.isFinite(Number(lastPov?.heading)) ? Number(lastPov.heading) : null,
      zoom: lastZoom,
      pitch: Number.isFinite(Number(lastPov?.pitch)) ? Number(lastPov.pitch) : null,
      panoId: panorama?.getPano?.() || lastOutdoorPanoId || null,
      panoPresent,
      programmatic: isStreetViewTraversalMuted()
    });
  }
  return () => navigationListeners.delete(listener);
}

export function applyWorldviewNavigationToStreetView(nav, options = {}) {
  if (!panorama || !nav) return false;
  const latitude = Number(nav.latitude);
  const longitude = Number(nav.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const minOffset = Number(options.minOffsetMeters) || 80;
  const here = lastPanoramaPosition;
  const offset = here ? offsetMetersBetween(here, { latitude, longitude }) : null;
  beginProgrammaticStreetApply(offset != null && offset < minOffset ? 900 : 1600);
  if (offset != null && offset < minOffset) {
    if (Number.isFinite(Number(nav.heading)) && panorama.setPov) {
      const pov = panorama.getPov?.() || { heading: 0, pitch: 0 };
      const delta = Math.abs(((Number(nav.heading) - Number(pov.heading) + 540) % 360) - 180);
      if (delta > 25) {
        panorama.setPov({
          heading: Number(nav.heading),
          pitch: Number(pov.pitch) || 0
        });
      }
    }
    return false;
  }
  lastOutdoorPanoId = null;
  panorama.setPosition?.({ lat: latitude, lng: longitude });
  return true;
}
