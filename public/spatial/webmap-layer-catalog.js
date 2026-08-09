/**
 * Live ArcGIS WebMap layer catalog — metadata only, ArcGIS remains source of truth.
 */

import { getWebMap } from './spatial-arcgis-runtime.js';

const WEBMAP_LAYER_CLASSIFICATION = 'CURRENT_WEBMAP';

const WEBMAP_LAYER_ALIAS_GROUPS = [
  { keys: ['camera', 'cameras', 'cams', 'caméra', 'caméras'], titles: ['cameras', 'camera'] },
  { keys: ['ems', 'ambulance', 'emergency medical', 'urgences', 'urgence'], titles: ['ems'] },
  { keys: ['road', 'roads', 'streets', 'rue', 'routes', 'route'], titles: ['roads', 'road'] },
  { keys: ['traffic'], titles: ['traffic'] }
];

/** @type {object | null} */
let catalogSnapshot = null;
/** @type {Promise<object | null> | null} */
let catalogBuildPromise = null;

const LAYER_LOAD_TIMEOUT_MS = 8000;

async function loadLayerWithTimeout(layer, label = 'layer') {
  if (!layer) return false;
  if (layer.loaded) return true;
  try {
    await Promise.race([
      layer.load(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} load timeout`)), LAYER_LOAD_TIMEOUT_MS);
      })
    ]);
    return true;
  } catch (error) {
    console.warn('[IQAI] Layer catalog skipped unloadable layer', label, error?.message || error);
    return false;
  }
}

function normalizeLayerKey(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function aliasTokensForTitle(title) {
  const normalizedTitle = normalizeLayerKey(title);
  const tokens = new Set();
  if (normalizedTitle) tokens.add(normalizedTitle);

  for (const group of WEBMAP_LAYER_ALIAS_GROUPS) {
    const titleMatch = group.titles.some((t) => normalizedTitle === normalizeLayerKey(t)
      || normalizedTitle.includes(normalizeLayerKey(t)));
    if (titleMatch) {
      for (const key of group.keys) tokens.add(normalizeLayerKey(key));
    }
  }

  return tokens;
}

function scoreLayerMatch(phrase, entry) {
  const normalizedPhrase = normalizeLayerKey(phrase);
  if (!normalizedPhrase) return 0;

  const titleKey = normalizeLayerKey(entry.title);
  if (!titleKey) return 0;

  if (normalizedPhrase === titleKey) return 100;

  const tokens = aliasTokensForTitle(entry.title);
  if (tokens.has(normalizedPhrase)) return 90;

  let best = 0;
  for (const token of tokens) {
    if (normalizedPhrase === token) best = Math.max(best, 85);
    if (normalizedPhrase.includes(token) && token.length >= 3) {
      best = Math.max(best, 60 + token.length);
    }
    if (token.includes(normalizedPhrase) && normalizedPhrase.length >= 3) {
      best = Math.max(best, 55 + normalizedPhrase.length);
    }
  }

  if (titleKey.includes(normalizedPhrase) && normalizedPhrase.length >= 3) {
    best = Math.max(best, 50 + normalizedPhrase.length);
  }

  return best;
}

/**
 * @param {string} phrase
 * @param {object | null} catalog
 */
export function resolveWebMapLayersFromPhrase(phrase, catalog) {
  const layers = Array.isArray(catalog?.layers) ? catalog.layers : [];
  if (!layers.length) return { matches: [], score: 0 };

  const scored = layers
    .map((entry) => ({ entry, score: scoreLayerMatch(phrase, entry) }))
    .filter((item) => item.score >= 50)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { matches: [], score: 0 };

  const topScore = scored[0].score;
  const matches = scored.filter((item) => item.score === topScore).map((item) => item.entry);
  return { matches, score: topScore };
}

/**
 * Resolve multiple layer phrases split on and / comma.
 * @param {string} phrase
 * @param {object | null} catalog
 */
export function resolveWebMapLayersFromPhrases(phrase, catalog) {
  const parts = String(phrase || '')
    .split(/\s*,\s*|\s+and\s+|\s+et\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return { matches: [], error: 'No layer names provided.' };

  const matches = [];
  const seen = new Set();
  for (const part of parts) {
    const resolved = resolveWebMapLayersFromPhrase(part, catalog);
    if (resolved.matches.length > 1) {
      return {
        matches: [],
        error: `Multiple layers match "${part}": ${resolved.matches.map((m) => m.title).join(', ')}. Please clarify.`
      };
    }
    if (!resolved.matches.length) {
      return {
        matches: [],
        error: `Layer not available in the current map or verified library: ${part}`
      };
    }
    const layer = resolved.matches[0];
    if (!seen.has(layer.catalogId)) {
      seen.add(layer.catalogId);
      matches.push(layer);
    }
  }
  return { matches, error: null };
}

function isIqaiRuntimeLayer(layer) {
  const id = layer?.id || '';
  return id.startsWith('iqai-');
}

/**
 * @param {object} entry
 */
export function isToggleableCatalogEntry(entry) {
  if (!entry) return false;
  if (String(entry.catalogId || '').startsWith('iqai')) return false;
  if (entry.type === 'unknown') return false;
  return true;
}

/**
 * @param {object | null} catalog
 */
export function getToggleableCatalogEntries(catalog = catalogSnapshot) {
  return (catalog?.layers || []).filter(isToggleableCatalogEntry);
}

/**
 * Runtime-only: hide every operational WebMap layer (basemap is separate).
 * @param {import('@arcgis/core/WebMap').default} [webMap]
 */
export async function applyStartupLayerVisibilityPolicy(webMap = getWebMap()) {
  if (!webMap?.layers) return { hidden: 0 };

  const collected = collectLayers(webMap.layers);
  let hidden = 0;
  for (const { layer } of collected) {
    if (!layer) continue;
    layer.visible = false;
    hidden += 1;
  }
  syncCatalogVisibilityFromRuntime();
  return { hidden };
}

export function syncCatalogVisibilityFromRuntime() {
  if (!catalogSnapshot?.layers?.length) return;
  for (const entry of catalogSnapshot.layers) {
    const layer = findRuntimeLayerByCatalogEntry(entry);
    if (layer) entry.visible = Boolean(layer.visible);
  }
}

/**
 * @param {object} catalog
 * @param {string | null} filter
 */
export function filterCatalogLayers(catalog, filter = null) {
  const layers = Array.isArray(catalog?.layers) ? catalog.layers : [];
  if (!filter) return layers;
  if (filter === 'point') {
    return layers.filter((layer) => {
      const geometry = String(layer.geometryType || '').toLowerCase();
      return geometry === 'point' || geometry === 'esrigeometrypoint';
    });
  }
  return layers;
}

function collectLayers(layerCollection, parentGroup = null) {
  const layers = [];
  const items = layerCollection?.items || layerCollection || [];
  for (const layer of items) {
    layers.push({ layer, parentGroup });
    if (layer.type === 'group' && layer.layers) {
      layers.push(...collectLayers(layer.layers, layer.title || layer.id || parentGroup));
    }
  }
  return layers;
}

function serializePopupTemplate(popupTemplate) {
  if (!popupTemplate) return null;
  const fieldInfos = (popupTemplate.content || [])
    .flatMap((item) => item.fieldInfos || [])
    .filter(Boolean)
    .map((info) => ({
      fieldName: info.fieldName,
      label: info.label
    }));

  return {
    title: popupTemplate.title || null,
    outFields: popupTemplate.outFields || ['*'],
    fieldInfos,
    content: popupTemplate.content || null
  };
}

function serializeFields(fields = []) {
  return fields
    .filter((field) => field?.name)
    .map((field) => ({
      name: field.name,
      alias: field.alias || field.name,
      type: field.type || 'string'
    }));
}

/**
 * @param {import('@arcgis/core/layers/Layer').default} layer
 * @param {string | null} parentGroup
 */
async function describeOperationalLayer(layer, parentGroup = null) {
  const entry = {
    catalogId: layer.id || `${parentGroup || 'root'}/${layer.title || 'layer'}`,
    layerId: layer.id || null,
    title: layer.title || layer.id || 'Untitled layer',
    type: layer.type || 'unknown',
    parentGroup: parentGroup || null,
    url: layer.url || layer.parsedUrl?.path || null,
    visible: Boolean(layer.visible),
    geometryType: layer.geometryType || null,
    fields: [],
    popupTemplateExists: Boolean(layer.popupTemplate),
    popupTemplate: null,
    queryable: false,
    selectable: false,
    minScale: layer.minScale ?? null,
    maxScale: layer.maxScale ?? null,
    serviceType: layer.sourceJSON?.type || layer.type || null,
    classification: WEBMAP_LAYER_CLASSIFICATION
  };

  try {
    const label = layer.id || layer.title || 'layer';
    const loaded = await loadLayerWithTimeout(layer, label);
    if (loaded) {
      entry.visible = Boolean(layer.visible);
      entry.geometryType = layer.geometryType || entry.geometryType;
      entry.url = layer.url || layer.parsedUrl?.path || entry.url;
      entry.popupTemplateExists = Boolean(layer.popupTemplate);
      entry.popupTemplate = serializePopupTemplate(layer.popupTemplate);
      entry.fields = serializeFields(layer.fields || []);
      entry.minScale = layer.minScale ?? null;
      entry.maxScale = layer.maxScale ?? null;

      if (layer.capabilities?.operations) {
        entry.queryable = Boolean(layer.capabilities.operations.supportsQuery);
        entry.selectable = Boolean(layer.capabilities.operations.supportsQuery);
      } else if (layer.type === 'feature') {
        entry.queryable = true;
        entry.selectable = true;
      }
    } else {
      entry.loadError = 'Layer load timed out or failed';
    }
  } catch (error) {
    entry.loadError = String(error?.message || error);
  }

  return entry;
}

/**
 * Build catalog from loaded WebMap.
 * @param {import('@arcgis/core/WebMap').default} webMap
 */
async function buildWebMapLayerCatalogInner(webMap) {
  if (!webMap) {
    catalogSnapshot = null;
    return null;
  }

  const collected = collectLayers(webMap.layers);
  const layers = [];

  for (const { layer, parentGroup } of collected) {
    if (layer.type === 'group') {
      const label = layer.id || layer.title || 'group';
      await loadLayerWithTimeout(layer, label);
      layers.push({
        catalogId: layer.id || `group:${layer.title || parentGroup || 'group'}`,
        layerId: layer.id || null,
        title: layer.title || layer.id || 'Group',
        type: 'group',
        parentGroup: parentGroup || null,
        url: null,
        visible: Boolean(layer.visible),
        geometryType: null,
        fields: [],
        popupTemplateExists: false,
        popupTemplate: null,
        queryable: false,
        selectable: false,
        minScale: layer.minScale ?? null,
        maxScale: layer.maxScale ?? null,
        serviceType: 'group',
        classification: WEBMAP_LAYER_CLASSIFICATION
      });
      continue;
    }

    layers.push(await describeOperationalLayer(layer, parentGroup));
  }

  catalogSnapshot = {
    webmapTitle: webMap.portalItem?.title || 'Montreal 1',
    webmapItemId: webMap.portalItem?.id || null,
    builtAt: new Date().toISOString(),
    classification: WEBMAP_LAYER_CLASSIFICATION,
    layers,
    summary: {
      operationalLayersDiscovered: layers.length,
      featureLayers: layers.filter((layer) => layer.type === 'feature').length,
      queryableLayers: layers.filter((layer) => layer.queryable).length,
      nestedGroupLayers: layers.filter((layer) => layer.type === 'group' && layer.parentGroup).length
    }
  };

  if (typeof window !== 'undefined') {
    window.__IQAI_WEBMAP_LAYER_CATALOG__ = catalogSnapshot;
  }

  syncCatalogVisibilityFromRuntime();

  return catalogSnapshot;
}

export async function buildWebMapLayerCatalog(webMap = getWebMap()) {
  if (!catalogBuildPromise) {
    catalogBuildPromise = buildWebMapLayerCatalogInner(webMap).finally(() => {
      catalogBuildPromise = null;
    });
  }
  return catalogBuildPromise;
}

export function getWebMapLayerCatalogSnapshot() {
  return catalogSnapshot;
}

/**
 * @param {string} catalogId
 */
export function getCatalogLayerByCatalogId(catalogId) {
  if (!catalogId || !catalogSnapshot?.layers?.length) return null;
  return catalogSnapshot.layers.find((layer) => layer.catalogId === catalogId) || null;
}

/**
 * Compact catalog for POST /api/spatial/map — planning metadata only.
 * @param {object | null} catalog
 */
export function buildCompactWebMapLayerCatalog(catalog) {
  if (!catalog?.layers?.length) return null;

  const layers = catalog.layers.map((layer) => {
    const catalogId = layer.catalogId;
    const entry = {
      c: catalogId,
      t: layer.title || catalogId
    };
    const type = String(layer.type || '').toLowerCase();
    if (type && type !== 'feature') {
      if (type === 'group') entry.y = 'g';
      else if (type === 'tile') entry.y = 't';
      else if (type === 'imagery') entry.y = 'i';
      else if (type === 'unknown') entry.y = 'u';
      else entry.y = layer.type;
    }
    if (layer.layerId && layer.layerId !== catalogId) entry.l = layer.layerId;
    if (layer.parentGroup) entry.g = layer.parentGroup;
    const geometry = String(layer.geometryType || '').toLowerCase();
    if (geometry === 'point' || geometry === 'esrigeometrypoint') entry.m = 'p';
    else if (geometry === 'polyline' || geometry === 'line' || geometry === 'esrigeometrypolyline') entry.m = 'l';
    else if (geometry === 'polygon' || geometry === 'esrigeometrypolygon') entry.m = 'x';
    else if (geometry === 'multipoint' || geometry === 'esrigeometrymultipoint') entry.m = 'g';
    else if (layer.geometryType) entry.m = layer.geometryType;
    if (layer.visible) entry.v = 1;
    return entry;
  });

  return {
    compact: true,
    layers
  };
}

/**
 * Ensure live catalog exists; rebuild from current WebMap when missing.
 */
export async function ensureLiveLayerCatalog() {
  if (catalogSnapshot?.layers?.length) return catalogSnapshot;

  const webMap = getWebMap();
  if (!webMap) return null;

  return buildWebMapLayerCatalog(webMap);
}

export function getLayerCatalogDiagnostics() {
  return {
    ready: Boolean(catalogSnapshot?.layers?.length),
    layerCount: catalogSnapshot?.layers?.length || 0,
    webmapTitle: catalogSnapshot?.webmapTitle || null,
    builtAt: catalogSnapshot?.builtAt || null
  };
}

/**
 * Find runtime layer object by catalog entry.
 * @param {object} entry
 */
export function findRuntimeLayerByCatalogEntry(entry) {
  const webMap = getWebMap();
  if (!webMap || !entry) return null;

  const all = collectLayers(webMap.layers).map((item) => item.layer);
  if (entry.layerId) {
    const byId = all.find((layer) => layer.id === entry.layerId);
    if (byId) return byId;
  }
  return all.find((layer) => layer.title === entry.title) || null;
}

export function findRuntimeLayerByCatalogId(catalogId) {
  const entry = catalogSnapshot?.layers?.find((layer) => layer.catalogId === catalogId);
  if (!entry) return null;
  return findRuntimeLayerByCatalogEntry(entry);
}
