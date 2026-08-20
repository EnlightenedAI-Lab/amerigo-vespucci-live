/**
 * Reserved imagery plane + one observation WebTileLayer.
 *
 * The observation layer must exist on the WebMap BEFORE MapView construction.
 * A WebTileLayer added after the view is up does not get a 2D LayerView in this
 * SDK/WebMap pairing, so tiles are never requested and the canvas stays empty.
 *
 * The observation is a top-level operational layer, not a GroupLayer child.
 * Nested WebTileLayers can get a LayerView and fetch tiles while the 2D
 * compositor stays updating forever. The empty imagery GroupLayer stays hidden
 * until it has children so it cannot occupy the top of the composite.
 */

import { importArc } from '../map/arcgis-sdk.js';
import {
  IMAGERY_PLANE_ID,
  IMAGERY_PLANE_TITLE,
  TIME_ENGINE_LAYER_ID
} from './imagery-contract.js';

export const WAYBACK_PLACEHOLDER_TEMPLATE =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10/{level}/{row}/{col}';

let imageryPlane = null;
let observationLayer = null;

function findById(collection, id) {
  if (!collection) return null;
  if (typeof collection.find === 'function') {
    return collection.find((item) => item?.id === id) || null;
  }
  const list = collection.toArray ? collection.toArray() : [...collection];
  return list.find((item) => item?.id === id) || null;
}

function collectionHas(collection, layer) {
  if (!collection || !layer) return false;
  if (typeof collection.find === 'function') {
    return Boolean(collection.find((item) => item === layer || item?.id === layer.id));
  }
  const list = collection.toArray ? collection.toArray() : [...collection];
  return list.some((item) => item === layer || item?.id === layer.id);
}

function reparentToOperational(webmap, layer) {
  if (!webmap?.layers || !layer) return;
  const parent = layer.parent;
  if (parent && parent !== webmap && parent.layers?.remove) {
    try { parent.layers.remove(layer); } catch { /* keep slot */ }
  }
  if (webmap.basemap?.baseLayers && collectionHas(webmap.basemap.baseLayers, layer)) {
    try { webmap.basemap.baseLayers.remove(layer); } catch { /* keep slot */ }
  }
  if (!collectionHas(webmap.layers, layer)) {
    webmap.layers.add(layer);
  }
}

export function getImageryPlaneSlot() {
  return imageryPlane;
}

export function getImageryObservationLayer() {
  return observationLayer;
}

export async function ensureImageryObservationSlot(webmap) {
  if (!webmap) throw new Error('WebMap is required.');
  const existingPlane = findById(webmap.layers, IMAGERY_PLANE_ID)
    || findById(webmap.allLayers, IMAGERY_PLANE_ID);
  const existingObservation = findById(webmap.allLayers, TIME_ENGINE_LAYER_ID);

  if (existingPlane && existingObservation) {
    imageryPlane = existingPlane;
    observationLayer = existingObservation;
    reparentToOperational(webmap, observationLayer);
    if (!(imageryPlane.layers?.length)) imageryPlane.visible = false;
    return { imageryPlane, observationLayer };
  }

  const [GroupLayer, WebTileLayer] = await Promise.all([
    importArc('@arcgis/core/layers/GroupLayer.js'),
    importArc('@arcgis/core/layers/WebTileLayer.js')
  ]);

  observationLayer = existingObservation || new WebTileLayer({
    id: TIME_ENGINE_LAYER_ID,
    title: 'IQAI V2 Imagery Observation',
    urlTemplate: WAYBACK_PLACEHOLDER_TEMPLATE,
    copyright: 'Esri World Imagery Wayback',
    visible: false,
    opacity: 1,
    popupEnabled: false,
    listMode: 'hide'
  });

  reparentToOperational(webmap, observationLayer);
  if (!collectionHas(webmap.layers, observationLayer)) {
    webmap.layers.add(observationLayer);
  }

  if (existingPlane) {
    imageryPlane = existingPlane;
  } else {
    imageryPlane = new GroupLayer({
      id: IMAGERY_PLANE_ID,
      title: IMAGERY_PLANE_TITLE,
      listMode: 'hide',
      visibilityMode: 'independent',
      layers: [],
      popupEnabled: false,
      visible: false
    });
    imageryPlane.legendEnabled = false;
    webmap.layers.add(imageryPlane, 0);
  }
  if (!(imageryPlane.layers?.length)) imageryPlane.visible = false;

  return { imageryPlane, observationLayer };
}
