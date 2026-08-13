/**
 * Runtime client-side FeatureLayer for Hydrometric + SWOB observation objects.
 */
import {
  addRuntimeLayer,
  getMapView,
  importArc
} from './spatial-arcgis-runtime.js';
import {
  buildProofStationRecords,
  formatProofHoverModel
} from './point-intelligence-station-model.js';
import {
  buildProofStationLabelingInfo,
  buildProofStationRenderer
} from './point-intelligence-station-symbols.js';
import {
  hideDistanceConnector,
  showDistanceConnector
} from './point-intelligence-aoi-layer.js';

export const POINT_INTEL_STATION_LAYER_ID = 'iqai-point-intel-stations';
export const POINT_INTEL_SELECTION_LAYER_ID = 'iqai-point-intel-selection';

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let stationLayer = null;
/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let selectionLayer = null;
/** @type {string | null} */
let selectedAssetKey = null;
/** @type {HTMLElement | null} */
let hoverEl = null;
/** @type {{ remove?: Function } | null} */
let pointerMoveHandle = null;
/** @type {{ remove?: Function } | null} */
let pointerLeaveHandle = null;
let pointerMoveTimer = 0;
let lastHoverKey = null;
/** @type {object[]} */
let currentStationRecords = [];

const STATION_FIELDS = Object.freeze([
  { name: 'OBJECTID', type: 'oid' },
  { name: 'assetKey', type: 'string' },
  { name: 'stationId', type: 'string' },
  { name: 'stationName', type: 'string' },
  { name: 'family', type: 'string' },
  { name: 'subtype', type: 'string' },
  { name: 'rendererKey', type: 'string' },
  { name: 'freshnessClass', type: 'string' },
  { name: 'primaryValue', type: 'double', nullable: true },
  { name: 'primaryUnit', type: 'string' },
  { name: 'primaryLabel', type: 'string' },
  { name: 'primaryDisplay', type: 'string' },
  { name: 'observationTime', type: 'string' },
  { name: 'retrievedTime', type: 'string' },
  { name: 'ageSeconds', type: 'double', nullable: true },
  { name: 'observationId', type: 'string' },
  { name: 'observationIds', type: 'string' },
  { name: 'provider', type: 'string' },
  { name: 'dataset', type: 'string' },
  { name: 'sourceUrl', type: 'string' },
  { name: 'sourceFamily', type: 'string' },
  { name: 'role', type: 'string' },
  { name: 'aoiClassification', type: 'string' },
  { name: 'aoiBoundaryDistanceMeters', type: 'double', nullable: true }
]);

function formatPrimaryDisplay(record) {
  if (record?.primaryValue == null || !record.primaryUnit) return '';
  const value = Number(record.primaryValue);
  if (!Number.isFinite(value)) return '';
  const formatted = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${formatted} ${record.primaryUnit}`;
}

function attributesFromRecord(record) {
  return {
    assetKey: record.assetKey,
    stationId: record.stationId || '',
    stationName: record.stationName || '',
    family: record.family,
    subtype: record.subtype || '',
    rendererKey: record.rendererKey,
    freshnessClass: record.freshnessClass,
    primaryValue: record.primaryValue,
    primaryUnit: record.primaryUnit || '',
    primaryLabel: record.primaryLabel || '',
    primaryDisplay: formatPrimaryDisplay(record),
    observationTime: record.observationTime || '',
    retrievedTime: record.retrievedTime || '',
    ageSeconds: record.ageSeconds,
    observationId: record.observationId,
    observationIds: (record.observationIds || []).join('|'),
    provider: record.provider || '',
    dataset: record.dataset || '',
    sourceUrl: record.sourceUrl || '',
      sourceFamily: record.subtype === 'hydrometric-registry'
      ? 'hydrometric'
      : (record.family === 'hydrometric' ? 'hydrometric-measurement' : 'weather'),
    role: 'pi-station',
    aoiClassification: record.aoiClassification || '',
    aoiBoundaryDistanceMeters: record.aoiBoundaryDistanceMeters
  };
}

async function ensureHoverHost(view) {
  if (hoverEl?.isConnected) return hoverEl;
  const host = view?.container;
  if (!host) return null;
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }
  hoverEl = document.createElement('div');
  hoverEl.className = 'pi-station-hover';
  hoverEl.hidden = true;
  hoverEl.setAttribute('role', 'status');
  host.appendChild(hoverEl);
  return hoverEl;
}

function hideHover() {
  lastHoverKey = null;
  if (hoverEl) {
    hoverEl.hidden = true;
    hoverEl.innerHTML = '';
  }
  if (selectedAssetKey) return;
  void hideDistanceConnector();
}

function showHover(record, event) {
  if (!hoverEl || !record) return;
  const model = formatProofHoverModel(record);
  if (!model) {
    hideHover();
    return;
  }
  hoverEl.innerHTML = `
    <div class="pi-station-hover__id">${escapeHtml(model.title)}</div>
    <div class="pi-station-hover__family">${escapeHtml(model.familyLabel)} · ${escapeHtml(model.freshnessClass)}</div>
    ${model.lines.map((line) => `<div class="pi-station-hover__line">${escapeHtml(line)}</div>`).join('')}
  `;
  hoverEl.hidden = false;
  const pad = 14;
  const x = Math.min((event?.x || 0) + pad, (hoverEl.parentElement?.clientWidth || 400) - 180);
  const y = Math.max(8, (event?.y || 0) - 8);
  hoverEl.style.left = `${Math.max(8, x)}px`;
  hoverEl.style.top = `${y}px`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function onPointerMove(event) {
  const view = getMapView();
  if (!view || !stationLayer || !currentStationRecords.length) {
    hideHover();
    return;
  }
  const response = await view.hitTest(event, { include: [stationLayer] });
  const hit = (response?.results || []).find((entry) => (
    entry?.graphic?.layer?.id === POINT_INTEL_STATION_LAYER_ID
    && entry?.graphic?.attributes?.role === 'pi-station'
  ));
  if (!hit?.graphic) {
    hideHover();
    return;
  }
  const key = hit.graphic.attributes.assetKey;
  const record = currentStationRecords.find((row) => row.assetKey === key);
  if (!record) {
    hideHover();
    return;
  }
  if (lastHoverKey === key && hoverEl && !hoverEl.hidden) {
    hoverEl.style.left = `${Math.max(8, event.x + 14)}px`;
    hoverEl.style.top = `${Math.max(8, event.y - 8)}px`;
    return;
  }
  lastHoverKey = key;
  showHover(record, event);
  if (record.aoiClassification === 'SUPPORTING_EXTERNAL') {
    void showDistanceConnector(record);
  } else if (!selectedAssetKey) {
    void hideDistanceConnector();
  }
}

function bindPointerHandlers(view) {
  pointerMoveHandle?.remove?.();
  pointerLeaveHandle?.remove?.();
  pointerMoveHandle = view.on('pointer-move', (event) => {
    window.clearTimeout(pointerMoveTimer);
    pointerMoveTimer = window.setTimeout(() => {
      void onPointerMove(event);
    }, 40);
  });
  pointerLeaveHandle = view.on('pointer-leave', () => hideHover());
}

export async function ensurePointIntelligenceStationLayer() {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap) return null;
  const existing = webMap.findLayerById(POINT_INTEL_STATION_LAYER_ID);
  if (existing) {
    stationLayer = existing;
    await ensureSelectionLayer();
    await ensureHoverHost(view);
    bindPointerHandlers(view);
    return stationLayer;
  }

  const [FeatureLayer, CIMSymbol, UniqueValueRenderer, UniqueValueInfo, LabelClass] = await Promise.all([
    importArc('@arcgis/core/layers/FeatureLayer.js'),
    importArc('@arcgis/core/symbols/CIMSymbol.js'),
    importArc('@arcgis/core/renderers/UniqueValueRenderer.js'),
    importArc('@arcgis/core/renderers/support/UniqueValueInfo.js'),
    importArc('@arcgis/core/layers/support/LabelClass.js')
  ]);

  const rendererSpec = buildProofStationRenderer(CIMSymbol);
  const renderer = new UniqueValueRenderer({
    field: rendererSpec.field,
    defaultSymbol: rendererSpec.defaultSymbol,
    uniqueValueInfos: rendererSpec.uniqueValueInfos.map((info) => new UniqueValueInfo({
      value: info.value,
      label: info.label,
      symbol: info.symbol,
      alternateSymbols: info.alternateSymbols || []
    }))
  });
  stationLayer = new FeatureLayer({
    id: POINT_INTEL_STATION_LAYER_ID,
    title: 'Point Intelligence stations',
    source: [],
    objectIdField: 'OBJECTID',
    fields: STATION_FIELDS,
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer,
    labelingInfo: buildProofStationLabelingInfo().map((info) => new LabelClass(info)),
    labelsVisible: true,
    popupEnabled: false,
    listMode: 'hide',
    outFields: ['*']
  });
  addRuntimeLayer(stationLayer);
  await stationLayer.load();
  await ensureSelectionLayer();
  await ensureHoverHost(view);
  bindPointerHandlers(view);
  return stationLayer;
}

async function ensureSelectionLayer() {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap) return null;
  const existing = webMap.findLayerById(POINT_INTEL_SELECTION_LAYER_ID);
  if (existing) {
    selectionLayer = existing;
    return selectionLayer;
  }
  const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
  selectionLayer = new GraphicsLayer({
    id: POINT_INTEL_SELECTION_LAYER_ID,
    title: 'Point Intelligence selection',
    listMode: 'hide',
    popupEnabled: false
  });
  addRuntimeLayer(selectionLayer);
  return selectionLayer;
}

async function drawAcquisitionRing(record) {
  const layer = await ensureSelectionLayer();
  if (!layer) return;
  layer.removeAll();
  if (!record) return;
  const [Graphic, Point, SimpleMarkerSymbol] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js')
  ]);
  layer.add(new Graphic({
    geometry: new Point({ longitude: record.longitude, latitude: record.latitude }),
    symbol: new SimpleMarkerSymbol({
      style: 'circle',
      color: [0, 0, 0, 0],
      size: 28,
      outline: { color: [236, 242, 246, 0.95], width: 1.25 }
    }),
    attributes: { role: 'pi-selection', assetKey: record.assetKey }
  }));
}

export async function clearPointIntelligenceStationLayer() {
  hideHover();
  clearStationSelection();
  currentStationRecords = [];
  const view = getMapView();
  if (!stationLayer) {
    stationLayer = view?.map?.findLayerById(POINT_INTEL_STATION_LAYER_ID) || null;
  }
  if (!selectionLayer) {
    selectionLayer = view?.map?.findLayerById(POINT_INTEL_SELECTION_LAYER_ID) || null;
  }
  selectionLayer?.removeAll?.();
  if (!stationLayer) return;
  const deleteAll = async () => {
    const ids = await stationLayer.queryObjectIds().catch(() => []);
    if (ids?.length) {
      await stationLayer.applyEdits({
        deleteFeatures: ids.map((objectId) => ({ objectId }))
      });
    }
    const queried = await stationLayer.queryFeatures({ where: '1=1', returnGeometry: false }).catch(() => null);
    const leftovers = queried?.features || [];
    if (leftovers.length) {
      await stationLayer.applyEdits({ deleteFeatures: leftovers });
    }
  };
  try {
    await deleteAll();
  } catch {
    // ignore empty-layer query failures
  }
}

export async function renderPointIntelligenceStationLayer(results = [], focusState = null, options = {}) {
  hideHover();
  const layer = await ensurePointIntelligenceStationLayer();
  if (!layer) return [];

  const records = Array.isArray(options.stationRecords)
    ? options.stationRecords
    : buildProofStationRecords(results, {
      retrievedAt: options.retrievedAt,
      nowMs: options.nowMs
    });
  currentStationRecords = records;

  const [Graphic, Point] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js')
  ]);

  const ids = await layer.queryObjectIds().catch(() => []);
  if (ids?.length) {
    await layer.applyEdits({
      deleteFeatures: ids.map((objectId) => ({ objectId }))
    });
  }

  if (records.length) {
    const addFeatures = records.map((record) => new Graphic({
      geometry: new Point({
        longitude: record.longitude,
        latitude: record.latitude
      }),
      attributes: attributesFromRecord(record)
    }));
    await layer.applyEdits({ addFeatures });
  }

  await applyStationSelection(focusState);
  return records;
}

function escapeWhereValue(value) {
  return String(value || '').replace(/'/g, "''");
}

export async function applyStationSelection(focusState = null) {
  const view = getMapView();
  const layer = stationLayer || view?.map?.findLayerById(POINT_INTEL_STATION_LAYER_ID);
  if (!view || !layer) return;

  const focusedId = focusState?.focusedObservationId || null;
  const focusedFamily = focusState?.focusedFamily || null;
  const selected = currentStationRecords.find((record) => (
    (focusedId && record.observationIds.includes(focusedId))
    || (focusedId && record.observationId === focusedId)
  ));

  selectedAssetKey = selected?.assetKey || null;
  await drawAcquisitionRing(selected || null);
  if (selected?.aoiClassification === 'SUPPORTING_EXTERNAL') {
    await showDistanceConnector(selected);
  } else {
    await hideDistanceConnector();
  }

  if (!selected && !focusedFamily) {
    layer.featureEffect = null;
    return;
  }

  const proofFocus = focusedFamily === 'hydrometric-measurement' || focusedFamily === 'hydrometric'
    ? 'hydrometric'
    : focusedFamily === 'weather' ? 'weather' : null;

  if (selectedAssetKey) {
    layer.featureEffect = {
      filter: { where: `assetKey = '${escapeWhereValue(selectedAssetKey)}'` },
      includedEffect: 'drop-shadow(0px, 0px, 2px, rgba(245,248,250,0.78))',
      excludedEffect: 'opacity(0.58)'
    };
    return;
  }

  if (proofFocus) {
    layer.featureEffect = {
      filter: { where: `family = '${escapeWhereValue(proofFocus)}'` },
      excludedEffect: 'opacity(0.58)'
    };
    return;
  }

  if (focusedFamily) {
    layer.featureEffect = {
      filter: { where: "assetKey = '__none__'" },
      excludedEffect: 'opacity(0.58)'
    };
  }
}

export function clearStationSelection() {
  selectedAssetKey = null;
  selectionLayer?.removeAll?.();
  if (stationLayer) stationLayer.featureEffect = null;
}

function stationHitFromRecord(record, graphic = null) {
  if (!record) return null;
  return {
    observationId: record.observationId,
    family: record.subtype === 'hydrometric-registry'
      ? 'hydrometric'
      : (record.family === 'hydrometric' ? 'hydrometric-measurement' : 'weather'),
    assetKey: record.assetKey,
    observationIds: record.observationIds || [],
    graphic,
    station: true
  };
}

export async function hitTestPointIntelligenceStation(mapEvent) {
  const view = getMapView();
  const layer = stationLayer || view?.map?.findLayerById(POINT_INTEL_STATION_LAYER_ID);
  if (!view?.hitTest || !layer) return null;
  const include = [layer, selectionLayer].filter(Boolean);
  const response = await view.hitTest(mapEvent, { include });
  const hit = (response?.results || []).find((entry) => {
    const layerId = entry?.graphic?.layer?.id;
    const role = entry?.graphic?.attributes?.role;
    return (layerId === POINT_INTEL_STATION_LAYER_ID && role === 'pi-station')
      || (layerId === POINT_INTEL_SELECTION_LAYER_ID && role === 'pi-selection');
  });
  if (!hit?.graphic) return null;
  const attrs = hit.graphic.attributes || {};
  const record = currentStationRecords.find((row) => row.assetKey === attrs.assetKey)
    || findStationRecordByObservationId(attrs.observationId);
  if (record) return stationHitFromRecord(record, hit.graphic);
  if (!attrs.observationId) return null;
  return {
    observationId: attrs.observationId,
    family: attrs.sourceFamily || (attrs.family === 'hydrometric' ? 'hydrometric-measurement' : attrs.family),
    assetKey: attrs.assetKey,
    observationIds: String(attrs.observationIds || '').split('|').filter(Boolean),
    graphic: hit.graphic,
    station: true
  };
}

export function findStationRecordByObservationId(observationId) {
  if (!observationId) return null;
  return currentStationRecords.find((record) => (
    record.observationId === observationId
    || record.observationIds.includes(observationId)
  )) || null;
}

export function getPointIntelligenceStationLayer() {
  return stationLayer;
}

export function getCurrentStationRecords() {
  return currentStationRecords.slice();
}

export async function previewPointIntelligenceStationHover(assetKey, event = { x: 18, y: 72 }) {
  const view = getMapView();
  await ensureHoverHost(view);
  const record = currentStationRecords.find((row) => row.assetKey === assetKey);
  if (!record) return false;
  lastHoverKey = assetKey;
  showHover(record, event);
  if (record.aoiClassification === 'SUPPORTING_EXTERNAL') {
    await showDistanceConnector(record);
  }
  return true;
}
