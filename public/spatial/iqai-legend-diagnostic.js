/**
 * TEMPORARY development diagnostic: native ArcGIS Legend vs IQAI Results legend.
 * NOT a product feature — isolates symbol fidelity failures scientifically.
 */

import { importArc, getMapView, getWebMap } from './spatial-arcgis-runtime.js';
import { DETERMINISTIC_RESULTS_LAYER_ID } from './results-table-model.js';
import {
  findWebMapLayerByServiceUrl,
  getOsmNaAmenitiesSourceDef
} from './source-presentation.js';

const SAMPLE_CATEGORIES = ['bench', 'restaurant', 'cafe'];
const NAKED_IMG_HOST_ID = 'iqai-legend-diagnostic-naked-imgs';

/** @type {import('@arcgis/core/widgets/Legend').default | null} */
let nativeDiagnosticLegend = null;
/** @type {HTMLElement | null} */
let nativeDiagnosticHost = null;

function cloneJson(value) {
  if (value == null) return null;
  if (typeof value.toJSON === 'function') return value.toJSON();
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function cssSnapshot(el) {
  if (!el || typeof window === 'undefined') return null;
  const cs = window.getComputedStyle(el);
  return {
    filter: cs.filter,
    opacity: cs.opacity,
    background: cs.background,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    mixBlendMode: cs.mixBlendMode,
    mask: cs.mask,
    maskImage: cs.maskImage,
    objectFit: cs.objectFit,
    width: cs.width,
    height: cs.height
  };
}

function imgMetrics(img) {
  if (!img) return null;
  return {
    tagName: img.tagName,
    src: img.getAttribute('src'),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    width: img.width,
    height: img.height,
    complete: img.complete,
    className: img.className
  };
}

/**
 * Sample top-left pixel luminance to detect black/broken renders.
 * @param {HTMLImageElement} img
 */
function imageAppearsBlack(img) {
  if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return false;
    return r < 16 && g < 16 && b < 16;
  } catch {
    return null;
  }
}

function visualStatus(img) {
  if (!img) return 'missing';
  if (!img.complete) return 'loading';
  if (!img.naturalWidth || !img.naturalHeight) return 'broken';
  if (imageAppearsBlack(img)) return 'black';
  return 'loaded';
}

function classifyCase(mapStatus, nativeStatus, iqaiStatus) {
  const mapOk = mapStatus === 'loaded';
  const nativeOk = nativeStatus === 'loaded';
  const iqaiOk = iqaiStatus === 'loaded';
  if (mapOk && nativeOk && iqaiOk) return 'CASE_D';
  if (mapOk && nativeOk && !iqaiOk) return 'CASE_A';
  if (mapOk && !nativeOk && !iqaiOk) return 'CASE_B';
  if (!mapOk && !nativeOk) return 'CASE_C';
  return 'CASE_INDETERMINATE';
}

function countNativeLegendClasses(legend) {
  const infos = legend?.viewModel?.activeLayerInfos?.toArray?.()
    || legend?.activeLayerInfos?.toArray?.()
    || [];
  let count = 0;
  const labels = [];
  for (const info of infos) {
    const elements = info.legendElements?.toArray?.() || info.legendElements || [];
    for (const element of elements) {
      count += 1;
      if (element?.label) labels.push(String(element.label));
    }
  }
  return { count, labels };
}

function findRendererClass(renderer, categoryValue) {
  if (!renderer || renderer.type !== 'uniqueValue') return null;
  const target = String(categoryValue).trim().toLowerCase();
  const info = (renderer.uniqueValueInfos || []).find(
    (entry) => String(entry.value).trim().toLowerCase() === target
  );
  if (!info) return null;
  const symbol = info.symbol;
  return {
    rendererValue: info.value,
    rendererLabel: info.label || null,
    symbolType: symbol?.type || null,
    declaredClass: symbol?.declaredClass || null,
    symbolJson: cloneJson(symbol),
    symbolUrl: symbol?.url || null,
    imageDataPresent: Boolean(symbol?.imageData),
    imageDataLength: symbol?.imageData ? String(symbol.imageData).length : 0,
    contentType: symbol?.contentType || null,
    width: symbol?.width ?? symbol?.size ?? null,
    height: symbol?.height ?? symbol?.size ?? null
  };
}

function inspectIqaiChip(categoryValue) {
  if (typeof document === 'undefined') return null;
  const chip = document.querySelector(`.results-category-chip[data-category="${categoryValue}"]`);
  const img = chip?.querySelector('img.results-category-chip__symbol') || null;
  const parent = img?.parentElement || chip;
  return {
    chipFound: Boolean(chip),
    img: imgMetrics(img),
    chipCss: cssSnapshot(chip),
    imgCss: cssSnapshot(img),
    parentCss: cssSnapshot(parent),
    visualStatus: visualStatus(img)
  };
}

function mountNakedImgProof(categoryValue, url) {
  if (typeof document === 'undefined' || !url) return null;
  let host = document.getElementById(NAKED_IMG_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = NAKED_IMG_HOST_ID;
    host.className = 'iqai-legend-diagnostic-naked-host';
    host.innerHTML = '<div class="iqai-legend-diagnostic-naked-title">NAKED IMG PROOF (no IQAI CSS)</div>';
    document.body.appendChild(host);
  }
  let wrap = host.querySelector(`[data-naked-category="${categoryValue}"]`);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.dataset.nakedCategory = categoryValue;
    wrap.className = 'iqai-legend-diagnostic-naked-item';
    host.appendChild(wrap);
  }
  wrap.innerHTML = `<div class="iqai-legend-diagnostic-naked-label">${categoryValue}</div>`;
  const img = document.createElement('img');
  img.src = url;
  img.alt = categoryValue;
  img.width = 14;
  img.height = 14;
  wrap.appendChild(img);
  return {
    url,
    visualStatus: visualStatus(img),
    appearsBlack: imageAppearsBlack(img),
    metrics: imgMetrics(img)
  };
}

function findNativeLegendSymbolImg(categoryValue) {
  if (!nativeDiagnosticHost) return null;
  const labelNeedle = String(categoryValue).replace(/_/g, ' ').toLowerCase();
  const imgs = [...nativeDiagnosticHost.querySelectorAll('img')];
  const match = imgs.find((img) => {
    const row = img.closest('.esri-legend__layer-row, .esri-legend__layer-cell, [class*="legend"]');
    const text = (row?.textContent || img.parentElement?.textContent || '').toLowerCase();
    return text.includes(labelNeedle);
  });
  return match || imgs[0] || null;
}

async function mountNativeDiagnosticLegend(view, displayLayer, host) {
  if (!view || !displayLayer || !host) return null;
  nativeDiagnosticHost = host;
  host.replaceChildren();

  const Legend = await importArc('@arcgis/core/widgets/Legend.js');
  if (nativeDiagnosticLegend) {
    nativeDiagnosticLegend.destroy();
    nativeDiagnosticLegend = null;
  }

  nativeDiagnosticLegend = new Legend({
    view,
    container: host,
    layerInfos: [{
      layer: displayLayer,
      title: displayLayer.title || 'IQAI Deterministic Results',
      respectLayerDefinitionExpression: true
    }]
  });

  await nativeDiagnosticLegend.when();
  try {
    await view.whenLayerView(displayLayer);
  } catch {
    // continue
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  return nativeDiagnosticLegend;
}

function rendererClassCount(renderer) {
  if (!renderer) return 0;
  if (renderer.type === 'uniqueValue') return (renderer.uniqueValueInfos || []).length;
  if (renderer.type === 'simple') return 1;
  return 0;
}

/**
 * @param {{
 *   mapResult?: object,
 *   iqaiLegend?: object | null,
 *   presentation?: object | null,
 *   nativeHost?: HTMLElement | null,
 *   iqaiHost?: HTMLElement | null
 * }} options
 */
export async function refreshLegendDiagnostic(options = {}) {
  const view = getMapView();
  const webMap = getWebMap();
  const displayLayer = webMap?.findLayerById(DETERMINISTIC_RESULTS_LAYER_ID) || null;
  const sourceDef = getOsmNaAmenitiesSourceDef();
  const sourceLayer = webMap ? findWebMapLayerByServiceUrl(webMap, sourceDef.serviceUrl) : null;

  let displayRenderer = null;
  let sourceRenderer = null;
  try {
    if (displayLayer && !displayLayer.loaded) await displayLayer.load();
    displayRenderer = cloneJson(displayLayer?.renderer);
  } catch {
    displayRenderer = null;
  }
  try {
    if (sourceLayer && !sourceLayer.loaded) await sourceLayer.load();
    sourceRenderer = cloneJson(sourceLayer?.renderer);
  } catch {
    sourceRenderer = null;
  }

  let nativeLegend = null;
  if (view && displayLayer && options.nativeHost) {
    nativeLegend = await mountNativeDiagnosticLegend(view, displayLayer, options.nativeHost);
  }

  const nativeCounts = countNativeLegendClasses(nativeLegend);
  const iqaiLegend = options.iqaiLegend || (typeof window !== 'undefined' ? window.__IQAI_RESULT_LEGEND__ : null);

  if (typeof window !== 'undefined') {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
  }

  const samples = {};
  for (const categoryValue of SAMPLE_CATEGORIES) {
    const rendererSample = findRendererClass(displayRenderer, categoryValue);
    const iqaiEntry = iqaiLegend?.entries?.find(
      (entry) => String(entry.categoryValue).trim().toLowerCase() === categoryValue
    ) || iqaiLegend?.categories?.find(
      (entry) => String(entry.value).trim().toLowerCase() === categoryValue
    ) || null;
    const iqaiUrl = iqaiEntry?.symbolUrl || null;
    const naked = mountNakedImgProof(categoryValue, iqaiUrl);
    const chip = inspectIqaiChip(categoryValue);
    const nativeImg = findNativeLegendSymbolImg(categoryValue);

    const chipImg = chip?.img
      ? document.querySelector(`.results-category-chip[data-category="${categoryValue}"] img`)
      : null;
    const chipBlack = chipImg ? imageAppearsBlack(chipImg) : null;

    samples[categoryValue] = {
      rendererValue: rendererSample?.rendererValue || categoryValue,
      rendererLabel: rendererSample?.rendererLabel || iqaiEntry?.displayLabel || iqaiEntry?.label || null,
      symbolType: rendererSample?.symbolType || iqaiEntry?.sourceSymbolType || null,
      declaredClass: rendererSample?.declaredClass || null,
      symbolJson: rendererSample?.symbolJson || null,
      symbolUrl: rendererSample?.symbolUrl || null,
      imageDataPresent: rendererSample?.imageDataPresent ?? Boolean(iqaiEntry?.sourceSymbol?.imageData),
      imageDataLength: rendererSample?.imageDataLength || 0,
      contentType: rendererSample?.contentType || null,
      width: rendererSample?.width || null,
      height: rendererSample?.height || null,
      iqaiUrlPresent: Boolean(iqaiUrl),
      iqaiUrl: iqaiUrl ? `${iqaiUrl.slice(0, 80)}…` : null,
      rawImgRendersCorrectly: naked?.visualStatus === 'loaded' && naked?.appearsBlack === false,
      iqaiChipRendersCorrectly: chip?.visualStatus === 'loaded' && chipBlack === false,
      nativeArcgisLegendRendersCorrectly: visualStatus(nativeImg) === 'loaded' && imageAppearsBlack(nativeImg) === false,
      nakedProof: naked,
      iqaiChipInspect: chip,
      nativeImgMetrics: imgMetrics(nativeImg)
    };
  }

  const benchSample = samples.bench;
  const mapVisual = displayLayer?.visible !== false ? 'assumed_correct_if_map_visible' : 'hidden';
  const nativeVisual = benchSample?.nativeArcgisLegendRendersCorrectly ? 'loaded' : 'black_or_missing';
  const iqaiVisual = benchSample?.iqaiChipRendersCorrectly ? 'loaded' : 'black_or_missing';

  const diagnostic = {
    classification: classifyCase(
      mapVisual.includes('correct') ? 'loaded' : 'black',
      nativeVisual === 'loaded' ? 'loaded' : 'black',
      iqaiVisual === 'loaded' ? 'loaded' : 'black'
    ),
    mapSymbolStatus: displayLayer ? mapVisual : 'layer_missing',
    nativeArcgisLegendStatus: nativeCounts.count > 0 ? nativeVisual : 'empty',
    iqaiLegendStatus: (iqaiLegend?.entries?.length || 0) > 0 ? iqaiVisual : 'empty',
    displayLayerTitle: displayLayer?.title || null,
    displayLayerId: displayLayer?.id || null,
    displayLayerUrl: displayLayer?.url || null,
    rendererType: displayRenderer?.type || null,
    rendererField: displayRenderer?.field1 || iqaiLegend?.field || 'amenity',
    sourceClassCount: rendererClassCount(sourceRenderer),
    displayClassCount: rendererClassCount(displayRenderer),
    deterministicResultCategoryCount: iqaiLegend?.resultCategoryCount ?? iqaiLegend?.entries?.length ?? null,
    nativeLegendClassCount: nativeCounts.count,
    nativeLegendLabels: nativeCounts.labels,
    iqaiLegendClassCount: iqaiLegend?.entries?.length ?? iqaiLegend?.categories?.length ?? null,
    respectsDefinitionExpression: true,
    definitionExpression: displayLayer?.definitionExpression || null,
    scopedRendererDiffersFromWebMap: JSON.stringify(displayRenderer) !== JSON.stringify(sourceRenderer),
    samples,
    recommendedArchitecture: null
  };

  if (diagnostic.classification === 'CASE_A') {
    diagnostic.recommendedArchitecture = 'Use ArcGIS LegendViewModel / legendElements for authoritative symbols; IQAI supplies counts + filter state only.';
  } else if (diagnostic.classification === 'CASE_B') {
    diagnostic.recommendedArchitecture = 'Inspect scoped display layer renderer clone and ArcGIS/CSS theming before any IQAI legend work.';
  } else if (diagnostic.classification === 'CASE_C') {
    diagnostic.recommendedArchitecture = 'Fix authoritative map/scoped display renderer first; legend work blocked.';
  } else if (diagnostic.classification === 'CASE_D') {
    diagnostic.recommendedArchitecture = 'Verify across reload/radius; then adopt ArcGIS-native legend representation with IQAI counts.';
  } else {
    diagnostic.recommendedArchitecture = 'Review diagnostic samples — classification indeterminate from automation; inspect browser A/B panel.';
  }

  if (typeof window !== 'undefined') {
    window.__IQAI_LEGEND_DIAGNOSTIC__ = diagnostic;
  }

  if (options.iqaiHost && iqaiLegend?.categories?.length) {
    options.iqaiHost.innerHTML = iqaiLegend.categories.map((entry) => {
      const src = entry.symbolUrl ? ` src="${entry.symbolUrl}"` : '';
      const img = entry.symbolUrl
        ? `<img class="iqai-legend-diagnostic-iqai-symbol"${src} alt="" width="14" height="14" />`
        : '<span class="iqai-legend-diagnostic-iqai-missing">?</span>';
      return `<div class="iqai-legend-diagnostic-iqai-row">${img}<span>${entry.label} ${entry.count}</span></div>`;
    }).join('');
  }

  return diagnostic;
}

export function clearLegendDiagnostic() {
  if (nativeDiagnosticLegend) {
    nativeDiagnosticLegend.destroy();
    nativeDiagnosticLegend = null;
  }
  nativeDiagnosticHost = null;
  if (typeof document !== 'undefined') {
    document.getElementById(NAKED_IMG_HOST_ID)?.remove();
  }
  if (typeof window !== 'undefined') {
    window.__IQAI_LEGEND_DIAGNOSTIC__ = null;
  }
}

export {
  classifyCase,
  cssSnapshot,
  imageAppearsBlack,
  visualStatus
};
