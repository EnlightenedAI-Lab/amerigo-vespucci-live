/**
 * Esri Web Style vessel symbol (browser only).
 */

/** @type {object | null} */
let cachedRenderer = null;

/**
 * @param {Function} importArc
 */
export async function buildVesselLayerRenderer(importArc) {
  if (cachedRenderer) return cachedRenderer;

  try {
    const WebStyleSymbol = await importArc('@arcgis/core/symbols/WebStyleSymbol.js');
    const webSymbol = new WebStyleSymbol({
      name: 'Ferry',
      styleName: 'Esri2DPointSymbolsStyle'
    });
    const symbol = await webSymbol.fetchSymbol();
    cachedRenderer = {
      type: 'simple',
      symbol,
      visualVariables: [{
        type: 'rotation',
        field: 'headingDegrees',
        rotationType: 'geographic'
      }]
    };
    return cachedRenderer;
  } catch (error) {
    const { recordWebStyleSymbolEvent } = await import('./spatial-auth-native-diagnostic.js');
    recordWebStyleSymbolEvent('vessels-live-symbols', {
      styleName: 'Esri2DPointSymbolsStyle',
      symbolName: 'Ferry',
      message: error?.message || String(error)
    });
    console.warn('[IQAI] Esri vessel symbol fetch failed; using fallback marker', error?.message || error);
    cachedRenderer = {
      type: 'simple',
      symbol: {
        type: 'simple-marker',
        style: 'triangle',
        color: [14, 116, 144, 0.92],
        size: 12,
        outline: { color: [255, 255, 255, 1], width: 1.2 },
        angle: 0
      },
      visualVariables: [{
        type: 'rotation',
        field: 'headingDegrees',
        rotationType: 'geographic'
      }]
    };
    return cachedRenderer;
  }
}

export const VESSEL_SYMBOL_SIZE_PX = 12;
