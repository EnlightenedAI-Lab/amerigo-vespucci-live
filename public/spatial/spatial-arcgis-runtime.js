/**
 * IQAI Spatial V1 — single ArcGIS MapView runtime (created once per page load).
 */

import {
  MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID,
  MONTREAL_OPERATIONAL_WEBMAP_NAME
} from './montreal-operational-config.js';
import {
  fetchMontrealOAuthConfig,
  ensureMontrealOAuthRegistered,
  getMontrealArcgisSession,
  signInToMontrealArcgis,
  buildMontrealUserDiagnostics,
  isMontrealAccessDeniedError,
  formatArcgisOAuthError
} from './montreal-arcgis-oauth.js';

const ARCGIS_CDN_URL = 'https://js.arcgis.com/5.1/';

/** @type {import('@arcgis/core/views/MapView').default | null} */
let mapView = null;
/** @type {import('@arcgis/core/WebMap').default | null} */
let webMap = null;
/** @type {Promise<object> | null} */
let initPromise = null;
let mapViewCreateCount = 0;
let webMapCreateCount = 0;
let shellWidgetsMounted = false;
/** @type {HTMLElement | null} */
let operationalLegendHost = null;
/** @type {import('@arcgis/core/widgets/Legend').default | null} */
let esriLegendWidget = null;

export async function loadArcgisCdn(cdnUrl = ARCGIS_CDN_URL) {
  if (window.$arcgis) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = cdnUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ArcGIS Maps SDK'));
    document.head.appendChild(script);
  });
}

export async function importArc(path) {
  const mod = await $arcgis.import(path);
  return mod?.default || mod;
}

function sanitizeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/token=[^&\s]+/gi, 'token=[redacted]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
}

async function loadWebMapWithTimeout(map, timeoutMs = 30000) {
  return withTimeout(map.load(), timeoutMs, 'WebMap load');
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function isWebMapLoadFailure(error) {
  if (!error) return false;
  if (isMontrealAccessDeniedError(error)) return true;
  const message = String(error?.message || error || '').toLowerCase();
  return /timed out|timeout|load failed|unable to load/i.test(message);
}

/**
 * @typedef {{ status: string, message?: string, webmapTitle?: string, username?: string | null }} RuntimeStatus
 * @typedef {{ layerListHost?: HTMLElement, mapControlsHost?: HTMLElement, mapToolsHost?: HTMLElement, measureToolsHost?: HTMLElement }} WidgetHosts
 */

/**
 * @param {HTMLElement} mapContainer
 * @param {{ onStatus?: (status: RuntimeStatus) => void, autoSignIn?: boolean, widgetHosts?: WidgetHosts }} [options]
 */
export function initSpatialArcgisRuntime(mapContainer, options = {}) {
  if (mapView) {
    return Promise.resolve({ view: mapView, webmap: webMap }).then(async (runtime) => {
      try {
        const catalogModule = await import('./webmap-layer-catalog.js');
        void catalogModule.ensureLiveLayerCatalog();
      } catch (catalogError) {
        console.warn('[IQAI] WebMap layer catalog refresh failed', catalogError);
      }
      return runtime;
    });
  }
  if (initPromise) return initPromise;
  initPromise = bootstrapRuntime(mapContainer, options).catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

export function getMapView() {
  return mapView;
}

export function getWebMap() {
  return webMap;
}

export function getMapViewCreateCount() {
  return mapViewCreateCount;
}

export function getWebMapCreateCount() {
  return webMapCreateCount;
}

export function isMapOperational() {
  return Boolean(mapView && webMap);
}

/**
 * @param {import('@arcgis/core/views/MapView').default} view
 * @param {HTMLElement} host
 */
async function mountMeasurementTools(view, host) {
  host.replaceChildren();

  const [DistanceMeasurement2D, AreaMeasurement2D] = await Promise.all([
    importArc('@arcgis/core/widgets/DistanceMeasurement2D.js'),
    importArc('@arcgis/core/widgets/AreaMeasurement2D.js')
  ]);

  const toolbar = document.createElement('div');
  toolbar.className = 'spatial-measure-toolbar';

  const panel = document.createElement('div');
  panel.className = 'spatial-measure-panel';
  panel.hidden = true;

  const distanceSlot = document.createElement('div');
  const areaSlot = document.createElement('div');
  panel.append(distanceSlot, areaSlot);

  const distanceWidget = new DistanceMeasurement2D({ view, unit: 'metric' });
  const areaWidget = new AreaMeasurement2D({ view, unit: 'metric' });
  distanceWidget.container = distanceSlot;
  areaWidget.container = areaSlot;
  distanceWidget.visible = false;
  areaWidget.visible = false;

  let activeMode = null;

  function deactivate() {
    activeMode = null;
    panel.hidden = true;
    distanceWidget.visible = false;
    areaWidget.visible = false;
    distanceBtn.classList.remove('is-active');
    areaBtn.classList.remove('is-active');
    distanceWidget.viewModel?.clear?.();
    areaWidget.viewModel?.clear?.();
  }

  function activate(mode) {
    if (activeMode === mode) {
      deactivate();
      return;
    }
    activeMode = mode;
    panel.hidden = false;
    distanceWidget.visible = mode === 'distance';
    areaWidget.visible = mode === 'area';
    distanceBtn.classList.toggle('is-active', mode === 'distance');
    areaBtn.classList.toggle('is-active', mode === 'area');
    if (mode !== 'distance') distanceWidget.viewModel?.clear?.();
    if (mode !== 'area') areaWidget.viewModel?.clear?.();
  }

  const distanceBtn = document.createElement('button');
  distanceBtn.type = 'button';
  distanceBtn.className = 'spatial-measure-btn';
  distanceBtn.textContent = 'Distance';
  distanceBtn.addEventListener('click', () => activate('distance'));

  const areaBtn = document.createElement('button');
  areaBtn.type = 'button';
  areaBtn.className = 'spatial-measure-btn';
  areaBtn.textContent = 'Area';
  areaBtn.addEventListener('click', () => activate('area'));

  toolbar.append(distanceBtn, areaBtn);
  host.append(toolbar, panel);
}

async function loadRuntimeBasemaps(Basemap) {
  const specs = [
    { legacyIds: ['streets-vector', 'streets'], styleId: 'arcgis/streets-vector', title: 'Streets' },
    { legacyIds: ['topo-vector', 'topo'], styleId: 'arcgis/topographic', title: 'Topographic' },
    { legacyIds: ['satellite', 'hybrid'], styleId: 'arcgis/imagery', title: 'Imagery' },
    { legacyIds: ['gray-vector', 'gray'], styleId: 'arcgis/gray-vector', title: 'Light Gray' },
    { legacyIds: ['dark-gray-vector', 'dark-gray'], styleId: 'arcgis/dark-gray-vector', title: 'Dark Gray' }
  ];

  async function cloneWithTitle(sourceBasemap, title, id) {
    const titled = new Basemap({
      baseLayers: sourceBasemap.baseLayers,
      referenceLayers: sourceBasemap.referenceLayers,
      title,
      id
    });
    await titled.load();
    return titled;
  }

  const basemaps = [];
  for (const spec of specs) {
    let loaded = null;
    for (const legacyId of spec.legacyIds) {
      try {
        const fromIdBasemap = await Basemap.fromId(legacyId);
        if (!fromIdBasemap) continue;
        await fromIdBasemap.load();
        loaded = await cloneWithTitle(fromIdBasemap, spec.title, legacyId);
        break;
      } catch {
        // try next legacy id
      }
    }
    if (loaded) {
      basemaps.push(loaded);
      continue;
    }
    try {
      const styleBasemap = new Basemap({
        style: { id: spec.styleId },
        title: spec.title,
        id: spec.styleId
      });
      await styleBasemap.load();
      basemaps.push(styleBasemap);
    } catch {
      // skip unavailable basemap
    }
  }
  return basemaps;
}

/**
 * @param {import('@arcgis/core/views/MapView').default} view
 * @param {HTMLElement} host
 */
async function mountMapOverlayTools(view, host) {
  host.replaceChildren();

  const [
    Legend,
    BasemapGallery,
    Basemap,
    LocalBasemapsSource
  ] = await Promise.all([
    importArc('@arcgis/core/widgets/Legend.js'),
    importArc('@arcgis/core/widgets/BasemapGallery.js'),
    importArc('@arcgis/core/Basemap.js'),
    importArc('@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js')
  ]);

  const toolbar = document.createElement('div');
  toolbar.className = 'spatial-map-tools-toolbar';

  const panel = document.createElement('div');
  panel.className = 'spatial-map-tools-panel';
  panel.hidden = true;

  const legendSlot = document.createElement('div');
  legendSlot.className = 'spatial-map-tools-slot spatial-map-tools-slot-legend';
  const operationalLegendSlot = document.createElement('div');
  operationalLegendSlot.className = 'spatial-map-tools-slot spatial-map-tools-slot-operational-legend';
  operationalLegendSlot.hidden = true;
  operationalLegendHost = operationalLegendSlot;
  const basemapSlot = document.createElement('div');
  basemapSlot.className = 'spatial-map-tools-slot spatial-map-tools-slot-basemap';
  panel.append(operationalLegendSlot, legendSlot, basemapSlot);

  const legendWidget = new Legend({ view });
  legendWidget.container = legendSlot;
  esriLegendWidget = legendWidget;

  const runtimeBasemaps = await loadRuntimeBasemaps(Basemap);
  const basemapSource = runtimeBasemaps.length
    ? new LocalBasemapsSource({ basemaps: runtimeBasemaps })
    : null;
  const basemapGallery = basemapSource
    ? new BasemapGallery({ view, source: basemapSource })
    : null;
  if (basemapGallery) {
    basemapGallery.container = basemapSlot;
  } else {
    basemapSlot.innerHTML = '<p class="spatial-map-tools-error">Basemaps unavailable</p>';
  }

  let activeMode = null;

  function deactivate() {
    activeMode = null;
    panel.hidden = true;
    legendSlot.hidden = true;
    if (operationalLegendHost) operationalLegendHost.hidden = true;
    basemapSlot.hidden = true;
    legendBtn.classList.remove('is-active');
    basemapBtn.classList.remove('is-active');
  }

  function activate(mode) {
    if (activeMode === mode) {
      deactivate();
      return;
    }
    activeMode = mode;
    panel.hidden = false;
    legendSlot.hidden = mode !== 'legend';
    if (operationalLegendHost) operationalLegendHost.hidden = mode !== 'legend';
    basemapSlot.hidden = mode !== 'basemap';
    legendBtn.classList.toggle('is-active', mode === 'legend');
    basemapBtn.classList.toggle('is-active', mode === 'basemap');
  }

  const legendBtn = document.createElement('button');
  legendBtn.type = 'button';
  legendBtn.className = 'spatial-map-tool-btn';
  legendBtn.textContent = 'Legend';
  legendBtn.addEventListener('click', () => activate('legend'));

  const basemapBtn = document.createElement('button');
  basemapBtn.type = 'button';
  basemapBtn.className = 'spatial-map-tool-btn';
  basemapBtn.textContent = 'Basemap';
  basemapBtn.addEventListener('click', () => activate('basemap'));

  toolbar.append(legendBtn, basemapBtn);
  host.append(toolbar, panel);
}

/**
 * @param {import('@arcgis/core/views/MapView').default} view
 * @param {WidgetHosts} hosts
 */
async function mountArcgisShellWidgets(view, hosts = {}) {
  if (shellWidgetsMounted) return;
  const { layerListHost, mapControlsHost, mapToolsHost, measureToolsHost } = hosts;

  if (layerListHost) {
    layerListHost.replaceChildren();
    const LayerList = await importArc('@arcgis/core/widgets/LayerList.js');
    const layerList = new LayerList({ view });
    layerList.container = layerListHost;
  }

  if (mapControlsHost) {
    mapControlsHost.replaceChildren();
    const [Zoom, Home, Search] = await Promise.all([
      importArc('@arcgis/core/widgets/Zoom.js'),
      importArc('@arcgis/core/widgets/Home.js'),
      importArc('@arcgis/core/widgets/Search.js')
    ]);

    const zoomSlot = document.createElement('div');
    const homeSlot = document.createElement('div');
    const searchSlot = document.createElement('div');
    mapControlsHost.append(zoomSlot, homeSlot, searchSlot);

    const zoom = new Zoom({ view });
    zoom.container = zoomSlot;

    const home = new Home({ view });
    home.container = homeSlot;

    try {
      const search = new Search({ view });
      search.container = searchSlot;
    } catch {
      searchSlot.hidden = true;
    }
  }

  const ScaleBar = await importArc('@arcgis/core/widgets/ScaleBar.js');
  const scaleBar = new ScaleBar({ view, unit: 'metric', style: 'line' });
  view.ui.add(scaleBar, { position: 'bottom-left' });

  if (mapToolsHost) {
    await mountMapOverlayTools(view, mapToolsHost);
  }

  if (measureToolsHost) {
    await mountMeasurementTools(view, measureToolsHost);
  }

  shellWidgetsMounted = true;
}

/**
 * @param {import('@arcgis/core/views/MapView').default} view
 */
async function configureMapViewPopup(view) {
  view.popupEnabled = true;
}

async function finalizeMapRuntime(map, mapView, portal, userDiagnostics, widgetHosts, emit) {
  await configureMapViewPopup(mapView);
  await mountArcgisShellWidgets(mapView, widgetHosts);

  const catalogModule = await import('./webmap-layer-catalog.js');
  await catalogModule.applyStartupLayerVisibilityPolicy(map);

  emit({
    status: 'connected',
    message: 'ArcGIS connected',
    webmapTitle: map.portalItem?.title || MONTREAL_OPERATIONAL_WEBMAP_NAME,
    username: userDiagnostics.username
  });

  void catalogModule.buildWebMapLayerCatalog(map).then((catalog) => {
    emit({
      status: 'catalog-ready',
      webmapTitle: catalog?.webmapTitle || map.portalItem?.title || MONTREAL_OPERATIONAL_WEBMAP_NAME,
      username: userDiagnostics.username,
      layerCount: catalog?.layers?.length || 0
    });
  }).catch((catalogError) => {
    console.warn('[IQAI] WebMap layer catalog build failed', catalogError);
  });
}

async function bootstrapRuntime(mapContainer, options) {
  const { onStatus, autoSignIn = false, widgetHosts } = options;
  const emit = (patch) => onStatus?.({ status: 'loading', ...patch });

  emit({ status: 'loading', message: 'Loading ArcGIS SDK…' });
  await loadArcgisCdn();

  const oauthConfig = await fetchMontrealOAuthConfig();
  if (!oauthConfig.oauthAppIdConfigured) {
    const err = new Error('ArcGIS OAuth App ID is not configured.');
    emit({ status: 'error', message: err.message });
    throw err;
  }

  const oauthRegistration = await ensureMontrealOAuthRegistered(oauthConfig);

  emit({ status: 'loading', message: 'Loading Montreal 1 WebMap…' });

  const [WebMap, MapView, Portal] = await withTimeout(
    Promise.all([
      importArc('@arcgis/core/WebMap.js'),
      importArc('@arcgis/core/views/MapView.js'),
      importArc('@arcgis/core/portal/Portal.js')
    ]),
    45000,
    'ArcGIS module import'
  );

  const portal = new Portal({ url: oauthRegistration.portalUrl });
  await withTimeout(portal.load(), 20000, 'Portal load');

  const map = new WebMap({
    portalItem: {
      id: MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID,
      portal
    }
  });

  let loadError = null;
  try {
    await loadWebMapWithTimeout(map);
  } catch (error) {
    loadError = error;
  }

  if (loadError) {
    if (!isWebMapLoadFailure(loadError)) {
      const message = sanitizeError(loadError);
      emit({ status: 'error', message });
      throw loadError;
    }

    let session = await getMontrealArcgisSession(
      oauthRegistration.IdentityManager,
      oauthRegistration.sharingUrl
    );

    if (!session.authenticated) {
      emit({ status: 'auth-required', message: 'ArcGIS sign-in required' });
      if (autoSignIn) {
        try {
          await signInToMontrealArcgis(
            oauthRegistration.IdentityManager,
            oauthRegistration.sharingUrl
          );
        } catch (error) {
          const message = formatArcgisOAuthError(error);
          emit({ status: 'error', message });
          throw error;
        }
        session = await getMontrealArcgisSession(
          oauthRegistration.IdentityManager,
          oauthRegistration.sharingUrl
        );
        if (!session.authenticated) {
          const err = new Error('ArcGIS sign-in was not completed.');
          emit({ status: 'error', message: err.message });
          throw err;
        }
      } else {
        const err = new Error('ArcGIS sign-in required');
        err.code = 'AUTH_REQUIRED';
        throw err;
      }
    }

    try {
      await loadWebMapWithTimeout(map);
      loadError = null;
    } catch (retryError) {
      const message = isMontrealAccessDeniedError(retryError)
        ? `Access denied for WebMap ${MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID}`
        : sanitizeError(retryError);
      emit({ status: 'error', message });
      throw retryError;
    }
  }

  await withTimeout(portal.load(), 20000, 'Portal load');
  const userDiagnostics = buildMontrealUserDiagnostics(portal);

  if (mapView) {
    await finalizeMapRuntime(webMap, mapView, portal, userDiagnostics, widgetHosts, emit);
    return { view: mapView, webmap: webMap, userDiagnostics };
  }

  webMap = map;
  webMapCreateCount += 1;
  mapViewCreateCount += 1;
  mapView = new MapView({
    container: mapContainer,
    map: webMap
  });

  await mapView.when();
  await finalizeMapRuntime(webMap, mapView, portal, userDiagnostics, widgetHosts, emit);

  return { view: mapView, webmap: webMap, userDiagnostics };
}

export async function clearRuntimeLayers() {
  if (!webMap) return;
  const runtimeLayers = webMap.layers.filter((layer) => layer.id?.startsWith('iqai-'));
  for (const layer of runtimeLayers) {
    webMap.remove(layer);
  }
}

export async function addRuntimeLayer(layer) {
  if (!webMap || !layer) return;
  webMap.add(layer);
}

export async function zoomTo(target, options = {}) {
  if (!mapView) return;
  await mapView.goTo(target, options).catch(() => {});
}

export function resizeMapView() {
  if (!mapView) return;
  // ArcGIS Maps SDK 5.x removed View.resize(); views auto-detect container size changes.
  if (typeof mapView.resize === 'function') {
    mapView.resize();
  }
}

/**
 * Render AOI operational legend HTML in map tools panel (categories in current X-ray).
 * @param {string | null} html
 */
export function setOperationalLegendContent(html) {
  if (!operationalLegendHost) return;
  if (!html) {
    operationalLegendHost.innerHTML = '';
    operationalLegendHost.hidden = true;
    if (esriLegendWidget) esriLegendWidget.container.style.display = '';
    return;
  }
  operationalLegendHost.innerHTML = html;
  operationalLegendHost.hidden = false;
  if (esriLegendWidget) esriLegendWidget.container.style.display = 'none';
}
