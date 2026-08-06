import { loadConfig } from '../src/config.js';
import { ArcGISClient } from '../src/arcgis.js';
import { runArcGISDiagnostics } from '../src/arcgis-diagnostics.js';
import { runWebMapRepair } from '../src/webmap-repair.js';

const dryRun = !process.argv.includes('--apply');
const config = loadConfig({ requireAIS: false });
const client = new ArcGISClient(config);
await client.ensureValidToken();
client.featureServiceUrl = config.arcgisFeatureServiceUrl || await client.resolveFeatureServiceUrl();

const diagnostics = await runArcGISDiagnostics(client, config);
const { plan, applyResult } = await runWebMapRepair(client, config, diagnostics, { dryRun });

const output = {
  mode: dryRun ? 'dry-run' : 'apply',
  diagnosticsSummary: diagnostics.layers.map((l) => ({
    layerId: l.layerId,
    name: l.name,
    featureCount: l.featureCount,
    hasValidGeometry: l.hasValidGeometry,
    latestTimestamp: l.latestTimestamp,
    travelledRouteNote: l.travelledRouteNote || null
  })),
  repairPlan: {
    summary: plan.summary,
    duplicatesRemoved: plan.duplicatesRemoved,
    layersAdded: plan.layersAdded,
    layerOrder: plan.layerOrder,
    preservedLayers: plan.preservedLayers,
    oceanCurrentsPreserved: plan.summary.oceanCurrentsPreserved,
    oceanCurrentsTitle: plan.oceanCurrentsTitle,
    visibilityChanges: plan.visibilityChanges,
    rendererChanges: plan.rendererChanges,
    featureRebuilds: plan.featureRebuilds,
    travelledRouteNote: plan.travelledRouteNote,
    vesselGeometryUntouched: plan.vesselGeometryUntouched
  },
  applyResult
};

console.log(JSON.stringify(output, null, 2));
if (dryRun) {
  console.error('\nDry-run only. Re-run with --apply to write WebMap changes (never alters Layer 0 geometry).');
}
