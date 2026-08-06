import 'dotenv/config';
import { loadConfig, DEFAULT_FEATURE_SERVICE_URL } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { PublicArcGISClient } from '../src/public-arcgis-client.js';
import { runArcGISDiagnostics } from '../src/arcgis-diagnostics.js';

function readServiceUrlArg() {
  const idx = process.argv.indexOf('--url');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.ARCGIS_FEATURE_SERVICE_URL || DEFAULT_FEATURE_SERVICE_URL || null;
}

function hasArcgisCredentials() {
  return Boolean(process.env.ARCGIS_TOKEN || (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD));
}

function buildDiagnosticsConfig(publicUrl) {
  if (publicUrl && !hasArcgisCredentials()) {
    return {
      targetMmsi: Number(process.env.TARGET_MMSI || '247999000'),
      currentLayerId: Number(process.env.ARCGIS_CURRENT_LAYER_ID || '0'),
      historyLayerId: Number(process.env.ARCGIS_HISTORY_LAYER_ID || '1'),
      travelledRouteLayerId: Number(process.env.ARCGIS_TRAVELLED_ROUTE_LAYER_ID || '2'),
      destinationLayerId: Number(process.env.ARCGIS_DESTINATION_LAYER_ID || '3'),
      estimatedRouteLayerId: Number(process.env.ARCGIS_ESTIMATED_ROUTE_LAYER_ID || '4'),
      conditionsLayerId: Number(process.env.ARCGIS_CONDITIONS_LAYER_ID || '5'),
      routeMaxHistoryPoints: Number(process.env.ROUTE_MAX_HISTORY_POINTS || '5000')
    };
  }
  return loadConfig({ requireAIS: false });
}

async function createDiagnosticClient(config, publicUrl) {
  if (hasArcgisCredentials()) {
    const client = new ArcGISClient(config);
    await client.ensureValidToken();
    client.featureServiceUrl = config.arcgisFeatureServiceUrl || publicUrl || await client.resolveFeatureServiceUrl();
    return { client, authMode: 'server-credentials' };
  }
  if (publicUrl) {
    return { client: new PublicArcGISClient(publicUrl), authMode: 'public-rest' };
  }
  throw new Error(
    'ArcGIS diagnostics require ARCGIS_FEATURE_SERVICE_URL, --url <FeatureServer>, or ARCGIS_TOKEN/ARCGIS_USERNAME credentials.'
  );
}

const publicUrl = readServiceUrlArg();
const config = buildDiagnosticsConfig(publicUrl);
const { client, authMode } = await createDiagnosticClient(config, publicUrl);
const report = await runArcGISDiagnostics(client, config);
report.authMode = authMode;
console.log(JSON.stringify(report, null, 2));
