import { describeLayerRenderer, normalizeToWgs84Pair } from '/js/ocean-view-helpers.js';

let oceanConfig = null;
let currentMode = 'tracker';
let cdnPromise = null;
let oceanInitialized = false;
let oceanLayerBindings = [];

const OCEAN_TOGGLE_SPECS = [
  { id: 'ocean-layer-vessel', match: /current vessel position/i },
  { id: 'ocean-layer-history', match: /track history/i },
  { id: 'ocean-layer-travelled', match: /travelled route/i },
  { id: 'ocean-layer-destination', match: /destination/i },
  { id: 'ocean-layer-estimated', match: /estimated route/i },
  { id: 'ocean-layer-conditions', match: /marine conditions/i },
  { id: 'ocean-layer-currents', match: /ocean current/i }
];

function $(id) { return document.getElementById(id); }

export function getMapMode() {
  return currentMode;
}

export async function loadOceanConfig() {
  if (oceanConfig) return oceanConfig;
  const res = await fetch('/api/ocean-view');
  if (!res.ok) throw new Error('Could not load ocean view configuration');
  oceanConfig = await res.json();
  return oceanConfig;
}

async function registerArcgisAccess(config) {
  const res = await fetch('/api/ocean-view/access');
  if (!res.ok) return;
  const access = await res.json();
  if (!access?.token) return;
  const IdentityManager = await $arcgis.import('@arcgis/core/identity/IdentityManager.js');
  const portalRoot = `${(access.portalUrl || config.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '')}/sharing/rest`;
  IdentityManager.registerToken({ server: portalRoot, token: access.token, ssl: true });
  if (access.featureServiceUrl) {
    const serviceRoot = access.featureServiceUrl.replace(/(\/arcgis\/rest\/services).*/, '$1');
    IdentityManager.registerToken({ server: serviceRoot, token: access.token, ssl: true });
  }
}

function loadArcgisCdn(cdnUrl) {
  if (window.$arcgis) return Promise.resolve();
  if (cdnPromise) return cdnPromise;
  cdnPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-arcgis-cdn]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = cdnUrl;
    script.dataset.arcgisCdn = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ArcGIS CDN'));
    document.head.appendChild(script);
  });
  return cdnPromise;
}

function showOceanLoading(show) {
  $('ocean-loading')?.classList.toggle('hidden', !show);
}

function showOceanError(message) {
  const el = $('ocean-error');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideOceanError() {
  $('ocean-error')?.classList.add('hidden');
}

function showEmbedFallback(config, message) {
  $('ocean-map-host')?.classList.add('hidden');
  const fallback = $('ocean-embed-fallback');
  fallback?.classList.remove('hidden');
  if (message && $('ocean-fallback-message')) $('ocean-fallback-message').textContent = message;
  const link = $('ocean-fallback-link');
  if (link && config?.externalUrl) link.href = config.externalUrl;
}

function hideEmbedFallback() {
  $('ocean-embed-fallback')?.classList.add('hidden');
  $('ocean-map-host')?.classList.remove('hidden');
}

function renderLayerWarnings(warnings, layerInfo) {
  const el = $('ocean-layer-warnings');
  if (!el) return;
  const parts = [];
  if (layerInfo?.length) {
    const animated = layerInfo.filter((l) => l.animated);
    if (animated.length) {
      parts.push(`<p><strong>Animated layers:</strong> ${animated.map((l) => `${l.title} (${l.rendererType || l.layerType})`).join(', ')}</p>`);
    }
  }
  if (warnings?.length) {
    parts.push('<p><strong>Layers that could not load:</strong></p><ul>' + warnings.map((w) => `<li>${w.title}: ${w.error}</li>`).join('') + '</ul>');
  }
  el.innerHTML = parts.join('');
  el.classList.toggle('hidden', parts.length === 0);
}

async function getOceanView() {
  const mapEl = $('arcgis-ocean-map');
  if (!mapEl) return null;
  await mapEl.viewOnReady();
  return mapEl.view;
}

export { getOceanView };

function collectMapLayers(webmap) {
  const out = [];
  const walk = (layers) => {
    for (const layer of layers) {
      out.push(layer);
      const children = layer.layers?.toArray?.() || layer.sublayers?.toArray?.() || [];
      if (children.length) walk(children);
    }
  };
  walk(webmap.allLayers.toArray());
  return out;
}

const UNAVAILABLE_LAYER_LABELS = {
  'ocean-layer-history': 'Track History — unavailable (0 observations)',
  'ocean-layer-travelled': 'Travelled Route — waiting (need 2 observations)'
};

function pushCoordinate(coords, lon, lat, attrs = {}) {
  const pair = normalizeToWgs84Pair(lon, lat, attrs);
  if (pair) coords.push(pair);
}

async function queryLayerCoordinates(layer) {
  const coords = [];
  if (!layer?.createQuery || !layer?.queryFeatures) return coords;
  await layer.load();
  const query = layer.createQuery();
  query.where = '1=1';
  query.outFields = ['*'];
  query.returnGeometry = true;
  query.num = 5000;
  const result = await layer.queryFeatures(query);
  for (const feature of result.features || []) {
    const geom = feature.geometry;
    const attrs = feature.attributes || {};
    if (!geom) continue;
    if (geom.type === 'point') pushCoordinate(coords, geom.longitude, geom.latitude, attrs);
    if (geom.type === 'polyline') {
      for (const path of geom.paths || []) {
        for (const [lon, lat] of path) pushCoordinate(coords, lon, lat);
      }
    }
  }
  return coords;
}

async function countLayerFeatures(layer) {
  if (!layer?.createQuery) return null;
  await layer.load();
  const query = layer.createQuery();
  query.where = '1=1';
  if (typeof layer.queryFeatureCount === 'function') {
    return layer.queryFeatureCount(query);
  }
  const result = await layer.queryFeatures(query);
  return result.features?.length ?? 0;
}

async function getFeatureLayers(webmap) {
  await webmap.loadAll();
  const out = [];
  const walk = (layers) => {
    for (const layer of layers) {
      out.push(layer);
      const children = layer.layers?.toArray?.() || layer.sublayers?.toArray?.() || [];
      if (children.length) walk(children);
    }
  };
  walk(webmap.allLayers.toArray());
  return out.filter((layer) => layer.url?.includes('FeatureServer')
    || /vespucci|vessel|destination|route|history|conditions/i.test(layer.title || ''));
}

async function findLayerByTitle(webmap, pattern) {
  const layers = await getFeatureLayers(webmap);
  return layers.find((layer) => pattern.test(layer.title || '')) || null;
}

async function getVesselCoordinates(webmap) {
  const layer = await findLayerByTitle(webmap, /current vessel position/i);
  if (!layer) return null;
  const coords = await queryLayerCoordinates(layer);
  return coords[0] || null;
}

async function collectVoyageCoordinates(webmap) {
  const layers = await getFeatureLayers(webmap);
  const coords = [];
  for (const layer of layers) {
    if (/ocean current/i.test(layer.title || '')) continue;
    const layerCoords = await queryLayerCoordinates(layer);
    coords.push(...layerCoords);
  }
  const config = await loadOceanConfig();
  if (config?.destination) {
    pushCoordinate(coords, config.destination.longitude, config.destination.latitude, {
      Longitude: config.destination.longitude,
      Latitude: config.destination.latitude
    });
  }
  return coords;
}

function extentFromCoordinates(coords) {
  if (!coords.length) return null;
  const lons = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const padLon = Math.max(1, (Math.max(...lons) - Math.min(...lons)) * 0.08);
  const padLat = Math.max(1, (Math.max(...lats) - Math.min(...lats)) * 0.08);
  return {
    xmin: Math.min(...lons) - padLon,
    ymin: Math.min(...lats) - padLat,
    xmax: Math.max(...lons) + padLon,
    ymax: Math.max(...lats) + padLat,
    spatialReference: { wkid: 4326 }
  };
}

async function centerOceanOnVessel() {
  const view = await getOceanView();
  if (!view) return;
  const coords = await getVesselCoordinates(view.map);
  if (!coords) return;
  await view.goTo({ center: coords, zoom: Math.max(view.zoom || 6, 6) }, { duration: 800 });
}

async function fitOceanVoyage() {
  const view = await getOceanView();
  if (!view) return;
  const coords = await collectVoyageCoordinates(view.map);
  const extent = extentFromCoordinates(coords);
  if (!extent) return;
  await view.goTo(extent, { duration: 900 });
}

async function wireOceanLayerToggles(webmap) {
  for (const binding of oceanLayerBindings) {
    binding.checkbox.removeEventListener('change', binding.handler);
  }
  oceanLayerBindings = [];

  const layers = collectMapLayers(webmap);
  const historyLayer = layers.find((entry) => /track history/i.test(entry.title || ''));
  let historyCount = null;
  if (historyLayer) {
    try {
      historyCount = await countLayerFeatures(historyLayer);
    } catch {
      historyCount = null;
    }
  }

  for (const spec of OCEAN_TOGGLE_SPECS) {
    const checkbox = $(spec.id);
    const layer = layers.find((entry) => spec.match.test(entry.title || ''));
    const label = checkbox?.closest('label');
    if (!checkbox || !layer) continue;

    const isCurrents = /ocean current/i.test(layer.title || '');
    const isHistory = /track history/i.test(layer.title || '');
    const isTravelled = /travelled route/i.test(layer.title || '');
    let featureCount = null;
    if (!isCurrents) {
      try {
        featureCount = isHistory ? historyCount : await countLayerFeatures(layer);
      } catch {
        featureCount = null;
      }
    }

    const unavailable = isHistory
      ? featureCount === 0
      : isTravelled
        ? (historyCount != null ? historyCount < 2 : featureCount === 0)
        : false;

    checkbox.disabled = unavailable;
    label?.classList.toggle('layer-unavailable', unavailable);
    if (unavailable) {
      checkbox.checked = false;
      layer.visible = false;
      if (UNAVAILABLE_LAYER_LABELS[spec.id] && label) {
        const text = ` ${UNAVAILABLE_LAYER_LABELS[spec.id]}`;
        if (label.lastChild && label.lastChild.nodeType === Node.TEXT_NODE) {
          label.lastChild.textContent = text;
        } else {
          label.append(document.createTextNode(text));
        }
      }
      continue;
    }

    checkbox.checked = true;
    layer.visible = true;
    label?.removeAttribute('title');
    const handler = () => { layer.visible = checkbox.checked; };
    checkbox.addEventListener('change', handler);
    oceanLayerBindings.push({ checkbox, handler });
  }
}

async function toggleOceanFullscreen() {
  const panel = $('map-panel');
  if (!document.fullscreenElement) await panel?.requestFullscreen?.();
  else await document.exitFullscreen?.();
  const view = await getOceanView();
  view?.resize();
}

async function initializeOceanView() {
  if (oceanInitialized) return;
  const config = await loadOceanConfig();
  const mapEl = $('arcgis-ocean-map');
  if (!mapEl) return;

  hideEmbedFallback();
  hideOceanError();
  showOceanLoading(true);
  renderLayerWarnings([], []);

  $('ocean-fallback-link').href = config.externalUrl;
  $('ocean-btn-external')?.addEventListener('click', () => window.open(config.externalUrl, '_blank', 'noopener,noreferrer'));

  try {
    await loadArcgisCdn(config.cdnUrl);
    await registerArcgisAccess(config);
    mapEl.setAttribute('item-id', config.webmapId);
    if (config.portalUrl) mapEl.setAttribute('portal-url', config.portalUrl);

    let view;
    try {
      await mapEl.viewOnReady();
      view = mapEl.view;
    } catch (err) {
      throw new Error(`WebMap ${config.webmapId} failed to load: ${err.message || err}`);
    }

    const webmap = view.map;
    const warnings = [];
    const layerInfo = [];
    const layers = collectMapLayers(webmap);
    for (const layer of layers) {
      try {
        await layer.load();
        layer.visible = layer.visible !== false;
        layerInfo.push(describeLayerRenderer(layer));
      } catch (err) {
        warnings.push({ title: layer.title || 'Unnamed layer', error: err.message || 'Failed to load' });
        try { layer.visible = false; } catch { /* ignore */ }
      }
    }

    await wireOceanLayerToggles(webmap);
    showOceanLoading(false);
    renderLayerWarnings(warnings, layerInfo);
    if (warnings.length) {
      showOceanError(`WebMap loaded with ${warnings.length} layer warning(s). See details below.`);
    }
    await fitOceanVoyage();
    oceanInitialized = true;
  } catch (err) {
    showOceanLoading(false);
    const detail = err?.message || String(err);
    showOceanError(detail);
    showEmbedFallback(config, `ArcGIS Ocean View error: ${detail}`);
    throw err;
  }
}

export async function setMapMode(mode) {
  const next = mode === 'ocean' ? 'ocean' : 'tracker';
  if (next === currentMode) return;
  currentMode = next;

  $('tracker-view')?.classList.toggle('hidden', next !== 'tracker');
  $('ocean-view')?.classList.toggle('hidden', next !== 'ocean');
  $('btn-mode-tracker')?.classList.toggle('active', next === 'tracker');
  $('btn-mode-ocean')?.classList.toggle('active', next === 'ocean');
  $('tracker-controls')?.classList.toggle('hidden', next !== 'tracker');
  $('ocean-controls')?.classList.toggle('hidden', next !== 'ocean');
  $('layer-toggles')?.classList.toggle('hidden', next !== 'tracker');
  $('ocean-layer-toggles')?.classList.toggle('hidden', next !== 'ocean');

  if (next === 'ocean') {
    await initializeOceanView();
    const view = await getOceanView();
    view?.resize();
  } else {
    window.dispatchEvent(new Event('resize'));
  }
}

export function initOceanView() {
  $('btn-mode-tracker')?.addEventListener('click', () => setMapMode('tracker'));
  $('btn-mode-ocean')?.addEventListener('click', () => setMapMode('ocean').catch(() => {}));
  $('btn-ocean-center')?.addEventListener('click', () => centerOceanOnVessel().catch(() => {}));
  $('btn-ocean-fit')?.addEventListener('click', () => fitOceanVoyage().catch(() => {}));
  $('btn-ocean-fullscreen')?.addEventListener('click', () => toggleOceanFullscreen().catch(() => {}));
  document.addEventListener('fullscreenchange', () => {
    if (currentMode === 'ocean') getOceanView().then((view) => view?.resize());
  });
}

initOceanView();
