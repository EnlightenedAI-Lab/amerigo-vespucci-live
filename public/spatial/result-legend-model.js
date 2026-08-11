/**
 * Result-scoped legend: CURRENT deterministic result categories ∩ authoritative renderer.
 */

import { formatAmenityCategory } from './iqai-osm-presentation.js';
import {
  getCategorySymbol,
  hydratePresentationRenderer,
  sanitizeSymbolForScopedLayer,
  symbolToImageUrl,
  getOsmNaAmenitiesSourceDef,
  normalizeRendererClassValue
} from './source-presentation.js';

export { normalizeRendererClassValue };

/**
 * @param {object | null | undefined} renderer
 */
export function buildRendererClassIndex(renderer) {
  /** @type {Map<string, { rawValue: string, label: string | null, symbol: object | null }>} */
  const index = new Map();
  if (!renderer) return index;

  if (renderer.type === 'uniqueValue') {
    for (const info of renderer.uniqueValueInfos || []) {
      const key = normalizeRendererClassValue(info.value);
      if (!key) continue;
      index.set(key, {
        rawValue: String(info.value),
        label: info.label ? String(info.label) : null,
        symbol: info.symbol || renderer.defaultSymbol || null
      });
    }
    return index;
  }

  if (renderer.type === 'simple' && renderer.symbol) {
    index.set('__simple__', {
      rawValue: '__simple__',
      label: null,
      symbol: renderer.symbol
    });
  }

  return index;
}

/**
 * @param {Map<string, { rawValue: string, label: string | null, symbol: object | null }>} index
 * @param {string} resultCategoryValue
 */
export function resolveRendererClass(index, resultCategoryValue) {
  const key = normalizeRendererClassValue(resultCategoryValue);
  if (!key || !index.size) return null;
  if (index.has(key)) return index.get(key);
  return null;
}

/**
 * @param {object | null | undefined} symbol
 */
export function legendSymbolUrlFromSource(symbol) {
  if (!symbol) return null;
  const httpUrl = String(symbol.url || '');
  if (/^https?:\/\//i.test(httpUrl)) return httpUrl;
  const sanitized = sanitizeSymbolForScopedLayer(symbol);
  const candidate = sanitized || symbol;
  const dataUrl = symbolToImageUrl(candidate);
  if (dataUrl) return dataUrl;
  return simpleMarkerSvgDataUrl(candidate);
}

function simpleMarkerSvgDataUrl(symbol) {
  const type = String(symbol?.type || '').toLowerCase();
  if (type !== 'esrisms' && type !== 'simple-marker') return null;
  const color = symbol.color;
  if (!Array.isArray(color) || color.length < 3) return null;
  const alpha = color.length > 3 ? Number(color[3]) / 255 : 1;
  const fill = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Number.isFinite(alpha) ? alpha : 1})`;
  const size = 14;
  const style = String(symbol.style || '').toLowerCase();
  const isSquare = style.includes('square');
  const shape = isSquare
    ? `<rect x="2" y="2" width="${size - 4}" height="${size - 4}" fill="${fill}" stroke="white" stroke-width="1"/>`
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${(size / 2) - 2}" fill="${fill}" stroke="white" stroke-width="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${shape}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * @param {object} mapResult
 */
export function deriveResultCategoryCounts(mapResult) {
  if (!mapResult?.supported) return null;
  const datasetResults = mapResult.datasetResults || [];
  const field = datasetResults[0]?.renderMeta?.semanticField
    || datasetResults[0]?.provenance?.semanticField
    || 'amenity';
  const counts = new Map();

  const addFeature = (feature) => {
    const raw = feature.rawAttributes || {};
    const rawValue = raw[field] ?? raw.amenity ?? raw.category ?? null;
    if (rawValue == null) return;
    const key = String(rawValue).trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  if (datasetResults.length) {
    for (const result of datasetResults) {
      for (const feature of result.features || []) {
        addFeature(feature);
      }
    }
  } else {
    for (const feature of mapResult.features || []) {
      addFeature(feature);
    }
  }

  if (!counts.size) return null;

  const categories = [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: formatAmenityCategory(value),
      count
    }))
    .sort((a, b) => b.count - a.count);

  return {
    field,
    categories,
    totalCount: mapResult.summary?.matchedFeatures
      ?? mapResult.resultAccounting?.totalMatchingObjectIds
      ?? categories.reduce((sum, entry) => sum + entry.count, 0)
  };
}

/**
 * @param {object} mapResult
 * @param {object | null} presentation
 */
export function buildResultScopedLegend(mapResult, presentation = null) {
  const counts = deriveResultCategoryCounts(mapResult);
  if (!counts) return null;

  const renderer = presentation?.renderer || null;
  const rendererField = renderer?.field1 || counts.field || presentation?.semanticField || 'amenity';
  const classIndex = buildRendererClassIndex(renderer);
  const unmatched = [];

  const entries = counts.categories.map((entry) => {
    const rendererClass = resolveRendererClass(classIndex, entry.value);
    const sourceSymbol = rendererClass?.symbol
      || (presentation ? getCategorySymbol(presentation, rendererField, entry.value) : null);
    const symbolUrl = legendSymbolUrlFromSource(sourceSymbol);
    const sourceClassMatched = Boolean(rendererClass && sourceSymbol);
    if (!sourceClassMatched) {
      unmatched.push(entry.value);
    }
    const displayLabel = rendererClass?.label || entry.label;
    return {
      categoryValue: entry.value,
      displayLabel,
      resultCount: entry.count,
      sourceSymbol,
      symbolUrl,
      sourceClassMatched,
      sourceSymbolType: sourceSymbol?.type || null
    };
  });

  const categories = entries.map((entry) => ({
    value: entry.categoryValue,
    label: entry.displayLabel,
    count: entry.resultCount,
    symbolUrl: entry.symbolUrl,
    sourceSymbol: entry.sourceSymbol,
    sourceClassMatched: entry.sourceClassMatched,
    sourceSymbolType: entry.sourceSymbolType
  }));

  return {
    field: rendererField,
    totalCount: counts.totalCount,
    entries,
    categories,
    sourceRendererClassCount: renderer?.uniqueValueInfos?.length
      ?? (renderer?.type === 'simple' ? 1 : 0),
    resultCategoryCount: entries.length,
    matchedLegendCategoryCount: entries.length - unmatched.length,
    unmatchedLegendCategories: unmatched
  };
}

/**
 * @param {object} mapResult
 * @param {object | null} presentation
 */
export async function buildResultScopedLegendAsync(mapResult, presentation = null) {
  let resolved = presentation;
  const isOsm = (mapResult.datasetResults || []).some((result) => (
    result.sourceType === 'TRUSTED_EXTERNAL' || result.sourceId === 'OSM_NA_AMENITIES'
  ));
  if (isOsm) {
    resolved = await hydratePresentationRenderer(resolved, getOsmNaAmenitiesSourceDef());
  }
  return buildResultScopedLegend(mapResult, resolved);
}

/**
 * @param {object | null} legend
 * @param {object | null} mapResult
 * @param {object | null} presentation
 * @param {object | null} rendererMeta
 */
export function publishResultLegendDiagnostics(legend, mapResult, presentation, rendererMeta = null) {
  if (typeof window === 'undefined') return legend;
  const renderer = presentation?.renderer || null;
  window.__IQAI_RESULT_LEGEND__ = legend;
  window.__IQAI_RESULT_RENDERER__ = {
    ...(rendererMeta || window.__IQAI_RESULT_RENDERER__ || {}),
    rendererField: legend?.field || renderer?.field1 || null,
    rendererType: renderer?.type || rendererMeta?.validation?.rendererType || null,
    sourceClassCount: legend?.sourceRendererClassCount ?? renderer?.uniqueValueInfos?.length ?? null,
    resultCategoryCount: legend?.resultCategoryCount ?? legend?.entries?.length ?? null,
    matchedLegendCategoryCount: legend?.matchedLegendCategoryCount ?? null,
    unmatchedLegendCategories: legend?.unmatchedLegendCategories || [],
    presentationSource: presentation?.rendererSource || null,
    rendererReconstructed: rendererMeta?.mode !== 'scoped_authoritative_source_layer'
      && rendererMeta?.mode !== 'authoritative_native_layerview',
    usesLayerViewFilter: rendererMeta?.usesLayerViewFilter === true,
    activeCategory: rendererMeta?.activeCategory ?? null,
    baseResultObjectIdCount: rendererMeta?.baseResultObjectIdCount ?? null,
    activeObjectIdCount: rendererMeta?.activeObjectIdCount ?? null,
    sourceLayerTitle: rendererMeta?.sourceLayerTitle || null,
    sourceLayerUrl: rendererMeta?.sourceLayerUrl || null,
    mode: rendererMeta?.mode || null
  };
  return legend;
}
