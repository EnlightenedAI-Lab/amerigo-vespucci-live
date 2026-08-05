import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';

const sharedPositionFields = [
  field('MMSI', 'esriFieldTypeDouble', 'MMSI'), field('VesselName', 'esriFieldTypeString', 'Vessel Name', 128), field('SpeedKnots', 'esriFieldTypeDouble', 'Speed (knots)'),
  field('Course', 'esriFieldTypeDouble', 'Course'), field('Heading', 'esriFieldTypeDouble', 'Heading'), field('Latitude', 'esriFieldTypeDouble', 'Latitude'), field('Longitude', 'esriFieldTypeDouble', 'Longitude'),
  field('LastAIS', 'esriFieldTypeDate', 'Last AIS Update'), field('Destination', 'esriFieldTypeString', 'Destination', 128), field('NavStatus', 'esriFieldTypeString', 'Navigation Status', 128)
];

const conditionsFields = [
  field('MMSI', 'esriFieldTypeDouble', 'MMSI'), field('VesselName', 'esriFieldTypeString', 'Vessel Name', 128), field('Latitude', 'esriFieldTypeDouble', 'Latitude'), field('Longitude', 'esriFieldTypeDouble', 'Longitude'),
  field('VesselAIS', 'esriFieldTypeDate', 'Vessel AIS Time'), field('ConditionsAt', 'esriFieldTypeDate', 'Newest Conditions Time'), field('WeatherAt', 'esriFieldTypeDate', 'Weather Valid Time'), field('MarineAt', 'esriFieldTypeDate', 'Marine Valid Time'), field('UpdatedAt', 'esriFieldTypeDate', 'Updated At'),
  field('WeatherStatus', 'esriFieldTypeString', 'Weather Status', 32), field('MarineStatus', 'esriFieldTypeString', 'Marine Status', 32), field('WxGridLat', 'esriFieldTypeDouble', 'Weather Grid Latitude'), field('WxGridLon', 'esriFieldTypeDouble', 'Weather Grid Longitude'), field('SeaGridLat', 'esriFieldTypeDouble', 'Marine Grid Latitude'), field('SeaGridLon', 'esriFieldTypeDouble', 'Marine Grid Longitude'), field('Attribution', 'esriFieldTypeString', 'Attribution', 256), field('Basis', 'esriFieldTypeString', 'Basis', 256),
  field('AirTempC', 'esriFieldTypeDouble', 'Air Temperature (C)'), field('FeelsLikeC', 'esriFieldTypeDouble', 'Feels Like (C)'), field('HumidityPct', 'esriFieldTypeDouble', 'Humidity (%)'), field('PrecipMM', 'esriFieldTypeDouble', 'Precipitation (mm)'), field('WeatherCode', 'esriFieldTypeInteger', 'WMO Weather Code'), field('WeatherText', 'esriFieldTypeString', 'Weather Text', 64), field('CloudPct', 'esriFieldTypeDouble', 'Cloud Cover (%)'), field('PressureHPA', 'esriFieldTypeDouble', 'Pressure (hPa)'), field('VisibilityKM', 'esriFieldTypeDouble', 'Visibility (km)'), field('WindKnots', 'esriFieldTypeDouble', 'Wind Speed (knots)'), field('WindFromDeg', 'esriFieldTypeDouble', 'Wind From Direction (deg)'), field('GustKnots', 'esriFieldTypeDouble', 'Gust Speed (knots)'),
  field('WaveHeightM', 'esriFieldTypeDouble', 'Wave Height (m)'), field('WaveFromDeg', 'esriFieldTypeDouble', 'Wave From Direction (deg)'), field('WavePeriodS', 'esriFieldTypeDouble', 'Wave Period (s)'), field('WindWaveM', 'esriFieldTypeDouble', 'Wind Wave Height (m)'), field('WindWaveFrom', 'esriFieldTypeDouble', 'Wind Wave From Direction (deg)'), field('WindWaveSec', 'esriFieldTypeDouble', 'Wind Wave Period (s)'), field('SwellHeightM', 'esriFieldTypeDouble', 'Swell Height (m)'), field('SwellFromDeg', 'esriFieldTypeDouble', 'Swell From Direction (deg)'), field('SwellPeriodS', 'esriFieldTypeDouble', 'Swell Period (s)'), field('SeaTempC', 'esriFieldTypeDouble', 'Sea Temperature (C)'), field('CurrentKnots', 'esriFieldTypeDouble', 'Ocean Current Speed (knots)'), field('CurrentToDeg', 'esriFieldTypeDouble', 'Ocean Current To Direction (deg)'), field('SeaLevelM', 'esriFieldTypeDouble', 'Sea Level MSL (m)'),
  field('MaxWind24Kn', 'esriFieldTypeDouble', 'Max Wind Next 24h (knots)'), field('MaxGust24Kn', 'esriFieldTypeDouble', 'Max Gust Next 24h (knots)'), field('MinVis24KM', 'esriFieldTypeDouble', 'Min Visibility Next 24h (km)'), field('Precip24MM', 'esriFieldTypeDouble', 'Precipitation Next 24h (mm)'), field('MaxWave24M', 'esriFieldTypeDouble', 'Max Wave Next 24h (m)'), field('MaxSwell24M', 'esriFieldTypeDouble', 'Max Swell Next 24h (m)'), field('MaxCurrent24Kn', 'esriFieldTypeDouble', 'Max Current Next 24h (knots)'), field('ForecastStart', 'esriFieldTypeDate', 'Forecast Start'), field('ForecastEnd', 'esriFieldTypeDate', 'Forecast End')
];
const layerDefs = [
  { idKey: 'currentLayerId', name: 'Current Vessel Position', geometryType: 'esriGeometryPoint', fields: sharedPositionFields, existingOnly: true },
  { idKey: 'historyLayerId', name: 'Vespucci Track History', geometryType: 'esriGeometryPoint', fields: [...sharedPositionFields, field('Source', 'esriFieldTypeString', 'Source', 32), field('PositionKey', 'esriFieldTypeString', 'Position Key', 160)], drawingInfo: pointRenderer([0, 112, 255, 180], 5) },
  { idKey: 'travelledRouteLayerId', name: 'Vespucci Travelled Route', geometryType: 'esriGeometryPolyline', fields: [field('MMSI', 'esriFieldTypeDouble', 'MMSI'), field('VesselName', 'esriFieldTypeString', 'Vessel Name', 128), field('RouteType', 'esriFieldTypeString', 'Route Type', 64), field('PointCount', 'esriFieldTypeInteger', 'Point Count'), field('StartAIS', 'esriFieldTypeDate', 'Start AIS'), field('EndAIS', 'esriFieldTypeDate', 'End AIS'), field('LastUpdated', 'esriFieldTypeDate', 'Last Updated')], drawingInfo: lineRenderer([0, 90, 180, 220], 2, 'esriSLSSolid') },
  { idKey: 'destinationLayerId', name: 'Vespucci Destination', geometryType: 'esriGeometryPoint', fields: [field('DestinationName', 'esriFieldTypeString', 'Destination Name', 160), field('PortCode', 'esriFieldTypeString', 'Port Code', 16), field('Latitude', 'esriFieldTypeDouble', 'Latitude'), field('Longitude', 'esriFieldTypeDouble', 'Longitude'), field('UpdatedAt', 'esriFieldTypeDate', 'Updated At')], drawingInfo: pointRenderer([220, 40, 40, 220], 12) },
  { idKey: 'estimatedRouteLayerId', name: 'Vespucci Estimated Route', geometryType: 'esriGeometryPolyline', fields: [field('MMSI', 'esriFieldTypeDouble', 'MMSI'), field('VesselName', 'esriFieldTypeString', 'Vessel Name', 128), field('DestinationName', 'esriFieldTypeString', 'Destination Name', 160), field('RouteType', 'esriFieldTypeString', 'Route Type', 64), field('DistanceNM', 'esriFieldTypeDouble', 'Distance (NM)'), field('SpeedKnots', 'esriFieldTypeDouble', 'Speed (knots)'), field('EstimatedETA', 'esriFieldTypeDate', 'Estimated ETA'), field('CalculatedAt', 'esriFieldTypeDate', 'Calculated At'), field('Basis', 'esriFieldTypeString', 'Basis', 256)], drawingInfo: lineRenderer([220, 40, 40, 220], 2, 'esriSLSDash') },
  { idKey: 'conditionsLayerId', name: 'Vespucci Marine Conditions', geometryType: 'esriGeometryPoint', fields: conditionsFields, drawingInfo: conditionsRenderer(), displayField: 'VesselName' }
];

const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = await client.resolveFeatureServiceUrl();
const adminFeatureServiceUrl = toAdminFeatureServiceUrl(client.featureServiceUrl);
const adminToken = process.env.ARCGIS_ADMIN_TOKEN;
const service = await client.get(`${client.featureServiceUrl}?f=json`);
if (service.error) throw new Error(`Feature service lookup failed: ${sanitizeArcGISResponse(service.error)}`);
const existingLayers = new Map((service.layers || []).map((layer) => [Number(layer.id), layer]));

const missingLayers = layerDefs.filter((def) => !def.existingOnly && !existingLayers.has(Number(config[def.idKey])));
const fieldWork = [];
for (const def of layerDefs) {
  const id = Number(config[def.idKey]);
  if (!existingLayers.has(id)) {
    if (def.existingOnly) throw new Error(`Required existing layer ${id} (${def.name}) is missing. Create/preserve Layer 0 before setup.`);
    continue;
  }
  const layer = await client.get(`${client.layerUrl(id)}?f=json`);
  const existing = new Set((layer.fields || []).map((f) => f.name.toLowerCase()));
  const missing = def.fields.filter((f) => !existing.has(f.name.toLowerCase()));
  if (missing.length) fieldWork.push({ def, id, missing });
}

if ((missingLayers.length || fieldWork.length) && !adminToken) {
  const lines = [];
  if (missingLayers.length) lines.push(`Missing layer(s): ${missingLayers.map((d) => `${config[d.idKey]} ${d.name}`).join(', ')}`);
  for (const item of fieldWork) lines.push(`Layer ${item.id} ${item.def.name} missing field(s): ${item.missing.map((f) => f.name).join(', ')}`);
  throw new Error(`${lines.join('; ')}. Set a temporary owner-level ARCGIS_ADMIN_TOKEN, rerun setup, and remove ARCGIS_ADMIN_TOKEN immediately after setup succeeds.`);
}

if (missingLayers.length) {
  const layers = missingLayers.map((def) => makeLayerDefinition(def, Number(config[def.idKey])));
  const result = await adminPost(`${adminFeatureServiceUrl}/addToDefinition`, adminToken, { layers });
  if (!result.success) throw new Error(`Feature service addToDefinition failed: ${sanitizeArcGISResponse(result)}`);
  console.log(`Added layer(s): ${missingLayers.map((d) => `${config[d.idKey]} ${d.name}`).join(', ')}`);
}
for (const item of fieldWork) {
  const result = await adminPost(`${adminFeatureServiceUrl}/${item.id}/addToDefinition`, adminToken, { fields: item.missing });
  if (!result.success) throw new Error(`Layer ${item.id} addToDefinition failed: ${sanitizeArcGISResponse(result)}`);
  console.log(`Layer ${item.id} added fields: ${item.missing.map((f) => f.name).join(', ')}`);
}
if (!missingLayers.length && !fieldWork.length) console.log('ArcGIS feature service already has all required layers and fields. ARCGIS_ADMIN_TOKEN is not needed.');

function field(name, type, alias, length) { return { name, type, alias, ...(length ? { length } : {}) }; }
function makeLayerDefinition(def, id) { return { id, name: def.name, type: 'Feature Layer', geometryType: def.geometryType, objectIdField: 'OBJECTID', displayField: def.displayField || undefined, fields: [field('OBJECTID', 'esriFieldTypeOID', 'OBJECTID'), ...def.fields], capabilities: 'Query,Create,Update,Delete,Editing', drawingInfo: def.drawingInfo, popupInfo: def.idKey === 'conditionsLayerId' ? conditionsPopup() : undefined }; }
function pointRenderer(color, size) { return { renderer: { type: 'simple', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color, size, outline: { color: [255, 255, 255, 220], width: 1 } } } }; }
function conditionsRenderer() { return { renderer: { type: 'simple', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color: [0, 0, 0, 0], size: 19, outline: { color: [0, 119, 190, 230], width: 2 } } } }; }
function conditionsPopup() { return { title: 'Vespucci marine conditions', fieldInfos: conditionsFields.map((f) => ({ fieldName: f.name, label: f.alias, visible: true })) }; }
function lineRenderer(color, width, style) { return { renderer: { type: 'simple', symbol: { type: 'esriSLS', style, color, width } } }; }
function toAdminFeatureServiceUrl(url) { if (!url.includes('/arcgis/rest/services/')) throw new Error(`Cannot derive ArcGIS admin URL from feature service URL: ${url}`); return url.replace('/arcgis/rest/services/', '/arcgis/rest/admin/services/'); }
function sanitizeArcGISResponse(response) { return JSON.stringify(response, (key, value) => (key.toLowerCase().includes('token') ? '[redacted]' : value)); }
async function adminPost(url, token, definition) { return client.rawPost(url, new URLSearchParams({ f: 'json', token, addToDefinition: JSON.stringify(definition) })); }
