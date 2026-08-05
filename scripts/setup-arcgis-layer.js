import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';

const fields = [
  { name: 'MMSI', type: 'esriFieldTypeDouble', alias: 'MMSI' },
  { name: 'VesselName', type: 'esriFieldTypeString', alias: 'Vessel Name', length: 128 },
  { name: 'SpeedKnots', type: 'esriFieldTypeDouble', alias: 'Speed (knots)' },
  { name: 'Course', type: 'esriFieldTypeDouble', alias: 'Course' },
  { name: 'Heading', type: 'esriFieldTypeDouble', alias: 'Heading' },
  { name: 'Latitude', type: 'esriFieldTypeDouble', alias: 'Latitude' },
  { name: 'Longitude', type: 'esriFieldTypeDouble', alias: 'Longitude' },
  { name: 'LastAIS', type: 'esriFieldTypeDate', alias: 'Last AIS Update' },
  { name: 'Destination', type: 'esriFieldTypeString', alias: 'Destination', length: 128 },
  { name: 'NavStatus', type: 'esriFieldTypeString', alias: 'Navigation Status', length: 128 }
];

const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = await client.resolveFeatureServiceUrl();
const adminFeatureServiceUrl = toAdminFeatureServiceUrl(client.featureServiceUrl);
const adminToken = process.env.ARCGIS_ADMIN_TOKEN;

await ensureFields(client, config.currentLayerId, 'current-position', adminFeatureServiceUrl, adminToken);

if (config.enableHistory) {
  await ensureFields(client, config.historyLayerId, 'history', adminFeatureServiceUrl, adminToken);
} else {
  console.log('History setup skipped. Set ENABLE_HISTORY=true and ensure a second point layer exists to configure it.');
}

function toAdminFeatureServiceUrl(featureServiceUrl) {
  const servicesPath = '/arcgis/rest/services/';
  const adminServicesPath = '/arcgis/rest/admin/services/';
  if (!featureServiceUrl.includes(servicesPath)) {
    throw new Error(`Cannot derive ArcGIS admin URL from feature service URL: ${featureServiceUrl}`);
  }
  return featureServiceUrl.replace(servicesPath, adminServicesPath);
}

function sanitizeArcGISResponse(response) {
  return JSON.stringify(response, (key, value) => (key.toLowerCase().includes('token') ? '[redacted]' : value));
}

async function ensureFields(client, layerId, label, adminFeatureServiceUrl, adminToken) {
  const layer = await client.get(`${client.layerUrl(layerId)}?f=json`);
  if (layer.error) throw new Error(`${label} layer lookup failed: ${sanitizeArcGISResponse(layer.error)}`);
  const existing = new Set((layer.fields || []).map((field) => field.name.toLowerCase()));
  const missing = fields.filter((field) => !existing.has(field.name.toLowerCase()));
  if (missing.length === 0) {
    console.log(`${label} layer already has all required fields.`);
    return;
  }
  if (!adminToken) {
    throw new Error(
      `${label} layer is missing required field(s): ${missing.map((field) => field.name).join(', ')}. `
      + 'Set a temporary owner-level ARCGIS_ADMIN_TOKEN to bootstrap the schema, rerun setup, and remove ARCGIS_ADMIN_TOKEN immediately after setup succeeds.'
    );
  }
  const body = new URLSearchParams({
    f: 'json',
    token: adminToken,
    addToDefinition: JSON.stringify({ fields: missing })
  });
  const adminLayerUrl = `${adminFeatureServiceUrl}/${layerId}`;
  const result = await client.rawPost(`${adminLayerUrl}/addToDefinition`, body);
  if (!result.success) {
    throw new Error(`${label} addToDefinition failed at ${adminLayerUrl}/addToDefinition: ${sanitizeArcGISResponse(result)}`);
  }
  console.log(`${label} layer added fields: ${missing.map((field) => field.name).join(', ')}`);
}
