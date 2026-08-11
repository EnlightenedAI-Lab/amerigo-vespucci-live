/** Esri agentic pilot feature gate — mirrors server IQAI_ESRI_AGENTIC_V1_ENABLED. */
export function isEsriAgenticV1Enabled() {
  if (typeof window !== 'undefined') {
    if (window.__IQAI_ESRI_AGENTIC_V1_ENABLED__ != null) {
      return Boolean(window.__IQAI_ESRI_AGENTIC_V1_ENABLED__);
    }
    if (window.__IQAI_SPATIAL_RUNTIME_INFO__?.esriAgenticV1Enabled != null) {
      return Boolean(window.__IQAI_SPATIAL_RUNTIME_INFO__.esriAgenticV1Enabled);
    }
  }
  return false;
}

export const ESRI_AGENTIC_V1_ENABLED = isEsriAgenticV1Enabled();
