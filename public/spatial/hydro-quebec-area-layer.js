/**
 * Hydro-Québec outage area polygons — shared with point feed in hydro-quebec-outages.js
 */
import {
  importArc,
  getWebMap,
  getMapView
} from './spatial-arcgis-runtime.js';
import {
  HYDRO_AREAS_LAYER_ID,
  HYDRO_AREAS_LAYER_TITLE,
  HYDRO_SOURCE_NAME
} from './hydro-quebec-outages-config.js';

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let hydroAreasLayer = null;
/** @type {Set<string>} */
let trackedAreaIds = new Set();

export function objectIdFromAreaId(areaId, fallback) {
  let hash = 0;
  const text = String(areaId || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || fallback;
}

export function stableAreaObjectId(areaId, fallback = 1) {
  return objectIdFromAreaId(areaId, fallback);
}

export function planHydroAreaEdits(areas, knownAreaIds) {
  const currentIds = new Set();
  const toAdd = [];
  const toUpdate = [];

  for (const area of areas || []) {
    const areaId = String(area?.areaId || '').trim();
    if (!areaId) continue;
    if (currentIds.has(areaId)) continue;
    currentIds.add(areaId);
    if (knownAreaIds.has(areaId)) toUpdate.push(areaId);
    else toAdd.push(areaId);
  }

  const toDelete = [];
  for (const areaId of knownAreaIds) {
    if (!currentIds.has(areaId)) toDelete.push(areaId);
  }

  return { toAdd, toUpdate, toDelete, currentIds };
}

export function buildAreaAttributes(area, objectId, outageLookup = null) {
  const linked = area.outageId && outageLookup?.get(area.outageId);
  return {
    OBJECTID: objectId,
    areaId: String(area.areaId || ''),
    outageId: area.outageId || '',
    customersAffected: linked?.customersAffected ?? null,
    outageStart: linked?.outageStart || '',
    estimatedRestoration: linked?.estimatedRestoration || '',
    crewStatusLabel: linked?.crewStatusLabel || '',
    causeCategory: linked?.causeCategory || '',
    municipalityId: linked?.municipalityId || '',
    feedTimestamp: area.feedTimestamp || '',
    sourceVersion: area.sourceVersion || '',
    sourceName: area.sourceName || HYDRO_SOURCE_NAME,
    spatialPrecision: area.spatialPrecision || 'Approximate outage area',
    iqaiType: 'hydro_quebec_outage_area'
  };
}

function buildAreaGraphic(area, objectId, Graphic, Polygon, outageLookup) {
  return new Graphic({
    geometry: new Polygon({
      rings: area.geometry.coordinates,
      spatialReference: { wkid: 4326 }
    }),
    attributes: buildAreaAttributes(area, objectId, outageLookup)
  });
}

function applyAreaDataToGraphic(graphic, area, objectId, Polygon, outageLookup) {
  graphic.geometry = new Polygon({
    rings: area.geometry.coordinates,
    spatialReference: { wkid: 4326 }
  });
  Object.assign(graphic.attributes, buildAreaAttributes(area, objectId, outageLookup));
  return graphic;
}

async function queryExistingAreaMaps(layer) {
  const featureByAreaId = new Map();
  const result = await layer.queryFeatures({
    where: '1=1',
    outFields: ['*'],
    returnGeometry: true
  });
  for (const feature of result.features || []) {
    const areaId = String(feature.attributes?.areaId || '').trim();
    if (areaId) featureByAreaId.set(areaId, feature);
  }
  return { featureByAreaId, queriedCount: result.features?.length ?? 0 };
}

export async function prepareHydroAreaEditBundle(layer, payload, knownAreaIds, modules, outageLookup) {
  const { Graphic, Polygon } = modules;
  const areas = payload.areas || [];
  const plan = planHydroAreaEdits(areas, knownAreaIds);
  const areaById = new Map(areas.map((area) => [area.areaId, area]));
  const { featureByAreaId, queriedCount } = await queryExistingAreaMaps(layer);

  const addFeatures = [];
  const updateFeatures = [];
  let fallbackId = 1;

  for (const areaId of plan.toAdd) {
    const area = areaById.get(areaId);
    if (!area) continue;
    const objectId = stableAreaObjectId(areaId, fallbackId);
    fallbackId += 1;
    addFeatures.push(buildAreaGraphic(area, objectId, Graphic, Polygon, outageLookup));
  }

  for (const areaId of plan.toUpdate) {
    const area = areaById.get(areaId);
    if (!area) continue;
    const existingGraphic = featureByAreaId.get(areaId);
    if (!existingGraphic) continue;
    const objectId = existingGraphic.attributes?.OBJECTID ?? stableAreaObjectId(areaId, fallbackId);
    fallbackId += 1;
    applyAreaDataToGraphic(existingGraphic, area, objectId, Polygon, outageLookup);
    updateFeatures.push(existingGraphic);
  }

  const deleteFeatures = plan.toDelete.map((areaId) => ({
    objectId: stableAreaObjectId(areaId, 1)
  }));

  return { plan, addFeatures, updateFeatures, deleteFeatures, queriedCount };
}

export async function ensureHydroAreasLayer(modules, hydroGroup) {
  const webMap = getWebMap();
  if (!webMap || !hydroGroup) return null;

  const existing = hydroGroup.layers?.find?.((layer) => layer.id === HYDRO_AREAS_LAYER_ID);
  if (existing) {
    hydroAreasLayer = existing;
    return hydroAreasLayer;
  }

  const { FeatureLayer } = modules;
  const layer = new FeatureLayer({
    id: HYDRO_AREAS_LAYER_ID,
    title: HYDRO_AREAS_LAYER_TITLE,
    source: [],
    objectIdField: 'OBJECTID',
    fields: [
      { name: 'OBJECTID', type: 'oid' },
      { name: 'areaId', type: 'string' },
      { name: 'outageId', type: 'string' },
      { name: 'customersAffected', type: 'integer', nullable: true },
      { name: 'outageStart', type: 'string' },
      { name: 'estimatedRestoration', type: 'string' },
      { name: 'crewStatusLabel', type: 'string' },
      { name: 'causeCategory', type: 'string' },
      { name: 'municipalityId', type: 'string' },
      { name: 'feedTimestamp', type: 'string' },
      { name: 'sourceVersion', type: 'string' },
      { name: 'sourceName', type: 'string' },
      { name: 'spatialPrecision', type: 'string' },
      { name: 'iqaiType', type: 'string' }
    ],
    geometryType: 'polygon',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [245, 106, 0, 0.22],
        outline: { color: [220, 38, 38, 0.85], width: 1.25 }
      }
    },
    popupEnabled: true,
    popupTemplate: {
      title: 'Hydro-Québec outage area',
      outFields: ['*'],
      content: [{
        type: 'text',
        text: '<div><strong>HYDRO-QUÉBEC OUTAGE AREA</strong></div>'
      }, {
        type: 'fields',
        fieldInfos: [
          { fieldName: 'spatialPrecision', label: 'Affected area' },
          { fieldName: 'customersAffected', label: 'Customers affected' },
          { fieldName: 'outageStart', label: 'Started' },
          { fieldName: 'estimatedRestoration', label: 'Estimated restoration' },
          { fieldName: 'crewStatusLabel', label: 'Crew status' },
          { fieldName: 'causeCategory', label: 'Cause' },
          { fieldName: 'sourceName', label: 'Source' },
          { fieldName: 'feedTimestamp', label: 'Feed timestamp' },
          { fieldName: 'sourceVersion', label: 'Feed version' }
        ]
      }]
    },
    listMode: 'show',
    visible: false
  });

  await layer.load();
  hydroGroup.add(layer, 0);
  hydroAreasLayer = layer;
  return layer;
}

export async function applyHydroAreaEdits(layer, payload, modules, outageLookup) {
  const bundle = await prepareHydroAreaEditBundle(layer, payload, trackedAreaIds, modules, outageLookup);
  const { plan, addFeatures, updateFeatures, deleteFeatures, queriedCount } = bundle;

  if (!addFeatures.length && !updateFeatures.length && !deleteFeatures.length) {
    const rendered = await layer.queryFeatureCount();
    return {
      added: 0,
      updated: 0,
      deleted: 0,
      rendered,
      queriedCount,
      polygonCount: payload.polygonCount ?? rendered
    };
  }

  const editResult = await layer.applyEdits({
    addFeatures,
    updateFeatures,
    deleteFeatures
  });

  const failed = (results = []) => results.some((result) => result?.error != null);
  if (
    failed(editResult?.addFeatureResults)
    || failed(editResult?.updateFeatureResults)
    || failed(editResult?.deleteFeatureResults)
  ) {
    throw new Error('Hydro area applyEdits returned errors');
  }

  trackedAreaIds = plan.currentIds;
  const rendered = await layer.queryFeatureCount();
  return {
    added: addFeatures.length,
    updated: updateFeatures.length,
    deleted: deleteFeatures.length,
    rendered,
    queriedCount,
    polygonCount: payload.polygonCount ?? rendered
  };
}

export function getHydroOutageAreasLayer() {
  return hydroAreasLayer;
}

export function __resetHydroAreaTrackingForTests(ids = new Set()) {
  trackedAreaIds = new Set(ids);
  hydroAreasLayer = null;
}
