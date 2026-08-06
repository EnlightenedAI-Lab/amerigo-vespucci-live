/** Shared ArcGIS drawingInfo renderers for Vespucci layers (WebMap + setup). */

export function pointRenderer(color, size) {
  return {
    renderer: {
      type: 'simple',
      symbol: {
        type: 'esriSMS',
        style: 'esriSMSCircle',
        color,
        size,
        outline: { color: [255, 255, 255, 220], width: 1 }
      }
    }
  };
}

export function conditionsRenderer() {
  return {
    renderer: {
      type: 'simple',
      symbol: {
        type: 'esriSMS',
        style: 'esriSMSCircle',
        color: [0, 0, 0, 0],
        size: 19,
        outline: { color: [0, 119, 190, 230], width: 2 }
      }
    }
  };
}

export function lineRenderer(color, width, style) {
  return {
    renderer: {
      type: 'simple',
      symbol: { type: 'esriSLS', style, color, width }
    }
  };
}

/** Vespucci layer renderer presets keyed by feature-service layer id. */
export const VESPUCCI_LAYER_RENDERERS = {
  0: pointRenderer([201, 162, 39, 255], 14),
  1: pointRenderer([0, 112, 255, 180], 5),
  2: lineRenderer([0, 90, 180, 220], 3, 'esriSLSSolid'),
  3: pointRenderer([220, 40, 40, 255], 16),
  4: lineRenderer([255, 120, 0, 255], 4, 'esriSLSDash'),
  5: conditionsRenderer()
};

export const VESPUCCI_LAYER_META = [
  { id: 0, key: 'current', title: 'Current Vessel Position', match: /current vessel position/i },
  { id: 5, key: 'conditions', title: 'Vespucci Marine Conditions', match: /marine conditions/i },
  { id: 1, key: 'history', title: 'Vespucci Track History', match: /track history/i },
  { id: 3, key: 'destination', title: 'Vespucci Destination', match: /destination/i },
  { id: 2, key: 'travelledRoute', title: 'Vespucci Travelled Route', match: /travelled route/i },
  { id: 4, key: 'estimatedRoute', title: 'Vespucci Estimated Route', match: /estimated route/i }
];

export const OCEAN_CURRENTS_MATCH = /ocean current/i;

/** Display order for Vespucci + ocean layers in the WebMap. */
export const WEBMAP_LAYER_DISPLAY_ORDER = [
  ...VESPUCCI_LAYER_META.map((m) => m.key),
  'oceanCurrents'
];
