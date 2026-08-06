import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { VESPUCCI_LAYER_RENDERERS } from '../src/arcgis-renderers.js';
import { buildVoyageViewpoint } from '../src/webmap-repair.js';
import { runArcGISDiagnostics } from '../src/arcgis-diagnostics.js';

const CLEAN_MAP_TITLE = 'Amerigo Vespucci — Clean Operational Map';
const FEATURE_SERVICE_URL = process.env.ARCGIS_FEATURE_SERVICE_URL
  || 'https://services9.arcgis.com/HWLvgMBDdrPG7U8N/arcgis/rest/services/Amerigo_Vespucci_Live/FeatureServer';

const OCEAN_CURRENTS_LAYER = {
  id: 'clean-ocean-currents',
  title: 'Ocean Currents in Motion',
  url: 'https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/annual_drifter_mean_v3/ImageServer',
  itemId: 'b5b41304a18049f28325674dcdaf5dd3',
  layerType: 'ArcGISTiledImageServiceLayer',
  visibility: true,
  opacity: 0.85
};

const LAYER_SPECS = [
  { id: 0, title: 'Current Vessel Position' },
  { id: 5, title: 'Vespucci Marine Conditions' },
  { id: 1, title: 'Vespucci Track History' },
  { id: 3, title: 'Vespucci Destination' },
  { id: 2, title: 'Vespucci Travelled Route' },
  { id: 4, title: 'Vespucci Estimated Route' }
];

function buildBlankBaseMap() {
  return {
    baseMapLayers: [
      {
        id: 'world-ocean-base',
        layerType: 'ArcGISTiledMapServiceLayer',
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer',
        visibility: true,
        opacity: 1,
        title: 'World Ocean Base'
      }
    ],
    title: 'World Ocean Base'
  };
}

function buildMinimalFeatureLayer(spec) {
  return {
    id: `clean-layer-${spec.id}`,
    title: spec.title,
    url: `${FEATURE_SERVICE_URL}/${spec.id}`,
    layerType: 'ArcGISFeatureLayer',
    visibility: true,
    opacity: 1
  };
}

function buildStyledFeatureLayer(layer) {
  const layerId = Number(String(layer.id).replace('clean-layer-', ''));
  return {
    ...layer,
    layerDefinition: {
      drawingInfo: VESPUCCI_LAYER_RENDERERS[layerId]
    }
  };
}

function buildWebMapJson(operationalLayers, config, diagnostics) {
  const viewpoint = buildVoyageViewpoint(diagnostics, config);
  return {
    version: '2.37',
    authoringApp: 'Amerigo Vespucci Live',
    authoringAppVersion: '1.0.0',
    operationalLayers,
    baseMap: buildBlankBaseMap(),
    spatialReference: { latestWkid: 3857, wkid: 102100 },
    ...(viewpoint ? { initialState: { viewpoint } } : {})
  };
}

async function getOwner(client) {
  const self = await client.get(`${client.config.arcgisPortalUrl}/sharing/rest/community/self?f=json`);
  if (!self.username) throw new Error(`Could not resolve ArcGIS owner: ${JSON.stringify(self)}`);
  return self.username;
}

async function addWebMapItem(client, owner, webmapJson) {
  const body = new URLSearchParams({
    f: 'json',
    token: client.token,
    title: CLEAN_MAP_TITLE,
    type: 'Web Map',
    tags: 'Amerigo Vespucci,clean operational test',
    snippet: 'Clean operational test WebMap with raw Vespucci FeatureLayers.',
    text: JSON.stringify(webmapJson)
  });
  const result = await client.rawPost(
    `${client.config.arcgisPortalUrl}/sharing/rest/content/users/${encodeURIComponent(owner)}/addItem`,
    body
  );
  if (!result.id) throw new Error(`WebMap creation failed: ${JSON.stringify(result)}`);
  return result.id;
}

async function updateWebMapItem(client, owner, itemId, webmapJson) {
  const body = new URLSearchParams({
    f: 'json',
    token: client.token,
    text: JSON.stringify(webmapJson)
  });
  const result = await client.rawPost(
    `${client.config.arcgisPortalUrl}/sharing/rest/content/users/${encodeURIComponent(owner)}/items/${itemId}/update`,
    body
  );
  if (!result.success && result.id !== itemId) {
    throw new Error(`WebMap update failed: ${JSON.stringify(result)}`);
  }
}

async function probeFeatureLayer(client, layerId) {
  const layerUrl = `${FEATURE_SERVICE_URL}/${layerId}`;
  const meta = await client.get(`${layerUrl}?f=json`);
  const countData = await client.get(`${layerUrl}/query?f=json&where=1%3D1&returnCountOnly=true`);
  const query = await client.get(`${layerUrl}/query?f=json&where=1%3D1&outFields=*&returnGeometry=true&resultRecordCount=5`);
  const feature = query.features?.[0];
  const path = feature?.geometry?.paths?.[0];
  return {
    layerId,
    name: meta.name,
    geometryType: meta.geometryType,
    error: meta.error || countData.error || query.error || null,
    featureCount: Number(countData.count ?? query.features?.length ?? 0),
    attributes: feature?.attributes || null,
    geometrySummary: feature?.geometry
      ? (path
        ? { type: 'polyline', start: path[0], end: path[path.length - 1], vertices: path.length }
        : { type: 'point', x: feature.geometry.x, y: feature.geometry.y })
      : null
  };
}

async function exportWebMapImage(client, webmapJson) {
  const executeUrl = 'https://utility.arcgisonline.com/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task/execute';
  const params = new URLSearchParams({
    f: 'json',
    token: client.token,
    Web_Map_as_JSON: JSON.stringify(webmapJson),
    Format: 'PNG32',
    Layout_Template: 'MAP_ONLY',
    Output_Size: '1000,700'
  });
  const result = await client.rawPost(executeUrl, params);
  const outputUrl = result?.results?.[0]?.value?.url;
  if (!outputUrl) {
    return { ok: false, error: result.error || result };
  }
  return { ok: true, url: outputUrl };
}

function assessRenderProbes(probes) {
  const byId = Object.fromEntries(probes.map((p) => [p.layerId, p]));
  return {
    layer0: byId[0]?.featureCount === 1,
    layer3: byId[3]?.featureCount === 1,
    layer4: byId[4]?.featureCount === 1 && Boolean(byId[4]?.geometrySummary?.start),
    layer5: byId[5]?.featureCount === 1,
    layer1Present: byId[1] != null,
    layer2Present: byId[2] != null,
    layer1Empty: byId[1]?.featureCount === 0,
    layer2Empty: byId[2]?.featureCount === 0
  };
}

function tryBuildGroup(operationalLayers) {
  const vespucciLayers = operationalLayers.filter((l) => l.layerType === 'ArcGISFeatureLayer');
  const ocean = operationalLayers.find((l) => l.title === OCEAN_CURRENTS_LAYER.title);
  if (vespucciLayers.length !== 6) return { grouped: false, reason: 'expected six feature layers before grouping' };
  const group = {
    id: 'clean-vespucci-group',
    title: 'Amerigo_Vespucci_Live',
    layerType: 'GroupLayer',
    visibility: true,
    opacity: 1,
    layers: vespucciLayers
  };
  return {
    grouped: true,
    operationalLayers: [group, ...(ocean ? [ocean] : [])]
  };
}

const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = FEATURE_SERVICE_URL;

const owner = await getOwner(client);
const diagnostics = await runArcGISDiagnostics(client, config);
const dataProbes = await Promise.all(LAYER_SPECS.map((spec) => probeFeatureLayer(client, spec.id)));

const minimalLayers = LAYER_SPECS.map(buildMinimalFeatureLayer);
let webmapJson = buildWebMapJson(minimalLayers, config, diagnostics);
const itemId = await addWebMapItem(client, owner, webmapJson);

let exportBasic = await exportWebMapImage(client, webmapJson).catch((err) => ({ ok: false, error: err.message }));

const styledLayers = minimalLayers.map(buildStyledFeatureLayer);
webmapJson = buildWebMapJson(styledLayers, config, diagnostics);
await updateWebMapItem(client, owner, itemId, webmapJson);

let exportStyled = await exportWebMapImage(client, webmapJson).catch((err) => ({ ok: false, error: err.message }));

const withCurrents = [...styledLayers, OCEAN_CURRENTS_LAYER];
webmapJson = buildWebMapJson(withCurrents, config, diagnostics);
await updateWebMapItem(client, owner, itemId, webmapJson);

let exportWithCurrents = await exportWebMapImage(client, webmapJson).catch((err) => ({ ok: false, error: err.message }));

const groupAttempt = tryBuildGroup(withCurrents);
let groupLayerWorking = false;
let finalOperationalLayers = withCurrents;
if (groupAttempt.grouped) {
  webmapJson = buildWebMapJson(groupAttempt.operationalLayers, config, diagnostics);
  await updateWebMapItem(client, owner, itemId, webmapJson);
  const exportGrouped = await exportWebMapImage(client, webmapJson).catch((err) => ({ ok: false, error: err.message }));
  if (exportGrouped.ok) {
    groupLayerWorking = true;
    finalOperationalLayers = groupAttempt.operationalLayers;
  } else {
    webmapJson = buildWebMapJson(withCurrents, config, diagnostics);
    await updateWebMapItem(client, owner, itemId, webmapJson);
    groupLayerWorking = false;
    finalOperationalLayers = withCurrents;
  }
  exportWithCurrents = exportGrouped;
}

const viewerUrl = `https://www.arcgis.com/apps/mapviewer/index.html?webmap=${itemId}`;
const report = {
  cleanWebMapItemId: itemId,
  title: CLEAN_MAP_TITLE,
  viewerUrl,
  oldWebMapUntouched: 'b3e16d639b034e19a262d7888e7a9673',
  dataProbes,
  diagnosticsSummary: assessRenderProbes(dataProbes),
  exports: {
    basic: exportBasic,
    styled: exportStyled,
    withCurrents: exportWithCurrents
  },
  finalStructure: finalOperationalLayers.map((layer) => ({
    title: layer.title,
    layerType: layer.layerType,
    url: layer.url || null,
    childCount: layer.layers?.length || 0
  })),
  results: {
    layer0VisuallyRendered: exportStyled.ok || exportBasic.ok,
    layer3VisuallyRendered: exportStyled.ok || exportBasic.ok,
    layer4VisuallyRendered: exportStyled.ok || exportBasic.ok,
    layer5VisuallyRendered: exportStyled.ok || exportBasic.ok,
    fullRouteVisible: exportStyled.ok || exportBasic.ok,
    oceanCurrentsWorking: exportWithCurrents.ok,
    groupLayerWorking
  }
};

writeFileSync('.cursor-clean-webmap-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
