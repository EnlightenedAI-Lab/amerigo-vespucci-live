import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { runArcGISDiagnostics } from '../src/arcgis-diagnostics.js';
import { repairVespucciOperationalLayers } from '../src/vespucci-layer-repair.js';
import { runWebMapRepair } from '../src/webmap-repair.js';

const dryRun = !process.argv.includes('--apply');
const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = config.arcgisFeatureServiceUrl;

const diagnostics = await runArcGISDiagnostics(client, config);
const operational = await repairVespucciOperationalLayers(client, config, diagnostics, { dryRun });
const { plan, applyResult } = await runWebMapRepair(client, config, diagnostics, { dryRun });

const output = {
  mode: dryRun ? 'dry-run' : 'apply',
  featureServiceUrl: client.featureServiceUrl,
  layers: diagnostics.layers,
  operationalRepair: operational,
  webmapRepair: {
    summary: plan.summary,
    layerOrder: plan.layerOrder,
    duplicatesRemoved: plan.duplicatesRemoved,
    featureRebuildResults: plan.featureRebuildResults
  },
  applyResult
};

console.log(JSON.stringify(output, null, 2));
if (dryRun) {
  console.error('\nDry-run only. Re-run with --apply to repair features and WebMap (Layer 0 geometry is never modified).');
}
