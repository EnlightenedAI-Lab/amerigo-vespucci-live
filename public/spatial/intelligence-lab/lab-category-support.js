/**
 * Category × model support — derived from frozen panel and F1 artifacts.
 * Application category selection is authoritative; model coverage is independent.
 */

import { categoryLabel } from './lab-labels.js';

/** @param {object} manifest */
export function f1SupportedCategory(manifest) {
  return manifest?.f1?.category || null;
}

/** @param {object} manifest @param {string} category */
export function isF1CategorySupported(manifest, category) {
  const supported = f1SupportedCategory(manifest);
  return Boolean(supported && category === supported);
}

/** @param {import('./lab-data.js').LabDataStore} store @param {string} category */
export function isHistoricalCategorySupported(store, category) {
  return store.categories.includes(category);
}

/** B4 seasonal outlook uses the same frozen weekly panel as historical analytics. */
export function isB4CategorySupported(store, category) {
  return isHistoricalCategorySupported(store, category);
}

const F1_MAP_MODES = new Set(['forecast', 'forecastError', 'modelAdvantage']);

export function isF1MapMode(visualMode) {
  return F1_MAP_MODES.has(visualMode);
}

/**
 * @param {import('./lab-data.js').LabDataStore} store
 * @param {object} manifest
 */
export function buildCategorySupportMatrix(store, manifest) {
  const f1Cat = f1SupportedCategory(manifest);
  return store.categories.map((category) => ({
    category,
    label: categoryLabel(category),
    historical: isHistoricalCategorySupported(store, category),
    b4: isB4CategorySupported(store, category),
    f1: f1Cat ? category === f1Cat : false
  }));
}
