/**
 * Add ArcGIS data to the current map — search, resolve, preview, add.
 */
import {
  addRuntimeLayer,
  getMapView,
  getWebMap
} from './spatial-arcgis-runtime.js';
import { buildWebMapLayerCatalog, syncCatalogVisibilityFromRuntime, getWebMapLayerCatalogSnapshot } from './webmap-layer-catalog.js';
import { fetchMontrealOAuthConfig } from './montreal-arcgis-oauth.js';
import {
  parseArcgisUserInput,
  createLayerFromParsedInput,
  createLayerFromPortalItem,
  getLayerStableIdentity
} from './arcgis-data-add-resolver.js';
import {
  registerUserAddedLayer,
  findUserAddedByIdentity,
  listUserAddedLayers,
  getUserAddedEntry,
  unregisterUserAddedLayer,
  isUserAddedLayer
} from './arcgis-data-add-registry.js';
import { searchArcgisPortalContent, fetchPortalItemMetadata } from './arcgis-data-add-search.js';
import { getContentSourceLabel } from './arcgis-data-add-search-config.js';
import { USER_ADDED_LAYER_PREFIX } from './arcgis-data-add-provenance.js';
import { clearIqaiSelection } from './spatial-map-command.js';
import { setOperationalLegendContent } from './spatial-arcgis-runtime.js';

const LAYER_LOAD_TIMEOUT_MS = 30000;

/**
 * @param {import('@arcgis/core/layers/Layer').default} layer
 */
async function loadLayerWithTimeout(layer) {
  await Promise.race([
    layer.load(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Layer load timed out — the service may be inaccessible or too large to preview.')), LAYER_LOAD_TIMEOUT_MS);
    })
  ]);
  return layer;
}

/**
 * @param {string} rawInput
 * @param {object} options
 */
export async function resolveArcgisUserInput(rawInput, options = {}) {
  const parsed = parseArcgisUserInput(rawInput);
  if (parsed.kind === 'empty') {
    throw new Error('Enter an ArcGIS item ID, item URL, or service URL.');
  }
  if (parsed.kind === 'invalid') {
    throw new Error('Enter a valid ArcGIS item ID, item URL, or service URL.');
  }

  const oauthConfig = await fetchMontrealOAuthConfig();
  const portalUrl = oauthConfig.portalUrl || 'https://www.arcgis.com';
  const created = await createLayerFromParsedInput(parsed, {
    portalUrl,
    title: options.title
  });

  const identity = getLayerStableIdentity(created.layer, created.provenance);
  const duplicate = findUserAddedByIdentity(identity);
  if (duplicate && !options.allowDuplicateCheckOnly) {
    return {
      status: 'ALREADY_ADDED',
      parsed,
      identity,
      entry: duplicate,
      layer: duplicate.layer,
      provenance: duplicate.provenance
    };
  }

  if (options.previewOnly) {
    await loadLayerWithTimeout(created.layer);
    return {
      status: 'PREVIEW_READY',
      parsed,
      identity,
      layer: created.layer,
      provenance: created.provenance
    };
  }

  return {
    status: 'RESOLVED',
    parsed,
    identity,
    layer: created.layer,
    provenance: created.provenance
  };
}

/**
 * @param {string} rawInput
 * @param {object} options
 */
export async function addArcgisDataFromInput(rawInput, options = {}) {
  const resolved = await resolveArcgisUserInput(rawInput, options);
  if (resolved.status === 'ALREADY_ADDED') {
    return {
      status: 'ALREADY_ADDED',
      message: `Already added: ${resolved.provenance?.itemTitle || resolved.layer?.title || 'this layer'}.`,
      entry: resolved.entry
    };
  }

  const { layer, provenance } = resolved;
  await loadLayerWithTimeout(layer);

  const registration = registerUserAddedLayer(layer, {
    ...provenance,
    contentSource: options.contentSource || provenance.contentSource || null,
    sourceLabel: options.sourceLabel
      || provenance.sourceLabel
      || getContentSourceLabel(options.contentSource || provenance.contentSource)
  });
  if (registration.duplicate) {
    return {
      status: 'ALREADY_ADDED',
      message: `Already added: ${registration.entry.provenance?.itemTitle || layer.title}.`,
      entry: registration.entry
    };
  }

  layer.visible = options.visible !== false;
  layer.id = registration.entry.layerId;
  await addRuntimeLayer(layer);

  const catalog = await buildWebMapLayerCatalog(getWebMap());
  syncCatalogVisibilityFromRuntime();
  const snapshot = getWebMapLayerCatalogSnapshot() || catalog;

  if (options.zoomTo !== false) {
    await zoomToUserAddedLayer(layer);
  }

  notifyCatalogUpdated(snapshot, options);

  return {
    status: 'ADDED',
    message: `Added ${layer.title}.`,
    entry: registration.entry,
    layer,
    catalog: snapshot
  };
}

/**
 * @param {string} itemId
 * @param {object} options
 */
export async function addArcgisPortalItem(itemId, options = {}) {
  return addArcgisDataFromInput(itemId, options);
}

/**
 * @param {string} query
 * @param {object} options
 */
export async function searchArcgisData(query, options = {}) {
  return searchArcgisPortalContent(query, options);
}

/**
 * @param {string} itemId
 */
export async function previewArcgisPortalItem(itemId, options = {}) {
  const metadata = await fetchPortalItemMetadata(itemId, options);
  const resolved = await resolveArcgisUserInput(itemId, { previewOnly: true });
  return {
    metadata,
    resolved
  };
}

/**
 * @param {import('@arcgis/core/layers/Layer').default} layer
 */
export async function zoomToUserAddedLayer(layer) {
  const view = getMapView();
  if (!view || !layer) return;
  await layer.when?.();
  const target = layer.fullExtent || layer.extent;
  if (target) await view.goTo(target.expand(1.15));
}

/**
 * @param {string} layerId
 * @param {object} options
 */
export async function removeUserAddedArcgisLayer(layerId, options = {}) {
  const view = getMapView();
  const webMap = getWebMap();
  const entry = getUserAddedEntry(layerId);
  if (!entry || !webMap) return { removed: false };

  const layer = webMap.findLayerById(layerId) || entry.layer;

  if (view?.popup?.visible) {
    const popupFeature = view.popup?.selectedFeature || view.popup?.viewModel?.selectedFeature;
    const popupLayer = popupFeature?.layer;
    if (!popupLayer || popupLayer === layer || popupLayer?.id === layerId) {
      view.closePopup();
    }
  }

  clearIqaiSelection(false);

  if (layer) {
    try {
      const layerView = view ? await view.whenLayerView(layer).catch(() => null) : null;
      if (layerView?.filter) layerView.filter = null;
    } catch {
      // ignore layer view cleanup errors
    }
    webMap.remove(layer);
  }

  unregisterUserAddedLayer(layerId);
  setOperationalLegendContent(null);

  const catalog = await buildWebMapLayerCatalog(webMap);
  syncCatalogVisibilityFromRuntime();
  const snapshot = getWebMapLayerCatalogSnapshot() || catalog;

  notifyCatalogUpdated(snapshot, options);
  options.onSelectionCleared?.();

  return { removed: true, catalog: snapshot, entry };
}

function notifyCatalogUpdated(catalog, options = {}) {
  options.onCatalogUpdated?.(catalog);
  if (typeof window === 'undefined') return;
  window.__IQAI_APP_SHELL__?.layerPanel?.refreshCatalog?.(catalog);
  window.__IQAI_APP_SHELL__?.refreshIntelligenceRail?.(catalog);
}

export function getUserAddedArcgisLayers() {
  return listUserAddedLayers();
}

export {
  parseArcgisUserInput,
  isUserAddedLayer,
  USER_ADDED_LAYER_PREFIX
};
