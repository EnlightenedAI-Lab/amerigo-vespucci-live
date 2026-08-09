/**
 * Inventory of CURRENTLY SUPPORTED MAP language capabilities (test reference only).
 * Derived from spatial-compound-planner, spatial-conversation-resolve, layer-aware-wiring.
 */
export const GIS_ACTIONS = ['CLEAR', 'LOCATE', 'WITHIN', 'NEAREST', 'COUNT', 'SHOW', 'FILTER'];
export const LAYER_ACTIONS = ['LIST_LAYERS', 'SHOW_LAYER', 'SHOW_LAYERS', 'HIDE_LAYER', 'HIDE_LAYERS', 'TOGGLE_LAYER', 'ZOOM_TO_LAYER', 'ZOOM_TO_LAYERS'];
export const META_ACTIONS = [
  'RESET_MAP',
  'HIDE_ALL_SOURCE',
  'HIDE_ALL_DISPLAYED',
  'SHOW_ALL_OPERATIONAL',
  'SHOW_ONLY_LAYERS',
  'ZOOM_SCOPED_RESULTS',
  'HIDE_SCOPED_RESULTS',
  'SHOW_SCOPED_RESULTS',
  'LAYER_REFERENCE'
];
export const LAYER_REFERENCE_OPS = ['ZOOM_TO_LAYERS', 'HIDE_LAYERS', 'SHOW_LAYERS'];
export const CONVERSATION_EXPANSIONS = ['radius_reuse', 'nearest_refine', 'location_reuse', 'location_only', 'same_radius'];
