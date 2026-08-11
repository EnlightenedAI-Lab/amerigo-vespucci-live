/**
 * Safe source-aware renderers for deterministic IQAI result FeatureLayers.
 * SOURCE SYMBOLOGY WHEN POSSIBLE + GUARANTEED VISIBILITY ALWAYS.
 */

import {
  sanitizeRendererForScopedLayer,
  sanitizeSymbolForScopedLayer,
  inheritRendererForCategories,
  getCategorySymbol
} from './source-presentation.js';

export const VISIBLE_CLASS_FALLBACK_SYMBOL = {
  type: 'simple-marker',
  style: 'circle',
  color: [110, 110, 110, 1],
  size: 9,
  outline: { color: [255, 255, 255, 1], width: 1.5 }
};

export const VISIBLE_SIMPLE_FALLBACK_RENDERER = {
  type: 'simple',
  symbol: {
    type: 'simple-marker',
    style: 'circle',
    color: [255, 64, 0, 1],
    size: 10,
    outline: { color: [255, 255, 255, 1], width: 1.5 }
  }
};

function curatedSymbolJson(symbol) {
  if (!symbol) return null;
  const style = String(symbol.style || 'circle').toLowerCase();
  return sanitizeSymbolForScopedLayer({
    type: 'simple-marker',
    style,
    color: symbol.color || [0, 112, 255, 1],
    size: symbol.size || 10,
    outline: symbol.outline || { color: [255, 255, 255, 1], width: 1.5 },
    path: symbol.path
  });
}

/**
 * @param {import('@arcgis/core/Graphic').default[]} graphics
 * @param {string} fieldName
 */
export function categoryValuesFromGraphics(graphics, fieldName) {
  const values = new Set();
  for (const graphic of graphics) {
    const value = graphic.attributes?.[fieldName];
    if (value != null && String(value).trim() !== '') {
      values.add(String(value));
    }
  }
  return [...values];
}

function fallbackSymbolForCategory(presentation, field, value) {
  const sourceSymbol = presentation ? getCategorySymbol(presentation, field, value) : null;
  const sanitized = sourceSymbol ? sanitizeSymbolForScopedLayer(sourceSymbol) : null;
  return sanitized || { ...VISIBLE_CLASS_FALLBACK_SYMBOL };
}

function ensureUniqueValueCoverage(renderer, categoryValues, field, presentation) {
  const infos = [...(renderer.uniqueValueInfos || [])];
  const covered = new Set(infos.map((entry) => String(entry.value)));
  const missing = categoryValues.filter((value) => !covered.has(String(value)));
  for (const value of missing) {
    infos.push({ value, symbol: fallbackSymbolForCategory(presentation, field, value) });
  }
  const defaultSymbol = renderer.defaultSymbol
    || infos[0]?.symbol
    || fallbackSymbolForCategory(presentation, field, categoryValues[0]);
  return {
    type: 'uniqueValue',
    field1: renderer.field1 || field,
    uniqueValueInfos: infos,
    defaultSymbol
  };
}

/**
 * @param {{
 *   presentation?: object | null,
 *   graphics: import('@arcgis/core/Graphic').default[],
 *   semanticField?: string | null,
 *   curatedSymbol?: object | null
 * }} options
 */
export function buildSafeResultRenderer(options) {
  const { presentation, graphics, semanticField, curatedSymbol } = options;
  const field = semanticField || presentation?.semanticField || 'amenity';
  const categoryValues = categoryValuesFromGraphics(graphics, field);

  if (curatedSymbol) {
    const symbol = curatedSymbolJson(curatedSymbol) || { ...VISIBLE_CLASS_FALLBACK_SYMBOL };
    return {
      renderer: { type: 'simple', symbol },
      field,
      mode: 'curated',
      validation: {
        field,
        categoryCount: categoryValues.length,
        rendererType: 'simple'
      }
    };
  }

  const sourceRenderer = presentation?.renderer;
  if (!sourceRenderer) {
    return {
      renderer: VISIBLE_SIMPLE_FALLBACK_RENDERER,
      field,
      mode: 'fallback_no_source',
      validation: { field, categoryCount: categoryValues.length }
    };
  }

  if (sourceRenderer.type === 'uniqueValue' && categoryValues.length) {
    const inherited = inheritRendererForCategories(presentation, field, categoryValues);
    const sanitized = sanitizeRendererForScopedLayer(inherited || sourceRenderer);
    if (sanitized?.type === 'uniqueValue') {
      const renderer = ensureUniqueValueCoverage(sanitized, categoryValues, field, presentation);
      return {
        renderer,
        field,
        mode: 'source_unique_value',
        validation: {
          field,
          categoryCount: categoryValues.length,
          symbolClasses: renderer.uniqueValueInfos.length,
          rendererType: 'uniqueValue'
        }
      };
    }
    if (sanitized?.type === 'simple') {
      return {
        renderer: sanitized,
        field,
        mode: 'source_simple',
        validation: { field, categoryCount: categoryValues.length, rendererType: 'simple' }
      };
    }
  }

  const sanitized = sanitizeRendererForScopedLayer(sourceRenderer);
  if (sanitized) {
    if (sanitized.type === 'uniqueValue' && categoryValues.length) {
      const renderer = ensureUniqueValueCoverage(sanitized, categoryValues, field, presentation);
      return {
        renderer,
        field,
        mode: 'source_unique_value_sanitized',
        validation: {
          field,
          categoryCount: categoryValues.length,
          symbolClasses: renderer.uniqueValueInfos.length,
          rendererType: 'uniqueValue'
        }
      };
    }
    return {
      renderer: sanitized,
      field,
      mode: 'source_sanitized',
      validation: { field, categoryCount: categoryValues.length, rendererType: sanitized.type }
    };
  }

  return {
    renderer: VISIBLE_SIMPLE_FALLBACK_RENDERER,
    field,
    mode: 'fallback_unsafe_source',
    validation: { field, categoryCount: categoryValues.length }
  };
}
