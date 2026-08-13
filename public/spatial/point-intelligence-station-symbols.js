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

function cimSymbol(markerGraphics, size) {
  return {
    type: 'cim',
    data: {
      type: 'CIMSymbolReference',
      symbol: {
        type: 'CIMPointSymbol',
        symbolLayers: [vectorMarker(markerGraphics, size)]
      }
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
  }
});

function freshnessStyle(family, freshnessClass) {
  const base = PALETTE[family];
  if (freshnessClass === FRESHNESS_CLASS.CURRENT) {
    return { ring: base.accent, ringWidth: 1.15, size: 18, chassisAlpha: 230 };
  }
  if (freshnessClass === FRESHNESS_CLASS.RECENT) {
    return { ring: [...base.accent.slice(0, 3), 190], ringWidth: 0.85, size: 17, chassisAlpha: 200 };
  }
  if (freshnessClass === FRESHNESS_CLASS.REGISTRY) {
    return { ring: [168, 180, 188, 160], ringWidth: 0.7, size: 16, chassisAlpha: 180 };
  }
  return { ring: [150, 162, 170, 130], ringWidth: 0.65, size: 16, chassisAlpha: 150 };
}

function withAlpha(color, alpha) {
  return [color[0], color[1], color[2], alpha];
}

export function buildHydrometricCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT) {
  const style = freshnessStyle('hydro', freshnessClass);
  const chassis = withAlpha(PALETTE.hydro.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(8.4), style.ring, style.ringWidth),
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

export function buildWeatherCimSymbol(freshnessClass = FRESHNESS_CLASS.CURRENT) {
  const style = freshnessStyle('weather', freshnessClass);
  const chassis = withAlpha(PALETTE.weather.chassis, style.chassisAlpha);
  const graphics = [
    lineGraphic(circlePath(8.2), style.ring, style.ringWidth),
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

export function buildProofStationRenderer(CIMSymbolCtor = null) {
  const wrap = (symbol) => (CIMSymbolCtor ? new CIMSymbolCtor({ data: symbol.data }) : symbol);
  const infos = [
    ['hydrometric', FRESHNESS_CLASS.CURRENT, buildHydrometricCimSymbol(FRESHNESS_CLASS.CURRENT)],
    ['hydrometric', FRESHNESS_CLASS.RECENT, buildHydrometricCimSymbol(FRESHNESS_CLASS.RECENT)],
    ['hydrometric', FRESHNESS_CLASS.STALE, buildHydrometricCimSymbol(FRESHNESS_CLASS.STALE)],
    ['hydrometric', FRESHNESS_CLASS.REGISTRY, buildHydrometricCimSymbol(FRESHNESS_CLASS.REGISTRY)],
    ['weather', FRESHNESS_CLASS.CURRENT, buildWeatherCimSymbol(FRESHNESS_CLASS.CURRENT)],
    ['weather', FRESHNESS_CLASS.RECENT, buildWeatherCimSymbol(FRESHNESS_CLASS.RECENT)],
    ['weather', FRESHNESS_CLASS.STALE, buildWeatherCimSymbol(FRESHNESS_CLASS.STALE)]
  ];
  return {
    type: 'unique-value',
    field: 'rendererKey',
    defaultSymbol: wrap(buildHydrometricCimSymbol(FRESHNESS_CLASS.STALE)),
    uniqueValueInfos: infos.map(([family, freshness, symbol]) => ({
      value: `${family}-${freshness}`,
      label: `${family} ${freshness}`,
      symbol: wrap(symbol)
    }))
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
      <div class="pi-station-legend__states">
        <span>Current</span>
        <span>Recent</span>
        <span>Stale</span>
        <span>Selected</span>
      </div>
    </div>`;
}
