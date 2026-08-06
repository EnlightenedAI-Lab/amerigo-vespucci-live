/** Public ArcGIS WebMap item ID for the Ocean View — proven clean operational map. */
export const OCEAN_VIEW_WEBMAP_ID = '86f1b6a9b6124da5b362964749b5d797';

/** WebMap item ID used for Vespucci layer repair (legacy map — do not modify). */
export const VESPUCCI_WEBMAP_ITEM_ID = 'b3e16d639b034e19a262d7888e7a9673';

/** Current ArcGIS Maps SDK CDN major.minor release (not hardcoded patch). */
export const OCEAN_VIEW_SDK_VERSION = '5.1';

/** Direct link when SDK load fails or user prefers full ArcGIS app. */
export const OCEAN_VIEW_EXTERNAL_URL = `https://www.arcgis.com/home/webmap/viewer.html?webmap=${OCEAN_VIEW_WEBMAP_ID}`;

/**
 * Server-side ocean view configuration returned to the browser.
 * Loads the WebMap via the official ArcGIS map web component CDN loader.
 */
export function getOceanViewConfig() {
  return {
    title: 'ArcGIS Ocean View',
    webmapId: OCEAN_VIEW_WEBMAP_ID,
    loadMethod: 'arcgis-map-component',
    sdkVersion: OCEAN_VIEW_SDK_VERSION,
    cdnUrl: `https://js.arcgis.com/${OCEAN_VIEW_SDK_VERSION}/`,
    portalUrl: process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com',
    externalUrl: OCEAN_VIEW_EXTERNAL_URL,
    destination: {
      name: 'Ponta Delgada, Portugal',
      portCode: 'PTPDL',
      latitude: 37.734722,
      longitude: -25.664444
    },
  };
}

/**
 * Describe a loaded ArcGIS layer renderer for diagnostics display.
 * @param {object} layer ArcGIS JS API layer instance or plain descriptor
 */
export function describeLayerRenderer(layer) {
  const renderer = layer?.renderer;
  const layerType = layer?.type || layer?.layerType || 'unknown';
  const title = layer?.title || 'Untitled layer';
  if (!renderer) {
    return { title, layerType, rendererType: null, animated: layerType === 'imagery' || layerType === 'imagery-tile' };
  }
  const rendererType = renderer.type || 'unknown';
  const animated = rendererType === 'flow'
    || rendererType === 'vector-field'
    || layerType === 'imagery'
    || layerType === 'imagery-tile'
    || /imagery/i.test(layerType);
  return { title, layerType, rendererType, animated };
}
