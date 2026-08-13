/**
 * Static multilayer CIM station objects for Point Intelligence proof 1.
 * Hydrometric = gauge chassis. SWOB = atmospheric registration chassis.
 * No animation.
 */
import { FRESHNESS_CLASS } from './point-intelligence-station-model.js';

function circlePath(radius, steps = 24) {
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    path.push([
      Number((Math.cos(angle) * radius).toFixed(3)),
      Number((Math.sin(angle) * radius).toFixed(3))
    ]);
  }
  return [path];
}

function lineGraphic(paths, color, width) {
  return {
    type: 'CIMMarkerGraphic',
    geometry: { paths },
    symbol: {
      type: 'CIMLineSymbol',
      symbolLayers: [{
        type: 'CIMSolidStroke',
        enable: true,
        color,
        width,
        capStyle: 'Round',
        joinStyle: 'Miter'
      }]
    }
  };
}

function fillGraphic(rings, fill, stroke, strokeWidth = 0.6) {
  const layers = [{
    type: 'CIMSolidFill',
    enable: true,
    color: fill
  }];
  if (stroke) {
    layers.unshift({
      type: 'CIMSolidStroke',
      enable: true,
      color: stroke,
      width: strokeWidth
    });
  }
  return {
    type: 'CIMMarkerGraphic',
    geometry: { rings },
    symbol: {
      type: 'CIMPolygonSymbol',
      symbolLayers: layers
    }
  };
}

function vectorMarker(markerGraphics, size) {
  return {
    type: 'CIMVectorMarker',
    enable: true,
    size,
    anchorPointUnits: 'Relative',
    frame: { xmin: -10, ymin: -10, xmax: 10, ymax: 10 },
    markerGraphics,
    scaleSymbolsProportionally: true,
    respectFrame: true
  };
}

function cimSymbol(markerGraphics, size, scale = null) {
  const data = {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPointSymbol',
      symbolLayers: [vectorMarker(markerGraphics, size)]
    }
  };
  if (scale) {
    data.minScale = scale.minScale ?? 0;
    data.maxScale = scale.maxScale ?? 0;
  }
  return { type: 'cim', data };
}

/** Local engineered CIM: visible when scale <= this (zoomed in). */
export const PI_LOCAL_INSTRUMENT_MIN_SCALE = 18000;
/** Regional firefly: visible from local cutoff out to this. */
export const PI_REGIONAL_FIREFLY_MIN_SCALE = 400000;

function withScale(symbol, minScale, maxScale) {
  return {
    type: 'cim',
    data: {
      ...symbol.data,
      minScale,
      maxScale
    }
  };
}

const PALETTE = Object.freeze({
  hydro: {
    chassis: [16, 36, 54, 230],
    chassisStroke: [214, 228, 236, 255],
    accent: [126, 176, 204, 255],
    measure: [186, 214, 228, 255]
  },
  weather: {
    chassis: [18, 40, 32, 230],
    chassisStroke: [206, 224, 214, 255],
    accent: [140, 186, 154, 255],
    measure: [196, 220, 200, 255]
  },
  climate: {
    chassis: [36, 32, 18, 230],
    chassisStroke: [226, 214, 186, 255],
    accent: [196, 168, 96, 255],
    measure: [228, 214, 170, 255]
  },
  weatherCurrent: {
    chassis: [32, 28, 16, 230],
    chassisStroke: [232, 214, 168, 255],
    accent: [214, 176, 82, 255],
    measure: [236, 220, 164, 255]
  },
  air: {
    chassis: [28, 22, 40, 230],
    chassisStroke: [214, 206, 228, 255],
    accent: [164, 148, 196, 255],
    measure: [206, 198, 224, 255]
  }
});

function paletteKey(family) {
  if (family === 'hydrometric' || family === 'hydro') return 'hydro';
  if (family === 'climate') return 'climate';
  if (family === 'weather-current' || family === 'weatherCurrent') return 'weatherCurrent';
  if (family === 'air-quality' || family === 'air') return 'air';
  return 'weather';
}

function freshnessStyle(family, freshnessClass, supporting = false) {
  const base = PALETTE[paletteKey(family)];
  let style;
  if (freshnessClass === FRESHNESS_CLASS.CURRENT) {
    style = { ring: base.accent, ringWidth: 1.15, size: 18, chassisAlpha: 230 };
  } else if (freshnessClass === FRESHNESS_CLASS.RECENT) {
    style = { ring: [...base.accent.slice(0, 3), 190], ringWidth: 0.85, size: 17, chassisAlpha: 200 };
  } else if (freshnessClass === FRESHNESS_CLASS.REGISTRY) {
    style = { ring: [168, 180, 188, 160], ringWidth: 0.7, size: 16, chassisAlpha: 180 };
  } else {
    style = { ring: [150, 162, 170, 130], ringWidth: 0.65, size: 16, chassisAlpha: 150 };
  }
  if (supporting) {
    style = {
      ...style,
      ring: [196, 214, 72, 180],
      ringWidth: Math.max(0.7, style.ringWidth - 0.15),
      size: Math.max(14, style.size - 2),
      chassisAlpha: Math.max(175, style.chassisAlpha - 35)
    };
  }
  return style;
}

function withAlpha(color, alpha) {
  return [color[0], color[1], color[2], alpha];
}

function diamondRings(radius) {
  return [[[0, -radius], [radius, 0], [0, radius], [-radius, 0], [0, -radius]]];
}

function squareRings(radius) {
  return [[[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius], [-radius, -radius]]];
}

function triangleRings(radius) {
  return [[[0, -radius], [radius * 0.92, radius * 0.72], [-radius * 0.92, radius * 0.72], [0, -radius]]];
}

function regularPolygonRings(sides, radius, rotation = -Math.PI / 2) {
  const path = [];
  for (let i = 0; i <= sides; i += 1) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    path.push([
      Number((Math.cos(angle) * radius).toFixed(3)),
      Number((Math.sin(angle) * radius).toFixed(3))
    ]);
  }
  return [path];
}

export function buildHydrometricCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT, options = {}) {
  const style = freshnessStyle('hydro', freshnessClass, options.supporting);
  const chassis = withAlpha(PALETTE.hydro.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(options.supporting ? 8.8 : 8.4), style.ring, style.ringWidth),
    fillGraphic(
      [[[-2.2, -7.4], [2.2, -7.4], [2.2, 6.6], [-2.2, 6.6], [-2.2, -7.4]]],
      chassis,
      PALETTE.hydro.chassisStroke,
      0.55
    ),
    lineGraphic([[[0, -6.4], [0, 5.8]]], PALETTE.hydro.measure, 0.7),
    lineGraphic([[[-1.5, -3.2], [1.5, -3.2]]], PALETTE.hydro.accent, 0.55),
    lineGraphic([[[-1.5, -0.4], [1.5, -0.4]]], PALETTE.hydro.accent, 0.55),
    lineGraphic([[[-1.5, 2.4], [1.5, 2.4]]], PALETTE.hydro.accent, 0.55),
    fillGraphic(
      [[[-1.7, 3.4], [1.7, 3.4], [1.7, 4.8], [-1.7, 4.8], [-1.7, 3.4]]],
      PALETTE.hydro.measure,
      PALETTE.hydro.chassisStroke,
      0.4
    )
  ];
  return cimSymbol(graphics, style.size);
}

export function buildWeatherCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT, options = {}) {
  const style = freshnessStyle('weather', freshnessClass, options.supporting);
  const chassis = withAlpha(PALETTE.weather.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(options.supporting ? 8.6 : 8.2), style.ring, style.ringWidth),
    fillGraphic(
      [[[-3.6, -3.6], [3.6, -3.6], [3.6, 3.6], [-3.6, 3.6], [-3.6, -3.6]]],
      chassis,
      PALETTE.weather.chassisStroke,
      0.55
    ),
    lineGraphic([[[-7.4, -7.4], [-4.6, -4.6]]], PALETTE.weather.accent, 0.8),
    lineGraphic([[[7.4, -7.4], [4.6, -4.6]]], PALETTE.weather.accent, 0.8),
    lineGraphic([[[-7.4, 7.4], [-4.6, 4.6]]], PALETTE.weather.accent, 0.8),
    lineGraphic([[[7.4, 7.4], [4.6, 4.6]]], PALETTE.weather.accent, 0.8),
    lineGraphic([[[-2.2, 0], [2.2, 0]], [[0, -2.2], [0, 2.2]]], PALETTE.weather.measure, 0.75)
  ];
  return cimSymbol(graphics, style.size);
}

export function buildClimateCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT, options = {}) {
  const style = freshnessStyle('climate', freshnessClass, options.supporting);
  const chassis = withAlpha(PALETTE.climate.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(options.supporting ? 8.6 : 8.2), style.ring, style.ringWidth),
    fillGraphic(diamondRings(5.4), chassis, PALETTE.climate.chassisStroke, 0.55),
    lineGraphic([[[-2.4, 0], [2.4, 0]]], PALETTE.climate.measure, 0.7),
    lineGraphic([[[-1.6, -1.8], [1.6, -1.8]]], PALETTE.climate.accent, 0.55),
    lineGraphic([[[-1.6, 1.8], [1.6, 1.8]]], PALETTE.climate.accent, 0.55)
  ];
  return cimSymbol(graphics, style.size);
}

export function buildWeatherCurrentCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT, options = {}) {
  const style = freshnessStyle('weather-current', freshnessClass, options.supporting);
  const chassis = withAlpha(PALETTE.weatherCurrent.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(options.supporting ? 8.6 : 8.2), style.ring, style.ringWidth),
    fillGraphic(triangleRings(5.8), chassis, PALETTE.weatherCurrent.chassisStroke, 0.55),
    lineGraphic([[[0, -5.2], [0, 3.4]]], PALETTE.weatherCurrent.measure, 0.7),
    lineGraphic([[[-1.6, 1.4], [1.6, 1.4]]], PALETTE.weatherCurrent.accent, 0.55)
  ];
  return cimSymbol(graphics, style.size);
}

export function buildAirQualityCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT, options = {}) {
  const style = freshnessStyle('air-quality', freshnessClass, options.supporting);
  const chassis = withAlpha(PALETTE.air.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(options.supporting ? 8.6 : 8.2), style.ring, style.ringWidth),
    fillGraphic(regularPolygonRings(6, 5.2), chassis, PALETTE.air.chassisStroke, 0.55),
    lineGraphic([[[0, 0], [0, -3.4]]], PALETTE.air.measure, 0.7),
    lineGraphic([[[0, 0], [2.9, 1.7]]], PALETTE.air.accent, 0.55),
    lineGraphic([[[0, 0], [-2.9, 1.7]]], PALETTE.air.accent, 0.55)
  ];
  return cimSymbol(graphics, style.size);
}

/**
 * Regional constellation node: small luminous core + tight halo.
 * Core shape follows family. Not a coverage blob, not a pulse, not map-wide bloom.
 */
export function buildRegionalFireflyCimSymbol(family = 'hydrometric', freshnessClass = FRESHNESS_CLASS.CURRENT, options = {}) {
  const key = paletteKey(family);
  const style = freshnessStyle(family, freshnessClass, options.supporting);
  const core = options.supporting
    ? [210, 224, 110, 230]
    : [...PALETTE[key].accent.slice(0, 3), freshnessClass === FRESHNESS_CLASS.CURRENT ? 240 : 190];
  const halo = options.supporting
    ? [196, 214, 72, 70]
    : [...PALETTE[key].accent.slice(0, 3), 55];
  let coreRings = circlePath(2.35);
  if (family === 'weather') coreRings = squareRings(1.85);
  else if (family === 'climate') coreRings = diamondRings(2.25);
  else if (family === 'weather-current') coreRings = triangleRings(2.45);
  else if (family === 'air-quality') coreRings = regularPolygonRings(6, 2.2);
  const graphics = [
    fillGraphic(circlePath(6.2), halo, null),
    fillGraphic(coreRings, core, [244, 248, 250, 200], 0.35)
  ];
  return cimSymbol(graphics, 12);
}

function familySymbolBuilder(family) {
  if (family === 'hydrometric') return buildHydrometricCimSymbol;
  if (family === 'climate') return buildClimateCimSymbol;
  if (family === 'weather-current') return buildWeatherCurrentCimSymbol;
  if (family === 'air-quality') return buildAirQualityCimSymbol;
  return buildWeatherCimSymbol;
}

export function buildProofStationRenderer(CIMSymbolCtor = null) {
  const wrap = (symbol) => (CIMSymbolCtor ? new CIMSymbolCtor({ data: symbol.data }) : symbol);
  const infos = [];
  const families = ['hydrometric', 'weather', 'climate', 'weather-current', 'air-quality'];
  const freshnessValues = [
    FRESHNESS_CLASS.CURRENT,
    FRESHNESS_CLASS.RECENT,
    FRESHNESS_CLASS.STALE,
    FRESHNESS_CLASS.REGISTRY
  ];
  for (const family of families) {
    const builder = familySymbolBuilder(family);
    for (const freshness of freshnessValues) {
      if (family !== 'hydrometric' && freshness === FRESHNESS_CLASS.REGISTRY) continue;
      const rows = [
        { value: `${family}-${freshness}`, supporting: false },
        { value: `${family}-${freshness}-inside`, supporting: false },
        { value: `${family}-${freshness}-external`, supporting: true }
      ];
      for (const row of rows) {
        const local = withScale(
          builder(freshness, { supporting: row.supporting }),
          PI_LOCAL_INSTRUMENT_MIN_SCALE,
          0
        );
        const regional = withScale(
          buildRegionalFireflyCimSymbol(family, freshness, { supporting: row.supporting }),
          PI_REGIONAL_FIREFLY_MIN_SCALE,
          PI_LOCAL_INSTRUMENT_MIN_SCALE
        );
        infos.push({
          value: row.value,
          label: row.supporting ? `${family} ${freshness} supporting` : `${family} ${freshness}`,
          symbol: wrap(regional),
          alternateSymbols: [wrap(local)]
        });
      }
    }
  }
  return {
    type: 'unique-value',
    field: 'rendererKey',
    defaultSymbol: wrap(withScale(
      buildHydrometricCimSymbol(FRESHNESS_CLASS.STALE),
      PI_LOCAL_INSTRUMENT_MIN_SCALE,
      0
    )),
    uniqueValueInfos: infos
  };
}

export function buildProofStationLabelingInfo() {
  return [{
    name: 'pi-station-value',
    labelExpressionInfo: {
      expression: `
        var d = $feature.primaryDisplay;
        if (IsEmpty(d)) { return ""; }
        return d;
      `
    },
    labelPlacement: 'below-center',
    deconflictionStrategy: 'static',
    minScale: 45000,
    maxScale: 0,
    symbol: {
      type: 'text',
      color: [228, 234, 238, 255],
      haloColor: [12, 20, 28, 210],
      haloSize: 1,
      font: { family: 'Arial', size: 8, weight: 'normal' }
    }
  }];
}

export function renderProofLegendHtml() {
  return `
    <div class="pi-station-legend" aria-label="Point Intelligence station legend">
      <div class="pi-station-legend__row">
        <span class="pi-station-legend__mark pi-station-legend__mark--hydro" aria-hidden="true"></span>
        <span>Hydrometric station</span>
      </div>
      <div class="pi-station-legend__row">
        <span class="pi-station-legend__mark pi-station-legend__mark--weather" aria-hidden="true"></span>
        <span>SWOB weather station</span>
      </div>
      <div class="pi-station-legend__row">
        <span class="pi-station-legend__mark pi-station-legend__mark--climate" aria-hidden="true"></span>
        <span>Climate station</span>
      </div>
      <div class="pi-station-legend__row">
        <span class="pi-station-legend__mark pi-station-legend__mark--citypage" aria-hidden="true"></span>
        <span>Current weather</span>
      </div>
      <div class="pi-station-legend__row">
        <span class="pi-station-legend__mark pi-station-legend__mark--air" aria-hidden="true"></span>
        <span>Air quality / AQHI</span>
      </div>
      <div class="pi-station-legend__states">
        <span>Current</span>
        <span>Recent</span>
        <span>Stale</span>
        <span>Selected</span>
        <span>Supporting</span>
      </div>
    </div>`;
}
