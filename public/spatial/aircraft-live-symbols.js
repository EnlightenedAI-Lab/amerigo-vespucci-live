/**
 * Inline SVG picture-marker symbols for live aircraft (no external hosting).
 */

function svgDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const AIRCRAFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="#2563eb" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"
    d="M12 2.2c.1 0 .9 7.4 1.1 9.1l5.9 1.9-5.9 1.4-.2 5.6-.9 2.8-.9-2.8-.2-5.6-5.9-1.4 5.9-1.9c.2-1.7 1-9.1 1.1-9.1z"/>
</svg>`;

const HELICOPTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <ellipse cx="12" cy="7" rx="9" ry="2.2" fill="none" stroke="#10b981" stroke-width="1.3"/>
  <path fill="#10b981" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"
    d="M12 7.5v5.2M8.2 12.7h7.6M10.2 16.2h3.6l-.4 2.2h-2.8z"/>
  <line x1="4" y1="7" x2="20" y2="7" stroke="#10b981" stroke-width="1.3"/>
</svg>`;

export const AIRCRAFT_SYMBOL_SIZE_PX = 16;

export const AIRCRAFT_PICTURE_SYMBOL = {
  type: 'picture-marker',
  url: svgDataUri(AIRCRAFT_SVG),
  width: AIRCRAFT_SYMBOL_SIZE_PX,
  height: AIRCRAFT_SYMBOL_SIZE_PX,
  angle: 0
};

export const HELICOPTER_PICTURE_SYMBOL = {
  type: 'picture-marker',
  url: svgDataUri(HELICOPTER_SVG),
  width: AIRCRAFT_SYMBOL_SIZE_PX,
  height: AIRCRAFT_SYMBOL_SIZE_PX,
  angle: 0
};

export function buildAircraftLayerRenderer() {
  return {
    type: 'unique-value',
    field: 'aircraftClass',
    defaultSymbol: AIRCRAFT_PICTURE_SYMBOL,
    uniqueValueInfos: [{
      value: 'HELICOPTER',
      symbol: HELICOPTER_PICTURE_SYMBOL
    }],
    visualVariables: [{
      type: 'rotation',
      field: 'headingDegrees',
      rotationType: 'geographic'
    }]
  };
}
