/** PLACE_POI_SEARCH V1 feature gate — mirrors server IQAI_PLACE_POI_V1_ENABLED. */
export function isPlacePoiV1Enabled() {
  if (typeof window !== 'undefined') {
    if (window.__IQAI_PLACE_POI_V1_ENABLED__ != null) {
      return Boolean(window.__IQAI_PLACE_POI_V1_ENABLED__);
    }
    if (window.__IQAI_SPATIAL_RUNTIME_INFO__?.placePoiV1Enabled != null) {
      return Boolean(window.__IQAI_SPATIAL_RUNTIME_INFO__.placePoiV1Enabled);
    }
  }
  return true;
}
