/**
 * Operational-layer session overlay on the long-lived MapView runtime plane.
 * listMode hide so Discover owns the chrome, not the authored WebMap tree.
 */
import { getMapView, getRuntimePlane } from '../map/map-foundation.js';
import { importArc } from '../map/arcgis-sdk.js';
import { fillRenderer, lineRenderer, pointRenderer, visualClass } from './symbology.js';

export const OPS_GROUP_ID = 'iqai-v2-ops-layers';
export const OPS_LAYER_PREFIX = 'ops-';

const layers = new Map();
let group = null;
let blobUrls = new Map();

function layerIdFor(id) {
  return `${OPS_LAYER_PREFIX}${id}`;
}

function geometryKind(geojson) {
  const types = new Set((geojson?.features || []).map((f) => f.geometry?.type).filter(Boolean));
  if ([...types].some((t) => /Polygon/.test(t))) return 'polygon';
  if ([...types].some((t) => /Line/.test(t))) return 'line';
  return 'point';
}

function rendererFor(meta, geojson) {
  const color = meta.color || '#9aa8b5';
  const kind = geometryKind(geojson);
  if (kind === 'polygon') return fillRenderer(meta.id, color);
  if (kind === 'line') return lineRenderer(color);
  return pointRenderer(meta.id, color);
}

async function ensureGroup() {
  if (group) return group;
  const plane = getRuntimePlane();
  if (!plane) return null;
  const existing = plane.layers?.find?.((item) => item.id === OPS_GROUP_ID)
    || (typeof plane.layers?.toArray === 'function'
      ? plane.layers.toArray().find((item) => item.id === OPS_GROUP_ID)
      : null);
  if (existing) {
    group = existing;
    return group;
  }
  const GroupLayer = await importArc('@arcgis/core/layers/GroupLayer.js');
  group = new GroupLayer({
    id: OPS_GROUP_ID,
    title: 'Operational Layers',
    listMode: 'hide',
    visibilityMode: 'independent',
    visible: true,
    layers: []
  });
  plane.add(group);
  plane.visible = true;
  return group;
}

function revoke(id) {
  const url = blobUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(id);
  }
}

export async function setOpsOverlay(meta, payload, visible) {
  const host = await ensureGroup();
  if (!host) return { ok: false, reason: 'MAP_NOT_READY' };
  const id = meta.id;
  const existing = layers.get(id);
  if (!visible) {
    if (existing) existing.visible = false;
    const radar = layers.get(`${id}-radar`);
    const fwi = layers.get(`${id}-fwi`);
    if (radar) radar.visible = false;
    if (fwi) fwi.visible = false;
    return { ok: true, visible: false };
  }

  const geojson = payload?.geojson || { type: 'FeatureCollection', features: [] };
  const GeoJSONLayer = await importArc('@arcgis/core/layers/GeoJSONLayer.js');
  revoke(id);
  const blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  blobUrls.set(id, url);

  if (existing && existing.type === 'geojson') {
    existing.url = url;
    existing.renderer = rendererFor(meta, geojson);
    existing.visible = true;
    existing.title = meta.title;
  } else {
    if (existing) host.remove(existing);
    const layer = new GeoJSONLayer({
      id: layerIdFor(id),
      title: meta.title,
      url,
      popupEnabled: false,
      copyright: 'session overlay',
      renderer: rendererFor(meta, geojson),
      labelingInfo: []
    });
    host.add(layer);
    layers.set(id, layer);
  }

  if (id === 'weather' && payload?.radar?.status === 'LIVE') {
    await ensureWms(`${id}-radar`, {
      title: 'ECCC Radar',
      url: '/api/spatial-v2/ops-layers/radar/wms',
      sublayer: 'RADAR_1KM_RRAI',
      opacity: 0.42
    });
  }
  if (id === 'wildfire-fwi' && payload?.fwi?.layer) {
    await ensureWms(`${id}-fwi`, {
      title: 'CWFIS FWI',
      url: '/api/spatial-v2/ops-layers/cwfis/fwi/wms',
      sublayer: payload.fwi.layer,
      opacity: 0.32
    });
  }

  const plane = getRuntimePlane();
  if (plane) plane.visible = true;
  return { ok: true, visible: true, visualClass: visualClass(id) };
}

async function ensureWms(key, spec) {
  const host = await ensureGroup();
  if (!host) return;
  let layer = layers.get(key);
  if (layer) {
    layer.visible = true;
    return;
  }
  const WMSLayer = await importArc('@arcgis/core/layers/WMSLayer.js');
  layer = new WMSLayer({
    id: layerIdFor(key),
    title: spec.title,
    url: spec.url,
    sublayers: [{ name: spec.sublayer, visible: true }],
    imageFormat: 'png',
    imageTransparency: true,
    opacity: spec.opacity,
    popupEnabled: false,
    listMode: 'hide'
  });
  host.add(layer);
  layers.set(key, layer);
}

export function isOpsOverlayVisible(id) {
  return layers.get(id)?.visible === true;
}

export function listVisibleOpsIds(catalogLayers = []) {
  return (catalogLayers || [])
    .map((layer) => layer.id)
    .filter((id) => isOpsOverlayVisible(id));
}

export function getOpsView() {
  return getMapView();
}
