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
await client.initialize();
await ensureFields(client, config.currentLayerId, 'current-position');

if (config.enableHistory) {
  await ensureFields(client, config.historyLayerId, 'history');
} else {
  console.log('History setup skipped. Set ENABLE_HISTORY=true and ensure a second point layer exists to configure it.');
}

async function ensureFields(client, layerId, label) {
  const layer = await client.get(`${client.layerUrl(layerId)}?f=json&token=${encodeURIComponent(client.token)}`);
  if (layer.error) throw new Error(`${label} layer lookup failed: ${JSON.stringify(layer.error)}`);
  const existing = new Set((layer.fields || []).map((field) => field.name.toLowerCase()));
  const missing = fields.filter((field) => !existing.has(field.name.toLowerCase()));
  if (missing.length === 0) {
    console.log(`${label} layer already has all required fields.`);
    return;
  }
  const body = new URLSearchParams({ f: 'json', token: client.token, addToDefinition: JSON.stringify({ fields: missing }) });
  const result = await client.post(`${client.layerUrl(layerId)}/addToDefinition`, body);
  if (!result.success) throw new Error(`${label} addToDefinition failed: ${JSON.stringify(result)}`);
  console.log(`${label} layer added fields: ${missing.map((field) => field.name).join(', ')}`);
}
