/**
 * Centralized IQAI MAP result symbology — high-contrast, dataset-distinct markers.
 */

/** @typedef {{ style: string, color: number[], size: number, outline?: { color: number[], width: number }, path?: string, angle?: number }} ResultSymbol */

/** @type {Record<string, ResultSymbol>} */
export const RESULT_SYMBOLS = {
  FIRE_STATIONS: {
    style: 'triangle',
    color: [220, 38, 38, 1],
    size: 13,
    outline: { color: [255, 255, 255, 1], width: 2 }
  },
  POLICE_STATIONS: {
    style: 'square',
    color: [24, 24, 24, 1],
    size: 13,
    outline: { color: [255, 255, 255, 1], width: 3 }
  },
  HOSPITALS: {
    style: 'path',
    color: [0, 102, 204, 1],
    size: 14,
    path: 'M0,-9 L0,9 M-9,0 L9,0',
    outline: { color: [255, 255, 255, 1], width: 2 }
  },
  SCHOOLS: {
    style: 'diamond',
    color: [180, 60, 0, 1],
    size: 12,
    outline: { color: [255, 255, 255, 1], width: 2 }
  },
  TRANSIT: {
    style: 'circle',
    color: [0, 130, 90, 1],
    size: 11,
    outline: { color: [255, 255, 255, 1], width: 2 }
  },
  PUBLIC_BUILDINGS: {
    style: 'square',
    color: [92, 64, 140, 1],
    size: 12,
    outline: { color: [255, 255, 255, 1], width: 2 }
  },
  TOILETS: {
    style: 'circle',
    color: [99, 102, 241, 1],
    size: 11,
    outline: { color: [255, 255, 255, 1], width: 2 }
  }
};

export const DEFAULT_RESULT_SYMBOL = {
  style: 'circle',
  color: [80, 80, 80, 1],
  size: 10,
  outline: { color: [255, 255, 255, 1], width: 1.5 }
};

/**
 * @param {string | null | undefined} datasetId
 * @returns {ResultSymbol}
 */
export function getResultSymbol(datasetId) {
  if (!datasetId) return { ...DEFAULT_RESULT_SYMBOL };
  return RESULT_SYMBOLS[datasetId] ? { ...RESULT_SYMBOLS[datasetId] } : { ...DEFAULT_RESULT_SYMBOL };
}
