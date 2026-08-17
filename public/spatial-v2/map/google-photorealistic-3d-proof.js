import {
  MONTREAL_OPERATIONAL_CENTER,
  isGreaterMontrealLongitudeLatitude
} from '../../spatial/montreal-operational-config.js';
import {
  initMapFoundation,
  getMapView,
  getMapViewCreateCount
} from './map-foundation.js';
import {
  closeGoogleMapsJs3d,
  getGoogleMapsJs3dSnapshot,
  nudgeGoogleMapsJs3dHeading,
  openGoogleMapsJs3d,
  probeGoogleMapsJs3d
} from './google-maps-js-3d.js';

const mapHost = document.querySelector('[data-iqai-map-host]');
const stageHost = document.querySelector('[data-iqai-google-3d-host]');
const statusNode = document.querySelector('[data-iqai-google-3d-status]');
const params = new URLSearchParams(window.location.search);

function setStatus(text) {
  if (statusNode) statusNode.textContent = text;
}

function hideMapHost() {
  if (!mapHost) return;
  mapHost.style.visibility = 'hidden';
  mapHost.style.pointerEvents = 'none';
}

function revealMapHost() {
  if (!mapHost) return;
  mapHost.style.visibility = 'visible';
  mapHost.style.pointerEvents = '';
}

function pointFromQueryOrMap() {
  const view = getMapView();
  const longitude = Number(params.get('lon') || view?.center?.longitude || MONTREAL_OPERATIONAL_CENTER.longitude);
  const latitude = Number(params.get('lat') || view?.center?.latitude || MONTREAL_OPERATIONAL_CENTER.latitude);
  return { longitude, latitude };
}

function publishApi() {
  window.__iqaiGooglePhotorealistic3d = {
    open: open3d,
    close: returnTo2d,
    nudgeHeading: nudgeGoogleMapsJs3dHeading,
    snapshot: () => ({
      ...getGoogleMapsJs3dSnapshot(),
      mapViewCreateCount: getMapViewCreateCount(),
      mapViewExists: Boolean(getMapView()),
      mapHostHidden: mapHost ? mapHost.style.visibility === 'hidden' : null,
      mapCenter: {
        longitude: getMapView()?.center?.longitude ?? null,
        latitude: getMapView()?.center?.latitude ?? null
      }
    })
  };
}

async function open3d() {
  const point = pointFromQueryOrMap();
  if (!isGreaterMontrealLongitudeLatitude(point.longitude, point.latitude)) {
    setStatus('point outside Montréal');
    throw new Error('Selected point is outside Greater Montréal.');
  }
  setStatus('opening Google Maps JS 3D');
  hideMapHost();
  const snap = await openGoogleMapsJs3d({
    container: stageHost,
    longitude: point.longitude,
    latitude: point.latitude,
    source: getMapView() ? 'mapview-center' : 'montreal-operational-center'
  });
  setStatus(snap.maps3dLoaded ? 'Google Map3DElement ready' : 'Google 3D loading');
  return snap;
}

async function returnTo2d() {
  const selected = getGoogleMapsJs3dSnapshot().selectedPoint;
  await closeGoogleMapsJs3d();
  if (stageHost) {
    stageHost.hidden = true;
    stageHost.innerHTML = '';
  }
  revealMapHost();
  const view = getMapView();
  if (view && selected && isGreaterMontrealLongitudeLatitude(selected.longitude, selected.latitude)) {
    view.center = [selected.longitude, selected.latitude];
  }
  setStatus(`2D restored · MapView ${getMapViewCreateCount()}`);
  return window.__iqaiGooglePhotorealistic3d.snapshot();
}

async function boot() {
  publishApi();
  setStatus('probing Google Maps JS');
  const entitlement = await probeGoogleMapsJs3d().catch((error) => ({
    ok: false,
    limitation: String(error?.message || error)
  }));
  if (!entitlement?.credentialUsable) {
    setStatus(entitlement?.limitation || 'Google Maps JS 3D not configured');
  } else {
    setStatus('Google Maps JS key present · starting 2D');
  }
  try {
    await initMapFoundation(mapHost);
    setStatus(`2D MapView ready · ${getMapViewCreateCount()}`);
  } catch (error) {
    setStatus(`2D unavailable · ${String(error?.message || error)}`);
  }
  publishApi();
}

document.querySelector('[data-iqai-google-3d-open]')?.addEventListener('click', () => {
  open3d().catch((error) => setStatus(String(error?.message || error)));
});
document.querySelector('[data-iqai-google-3d-return]')?.addEventListener('click', () => {
  returnTo2d().catch((error) => setStatus(String(error?.message || error)));
});

boot().catch((error) => setStatus(String(error?.message || error)));
