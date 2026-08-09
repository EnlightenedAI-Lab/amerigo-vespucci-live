/**
 * SPVM crime layer renderers — unique-value incidents + clustering / heatmap density.
 */

import { importArc } from './spatial-arcgis-runtime.js';
import {
  SPVM_CATEGORY_DEFS,
  englishLabelForCategory
} from './spvm-crime-taxonomy.js';

function markerSymbol(def) {
  return {
    type: 'simple-marker',
    style: 'circle',
    color: def.color,
    size: def.size || 6,
    outline: {
      color: def.outline || [255, 255, 255, 0.9],
      width: 0.75
    }
  };
}

export function buildSpvmIncidentsRenderer() {
  return {
    type: 'unique-value',
    field: 'category',
    defaultSymbol: markerSymbol({
      color: [120, 120, 120, 0.85],
      outline: [255, 255, 255, 0.9]
    }),
    uniqueValueInfos: SPVM_CATEGORY_DEFS.map((def) => ({
      value: def.french,
      label: def.english,
      symbol: markerSymbol(def)
    }))
  };
}

export function buildSpvmClusterReduction() {
  return {
    type: 'cluster',
    clusterRadius: '64px',
    clusterMinSize: '24px',
    clusterMaxSize: '56px',
    labelingInfo: [{
      deconflictionStrategy: 'none',
      labelExpressionInfo: {
        expression: 'Text($feature.cluster_count, "#,###")'
      },
      symbol: {
        type: 'text',
        color: [20, 20, 20, 0.95],
        font: { size: 10, weight: 'bold', family: 'Arial' },
        haloColor: [255, 255, 255, 0.85],
        haloSize: 1
      },
      labelPlacement: 'center-center'
    }]
  };
}

export function buildSpvmHeatmapReduction() {
  return {
    type: 'heatmap',
    renderer: {
      type: 'heatmap',
      colorStops: [
        { color: [44, 82, 130, 0], ratio: 0 },
        { color: [69, 117, 180, 0.45], ratio: 0.25 },
        { color: [254, 224, 144, 0.65], ratio: 0.55 },
        { color: [215, 48, 39, 0.85], ratio: 0.85 },
        { color: [165, 0, 38, 1], ratio: 1 }
      ],
      maxDensity: 0.012,
      minDensity: 0,
      radius: 18
    }
  };
}

/**
 * @param {import('@arcgis/core/layers/GeoJSONLayer').default} layer
 * @param {'INCIDENTS' | 'DENSITY'} viewMode
 */
export async function applySpvmLayerPresentation(layer, viewMode = 'INCIDENTS') {
  if (!layer) return;
  if (viewMode === 'DENSITY') {
    layer.renderer = null;
    layer.featureReduction = buildSpvmHeatmapReduction();
  } else {
    layer.renderer = buildSpvmIncidentsRenderer();
    layer.featureReduction = buildSpvmClusterReduction();
  }
}

/**
 * @param {import('@arcgis/core/MapView').default} view
 */
export async function renderSpvmLegendHtml(view) {
  if (!view?.container) return '';
  const Legend = await importArc('@arcgis/core/widgets/Legend.js');
  const legend = new Legend({
    view,
    container: document.createElement('div')
  });
  await legend.when();
  const layer = view.map?.allLayers?.find((entry) => entry.id === 'spvm-recent-crime');
  if (!layer?.visible) return '';
  const infos = legend.activeLayerInfos?.toArray?.() || [];
  const spvmInfo = infos.find((info) => info.layer?.id === 'spvm-recent-crime');
  if (!spvmInfo) return '';
  return `<div class="operational-legend-spvm">${legend.container?.innerHTML || ''}</div>`;
}

export function buildSpvmLegendEntries() {
  return SPVM_CATEGORY_DEFS.map((def) => ({
    label: def.english,
    french: def.french,
    color: `rgb(${def.color.slice(0, 3).join(',')})`
  }));
}
