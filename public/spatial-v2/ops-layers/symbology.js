/** Class-by-shape operational language. Gold is impact/affected area only. */

export const LAYER_CLASS = {
  stm: 'moving',
  aircraft: 'aircraft',
  'recent-crime': 'event',
  'fire-interventions': 'event',
  'civic-311': 'event',
  pdq: 'facility',
  fire: 'facility',
  hospitals: 'facility',
  bixi: 'facility',
  'traffic-cameras': 'facility',
  'pdq-territories': 'territory',
  hydro: 'affected',
  'road-works': 'affected',
  'qc-511': 'affected',
  weather: 'environment',
  'air-quality': 'environment',
  hydrometric: 'environment',
  'bike-counters': 'environment',
  'wildfire-active': 'wildfire',
  'wildfire-hotspots': 'wildfire',
  'wildfire-perimeters': 'wildfire',
  'wildfire-fwi': 'wildfire',
  'spvm-crime': 'historical',
  'intersection-counts': 'historical',
  exo: 'unavailable',
  rem: 'unavailable',
  'road-traffic': 'unavailable',
  'snow-ops': 'unavailable'
};

export const MARKER_STYLE = {
  moving: 'circle',
  aircraft: 'circle',
  event: 'diamond',
  facility: 'square',
  territory: 'square',
  affected: 'diamond',
  environment: 'triangle',
  historical: 'circle',
  wildfire: 'diamond',
  unavailable: 'cross'
};

export function visualClass(layerId) {
  return LAYER_CLASS[layerId] || 'facility';
}

export function markerStyleFor(layerId) {
  return MARKER_STYLE[visualClass(layerId)] || 'circle';
}

export function hexToRgb(hex, alpha = 1) {
  const raw = String(hex || '#9aa8b5').replace('#', '');
  const n = parseInt(raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw, 16);
  if (!Number.isFinite(n)) return [154, 168, 181, alpha];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function pointRenderer(layerId, color) {
  const rgb = hexToRgb(color, 0.92);
  return {
    type: 'simple',
    symbol: {
      type: 'simple-marker',
      style: markerStyleFor(layerId),
      color: rgb,
      size: visualClass(layerId) === 'aircraft' ? 9 : 8,
      outline: { color: [244, 240, 234, 0.85], width: 0.8 }
    }
  };
}

export function fillRenderer(layerId, color) {
  const rgb = hexToRgb(color, visualClass(layerId) === 'affected' ? 0.28 : 0.18);
  const line = hexToRgb(color, 0.9);
  return {
    type: 'simple',
    symbol: {
      type: 'simple-fill',
      color: rgb,
      outline: { color: line, width: 1.2 }
    }
  };
}

export function lineRenderer(color) {
  return {
    type: 'simple',
    symbol: {
      type: 'simple-line',
      color: hexToRgb(color, 0.9),
      width: 2
    }
  };
}
