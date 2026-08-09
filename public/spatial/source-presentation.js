/**
 * Generic ArcGIS source presentation inheritance for scoped IQAI layers.
 * V1: renderer / category symbol / popupTemplate.
 */

import { getWebMap } from './spatial-arcgis-runtime.js';
import { findRuntimeLayerByCatalogId } from './webmap-layer-catalog.js';

const presentationCache = new Map();

const OSM_NA_AMENITIES = {
  sourceId: 'OSM_NA_AMENITIES',
  serviceUrl: 'https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services/OSM_NA_Amenities/FeatureServer',
  layerId: 0,
  semanticField: 'amenity'
};

function collectMapLayers(layerCollection) {
  const layers = [];
  const items = layerCollection?.items || layerCollection || [];
  for (const layer of items) {
    layers.push(layer);
    if (layer.type === 'group' && layer.layers) {
      layers.push(...collectMapLayers(layer.layers));
    }
  }
  return layers;
}

function normalizeServiceUrl(url) {
  return String(url || '').replace(/\/$/, '').toLowerCase();
}

function layerServiceUrl(layer) {
  const url = layer?.url || layer?.portalItem?.url || layer?.sourceJSON?.url || null;
  return normalizeServiceUrl(url);
}

/**
 * @param {object} webMap
 * @param {string} serviceUrl
 */
export function findWebMapLayerByServiceUrl(webMap, serviceUrl) {
  if (!webMap?.layers) return null;
  const target = normalizeServiceUrl(serviceUrl);
  for (const layer of collectMapLayers(webMap.layers)) {
    if (layerServiceUrl(layer) === target) return layer;
    if (layer.type === 'feature' && layer.url && normalizeServiceUrl(`${layer.url}`).startsWith(target)) {
      return layer;
    }
  }
  return null;
}

function rendererToJson(renderer) {
  if (!renderer) return null;
  if (typeof renderer.toJSON === 'function') return renderer.toJSON();
  return renderer;
}

function popupInfoToTemplate(popupInfo) {
  if (!popupInfo) return null;
  if (popupInfo.title && popupInfo.fieldInfos) {
    return {
      title: popupInfo.title,
      content: [{ type: 'fields', fieldInfos: popupInfo.fieldInfos }],
      outFields: ['*']
    };
  }
  return {
    title: popupInfo.title || '{name}',
    content: popupInfo.description || '',
    outFields: ['*']
  };
}

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

/**
 * @param {{ sourceId?: string, serviceUrl?: string, layerId?: number, semanticField?: string }} sourceDef
 * @param {{ fetchFn?: typeof fetch }} [options]
 */
export async function getSourcePresentation(sourceDef = OSM_NA_AMENITIES, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const key = sourceDef.sourceId || sourceDef.serviceUrl;
  if (presentationCache.has(key)) return presentationCache.get(key);

  let renderer = null;
  let rendererSource = 'IQAI_FALLBACK';
  let popupTemplate = null;
  let popupInfo = null;

  const webMap = getWebMap();
  const webMapLayer = webMap ? findWebMapLayerByServiceUrl(webMap, sourceDef.serviceUrl) : null;
  if (webMapLayer?.renderer) {
    renderer = rendererToJson(webMapLayer.renderer);
    rendererSource = 'WEBMAP_LAYER';
  }
  if (webMapLayer?.popupTemplate) {
    popupTemplate = rendererToJson(webMapLayer.popupTemplate);
  }

  const base = String(sourceDef.serviceUrl || '').replace(/\/$/, '');
  const layerId = sourceDef.layerId ?? 0;
  if (!renderer || !popupTemplate) {
    try {
      const response = await fetchFn(`${base}/${layerId}?f=json`);
      if (response.ok) {
        const data = await response.json();
        if (!renderer && data?.drawingInfo?.renderer) {
          renderer = data.drawingInfo.renderer;
          rendererSource = 'FEATURE_LAYER_JSON';
        }
        popupInfo = data?.popupInfo || null;
        if (!popupTemplate && popupInfo) {
          popupTemplate = popupInfoToTemplate(popupInfo);
        }
      }
    } catch {
      // fall through
    }
  }

  const presentation = {
    sourceId: sourceDef.sourceId || null,
    serviceUrl: sourceDef.serviceUrl || null,
    renderer,
    rendererSource,
    semanticField: sourceDef.semanticField || renderer?.field1 || 'amenity',
    uniqueValueInfos: renderer?.uniqueValueInfos || [],
    popupInfo,
    popupTemplate
  };
  presentationCache.set(key, presentation);
  return presentation;
}

/**
 * @param {string} semanticField
 * @param {string[]} categoryValues
 */
export function buildCategoryDefinitionExpression(semanticField, categoryValues) {
  const field = String(semanticField || 'amenity').trim();
  const values = (categoryValues || []).filter(Boolean);
  if (!values.length) return '1=0';
  if (values.length === 1) {
    return `${field} = '${escapeSqlLiteral(values[0])}'`;
  }
  const list = values.map((value) => `'${escapeSqlLiteral(value)}'`).join(',');
  return `${field} IN (${list})`;
}

/**
 * @param {object} presentation
 * @param {string} semanticField
 * @param {string} categoryValue
 */
export function getCategorySymbol(presentation, semanticField, categoryValue) {
  const renderer = presentation?.renderer;
  if (!renderer) return null;
  const field = renderer.field1 || semanticField || presentation.semanticField;
  if (renderer.type === 'uniqueValue') {
    const info = (renderer.uniqueValueInfos || []).find((entry) => entry.value === categoryValue);
    return info?.symbol || renderer.defaultSymbol || null;
  }
  return renderer.symbol || renderer.defaultSymbol || null;
}

/**
 * @param {object} symbol
 */
export function symbolToImageUrl(symbol) {
  if (!symbol) return null;
  if (symbol.imageData) {
    return `data:${symbol.contentType || 'image/png'};base64,${symbol.imageData}`;
  }
  const url = String(symbol.url || '');
  if (/^data:/i.test(url)) return url;
  return null;
}

/**
 * ArcGIS WebMap style UUID references fail on materialized client FeatureLayers.
 * @param {object} symbol
 */
export function isScopedLayerSymbolSafe(symbol) {
  if (!symbol) return false;
  const type = String(symbol.type || '').toLowerCase();
  if (type === 'esrisms' || type === 'simple-marker') return true;
  if (type === 'esripms' || type === 'picture-marker') {
    if (symbol.imageData) return true;
    const url = String(symbol.url || '');
    if (/^data:/i.test(url) || /^https?:/i.test(url)) return true;
    return false;
  }
  return false;
}

/**
 * Convert inherited service/WebMap symbols into ArcGIS JS-safe scoped-layer symbols.
 * @param {object} symbol
 */
export function sanitizeSymbolForScopedLayer(symbol) {
  if (!symbol) return null;
  const type = String(symbol.type || '').toLowerCase();
  if (type === 'esripms' || type === 'picture-marker') {
    const dataUrl = symbolToImageUrl(symbol);
    if (!dataUrl) return null;
    return {
      type: 'picture-marker',
      url: dataUrl,
      width: symbol.width || symbol.size || 12,
      height: symbol.height || symbol.size || 12,
      angle: symbol.angle || 0,
      xoffset: symbol.xoffset || 0,
      yoffset: symbol.yoffset || 0
    };
  }
  if (type === 'esrisms' || type === 'simple-marker') {
    const { url, style, ...rest } = symbol;
    if (style && /^[0-9a-f-]{36}$/i.test(String(style))) {
      return null;
    }
    return rest;
  }
  if (type === 'esrisfs' || type === 'simple-fill') {
    return symbol;
  }
  if (type === 'esriss' || type === 'simple-line') {
    return symbol;
  }
  return null;
}

/**
 * Scoped IQAI layers materialize a feature subset client-side.
 * Unique-value renderers with WebMap style-url PMS symbols must be sanitized.
 * @param {object} renderer
 */
export function sanitizeRendererForScopedLayer(renderer) {
  if (!renderer) return null;

  if (renderer.type === 'simple' && renderer.symbol) {
    const symbol = sanitizeSymbolForScopedLayer(renderer.symbol);
    return symbol ? { type: 'simple', symbol } : null;
  }

  if (renderer.type === 'uniqueValue') {
    const infos = (renderer.uniqueValueInfos || []).filter((entry) => entry?.symbol);
    if (infos.length === 1) {
      const symbol = sanitizeSymbolForScopedLayer(infos[0].symbol);
      if (symbol) return { type: 'simple', symbol };
    }

    const sanitizedInfos = infos
      .map((entry) => {
        const symbol = sanitizeSymbolForScopedLayer(entry.symbol);
        if (!symbol) return null;
        return { ...entry, symbol };
      })
      .filter(Boolean);

    if (!sanitizedInfos.length) return null;

    const defaultSymbol = sanitizeSymbolForScopedLayer(renderer.defaultSymbol)
      || sanitizedInfos[0].symbol;

    return {
      type: 'uniqueValue',
      field1: renderer.field1,
      uniqueValueInfos: sanitizedInfos,
      defaultSymbol
    };
  }

  if (renderer.type === 'classBreaks') {
    const infos = (renderer.classBreakInfos || []).filter((entry) => entry?.symbol);
    const sanitizedInfos = infos
      .map((entry) => {
        const symbol = sanitizeSymbolForScopedLayer(entry.symbol);
        if (!symbol) return null;
        return { ...entry, symbol };
      })
      .filter(Boolean);
    if (!sanitizedInfos.length) return null;
    const defaultSymbol = sanitizeSymbolForScopedLayer(renderer.defaultSymbol)
      || sanitizedInfos[0].symbol;
    return {
      type: 'classBreaks',
      field: renderer.field,
      classBreakInfos: sanitizedInfos,
      defaultSymbol
    };
  }

  return null;
}

/**
 * @param {object} presentation
 * @param {string} semanticField
 * @param {string} semanticValue
 */
export function inheritSourceRenderer(presentation, semanticField, semanticValue) {
  if (!presentation?.renderer) return null;
  const renderer = presentation.renderer;
  const field = renderer.field1 || semanticField || presentation.semanticField;

  if (semanticValue && renderer.type === 'uniqueValue') {
    const infos = (renderer.uniqueValueInfos || []).filter((entry) => entry.value === semanticValue);
    if (infos.length) {
      return {
        type: 'uniqueValue',
        field1: field,
        uniqueValueInfos: infos,
        defaultSymbol: renderer.defaultSymbol || infos[0]?.symbol || null
      };
    }
    const symbol = getCategorySymbol(presentation, field, semanticValue);
    if (symbol) {
      return { type: 'simple', symbol };
    }
  }

  if (renderer.type === 'simple' && renderer.symbol) {
    return { type: 'simple', symbol: renderer.symbol };
  }

  if (renderer.type === 'uniqueValue' && semanticValue) {
    const symbol = getCategorySymbol(presentation, field, semanticValue);
    if (symbol) return { type: 'simple', symbol };
  }

  return null;
}

/**
 * @param {object} presentation
 * @param {string} semanticField
 * @param {string[]} categoryValues
 */
export function inheritRendererForCategories(presentation, semanticField, categoryValues) {
  if (!presentation?.renderer) return null;
  const renderer = presentation.renderer;
  const field = renderer.field1 || semanticField || presentation.semanticField;
  const values = categoryValues || [];

  if (renderer.type === 'uniqueValue') {
    if (!values.length) return null;
    const allInfos = renderer.uniqueValueInfos || [];
    const infos = values.length >= allInfos.length
      ? allInfos
      : allInfos.filter((entry) => values.includes(entry.value));
    if (infos.length) {
      return {
        type: 'uniqueValue',
        field1: field,
        uniqueValueInfos: infos,
        defaultSymbol: renderer.defaultSymbol || infos[0]?.symbol || null
      };
    }
    const symbol = getCategorySymbol(presentation, field, values[0]);
    if (symbol) return { type: 'simple', symbol };
  }

  if (renderer.type === 'simple' && renderer.symbol) {
    return { type: 'simple', symbol: renderer.symbol };
  }

  return inheritSourceRenderer(presentation, semanticField, values[0]);
}

export function getOsmNaAmenitiesSourceDef() {
  return { ...OSM_NA_AMENITIES };
}

/** @type {object[]} */
const fidelityRecords = [];

export function getPresentationFidelityRecords() {
  return [...fidelityRecords];
}

export function clearPresentationFidelityRecords() {
  fidelityRecords.length = 0;
  if (typeof window !== 'undefined') {
    window.__IQAI_PRESENTATION_FIDELITY__ = [];
  }
}

/**
 * @param {object} entry
 */
export function recordPresentationFidelity(entry) {
  const record = { ...entry, at: new Date().toISOString() };
  fidelityRecords.push(record);
  if (typeof window !== 'undefined') {
    window.__IQAI_PRESENTATION_FIDELITY__ = getPresentationFidelityRecords();
  }
  return record;
}

/**
 * @param {object} layer
 */
export function getArcgisPresentation(layer) {
  if (!layer) return null;

  const cloneValue = (value) => {
    if (value == null) return null;
    if (typeof value.clone === 'function') return value.clone();
    if (typeof value.toJSON === 'function') return value.toJSON();
    return value;
  };

  let labelingInfo = null;
  if (layer.labelingInfo?.length) {
    labelingInfo = layer.labelingInfo
      .map((info) => cloneValue(info))
      .filter(Boolean);
  }

  return {
    sourceLayerTitle: layer.title || layer.id || null,
    renderer: cloneValue(layer.renderer),
    popupTemplate: cloneValue(layer.popupTemplate),
    labelingInfo,
    labelsVisible: layer.labelsVisible,
    opacity: layer.opacity,
    minScale: layer.minScale,
    maxScale: layer.maxScale,
    blendMode: layer.blendMode,
    effect: layer.effect,
    definitionExpression: layer.definitionExpression
  };
}

/**
 * @param {object} result
 */
export async function resolveLiveWebMapSourceLayer(result) {
  const catalogId = result?.webmapLayer?.catalogId
    || result?.renderMeta?.catalogId
    || (String(result?.datasetId || '').startsWith('webmap:')
      ? String(result.datasetId).slice(7)
      : null);
  if (!catalogId) return null;

  const layer = findRuntimeLayerByCatalogId(catalogId);
  if (!layer) return null;

  try {
    if (!layer.loaded) await layer.load();
  } catch {
    // use partially loaded layer when possible
  }
  return layer;
}

/**
 * @param {object[]} features
 */
export function inferScopedGeometryTypeFromFeatures(features = []) {
  const types = new Set();

  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) {
      if (Number.isFinite(Number(feature?.longitude)) && Number.isFinite(Number(feature?.latitude))) {
        types.add('point');
      }
      continue;
    }
    const rawType = String(geom.type || '').toLowerCase();
    if (rawType.includes('polygon') || Array.isArray(geom.rings)) {
      types.add('polygon');
    } else if (rawType.includes('line') || rawType.includes('polyline') || Array.isArray(geom.paths)) {
      types.add('polyline');
    } else {
      types.add('point');
    }
  }

  if (types.size > 1) {
    return { geometryType: null, mixed: true };
  }

  const geometryType = types.has('polygon')
    ? 'polygon'
    : types.has('polyline')
      ? 'polyline'
      : 'point';
  return { geometryType, mixed: false };
}

/**
 * @param {string | null | undefined} raw
 */
export function normalizeLayerGeometryType(raw) {
  const geometry = String(raw || '').toLowerCase();
  if (!geometry) return null;
  if (geometry.includes('polygon')) return 'polygon';
  if (geometry.includes('line') || geometry.includes('polyline')) return 'polyline';
  if (geometry.includes('point')) return 'point';
  return null;
}

/**
 * @param {object | null} presentation
 * @param {object} fallbackRenderer
 */
export function resolveScopedRenderer(presentation, fallbackRenderer) {
  if (!presentation?.renderer) {
    return {
      renderer: fallbackRenderer,
      rendererStatus: 'FALLBACK',
      mode: 'IQAI_OVERRIDE'
    };
  }

  const rendererJson = rendererToJson(presentation.renderer);
  const sanitized = sanitizeRendererForScopedLayer(rendererJson);
  if (sanitized) {
    const changed = JSON.stringify(sanitized) !== JSON.stringify(rendererJson);
    return {
      renderer: sanitized,
      rendererStatus: changed ? 'SANITIZED' : 'PRESERVED',
      mode: changed ? 'PARTIAL' : 'INHERITED'
    };
  }

  return {
    renderer: fallbackRenderer,
    rendererStatus: 'FALLBACK',
    mode: 'PARTIAL'
  };
}

/**
 * @param {object | null} presentation
 * @param {object | null} serializedPopup
 * @param {object | null} genericPopup
 */
export function resolveScopedPopup(presentation, serializedPopup, genericPopup) {
  if (presentation?.popupTemplate) {
    if (typeof presentation.popupTemplate.clone === 'function') {
      return { popupTemplate: presentation.popupTemplate.clone(), popupStatus: 'CLONED' };
    }
    return { popupTemplate: presentation.popupTemplate, popupStatus: 'CLONED' };
  }
  if (serializedPopup) {
    return { popupTemplate: serializedPopup, popupStatus: 'GENERIC' };
  }
  if (genericPopup) {
    return { popupTemplate: genericPopup, popupStatus: 'GENERIC' };
  }
  return { popupTemplate: null, popupStatus: 'NONE' };
}
