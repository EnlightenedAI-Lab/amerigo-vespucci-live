import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { bootstrapHistoryFromVerifiedSources } from '../src/history-bootstrap.js';

const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = config.arcgisFeatureServiceUrl;

const result = await bootstrapHistoryFromVerifiedSources(client, config);
console.log(JSON.stringify(result, null, 2));
