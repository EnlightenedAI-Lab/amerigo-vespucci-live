/**
 * Phase 5 — ArcGIS-native agentic adapter feasibility (inspected, not assumed).
 */
export const ESRI_AI_FEASIBILITY = Object.freeze({
  schemaVersion: '1.0.0',
  compatible: 'PARTIAL',
  implementationStatus: 'BOUNDED_CUSTOM_AGENT_PILOT',
  sdkVersion: '5.1 (ArcGIS Maps SDK for JavaScript via CDN js.arcgis.com/5.1)',
  aiComponentsPackageInstalled: false,
  mapArchitecture: 'MapView + WebMap (Core API via $arcgis.import); NOT arcgis-map web component',
  authentication: 'Montreal OAuth portal (montreal-arcgis-oauth.js)',
  layerComposition: 'WebMap operational layers + runtime GraphicsLayer/FeatureLayer (iqai-deterministic-results, intelligence layers, analytical hospitals)',
  builtInAgentsEvaluated: Object.freeze({
    navigationAgent: {
      tested: false,
      integrated: false,
      limitation: 'Built-in Navigation Agent mutates MapView directly and bypasses IQAI MapActionPlan validator — isolated, not production-wired'
    },
    dataExplorationAgent: {
      tested: false,
      integrated: false,
      limitation: 'Requires @arcgis/ai-components + FeatureLayer-centric context; IQAI results primarily use GraphicsLayer — not safely authoritative without redesign'
    },
    customFunctionAgent: {
      tested: true,
      integrated: true,
      approach: 'IQAI MAP SPECIALIST bounded allowlist → structured proposal → MapActionPlan → validator → executor'
    }
  }),
  orgEligibility: 'UNKNOWN — @arcgis/ai-components not installed; pilot uses IQAI adapter without Esri Assistant orchestration',
  rationale: [
    'Inspected: package.json has no @arcgis/ai-components dependency.',
    'Inspected: spatial-arcgis-runtime.js loads ArcGIS 5.1 CDN, single MapView + WebMap.',
    'Inspected: IQAI map mutations flow through MapActionPlan validator + ArcGIS executor.',
    'Built-in Esri agents would introduce dual-orchestrator risk; custom bounded adapter preserves authority.',
    'GraphicsLayer-heavy IQAI results limit native Data Exploration Agent without layer redesign.'
  ],
  adapterSeam: Object.freeze({
    flow: 'Map-local prompt → ESRI_MAP_AGENT capability → structured proposal → MapActionPlan → validator → ArcGIS executor',
    authority: 'IQAI Coordinator remains system coordinator; Esri subordinate MAP-LOCAL only',
    bypassProhibited: true
  }),
  pilotFeatureFlag: 'IQAI_ESRI_AGENTIC_V1_ENABLED'
});

export function assessEsriAiFeasibility() {
  return { ...ESRI_AI_FEASIBILITY, assessedAt: new Date().toISOString() };
}
