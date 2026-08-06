import {
  OCEAN_CURRENTS_MATCH,
  VESPUCCI_LAYER_META,
  VESPUCCI_LAYER_RENDERERS
} from './arcgis-renderers.js';
import { VESPUCCI_WEBMAP_ITEM_ID } from './ocean-view-config.js';
import { repairVespucciOperationalLayers } from './vespucci-layer-repair.js';

const VESPUCCI_GROUP_TITLE = 'Amerigo_Vespucci_Live';

/**
 * Flatten operationalLayers including nested WebMap group layers.
 * Does NOT flatten FeatureServer sublayer definition arrays.
 * @param {Array<object>} layers
 * @returns {Array<object>}
 */
export function flattenOperationalLayers(layers = []) {
  const out = [];
  for (const layer of layers) {
    if (isWebMapGroupLayer(layer)) {
      flattenOperationalLayers(layer.layers).forEach((l) => out.push(l));
    } else {
      out.push(layer);
    }
  }
  return out;
}

/**
 * @param {object} layer
 */
export function isWebMapGroupLayer(layer) {
  if (!Array.isArray(layer?.layers)) return false;
  if (layer.layerType === 'GroupLayer') return true;
  if (isFeatureServiceRootUrl(layer.url || '')) return false;
  return !layer.url && layer.layerType !== 'ArcGISFeatureLayer';
}

/**
 * Extract feature-service layer id from a webmap layer URL.
 * @param {string} url
 * @returns {number|null}
 */
export function parseFeatureLayerIdFromUrl(url = '') {
  const match = String(url).match(/FeatureServer\/(\d+)\/?$/i);
  return match ? Number(match[1]) : null;
}

/**
 * True when URL points at the FeatureServer root (not a sublayer).
 * @param {string} url
 * @param {string} [featureServiceUrl]
 */
export function isFeatureServiceRootUrl(url = '', featureServiceUrl = '') {
  if (!url) return false;
  const normalized = String(url).replace(/\/+$/, '');
  if (featureServiceUrl) {
    const root = String(featureServiceUrl).replace(/\/+$/, '');
    if (normalized === root) return true;
  }
  return /\/FeatureServer$/i.test(normalized);
}

/**
 * Determine if a webmap layer references the Vespucci hosted feature service.
 * @param {object} layer
 * @param {string} featureServiceUrl
 * @param {string} [featureItemId]
 */
export function isVespucciServiceLayer(layer, featureServiceUrl, featureItemId) {
  const url = layer?.url || '';
  if (featureItemId && layer?.itemId === featureItemId) return true;
  if (isFeatureServiceRootUrl(url, featureServiceUrl)) return true;
  if (featureServiceUrl && url.startsWith(`${featureServiceUrl}/`)) return true;
  if (featureServiceUrl && url.includes(featureServiceUrl.replace(/^https?:\/\//, ''))) return true;
  return VESPUCCI_LAYER_META.some((m) => m.match.test(layer?.title || ''));
}

/**
 * Classify a top-level or flattened operational layer.
 * @param {object} layer
 * @param {string} featureServiceUrl
 */
export function classifyWebMapLayer(layer, featureServiceUrl) {
  const title = layer?.title || '';
  if (OCEAN_CURRENTS_MATCH.test(title)) return { kind: 'oceanCurrents', key: 'oceanCurrents' };
  if (layer.layerType === 'GroupLayer' && /amerigo_vespucci/i.test(title)) {
    return { kind: 'vespucciGroup', key: 'vespucciGroup' };
  }
  if (isFeatureServiceRootUrl(layer?.url || '', featureServiceUrl)) {
    return { kind: 'vespucciService', key: 'vespucciService' };
  }
  const subId = parseFeatureLayerIdFromUrl(layer?.url || '');
  const vespucci = VESPUCCI_LAYER_META.find((m) => m.id === subId || m.match.test(title));
  if (vespucci && (subId != null || isVespucciServiceLayer(layer, featureServiceUrl))) {
    return { kind: 'vespucciSublayer', key: vespucci.key, layerId: vespucci.id, meta: vespucci };
  }
  if (isVespucciServiceLayer(layer, featureServiceUrl)) {
    const byTitle = VESPUCCI_LAYER_META.find((m) => m.match.test(title));
    if (byTitle) return { kind: 'vespucciSublayer', key: byTitle.key, layerId: byTitle.id, meta: byTitle };
  }
  return { kind: 'other', key: `other:${title}` };
}

/**
 * Collect per-sublayer WebMap overrides from existing layers.
 * @param {Array<object>} layers
 * @param {string} featureServiceUrl
 */
export function collectVespucciSublayerConfigs(layers, featureServiceUrl) {
  const byId = new Map();
  const flat = flattenOperationalLayers(layers);
  for (const layer of flat) {
    const cls = classifyWebMapLayer(layer, featureServiceUrl);
    if (cls.kind === 'vespucciService' && Array.isArray(layer.layers)) {
      for (const sub of layer.layers) {
        const id = Number(sub.id ?? parseFeatureLayerIdFromUrl(sub.url || ''));
        if (Number.isFinite(id)) byId.set(id, mergeSublayerConfig(byId.get(id), sub));
      }
      continue;
    }
    if (cls.kind === 'vespucciGroup' && Array.isArray(layer.layers)) {
      for (const sub of layer.layers) {
        const id = parseFeatureLayerIdFromUrl(sub.url || '');
        if (id != null) byId.set(id, mergeSublayerConfig(byId.get(id), sub));
      }
      continue;
    }
    if (cls.kind === 'vespucciSublayer' && cls.layerId != null) {
      byId.set(cls.layerId, mergeSublayerConfig(byId.get(cls.layerId), layer));
    }
  }
  return byId;
}

function mergeSublayerConfig(existing = {}, layer) {
  return {
    ...existing,
    id: layer.id || existing.id,
    popupInfo: layer.popupInfo || existing.popupInfo,
    layerDefinition: {
      ...(existing.layerDefinition || {}),
      ...(layer.layerDefinition || {})
    }
  };
}

/**
 * Build one ArcGISFeatureLayer child for the Vespucci GroupLayer.
 * @param {object} meta
 * @param {object} options
 */
export function buildVespucciFeatureLayerChild(meta, options = {}) {
  const { featureServiceUrl, featureItemId = null, saved = {} } = options;
  return {
    id: saved.id || `vespucci-layer-${meta.id}`,
    title: meta.title,
    url: `${featureServiceUrl}/${meta.id}`,
    layerType: 'ArcGISFeatureLayer',
    itemId: featureItemId || undefined,
    visibility: true,
    visible: true,
    opacity: 1,
    layerDefinition: {
      minScale: 0,
      maxScale: 0,
      definitionExpression: saved.layerDefinition?.definitionExpression ?? null,
      ...(saved.layerDefinition || {}),
      drawingInfo: VESPUCCI_LAYER_RENDERERS[meta.id]
    },
    ...(saved.popupInfo ? { popupInfo: saved.popupInfo } : {})
  };
}

/**
 * Build the known-good WebMap GroupLayer with six FeatureLayer children.
 * @param {object} options
 */
export function buildVespucciGroupLayer(options = {}) {
  const {
    featureServiceUrl,
    featureItemId = null,
    sublayerConfigs = new Map(),
    existingGroupLayer = null
  } = options;

  const children = VESPUCCI_LAYER_META.map((meta) => buildVespucciFeatureLayerChild(meta, {
    featureServiceUrl,
    featureItemId,
    saved: sublayerConfigs.get(meta.id) || {}
  }));

  return {
    id: existingGroupLayer?.id || 'vespucci-group-layer',
    title: VESPUCCI_GROUP_TITLE,
    layerType: 'GroupLayer',
    visibility: true,
    visible: true,
    opacity: 1,
    layers: children
  };
}

/** @deprecated use buildVespucciGroupLayer */
export const buildVespucciServiceGroupLayer = buildVespucciGroupLayer;

/**
 * Validate that a WebMap group has six real FeatureLayer children.
 * @param {object} groupLayer
 * @param {string} featureServiceUrl
 */
export function validateVespucciGroupLayer(groupLayer, featureServiceUrl) {
  const errors = [];
  if (!groupLayer) errors.push('missing group layer');
  if (groupLayer?.layerType !== 'GroupLayer') errors.push(`expected GroupLayer, got ${groupLayer?.layerType}`);
  if (groupLayer?.url) errors.push('group layer must not have a service URL');
  if (groupLayer?.title !== VESPUCCI_GROUP_TITLE) errors.push(`unexpected group title: ${groupLayer?.title}`);
  const children = groupLayer?.layers || [];
  if (children.length !== VESPUCCI_LAYER_META.length) {
    errors.push(`expected ${VESPUCCI_LAYER_META.length} children, got ${children.length}`);
  }
  const childReport = VESPUCCI_LAYER_META.map((meta, index) => {
    const child = children[index];
    const expectedUrl = `${featureServiceUrl}/${meta.id}`;
    const childErrors = [];
    if (!child) childErrors.push('missing child');
    if (child?.layerType !== 'ArcGISFeatureLayer') childErrors.push(`expected ArcGISFeatureLayer, got ${child?.layerType}`);
    if (child?.url !== expectedUrl) childErrors.push(`expected ${expectedUrl}, got ${child?.url}`);
    if (child?.title !== meta.title) childErrors.push(`expected title ${meta.title}, got ${child?.title}`);
    return {
      title: meta.title,
      layerType: child?.layerType || null,
      url: child?.url || null,
      visibility: child?.visibility ?? null,
      rendererType: child?.layerDefinition?.drawingInfo?.renderer?.type || null,
      valid: childErrors.length === 0,
      errors: childErrors
    };
  });
  if (childReport.some((c) => !c.valid)) errors.push('one or more children invalid');
  return {
    valid: errors.length === 0,
    errors,
    group: {
      title: groupLayer?.title,
      layerType: groupLayer?.layerType,
      url: groupLayer?.url || null,
      childCount: children.length
    },
    children: childReport
  };
}

/**
 * Build a repair plan without modifying anything.
 * @param {object} webmapData
 * @param {object} diagnostics
 * @param {object} options
 */
export function buildWebMapRepairPlan(webmapData, diagnostics, options = {}) {
  const {
    featureServiceUrl,
    featureItemId = null
  } = options;

  const operationalLayers = [...(webmapData.operationalLayers || [])];
  const duplicates = [];
  const preserved = [];
  let oceanCurrents = null;
  let existingGroupLayer = null;
  const others = [];

  for (const layer of operationalLayers) {
    const cls = classifyWebMapLayer(layer, featureServiceUrl);
    if (cls.kind === 'oceanCurrents') {
      if (!oceanCurrents) oceanCurrents = layer;
      else duplicates.push({ title: layer.title, reason: 'duplicate ocean currents layer' });
      continue;
    }
    if (cls.kind === 'vespucciGroup') {
      if (!existingGroupLayer) existingGroupLayer = layer;
      else duplicates.push({ title: layer.title, reason: 'duplicate Vespucci group layer' });
      continue;
    }
    if (cls.kind === 'vespucciService') {
      duplicates.push({ title: layer.title, reason: 'legacy FeatureServer root layer replaced by GroupLayer' });
      continue;
    }
    if (cls.kind === 'vespucciSublayer') {
      duplicates.push({ title: layer.title, key: cls.key, reason: 'top-level sublayer replaced by GroupLayer child' });
      continue;
    }
    if (cls.kind === 'other') {
      others.push(layer);
      preserved.push(layer.title || 'Unnamed layer');
    }
  }

  const sublayerConfigs = collectVespucciSublayerConfigs(operationalLayers, featureServiceUrl);
  const vespucciGroup = buildVespucciGroupLayer({
    featureServiceUrl,
    featureItemId,
    sublayerConfigs,
    existingGroupLayer
  });

  const reordered = [
    vespucciGroup,
    ...(oceanCurrents ? [{ ...oceanCurrents, visibility: true, visible: true }] : []),
    ...others
  ];

  const validation = validateVespucciGroupLayer(vespucciGroup, featureServiceUrl);
  const visibilityChanges = [
    { title: vespucciGroup.title, visibility: true },
    ...VESPUCCI_LAYER_META.map((m) => ({ title: m.title, visibility: true }))
  ];
  const rendererChanges = VESPUCCI_LAYER_META.map((m) => ({ title: m.title, renderer: 'explicit SimpleRenderer' }));

  const featureRebuilds = [];
  const layerDiag = Object.fromEntries((diagnostics?.layers || []).map((l) => [l.layerId, l]));

  if (!layerDiag[3]?.destinationExists) {
    featureRebuilds.push({ layer: 'Vespucci Destination', action: 'rebuild from stored vessel position and env destination config' });
  }
  if (!layerDiag[4]?.estimatedRouteExists) {
    featureRebuilds.push({ layer: 'Vespucci Estimated Route', action: 'rebuild from stored vessel position' });
  }

  const travelledRouteNote = layerDiag[2]?.travelledRouteNote
    || (!layerDiag[2]?.travelledRouteExists && layerDiag[1]?.historyPointCount < 2
      ? 'Observed route unavailable: fewer than two stored observations.'
      : null);

  const updatedWebMap = { ...webmapData, operationalLayers: reordered };
  const voyageViewpoint = buildVoyageViewpoint(diagnostics, options.config);
  if (voyageViewpoint) {
    updatedWebMap.initialState = {
      ...(webmapData.initialState || {}),
      viewpoint: voyageViewpoint
    };
  }

  return {
    webmapItemId: VESPUCCI_WEBMAP_ITEM_ID,
    dryRun: true,
    summary: {
      duplicatesRemoved: duplicates.length,
      layersAdded: existingGroupLayer ? 0 : 1,
      vespucciGroupLayer: true,
      vespucciFeatureLayerChildren: VESPUCCI_LAYER_META.length,
      groupLayerValid: validation.valid,
      oceanCurrentsPreserved: Boolean(oceanCurrents),
      baseMapPreserved: Boolean(webmapData.baseMap),
      extentPreserved: Boolean(voyageViewpoint || webmapData.initialState?.viewpoint || webmapData.extent),
      voyageViewpointUpdated: Boolean(voyageViewpoint)
    },
    duplicatesRemoved: duplicates,
    visibilityChanges,
    rendererChanges,
    layerOrder: reordered.map((l) => l.title),
    preservedLayers: preserved,
    oceanCurrentsTitle: oceanCurrents?.title || null,
    featureRebuilds,
    travelledRouteNote,
    vesselGeometryUntouched: true,
    groupValidation: validation,
    operationalLayersAfter: reordered,
    updatedWebMap
  };
}

/**
 * Build a Web Mercator viewpoint extent covering vessel + destination.
 * @param {object} diagnostics
 * @param {object} config
 */
export function buildVoyageViewpoint(diagnostics, config) {
  const layerById = Object.fromEntries((diagnostics?.layers || []).map((l) => [l.layerId, l]));
  const layer0 = layerById[config?.currentLayerId ?? 0];
  const layer3 = layerById[config?.destinationLayerId ?? 3];
  const vesselLat = Number(layer0?.displayAttributes?.Latitude);
  const vesselLon = Number(layer0?.displayAttributes?.Longitude);
  const destLat = Number(layer3?.destinationCoordinates?.latitude ?? config?.destinationLatitude);
  const destLon = Number(layer3?.destinationCoordinates?.longitude ?? config?.destinationLongitude);
  if (![vesselLat, vesselLon, destLat, destLon].every(Number.isFinite)) return null;

  const padLon = Math.max(2, Math.abs(vesselLon - destLon) * 0.08);
  const padLat = Math.max(2, Math.abs(vesselLat - destLat) * 0.08);
  const xmin = Math.min(vesselLon, destLon) - padLon;
  const xmax = Math.max(vesselLon, destLon) + padLon;
  const ymin = Math.min(vesselLat, destLat) - padLat;
  const ymax = Math.max(vesselLat, destLat) + padLat;

  const toMercator = (lon, lat) => {
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    return [x, y * 20037508.34 / 180];
  };
  const [xminM, yminM] = toMercator(xmin, ymin);
  const [xmaxM, ymaxM] = toMercator(xmax, ymax);

  return {
    targetGeometry: {
      spatialReference: { latestWkid: 3857, wkid: 102100 },
      xmin: Math.min(xminM, xmaxM),
      ymin: Math.min(yminM, ymaxM),
      xmax: Math.max(xminM, xmaxM),
      ymax: Math.max(yminM, ymaxM)
    }
  };
}

/**
 * Apply feature-layer rebuilds for missing destination / estimated route only.
 * Never modifies Layer 0 geometry.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} diagnostics
 * @param {object} config
 */
export async function rebuildMissingRouteFeatures(client, diagnostics, config, options = {}) {
  return repairVespucciOperationalLayers(client, config, diagnostics, options);
}

/**
 * Fetch WebMap JSON from ArcGIS Portal.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {string} webmapItemId
 */
export async function fetchWebMapData(client, webmapItemId) {
  const item = await client.get(`${client.config.arcgisPortalUrl}/sharing/rest/content/items/${webmapItemId}?f=json`);
  if (item.error) throw new Error(`WebMap item lookup failed: ${item.error.message || JSON.stringify(item.error)}`);
  const data = await client.get(`${client.config.arcgisPortalUrl}/sharing/rest/content/items/${webmapItemId}/data?f=json`);
  if (data.error) throw new Error(`WebMap data lookup failed: ${data.error.message || JSON.stringify(data.error)}`);
  return { item, data };
}

/**
 * Apply WebMap repair (skipped when dryRun=true).
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} plan
 * @param {object} options
 */
export async function applyWebMapRepairPlan(client, plan, options = {}) {
  if (plan.dryRun || options.dryRun) {
    return { applied: false, dryRun: true, plan };
  }

  const owner = plan.owner;
  const webmapItemId = plan.webmapItemId;
  const updated = plan.updatedWebMap || {
    ...plan.originalWebMap,
    operationalLayers: plan.operationalLayersAfter
  };

  const body = new URLSearchParams({
    f: 'json',
    token: client.token,
    text: JSON.stringify(updated)
  });
  const result = await client.rawPost(
    `${client.config.arcgisPortalUrl}/sharing/rest/content/users/${owner}/items/${webmapItemId}/update`,
    body
  );
  if (!result.success && result.id !== webmapItemId) {
    throw new Error(`WebMap update failed: ${JSON.stringify(result)}`);
  }
  return { applied: true, itemId: webmapItemId, featureRebuilds: plan.featureRebuildResults || [] };
}

/**
 * Run full repair workflow.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} config
 * @param {object} diagnostics
 * @param {object} options
 */
export async function runWebMapRepair(client, config, diagnostics, options = {}) {
  const dryRun = options.dryRun !== false;
  const { item, data } = await fetchWebMapData(client, VESPUCCI_WEBMAP_ITEM_ID);
  const plan = buildWebMapRepairPlan(data, diagnostics, {
    featureServiceUrl: client.featureServiceUrl,
    featureItemId: config.arcgisItemId,
    config
  });
  plan.dryRun = dryRun;
  plan.owner = item.owner;
  plan.originalWebMap = data;

  let featureRebuildResults = [];
  if (!dryRun) {
    featureRebuildResults = await rebuildMissingRouteFeatures(client, diagnostics, config, { dryRun: false });
  } else {
    featureRebuildResults = await rebuildMissingRouteFeatures(client, diagnostics, config, { dryRun: true });
  }
  plan.featureRebuildResults = featureRebuildResults;

  const applyResult = await applyWebMapRepairPlan(client, plan, { dryRun });
  return { plan, applyResult };
}
