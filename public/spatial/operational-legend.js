/**
 * Dynamic operational legend for X-ray amenity display — AOI categories only.
 */

import { getCategorySymbol, symbolToImageUrl } from './source-presentation.js';

function formatCategoryLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * @param {object} xrayResult
 * @param {object | null} presentation
 */
export function buildOperationalLegendEntries(xrayResult, presentation = null) {
  const categories = xrayResult?.categories || [];
  const semanticField = xrayResult?.semanticField || 'amenity';
  return categories.map((entry) => {
    const symbol = presentation
      ? getCategorySymbol(presentation, semanticField, entry.value)
      : null;
    return {
      value: entry.value,
      label: entry.label || formatCategoryLabel(entry.value),
      count: entry.count,
      symbolUrl: symbolToImageUrl(symbol)
    };
  });
}

/**
 * @param {Array<{ label: string, count: number, symbolUrl: string | null }>} entries
 */
export function renderOperationalLegendHtml(entries = []) {
  if (!entries.length) return '';
  const rows = entries.map((entry) => {
    const symbol = entry.symbolUrl
      ? `<img class="operational-legend-symbol" src="${entry.symbolUrl}" alt="" />`
      : '<span class="operational-legend-symbol-fallback">●</span>';
  const countLabel = entry.count != null ? ` — ${entry.count}` : '';
    return `<div class="operational-legend-row">${symbol}<span class="operational-legend-label">${entry.label}${countLabel}</span></div>`;
  }).join('');
  return `<div class="operational-legend"><div class="operational-legend-title">Amenities in AOI</div>${rows}</div>`;
}
