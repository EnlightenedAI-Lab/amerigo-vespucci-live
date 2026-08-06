import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { repairGeometrySpatialReference } from '../src/geometry-sr-repair.js';

const dryRun = !process.argv.includes('--apply');
const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = config.arcgisFeatureServiceUrl;

const result = await repairGeometrySpatialReference(client, config, { dryRun });
console.log(JSON.stringify(result, null, 2));

if (dryRun) {
  console.error('\nDry-run only. Re-run with --apply to repair Layer 3/4/5 geometries (Layer 0 is never modified).');
}
