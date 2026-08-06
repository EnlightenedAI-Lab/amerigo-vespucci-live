import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { VESPUCCI_WEBMAP_ITEM_ID } from '../src/ocean-view-config.js';
import {
  getItemAccess,
  probeAnonymousArcGIS,
  publishArcGISItem
} from '../src/arcgis-sharing.js';

const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = config.arcgisFeatureServiceUrl;

const featureItemId = config.arcgisItemId;
const webmapItemId = VESPUCCI_WEBMAP_ITEM_ID;

const before = {
  feature: await getItemAccess(client, featureItemId),
  webmap: await getItemAccess(client, webmapItemId)
};

const feature = await publishArcGISItem(client, featureItemId);
const webmap = await publishArcGISItem(client, webmapItemId);

const after = {
  feature: await getItemAccess(client, featureItemId),
  webmap: await getItemAccess(client, webmapItemId)
};

const serviceUrl = config.arcgisFeatureServiceUrl;
const anonymous = {
  serviceMeta: await probeAnonymousArcGIS(`${serviceUrl}?f=json`),
  layer0: await probeAnonymousArcGIS(`${serviceUrl}/0/query?f=json&where=1%3D1&returnCountOnly=true`),
  layer3: await probeAnonymousArcGIS(`${serviceUrl}/3/query?f=json&where=1%3D1&returnCountOnly=true`),
  layer4: await probeAnonymousArcGIS(`${serviceUrl}/4/query?f=json&where=1%3D1&returnCountOnly=true`),
  webmap: await probeAnonymousArcGIS(`https://www.arcgis.com/sharing/rest/content/items/${webmapItemId}/data?f=json`)
};

console.log(JSON.stringify({ before, feature, webmap, after, anonymous }, null, 2));
