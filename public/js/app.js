import { renderAllInfoCards } from './info-cards.js';
import { setMapData } from './map-context.js';
import { normalizeToWgs84Pair } from './ocean-view-helpers.js';

const REFRESH_INTERVAL_MS = 60_000;
const HIDDEN_REFRESH_INTERVAL_MS = 300_000;

const layers = { vessel: null };
const layerGroups = {
  vessel: L.layerGroup(),
  history: L.layerGroup(),
  travelledRoute: L.layerGroup(),
  destination: L.layerGroup(),
  estimatedRoute: L.layerGroup(),
  conditions: L.layerGroup()
};

let map;
let basemapLayer;
let mapData = null;
let refreshTimer = null;
let fetchInFlight = false;

const $ = (id) => document.getElementById(id);

function getBasemapUrl(theme) {
  return theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([38.4, -28], 5);
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  basemapLayer = L.tileLayer(getBasemapUrl(theme), {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  Object.values(layerGroups).forEach((g) => g.addTo(map));

  window.dispatchEvent(new CustomEvent('classic-leaflet-ready', { detail: { map } }));

  // Re-layer conditions behind vessel
  layerGroups.conditions.addTo(map);
  layerGroups.vessel.addTo(map);
}

function updateBasemap(theme) {
  if (!map || !basemapLayer) return;
  map.removeLayer(basemapLayer);
  basemapLayer = L.tileLayer(getBasemapUrl(theme), {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  basemapLayer.bringToBack();
}

const themeObserver = new MutationObserver(() => {
  updateBasemap(document.documentElement.getAttribute('data-theme') || 'light');
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function createShipIcon(heading) {
  const rotation = Number.isFinite(Number(heading)) ? Number(heading) : 0;
  const fill = getComputedStyle(document.documentElement).getPropertyValue('--vessel').trim() || '#b8860b';
  const html = `<div class="ship-marker" style="transform:rotate(${rotation}deg)">
    <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 2 L32 32 L18 27 L4 32 Z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>
      <line x1="18" y1="2" x2="18" y2="12" stroke="#fff" stroke-width="1.2"/>
    </svg>
  </div>`;
  return L.divIcon({ className: 'ship-icon', html, iconSize: [36, 36], iconAnchor: [18, 18] });
}

function createConditionsIcon() {
  return L.divIcon({
    className: 'conditions-ring-icon',
    html: '<div class="conditions-ring"></div>',
    iconSize: [52, 52],
    iconAnchor: [26, 26]
  });
}

function createDestinationIcon() {
  return L.divIcon({
    className: 'destination-icon',
    html: '<div class="destination-pin"></div>',
    iconSize: [18, 18],
    iconAnchor: [3, 18]
  });
}

function formatTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function updateHeaderStatus(vessel) {
  const dot = $('status-dot');
  const text = $('status-text');
  const freshness = vessel?.freshness || 'unknown';
  dot.className = `status-dot ${freshness}`;
  if (vessel?.empty) {
    text.textContent = 'No position data';
  } else {
    const name = vessel?.properties?.VesselName || 'Amerigo Vespucci';
    text.textContent = `${name} · ${freshness}${vessel.ageSeconds != null ? ` (${vessel.ageSeconds}s)` : ''}`;
  }
}

function clearLayerGroup(name) {
  layerGroups[name].clearLayers();
}

function coordsFromFeature(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!coords) return null;
  if (feature.geometry.type === 'Point') {
    return normalizeToWgs84Pair(coords[0], coords[1], feature.properties || {});
  }
  return null;
}

function lineFromFeature(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const latlngs = coords.map((vertex) => {
    if (Array.isArray(vertex)) {
      const pair = normalizeToWgs84Pair(vertex[0], vertex[1], feature.properties || {});
      return pair ? [pair[1], pair[0]] : null;
    }
    if (typeof vertex === 'string') {
      const parts = vertex.trim().split(/\s+/);
      const pair = normalizeToWgs84Pair(Number(parts[0]), Number(parts[1]), feature.properties || {});
      return pair ? [pair[1], pair[0]] : null;
    }
    return null;
  }).filter(Boolean);
  return latlngs.length >= 2 ? latlngs : null;
}

function renderMapLayers(data) {
  Object.keys(layerGroups).forEach(clearLayerGroup);

  const vesselFeature = data.vessel?.geojson?.features?.[0];
  if (data.conditions?.geojson?.features?.length) {
    data.conditions.geojson.features.forEach((f) => {
      const pair = coordsFromFeature(f);
      if (!pair) return;
      const [lon, lat] = pair;
      const ring = L.marker([lat, lon], { icon: createConditionsIcon(), interactive: true, zIndexOffset: -100 });
      const p = f.properties;
      ring.bindPopup([
        '<strong>Marine Conditions</strong>',
        p.WeatherText ? `Weather: ${p.WeatherText}` : '',
        p.WindKnots != null ? `Wind: ${p.WindKnots} kn` : '',
        p.WaveHeightM != null ? `Waves: ${p.WaveHeightM} m` : ''
      ].filter(Boolean).join('<br>'));
      layerGroups.conditions.addLayer(ring);
    });
  }

  if (data.history?.geojson?.features?.length) {
    data.history.geojson.features.forEach((f) => {
      const pair = coordsFromFeature(f);
      if (!pair) return;
      const [lon, lat] = pair;
      const pt = L.circleMarker([lat, lon], {
        radius: 4,
        color: '#1565a8',
        fillColor: '#4a9eff',
        fillOpacity: 0.75,
        weight: 1.5
      });
      layerGroups.history.addLayer(pt);
    });
  }

  if (data.travelledRoute?.geojson?.features?.length) {
    data.travelledRoute.geojson.features.forEach((f) => {
      const latlngs = lineFromFeature(f);
      if (!latlngs) return;
      const line = L.polyline(latlngs, { color: '#1565a8', weight: 4, opacity: 0.9 });
      line.bindPopup(`<strong>${data.travelledRoute.label || 'Observed AIS track'}</strong>`);
      layerGroups.travelledRoute.addLayer(line);
    });
  }

  if (data.destination?.geojson?.features?.length) {
    data.destination.geojson.features.forEach((f) => {
      const pair = coordsFromFeature(f);
      if (!pair) return;
      const [lon, lat] = pair;
      const m = L.marker([lat, lon], { icon: createDestinationIcon() });
      const p = f.properties;
      m.bindPopup(`<strong>${p.DestinationName || 'Destination'}</strong><br>${p.PortCode || ''}`);
      layerGroups.destination.addLayer(m);
    });
  }

  if (data.estimatedRoute?.geojson?.features?.length) {
    data.estimatedRoute.geojson.features.forEach((f) => {
      const latlngs = lineFromFeature(f);
      if (!latlngs) return;
      const line = L.polyline(latlngs, {
        color: '#c0392b',
        weight: 3,
        opacity: 0.85,
        dashArray: '10 8'
      });
      line.bindPopup(`<strong>Estimated route</strong><br><em>${data.estimatedRoute.disclaimer || 'Straight-line estimate'}</em>`);
      layerGroups.estimatedRoute.addLayer(line);
    });
  }

  if (vesselFeature) {
    const pair = coordsFromFeature(vesselFeature);
    if (pair) {
      const [lon, lat] = pair;
      const heading = vesselFeature.properties.Heading ?? vesselFeature.properties.Course;
      const marker = L.marker([lat, lon], { icon: createShipIcon(heading), zIndexOffset: 1000 });
      const p = vesselFeature.properties;
      marker.bindPopup([
        `<strong>${p.VesselName || 'Amerigo Vespucci'}</strong>`,
        `Speed: ${p.SpeedKnots ?? '—'} kn`,
        `Course: ${p.Course ?? '—'}°`,
        `Heading: ${p.Heading ?? '—'}°`,
        `Last AIS: ${formatTime(p.LastAIS)}`
      ].join('<br>'));
      layerGroups.vessel.addLayer(marker);
      layers.vessel = marker;
    }
  }

  applyLayerVisibility();
}

function applyLayerVisibility() {
  document.querySelectorAll('#layer-toggles input').forEach((input) => {
    const name = input.dataset.layer;
    const group = layerGroups[name];
    if (!group) return;
    if (input.checked) {
      if (!map.hasLayer(group)) map.addLayer(group);
    } else if (map.hasLayer(group)) {
      map.removeLayer(group);
    }
  });
}

function centerOnVessel() {
  if (layers.vessel) {
    map.setView(layers.vessel.getLatLng(), Math.max(map.getZoom(), 8));
  } else if (mapData?.vessel?.geojson?.features?.[0]) {
    const pair = coordsFromFeature(mapData.vessel.geojson.features[0]);
    if (pair) map.setView([pair[1], pair[0]], 8);
  }
}

function fitVoyage() {
  const bounds = L.latLngBounds([]);
  Object.values(layerGroups).forEach((group) => {
    group.eachLayer((layer) => {
      if (layer.getLatLng) bounds.extend(layer.getLatLng());
      if (layer.getLatLngs) {
        const latlngs = layer.getLatLngs();
        if (Array.isArray(latlngs[0])) latlngs.forEach((ll) => bounds.extend(ll));
        else latlngs.forEach((ll) => bounds.extend(ll));
      }
    });
  });
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48] });
}

function showLoading(show) {
  $('map-loading')?.classList.toggle('hidden', !show);
}

function showError(show, message) {
  const el = $('map-error');
  el?.classList.toggle('hidden', !show);
  if (message && $('map-error-text')) $('map-error-text').textContent = message;
}

function updateDemoBadge(data) {
  $('demo-badge')?.classList.toggle('hidden', data?.meta?.preview !== true);
}

async function fetchMapData() {
  if (fetchInFlight) return;
  fetchInFlight = true;
  showError(false);
  if (!mapData) showLoading(true);
  try {
    const res = await fetch('/api/map-data');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    mapData = data;
    setMapData(data);
    $('last-refresh').textContent = new Date().toLocaleString();
    $('server-fetched').textContent = data.meta?.fetchedAt
      ? new Date(data.meta.fetchedAt).toLocaleString()
      : '—';
    updateDemoBadge(data);
    renderAllInfoCards(data);
    updateHeaderStatus(data.vessel);
    renderMapLayers(data);
    showLoading(false);
  } catch (err) {
    showLoading(false);
    showError(true, err.message || 'Failed to load map data.');
  } finally {
    fetchInFlight = false;
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = document.hidden ? HIDDEN_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;
  refreshTimer = setInterval(fetchMapData, interval);
}

document.addEventListener('visibilitychange', () => {
  scheduleRefresh();
  if (!document.hidden) fetchMapData();
});

window.addEventListener('resize', () => map?.invalidateSize());

document.querySelectorAll('#layer-toggles input').forEach((input) => {
  input.addEventListener('change', applyLayerVisibility);
});

$('btn-center-vessel')?.addEventListener('click', centerOnVessel);
$('btn-fit-voyage')?.addEventListener('click', fitVoyage);
$('btn-retry')?.addEventListener('click', fetchMapData);

initMap();
fetchMapData();
scheduleRefresh();
