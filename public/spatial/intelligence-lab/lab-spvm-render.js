/**
 * SPVM layer renderers for intelligence lab (browser-side, no paid services).
 */

const CATEGORY_DEFS = [
  { french: 'Vol de véhicule à moteur', color: [47, 79, 132, 0.92] },
  { french: 'Vol dans / sur véhicule à moteur', color: [0, 122, 194, 0.92] },
  { french: 'Introduction', color: [166, 97, 26, 0.92] },
  { french: 'Méfait', color: [117, 112, 179, 0.92] },
  { french: 'Vols qualifiés', color: [214, 39, 40, 0.92] }
];

function markerSymbol(color) {
  return {
    type: 'simple-marker',
    style: 'circle',
    color,
    size: 7,
    outline: { color: [255, 255, 255, 0.9], width: 0.75 }
  };
}

export function buildIncidentsRenderer() {
  return {
    type: 'unique-value',
    field: 'category',
    defaultSymbol: markerSymbol([120, 120, 120, 0.85]),
    uniqueValueInfos: CATEGORY_DEFS.map((def) => ({
      value: def.french,
      symbol: markerSymbol(def.color)
    }))
  };
}

export function buildClusterReduction() {
  return {
    type: 'cluster',
    clusterRadius: '64px',
    clusterMinSize: '24px',
    clusterMaxSize: '56px',
    popupEnabled: false,
    labelingInfo: [{
      deconflictionStrategy: 'none',
      labelExpressionInfo: { expression: 'Text($feature.cluster_count, "#,###")' },
      symbol: {
        type: 'text',
        color: [20, 20, 20, 0.95],
        font: { size: 10, weight: 'bold', family: 'Segoe UI' },
        haloColor: [255, 255, 255, 0.85],
        haloSize: 1
      },
      labelPlacement: 'center-center'
    }]
  };
}

export function buildHeatmapReduction() {
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

export function applySpvmPresentation(layer, gisMode) {
  if (!layer) return;
  if (gisMode === 'heatmap') {
    layer.renderer = null;
    layer.featureReduction = buildHeatmapReduction();
  } else if (gisMode === 'clusters') {
    layer.renderer = buildIncidentsRenderer();
    layer.featureReduction = buildClusterReduction();
  } else {
    layer.renderer = buildIncidentsRenderer();
    layer.featureReduction = null;
  }
}
