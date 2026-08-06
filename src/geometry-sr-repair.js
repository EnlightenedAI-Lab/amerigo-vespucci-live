import { parseDestinationConfig } from './navigation.js';
import { layer0AttributesToPosition } from './arcgis-diagnostics.js';
import {
  geometryLooksLikeWgs84InWebMercatorLayer,
  webMercatorPointFromWgs84,
  webMercatorPolylineFromWgs84Points
} from './arcgis-geometry.js';

const REPAIR_LAYER_IDS = [3, 4, 5];

/**
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {number} layerId
 */
export async function queryLayerFeatureGeometry(client, layerId) {
  const data = await client.get(`${client.layerUrl(layerId)}/query?${new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    resultRecordCount: '1'
  })}`);
  const feature = data.features?.[0];
  if (!feature) return null;
  return {
    objectId: feature.attributes?.OBJECTID,
    attributes: feature.attributes,
    geometry: feature.geometry
  };
}

/**
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {number} layerId
 * @param {number} objectId
 * @param {object} geometry
 */
export async function updateLayerGeometryOnly(client, layerId, objectId, geometry) {
  const data = await client.post(
    client.layerUrl(layerId),
    'updateFeatures',
    new URLSearchParams({
      f: 'json',
      features: JSON.stringify([{ attributes: { OBJECTID: objectId }, geometry }])
    })
  );
  const result = data.updateResults?.[0];
  if (!result?.success) {
    throw new Error(`Layer ${layerId} geometry update failed: ${JSON.stringify(data)}`);
  }
}

export function geometryNeedsWebMercatorRepair(geometry, geometryType) {
  return geometryLooksLikeWgs84InWebMercatorLayer(geometry, geometryType);
}

function buildRepairedGeometry(layerId, config, layer0Attrs, existingFeature) {
  if (layerId === config.destinationLayerId) {
    const d = parseDestinationConfig(config);
    return webMercatorPointFromWgs84(d.longitude, d.latitude);
  }
  if (layerId === config.conditionsLayerId) {
    const position = layer0AttributesToPosition(layer0Attrs, config);
    if (!position) throw new Error('Layer 5 repair requires Layer 0 WGS84 attributes.');
    return webMercatorPointFromWgs84(position.longitude, position.latitude);
  }
  if (layerId === config.estimatedRouteLayerId) {
    const position = layer0AttributesToPosition(layer0Attrs, config);
    const d = parseDestinationConfig(config);
    if (!position) throw new Error('Layer 4 repair requires Layer 0 WGS84 attributes.');
    return webMercatorPolylineFromWgs84Points([position, d]);
  }
  throw new Error(`Layer ${layerId} is not eligible for geometry SR repair.`);
}

/**
 * Repair Web Mercator geometry for layers 3, 4 and 5 only. Never modifies Layer 0.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} config
 * @param {object} [options]
 */
export async function repairGeometrySpatialReference(client, config, options = {}) {
  const dryRun = options.dryRun !== false;
  const layerMeta = await Promise.all(REPAIR_LAYER_IDS.map(async (layerId) => {
    const meta = await client.get(`${client.layerUrl(layerId)}?f=json`);
    return { layerId, geometryType: meta.geometryType };
  }));
  const geometryTypeById = Object.fromEntries(layerMeta.map((m) => [m.layerId, m.geometryType]));

  const before = {};
  for (const layerId of [0, ...REPAIR_LAYER_IDS]) {
    const feature = await queryLayerFeatureGeometry(client, layerId);
    before[layerId] = feature?.geometry || null;
  }

  const layer0Feature = await queryLayerFeatureGeometry(client, config.currentLayerId);
  const layer0Attrs = layer0Feature?.attributes || null;
  const repairs = [];

  for (const layerId of REPAIR_LAYER_IDS) {
    const feature = await queryLayerFeatureGeometry(client, layerId);
    if (!feature?.objectId) {
      repairs.push({ layerId, action: 'skipped', reason: 'no feature found' });
      continue;
    }
    const needsRepair = geometryNeedsWebMercatorRepair(feature.geometry, geometryTypeById[layerId]);
    if (!needsRepair) {
      repairs.push({ layerId, action: 'unchanged', reason: 'geometry already Web Mercator' });
      continue;
    }
    const geometry = buildRepairedGeometry(layerId, config, layer0Attrs, feature);
    if (!dryRun) {
      await updateLayerGeometryOnly(client, layerId, feature.objectId, geometry);
    }
    repairs.push({
      layerId,
      action: dryRun ? 'would repair geometry SR' : 'repaired geometry SR',
      objectId: feature.objectId
    });
  }

  const after = {};
  if (!dryRun) {
    for (const layerId of [0, ...REPAIR_LAYER_IDS]) {
      const feature = await queryLayerFeatureGeometry(client, layerId);
      after[layerId] = feature?.geometry || null;
    }
  }

  return {
    dryRun,
    layer0GeometryUntouched: true,
    before,
    after,
    repairs
  };
}
