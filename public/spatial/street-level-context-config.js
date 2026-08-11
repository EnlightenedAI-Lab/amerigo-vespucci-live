/**
 * Street-level visual context (V1) — configuration constants.
 * Google Street View only. Optional; IQAI Spatial runs without it.
 */

export const STREET_LEVEL_CONTEXT_UI_ENABLED = true;

/** Provider id for V1 — Google Street View only. */
export const STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE = 'google-street-view';

/** Default search radius (meters) when resolving nearest panorama. */
export const STREET_VIEW_SEARCH_RADIUS_METERS = 50;

/** Public spatial config endpoint (browser-safe subset only). */
export const STREET_LEVEL_CONTEXT_CONFIG_PATH = '/api/spatial/config';

export const SLC_PANEL_STATE = Object.freeze({
  CLOSED: 'CLOSED',
  CONFIG_DISABLED: 'CONFIG_DISABLED',
  NO_LOCATION: 'NO_LOCATION',
  CHECKING: 'CHECKING',
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
});
