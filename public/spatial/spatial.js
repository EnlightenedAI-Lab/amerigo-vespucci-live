import { AppShell } from './shell/AppShell.js';
import {
  getMapViewCreateCount,
  getWebMapCreateCount
} from './spatial-arcgis-runtime.js';
import { mountSpatialDevBadge } from './spatial-dev-badge.js';
import { mountEsriMapAgentPilot } from './orchestrator/esri-map-agent-pilot.js';
import { mountDeterministicAcceptanceHarness } from './spatial-deterministic-acceptance.js';
import { installWebStyleSymbolTrace } from './spatial-auth-native-diagnostic.js';
import { initA1RuntimeProvenance } from './a1-runtime-provenance.js';
import { initGisPlanDevRuntime } from './a1-gis-plan-runtime.js';
import { mountAiMapUiAcceptanceHarness } from './a1-ai-map-ui-acceptance.js';
import { mountPointIntelligenceAcceptanceHarness } from './a1-point-intelligence-acceptance.js';
import { mountPointIntelligenceV2AcceptanceHarness } from './a1-point-intelligence-v2-acceptance.js';
import { mountPointIntelligenceV3AcceptanceHarness } from './a1-point-intelligence-v3-acceptance.js';
import { mountLifPhase1AcceptanceHarness } from './a1-location-intelligence-focus-phase1-acceptance.js';
import { mountLifPhase2AcceptanceHarness } from './a1-location-intelligence-focus-phase2-acceptance.js';
import { mountLifPhase3AcceptanceHarness } from './a1-location-intelligence-focus-phase3-acceptance.js';
import { mountLifPhase4AcceptanceHarness } from './a1-location-intelligence-focus-phase4-acceptance.js';
import { mountLifPhase5AcceptanceHarness } from './a1-location-intelligence-focus-phase5-acceptance.js';

installWebStyleSymbolTrace();
initA1RuntimeProvenance();

const app = new AppShell(document.querySelector('#spatial-app'));
app.mount();
mountSpatialDevBadge();
mountEsriMapAgentPilot();
mountDeterministicAcceptanceHarness(app);
initGisPlanDevRuntime(app);
mountAiMapUiAcceptanceHarness(app);
mountPointIntelligenceAcceptanceHarness(app);
mountPointIntelligenceV2AcceptanceHarness();
mountPointIntelligenceV3AcceptanceHarness();
mountLifPhase1AcceptanceHarness();
mountLifPhase2AcceptanceHarness();
mountLifPhase3AcceptanceHarness();
mountLifPhase4AcceptanceHarness();
mountLifPhase5AcceptanceHarness();

if (typeof window !== 'undefined') {
  window.__IQAI_APP_SHELL__ = app;
}

window.__iqaiSpatialV1Diagnostics = () => ({
  mapViewCreateCount: getMapViewCreateCount(),
  webMapCreateCount: getWebMapCreateCount(),
  mapContainers: document.querySelectorAll('[data-spatial-map-host]').length,
  layerListItems: document.querySelectorAll('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').length
});
