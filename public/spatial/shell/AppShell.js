import { LayerPanel } from './LayerPanel.js';
import { CommandBar } from './CommandBar.js';
import { DetailPanel } from './DetailPanel.js';
import { EventTray } from './EventTray.js';
import { PanelLayout } from './PanelLayout.js';
import {
  initSpatialArcgisRuntime,
  getMapViewCreateCount,
  getWebMapCreateCount,
  isMapOperational,
  resizeMapView,
  getWebMap
} from '../spatial-arcgis-runtime.js';
import {
  renderMapResultOnRuntime,
  wireFeaturePicking,
  clearMapResultsOnRuntime,
  inspectWebMapFeatureLayers,
  getIqaiResultLayerIds,
  zoomToScopedResults,
  clearIqaiSelection,
  selectIqaiResultFeature,
  selectRuntimeLayerFeature,
  setDeterministicResultsCategoryFilter,
  setPointIntelligenceClickMode
} from '../spatial-map-command.js';
import {
  getWebMapLayerCatalogSnapshot,
  ensureLiveLayerCatalog,
  getLayerCatalogDiagnostics,
  resolveWebMapLayersFromPhrases,
  syncCatalogVisibilityFromRuntime
} from '../webmap-layer-catalog.js';
import { buildMapApiRequestBody } from '../map-request-payload.js';
import {
  executeLayerControl,
  executeLayerControls,
  executeHideAllDisplayed,
  executeHideAllSourceLayers,
  executeShowAllOperational,
  executeShowOnlyLayers,
  restoreMapLayerVisibility,
  setIqaiResultsVisible
} from '../webmap-layer-commands.js';
import { executeClientWebMapLayerQueries } from '../webmap-layer-query.js';
import { resetDeterministicExecutionState, applyPrimaryDatasetResultState } from '../deterministic-result-state.js';
import { A1_APP_SHELL_VERSION, recordCommandBoundary } from '../a1-runtime-provenance.js';
import {
  formatAiMapUiResponse,
  formatAiMapSuccessMessage,
  formatAiMapSuccessChain
} from '../ai-map-ui-status.js';
import { PointIntelligenceControl } from '../point-intelligence-control.js';
import {
  runPointIntelligenceQuery,
  getPointIntelligencePresentation,
  subscribePointIntelligenceState,
  isPointIntelligenceModeEnabled
} from '../point-intelligence-service.js';
import {
  mountPointIntelligenceFocusInteraction
} from '../point-intelligence-focus-controller.js';
import {
  mountPointIntelligenceInspector
} from '../point-intelligence-inspector-controller.js';
import {
  mountStreetLevelContext
} from '../street-level-context-controller.js';
import {
  initPointIntelligenceTemporalController
} from '../point-intelligence-temporal-controller.js';
import { OpenWorldIntelligenceControl, mountOpenWorldIntelligenceInteraction } from '../open-world-intelligence-control.js';
import { mountOpenWorldIntelligenceFocus } from '../open-world-intelligence-focus-controller.js';
import { isTemporalModeExecutable } from '../point-intelligence-temporal-support.js';
import { getUnsupportedTemporalMessage } from '../point-intelligence-temporal-gate.js';
import { summarizePointIntelligenceResponse } from '../point-intelligence-status.js';
import {
  attachCategorySummary,
  publishCanonicalDeterministicResult,
  recordCommandLifecycle
} from '../canonical-result-state.js';
import {
  beginDeterministicCommand,
  buildEmptyCanonicalResult,
  commitCanonicalToTransaction,
  getCommittedCanonicalResult,
  markCommandStage,
  setCommandRequestContext,
  settleDeterministicCommand,
  updateCommandTransactionMeta,
  awaitDeterministicCommandSettled
} from '../deterministic-command-transaction.js';
import { resetRendererDisplayState } from '../spatial-renderer-telemetry.js';
import {
  planLayerAwareClientCommand,
  buildListLayersMapResult,
  buildLayerControlMapResult,
  buildLayerControlsMapResult,
  buildMixedLayerControlsMapResult
} from '../layer-aware-wiring.js';
import {
  getConversationState,
  resetConversationState,
  recordConversationFromList,
  recordConversationFromLayerControls,
  recordConversationFromMapResult,
  patchConversationState
} from '../spatial-conversation-state.js';
import { expandConversationInput } from '../spatial-conversation-resolve.js';
import {
  responseForListLayers,
  responseForLayerControls,
  responseForMixedLayerControls,
  responseForHideAll,
  responseForHideAllSource,
  responseForShowAll,
  responseForShowOnly,
  responseForReset,
  responseForLocationReuse,
  responseForMapResult,
  responseForCategoryFilter,
  responseForResultCleared,
  responseForScopedVisibility,
  responseForClarification,
  responseForError
} from '../conversation-response.js';
import {
  ensureMontrealOAuthRegistered,
  fetchMontrealOAuthConfig,
  signInToMontrealArcgis,
  formatArcgisOAuthError
} from '../montreal-arcgis-oauth.js';
import { startStmLiveBusesLayer } from '../stm-live-buses.js';
import { startHydroQuebecOutagesLayer } from '../hydro-quebec-outages.js';
import { startAircraftLiveLayer } from '../aircraft-live.js';
import { startVesselsLiveLayer } from '../vessels-live.js';
import {
  WORKSPACES,
  setActiveWorkspace,
  clearActiveSelection,
  subscribeWorkspaceContext
} from '../workspace-context.js';
import {
  getSourcePresentation,
  inheritSourceRenderer,
  getOsmNaAmenitiesSourceDef,
  hydratePresentationRenderer
} from '../source-presentation.js';
import {
  buildOperationalFeaturesTableModel,
  buildResultScopedLegend,
  publishResultLegendDiagnostics
} from '../results-table-model.js';
import {
  syncXrayOperationalDisplay,
  clearXrayOperationalDisplay,
  queryXrayOperationalFeatures
} from '../xray-operational-map.js';
import {
  buildOperationalLegendEntries,
  renderOperationalLegendHtml
} from '../operational-legend.js';
import { setOperationalLegendContent } from '../spatial-arcgis-runtime.js';
import {
  clearLegendDiagnostic
} from '../iqai-legend-diagnostic.js';
import {
  clearMapCommandDiagnostics,
  markMapDiagStage,
  captureMapCommandFailure,
  formatMapCommandFailureMessage,
  getLastMapCommandError,
  snapshotApiBody,
  wrapMapCommandError
} from '../map-command-diagnostics.js';
import { applySpatialBrandDocumentTitle } from '../iqai-spatial-brand.js';
import { publishDeterministicResultAccounting } from '../deterministic-result-accounting.js';

const LEGACY_UNSUPPORTED_MESSAGE =
  'IQAI Spatial V1 does not yet support that mapping request.';
const V1_SERVER_HINT =
  'Wrong server on port 3000. Stop other Node processes, then run: npm run spatial';

export class AppShell {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.oauthRegistration = null;
    this.systemIndicator = null;
    this.detailPanel = null;
    this.commandBar = null;
    this.layerPanel = null;
    this.mapHost = null;
    this.mapControlsHost = null;
    this.mapToolsHost = null;
    this.measureToolsHost = null;
    this.arcgisInitStarted = false;
    this.mapOperational = false;
    this.lastMapResult = null;
    this.previousLocationText = null;
    this.previousMatchedAddress = null;
    this.eventTray = null;
    this.selectionWired = false;
    this.stmLiveHandle = null;
    this.hydroLiveHandle = null;
    this.aircraftLiveHandle = null;
    this.vesselsLiveHandle = null;
    this.workspaceUnsubscribe = null;
    this.lastXrayMapResult = null;
    this.lastXrayPresentation = null;
    /** Authoritative X-ray amenity visibility — checked checkbox = member of this Set. */
    this.visibleCategories = new Set();
    this.xrayTableViewMode = 'categories';
    this.activeCommandId = 0;
  }

  formatResultCounter(mapResult) {
    if (!mapResult?.supported) return '';
    if (mapResult.action === 'CATEGORY_COUNTS_WITHIN' || mapResult.summary?.displayMode === 'category_counts') {
      const cats = mapResult.xrayResult?.totalCategories ?? 0;
      const represented = mapResult.xrayResult?.totalFeaturesRepresented ?? 0;
      return `${cats} CATEGORIES · ${represented} REPRESENTED`;
    }
    const total = mapResult.summary?.matchedFeatures ?? mapResult.features?.length ?? 0;
    if (mapResult.summary?.action === 'COMPOUND' && mapResult.datasetResults?.length) {
      const parts = mapResult.datasetResults.map((result) => {
        const label = result.displayName?.replace(/\s+Stations?$/i, '').replace(/\s+Stops?$/i, '') || result.datasetId;
        const count = result.features?.length ?? 0;
        return `${label} ${count}`;
      });
      return `${total} RESULTS — ${parts.join(' · ')}`;
    }
    return `${total} RESULTS`;
  }

  async updateMapPresentation(mapResult) {
    this.commandBar?.setResultCounter(this.formatResultCounter(mapResult));
    this.eventTray?.setMapLedger(mapResult);
    if (mapResult?.action === 'CATEGORY_COUNTS_WITHIN' || mapResult?.summary?.displayMode === 'category_counts') {
      this.eventTray?.setMapResults(mapResult, {
        presentation: this.lastXrayPresentation,
        mode: 'category_summary',
        visibleCategories: this.visibleCategories,
        operationalMode: true
      });
      this.eventTray?.setViewMode?.(this.xrayTableViewMode);
    } else if (mapResult?.supported) {
      const presentation = await this.resolveFeatureLegendPresentationAsync(mapResult);
      this.eventTray?.setMapResults(mapResult, { presentation });
      const legend = buildResultScopedLegend(mapResult, presentation);
      publishResultLegendDiagnostics(
        legend,
        mapResult,
        presentation,
        typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__ : null
      );
      publishDeterministicResultAccounting(
        mapResult,
        mapResult.resultAccounting || mapResult.datasetResults?.[0]?.resultAccounting || null,
        presentation
      );
      this.eventTray?.resultsTable?.setLegendDiagnosticVisible(false);
      clearLegendDiagnostic();
    }
    this.refreshIntelligenceRail();
  }

  refreshIntelligenceRail(catalog = getWebMapLayerCatalogSnapshot()) {
    const layers = Array.isArray(catalog?.layers) ? catalog.layers : [];
    const toggleable = layers.filter((layer) => layer.type !== 'group' && layer.type !== 'unknown');
    const visible = toggleable.filter((layer) => layer.visible);
    this.detailPanel?.setWorkspaceSummary({
      webmapTitle: catalog?.webmapTitle,
      layerCount: toggleable.length,
      visibleCount: visible.length,
      ready: this.mapOperational
    });
    this.detailPanel?.setActiveDataSummary(visible.map((layer) => ({
      title: layer.title,
      parentGroup: layer.parentGroup,
      type: layer.type
    })));
    this.layerPanel?.refreshCatalog(catalog);
  }

  async resolveFeatureLegendPresentationAsync(mapResult) {
    let presentation = this.resolveFeatureLegendPresentation(mapResult);
    const primary = mapResult?.datasetResults?.[0] || null;
    const datasetLabel = String(
      primary?.displayName || mapResult?.summary?.dataset || ''
    ).toLowerCase();
    const isAmenities = datasetLabel.includes('amenit')
      || primary?.sourceId === 'OSM_NA_AMENITIES'
      || primary?.sourceType === 'TRUSTED_EXTERNAL';
    if (!presentation && isAmenities) {
      presentation = await getSourcePresentation(getOsmNaAmenitiesSourceDef());
      this.lastXrayPresentation = presentation;
    }
    if (presentation && isAmenities) {
      presentation = await hydratePresentationRenderer(presentation, getOsmNaAmenitiesSourceDef());
      this.lastXrayPresentation = presentation;
    }
    return presentation;
  }

  resolveFeatureLegendPresentation(mapResult) {
    const datasets = mapResult?.datasetResults || [];
    for (const result of datasets) {
      if (result.renderMeta?.sourcePresentation) {
        return result.renderMeta.sourcePresentation;
      }
    }
    return this.lastXrayPresentation || null;
  }

  async enrichExternalPresentation(mapResult) {
    if (!mapResult?.datasetResults?.length) return;
    for (const result of mapResult.datasetResults) {
      if (result.sourceType !== 'TRUSTED_EXTERNAL' && result.sourceId !== 'OSM_NA_AMENITIES') continue;
      let presentation = this.lastXrayPresentation || await getSourcePresentation(getOsmNaAmenitiesSourceDef());
      presentation = await hydratePresentationRenderer(presentation, getOsmNaAmenitiesSourceDef());
      this.lastXrayPresentation = presentation;
      const semanticField = result.renderMeta?.semanticField || result.provenance?.semanticField;
      const semanticValue = result.renderMeta?.semanticValue || result.provenance?.semanticValue;
      result.renderMeta = {
        ...result.renderMeta,
        sourcePresentation: presentation,
        inheritedRenderer: inheritSourceRenderer(presentation, semanticField, semanticValue)
      };
    }
  }

  clearMapPresentation() {
    this.commandBar?.setResultCounter('');
    this.commandBar?.setUnderstoodLine('');
    this.commandBar?.setResponseLine('');
    this.eventTray?.clearLedger();
    setOperationalLegendContent(null);
    clearLegendDiagnostic();
    if (typeof window !== 'undefined') {
      window.__IQAI_RESULT_LEGEND__ = null;
    }
  }

  async clearTransientMapResults() {
    await clearMapResultsOnRuntime();
    const { listIntelligenceLayers, unregisterIntelligenceLayer } = await import('../intelligence-layer-registry.js');
    const { removeIntelligenceLayerFromMap } = await import('../intelligence-layer-map.js');
    const { resetMapActionExecutorStore } = await import('../orchestrator/map-action-executor.js');
    const { resetIntelligenceMapActionExecutorStore } = await import('../orchestrator/intelligence-map-action-executor.js');
    for (const entry of listIntelligenceLayers()) {
      await removeIntelligenceLayerFromMap(entry.layerId);
      unregisterIntelligenceLayer(entry.layerId);
    }
    resetMapActionExecutorStore();
    resetIntelligenceMapActionExecutorStore();
    if (typeof window !== 'undefined') {
      window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ = null;
      window.__IQAI_ORCHESTRATOR_STATUS__ = null;
    }
  }

  updateOperationalLegend(mapResult = this.lastXrayMapResult) {
    const xray = mapResult?.xrayResult;
    if (!xray?.categories?.length) {
      setOperationalLegendContent(null);
      return;
    }
    const filteredXray = {
      ...xray,
      categories: xray.categories.filter((entry) => this.visibleCategories.has(entry.value))
    };
    if (!filteredXray.categories.length) {
      setOperationalLegendContent('');
      return;
    }
    const presentation = this.lastXrayPresentation;
    const entries = buildOperationalLegendEntries(filteredXray, presentation);
    setOperationalLegendContent(renderOperationalLegendHtml(entries));
  }

  refreshCategoryTableUI() {
    const total = this.lastXrayMapResult?.xrayResult?.categories?.length ?? 0;
    this.eventTray?.updateCategorySelection(this.visibleCategories);
    this.eventTray?.updateVisibilityStatus(this.visibleCategories.size, total);
  }

  async syncXrayOperationalFromVisible() {
    const mapResult = this.lastXrayMapResult;
    const xray = mapResult?.xrayResult;
    if (!xray) return;
    const origin = this.getXrayOrigin(mapResult);
    if (!origin) return;
    const presentation = this.lastXrayPresentation || await getSourcePresentation(getOsmNaAmenitiesSourceDef());
    this.lastXrayPresentation = presentation;
    const radiusMeters = xray.radiusMeters
      ?? mapResult.summary?.radiusMeters
      ?? (xray.radiusKm ? xray.radiusKm * 1000 : null);
    await syncXrayOperationalDisplay({
      originLat: origin.latitude,
      originLon: origin.longitude,
      radiusMeters,
      semanticField: xray.semanticField || 'amenity',
      categoryValues: [...this.visibleCategories],
      presentation,
      sourceDef: getOsmNaAmenitiesSourceDef()
    });
    patchConversationState({ lastXraySelectedCategories: [...this.visibleCategories] });
    this.updateOperationalLegend(mapResult);
  }

  async setCategoryVisible(categoryValue, visible) {
    if (!categoryValue || !this.lastXrayMapResult?.xrayResult) return;
    if (visible) this.visibleCategories.add(categoryValue);
    else this.visibleCategories.delete(categoryValue);
    await this.syncXrayOperationalFromVisible();
    this.refreshCategoryTableUI();
    this.initMapSelection();
    if (this.xrayTableViewMode === 'features') {
      await this.switchToXrayFeaturesMode();
    }
  }

  async toggleXrayCategory(categoryValue, selected) {
    await this.setCategoryVisible(categoryValue, selected);
  }

  async clearAllVisibleCategories() {
    this.visibleCategories.clear();
    await this.syncXrayOperationalFromVisible();
    this.refreshCategoryTableUI();
    if (this.xrayTableViewMode === 'features') {
      await this.switchToXrayCategoriesMode();
    }
  }

  async clearXrayOperationalSelection() {
    await this.clearAllVisibleCategories();
  }

  async selectAllVisibleCategories() {
    const xray = this.lastXrayMapResult?.xrayResult;
    if (!xray?.categories?.length) return;
    this.visibleCategories = new Set(
      xray.categories.map((entry) => entry.value).filter(Boolean)
    );
    await this.syncXrayOperationalFromVisible();
    this.refreshCategoryTableUI();
    this.initMapSelection();
    this.setConversationResponse(`All ${xray.categories.length} categories shown.`);
  }

  async showAllXrayCategories() {
    await this.selectAllVisibleCategories();
  }

  getXrayOrigin(mapResult = this.lastXrayMapResult) {
    const origin = mapResult?.origin;
    if (origin?.latitude != null && origin?.longitude != null) {
      return { latitude: origin.latitude, longitude: origin.longitude };
    }
    const lat = mapResult?.originLat ?? mapResult?.latitude;
    const lon = mapResult?.originLon ?? mapResult?.longitude;
    if (lat != null && lon != null) return { latitude: lat, longitude: lon };
    return null;
  }

  async switchToXrayCategoriesMode() {
    this.xrayTableViewMode = 'categories';
    if (!this.lastXrayMapResult) return;
    this.eventTray?.restoreCategorySummary(this.lastXrayMapResult, this.lastXrayPresentation, {
      visibleCategories: this.visibleCategories,
      viewMode: 'categories'
    });
    this.eventTray?.setResultsOpen(true);
    this.refreshCategoryTableUI();
  }

  async switchToXrayFeaturesMode() {
    if (!this.visibleCategories.size) {
      this.setConversationResponse('Select at least one category to view features.');
      return;
    }
    const queryResult = await queryXrayOperationalFeatures();
    const model = buildOperationalFeaturesTableModel(
      queryResult.features,
      this.lastXrayMapResult.xrayResult
    );
    if (!model) {
      this.setConversationResponse('No features found for selected categories.');
      return;
    }
    this.xrayTableViewMode = 'features';
    this.eventTray?.applyOperationalFeaturesModel(model, queryResult.truncated);
    this.setConversationResponse(
      queryResult.truncated
        ? 'Showing first 500 features from selected categories (table cap).'
        : `Showing ${model.totalCount} features from selected categories.`
    );
  }

  wireResultsTable() {
    if (!this.eventTray) return;
    this.eventTray.setResultsToggleHandler((open) => {
      if (!this.panelLayout) return;
      if (open) {
        this.panelLayout.expand('bottom');
        if (this.panelLayout.bottomHeight < 280) {
          this.panelLayout.bottomHeight = 300;
          this.panelLayout.applyLayout();
        }
      } else {
        this.panelLayout.collapse('bottom');
      }
    });
    this.eventTray.setRowSelectHandler(async (row) => {
      const isLiveFeed = row.layerId === 'live-aircraft' || row.layerId === 'live-vessels';
      const selection = isLiveFeed
        ? await selectRuntimeLayerFeature({
          layerId: row.layerId,
          mapObjectId: row.mapObjectId
        })
        : await selectIqaiResultFeature({
          layerId: row.layerId,
          datasetId: row.datasetId,
          mapObjectId: row.mapObjectId
        });
      if (selection.ok && selection.graphic) {
        this.detailPanel?.setFeatureDetail(
          selection.graphic.attributes,
          this.lastMapResult,
          selection.graphic
        );
        this.eventTray?.highlightResultsRowFromMap(selection.graphic.attributes);
      }
    });
    this.eventTray.setCategoryToggleHandler(async (categoryValue, selected) => {
      await this.toggleXrayCategory(categoryValue, selected);
    });
    this.eventTray.setCategoryFilterHandler(async (categoryValue) => {
      await setDeterministicResultsCategoryFilter(categoryValue);
    });
    this.eventTray.setCategoryFilterChangeHandler((categoryValue, activeMeta) => {
      this.detailPanel?.setActiveCategoryFilter(categoryValue, this.lastMapResult, activeMeta);
      if (activeMeta?.label) {
        this.setConversationResponse(responseForCategoryFilter(activeMeta.label, activeMeta.count));
      }
    });
    this.eventTray.setClearResultHandler(() => this.clearDeterministicResult());
    this.eventTray.setOperationalActionHandler(async (action) => {
      switch (action) {
        case 'categories':
          await this.switchToXrayCategoriesMode();
          break;
        case 'features':
          await this.switchToXrayFeaturesMode();
          break;
        default:
          break;
      }
    });
  }

  async clearDeterministicResult(commandId = this.activeCommandId) {
    const hadResult = Boolean(this.lastMapResult?.supported || this.lastXrayMapResult?.supported);
    await clearMapResultsOnRuntime();
    clearIqaiSelection(true);
    this.lastMapResult = null;
    this.lastXrayMapResult = null;
    this.visibleCategories.clear();
    this.detailPanel?.clearMapResult();
    this.detailPanel?.setActiveCategoryFilter(null);
    this.clearMapPresentation();
    this.eventTray?.clearLedger();
    resetRendererDisplayState(commandId);
    if (typeof window !== 'undefined') {
      window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__ = null;
      window.__IQAI_DETERMINISTIC_EXECUTION_RECEIPT__ = null;
      window.__IQAI_RESULT_RENDERER__ = null;
    }
    const empty = buildEmptyCanonicalResult(commandId, {
      command: 'clear result',
      operation: 'CLEAR'
    });
    commitCanonicalToTransaction(commandId, empty);
    markCommandStage(commandId, 'canonical_commit', { canonical: empty });
    markCommandStage(commandId, 'renderer_settled', { rendererMode: 'IDLE' });
    settleDeterministicCommand(commandId, empty);
    this.setConversationResponse(responseForResultCleared());
    if (!hadResult) {
      return;
    }
    this.syncWorkspaceContext();
    resizeMapView();
  }

  wireWorkspaceContext() {
    try {
      this.workspaceUnsubscribe = subscribeWorkspaceContext((ctx) => {
        this.detailPanel?.applyWorkspaceLayout(ctx);
      });
    } catch (error) {
      console.warn('[IQAI] workspace context wiring failed', error?.message || error);
    }
  }

  collectVisibleLayerIds() {
    const webMap = getWebMap();
    if (!webMap?.allLayers) return [];
    const ids = [];
    for (const layer of webMap.allLayers) {
      if (layer?.visible && layer.id) ids.push(layer.id);
    }
    if (webMap.allLayers.some((l) => l.id === 'hydro-quebec' && l.visible)) {
      ids.push('hydro-quebec-current-outages');
    }
    return ids;
  }

  resolveActiveWorkspace() {
    if (
      this.lastXrayMapResult?.action === 'CATEGORY_COUNTS_WITHIN'
      || this.lastXrayMapResult?.summary?.displayMode === 'category_counts'
    ) {
      return WORKSPACES.AMENITY_XRAY;
    }
    if (this.lastMapResult?.supported) return WORKSPACES.SCOPED_QUERY;
    return WORKSPACES.NONE;
  }

  syncWorkspaceContext() {
    try {
      const visibleLayerIds = this.collectVisibleLayerIds();
      const workspace = this.resolveActiveWorkspace();
      setActiveWorkspace(workspace, { visibleLayerIds });
    } catch (error) {
      console.warn('[IQAI] workspace sync failed', error?.message || error);
    }
  }

  setConversationResponse(text) {
    if (this._presentationTarget === 'ai-map' || this.commandBar?._suppressDeterministicFeedback) return;
    this.commandBar?.setResponseLine(text || '');
  }

  presentAiMapMessage(message, chain = [], severity = 'info') {
    this.commandBar?.setAiPhase('');
    this.commandBar?.setAiPresentation({ message: message || '', chain, severity });
  }

  async dispatchAiMapCapability(prompt, capabilityPlan, commandId) {
    const { SPATIAL_CAPABILITY, formatCapabilityUnavailableMessage } = await import('../spatial-capability-router.js');

    switch (capabilityPlan.capability) {
      case SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH: {
        const intelligenceResult = await this.tryRunIntelligenceMapCommand(prompt, {
          viaAiMap: true,
          commandId,
          capabilityPlan
        });
        return intelligenceResult || this.presentAiMapUnavailable(capabilityPlan, commandId);
      }
      case SPATIAL_CAPABILITY.DETERMINISTIC_GIS:
        return this.executeDeterministicGisViaAiMap(prompt, { commandId, capabilityPlan });
      case SPATIAL_CAPABILITY.ARCGIS_DATA_DISCOVERY:
        return this.executeArcgisDiscoveryViaAiMap(prompt, { commandId });
      case SPATIAL_CAPABILITY.PLACE_POI_SEARCH:
        return this.executePlacePoiViaAiMap(prompt, { commandId, capabilityPlan });
      case SPATIAL_CAPABILITY.CROSS_AGENT_SPATIAL:
        return this.executeCrossAgentSpatialViaAiMap(prompt, { commandId, capabilityPlan });
      case SPATIAL_CAPABILITY.POINT_INTELLIGENCE:
        return this.executePointIntelligenceViaAiMap(prompt, { commandId, capabilityPlan });
      default:
        if (!capabilityPlan.available) {
          return this.presentAiMapUnavailable(capabilityPlan, commandId);
        }
        return this.executeDeterministicGisViaAiMap(prompt, { commandId, capabilityPlan });
    }
  }

  presentAiMapUnavailable(capabilityPlan, commandId) {
    const message = capabilityPlan?.message
      || 'Requested capability is not yet available in IQAI Spatial V1.';
    this.presentAiMapMessage(message, ['Capability recognized', 'Execution unavailable'], 'warning');
    settleDeterministicCommand(commandId, buildEmptyCanonicalResult(commandId, {
      command: capabilityPlan?.parsedIntent?.sourceText || '',
      operation: 'AI_MAP_UNSUPPORTED_CAPABILITY'
    }));
    return { rejected: true, gisExecuted: false, commandId, capability: capabilityPlan.capability };
  }

  async executeDeterministicGisViaAiMap(prompt, { commandId, capabilityPlan }) {
    this.commandBar._suppressDeterministicFeedback = true;
    this.commandBar?.setAiPhase('Executing GIS…');
    try {
      const result = await this.runMapCommand(prompt, { commandId, suppressDeterministicUi: true });
      const cleared = capabilityPlan?.parsedIntent?.operation === 'CLEAR'
        || (result?.mapResult == null && !this.lastMapResult);
      const message = cleared
        ? responseForResultCleared()
        : (this.lastMapResult ? responseForMapResult(this.lastMapResult) : 'GIS command executed.');
      const chain = cleared
        ? ['Deterministic GIS', 'Map cleared']
        : ['Deterministic GIS', 'Executed'];
      this.presentAiMapMessage(message, chain, 'success');
      return { rejected: false, gisExecuted: true, commandId, cleared, result };
    } catch (error) {
      const message = error?.message || 'GIS execution failed.';
      this.presentAiMapMessage(message, ['Deterministic GIS', 'Failed'], 'error');
      return { rejected: true, gisExecuted: false, commandId };
    } finally {
      this.commandBar._suppressDeterministicFeedback = false;
    }
  }

  async executeArcgisDiscoveryViaAiMap(prompt, { commandId }) {
    const { runArcgisDiscoveryFromPrompt } = await import('../arcgis-data-add-discovery-command.js');
    this.commandBar?.setAiPhase('Searching ArcGIS…');
    try {
      const result = await runArcgisDiscoveryFromPrompt(prompt, {
        onCatalogUpdated: (catalog) => this.layerPanel?.refreshCatalog?.(catalog)
      });
      if (typeof window !== 'undefined') {
        window.__IQAI_LAST_ARCGIS_DISCOVERY__ = {
          ok: result.ok,
          searchQuery: result.searchQuery || null,
          itemId: result.addReceipt?.itemId || result.candidate?.id || null,
          title: result.addReceipt?.title || result.candidate?.title || null,
          owner: result.addReceipt?.owner || result.candidate?.owner || null,
          itemType: result.addReceipt?.type || result.candidate?.type || null,
          serviceUrl: result.addReceipt?.serviceUrl || result.candidate?.url || null,
          contentSource: result.candidate?.contentSource || null,
          sourceLabel: result.candidate?.sourceLabel || null,
          authority: result.qualification || null,
          searchAttempts: (result.searchAttempts || []).map((attempt) => ({
            query: attempt.query,
            source: attempt.source,
            resultCount: attempt.results?.length ?? attempt.resultCount ?? null
          })),
          addReceipt: result.addReceipt || null,
          added: result.added || null,
          at: new Date().toISOString()
        };
      }
      const chain = ['ArcGIS discovery', result.ok ? 'Layer added' : 'No qualifying layer'];
      this.presentAiMapMessage(result.message, chain, result.ok ? 'success' : 'warning');
      return { rejected: !result.ok, gisExecuted: result.ok, commandId, arcgisDiscovery: result };
    } catch (error) {
      const message = error?.message || 'ArcGIS discovery failed.';
      this.presentAiMapMessage(message, ['ArcGIS discovery', 'Failed'], 'error');
      return { rejected: true, gisExecuted: false, commandId };
    }
  }

  async executeCrossAgentSpatialViaAiMap(prompt, { commandId }) {
    const { runCrossAgentSpatialCommand } = await import('../orchestrator/cross-agent-orchestrator-client.js');
    this.commandBar?.setAiPhase('Cross-agent spatial analysis…');
    try {
      const result = await runCrossAgentSpatialCommand(prompt, {
        appShell: this,
        commandId,
        traceId: commandId
      });
      const chain = ['Cross-agent spatial', result.mappedCount > 0 ? 'Analysis mapped' : 'Analysis complete'];
      this.presentAiMapMessage(result.message, chain, result.mappedCount > 0 ? 'success' : 'warning');
      return {
        rejected: false,
        gisExecuted: result.mappedCount > 0,
        commandId,
        crossAgent: result
      };
    } catch (error) {
      const message = error?.message || 'Cross-agent spatial analysis failed.';
      this.presentAiMapMessage(message, ['Cross-agent spatial', 'Failed'], 'error');
      return { rejected: true, gisExecuted: false, commandId };
    }
  }

  async executePlacePoiViaAiMap(prompt, { commandId, viaAiMap = true }) {
    const { runPlacePoiSearch } = await import('../place-poi-client.js');
    if (viaAiMap) {
      this.commandBar?.setAiPhase('Searching places…');
    } else {
      this.commandBar?.setUnderstoodLine('Searching places…');
    }
    try {
      const result = await runPlacePoiSearch(prompt, {
        sessionScope: `${viaAiMap ? 'ai-map' : 'direct'}:${commandId}`,
        traceId: commandId
      });
      const chain = ['Place POI search', result.executionReceipt?.mutatedMap ? 'Results mapped' : 'No map change'];
      const message = result.message || result.error || 'Place POI search complete.';
      if (viaAiMap) {
        this.presentAiMapMessage(message, chain, result.ok ? 'success' : 'warning');
      } else {
        this.setConversationResponse(message);
        this.commandBar?.setUnderstoodLine(message);
      }
      return {
        rejected: !result.ok,
        gisExecuted: Boolean(result.executionReceipt?.mutatedMap),
        commandId,
        placePoi: result
      };
    } catch (error) {
      const message = error?.message || 'Place POI search failed.';
      if (viaAiMap) {
        this.presentAiMapMessage(message, ['Place POI search', 'Failed'], 'error');
      } else {
        this.setConversationResponse(message);
      }
      return { rejected: true, gisExecuted: false, commandId };
    }
  }

  async executePointIntelligenceViaAiMap(prompt, { commandId }) {
    const message = /why\b/i.test(prompt)
      ? 'Select a mapped intelligence feature on the map to inspect its evidence and provenance.'
      : 'Point intelligence requires a selected map location.';
    this.presentAiMapMessage(message, ['Point intelligence', 'Context required'], 'info');
    return { rejected: false, gisExecuted: false, commandId, pointIntelligence: true };
  }

  setOrchestratorStatus(status) {
    this.orchestratorStatus = status || null;
    if (status?.label) {
      if (this._presentationTarget === 'ai-map') {
        this.commandBar?.setAiPhase(status.label);
      } else if (!this.commandBar?._suppressDeterministicFeedback) {
        this.commandBar?.setUnderstoodLine(status.label);
      }
    }
    if (typeof window !== 'undefined') {
      window.__IQAI_ORCHESTRATOR_STATUS__ = status;
    }
  }

  async executeServerMapQuery(prompt, catalog, expansion = null) {
    const conversation = getConversationState();
    const requestBody = buildMapApiRequestBody({
      prompt,
      catalog: catalog || getWebMapLayerCatalogSnapshot(),
      conversation,
      previousLocationText: this.previousLocationText,
      previousMatchedAddress: this.previousMatchedAddress
    });
    const response = await fetch('/api/spatial/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const body = await response.json().catch(() => ({}));

    markMapDiagStage('api_response_received', snapshotApiBody(body, response.status));
    markMapDiagStage('api_supported_check', {
      supported: body.supported,
      responseOk: response.ok,
      httpStatus: response.status
    });

    if (!response.ok || !body.supported) {
      if (body.canonicalUtterance) {
        this.commandBar?.setUnderstoodLine(body.canonicalUtterance);
      }
      throw wrapMapCommandError('api_response_rejected', new Error(body.message || `HTTP ${response.status}`), {
        httpResponseBody: snapshotApiBody(body, response.status)
      });
    }

    if (body.canonicalUtterance) {
      this.commandBar?.setUnderstoodLine(body.canonicalUtterance);
    }

    return this.handleMapCommandBody(body, prompt, catalog, expansion, null, this.activeCommandId);
  }

  buildCommandRequestContext(body) {
    const querySpec = body.clientWebMapQueries?.[0] || null;
    return {
      requestedOperation: body.request?.action || body.summary?.action || body.action || null,
      requestedDatasetLabel: querySpec?.displayNameOverride
        || querySpec?.title
        || body.summary?.dataset
        || body.datasetResults?.[0]?.displayName
        || null,
      requestedDatasetKey: querySpec?.catalogId
        || body.summary?.conceptId
        || body.datasetResults?.[0]?.conceptId
        || body.datasetResults?.[0]?.datasetId
        || null,
      requestedRadiusMeters: body.request?.radiusMeters ?? body.summary?.radiusMeters ?? querySpec?.radiusMeters ?? null,
      requestedLocation: body.request?.locationText || body.summary?.locationText || null
    };
  }

  async finalizeSpatialCommand(commandId, mapResult, prompt, presentation = null, expansion = null, aiMeta = null) {
    let resolvedPresentation = presentation;
    const datasetLabel = String(
      mapResult?.summary?.dataset || mapResult?.datasetResults?.[0]?.displayName || ''
    ).toLowerCase();
    if (datasetLabel.includes('amenit')) {
      resolvedPresentation = resolvedPresentation || await this.resolveFeatureLegendPresentationAsync(mapResult);
      if (typeof window !== 'undefined' && window.__IQAI_AUTH_NATIVE_LAYER__) {
        try {
          const authLayer = window.__IQAI_AUTH_NATIVE_LAYER__;
          if (!authLayer.loaded) await authLayer.load();
          const rendererJson = typeof authLayer.renderer?.toJSON === 'function'
            ? authLayer.renderer.toJSON()
            : authLayer.renderer;
          const rendererClassCount = rendererJson?.uniqueValueInfos?.length
            ?? (rendererJson?.type === 'simple' ? 1 : 0);
          if (rendererClassCount > 0) {
            mapResult.categorySummary = {
              ...(mapResult.categorySummary || {}),
              field: rendererJson?.field1 || mapResult.categorySummary?.field || 'amenity',
              rawDistinctCategoryCount: rendererClassCount,
              categories: mapResult.categorySummary?.categories || []
            };
          }
        } catch {
          // fall through to presentation-based inference
        }
      }
      attachCategorySummary(mapResult, resolvedPresentation);
      const inferredCount = mapResult.categorySummary?.rawDistinctCategoryCount
        ?? resolvedPresentation?.uniqueValueInfos?.length
        ?? resolvedPresentation?.renderer?.uniqueValueInfos?.length
        ?? 0;
      if (inferredCount > 0) {
        mapResult.categorySummary = {
          ...(mapResult.categorySummary || {}),
          field: resolvedPresentation?.semanticField || mapResult.categorySummary?.field || 'amenity',
          rawDistinctCategoryCount: inferredCount,
          categories: mapResult.categorySummary?.categories || []
        };
      }
    }
    const canonical = publishCanonicalDeterministicResult(mapResult, {
      command: prompt,
      presentation: resolvedPresentation,
      commandId
    });
    this.lastMapResult = mapResult;
    markCommandStage(commandId, 'renderer_settled', {
      renderingMode: canonical?.renderingMode
        || (typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__?.mode : null)
    });
    settleDeterministicCommand(commandId, canonical || getCommittedCanonicalResult(commandId), {
      queryPopulation: canonical?.canonicalCount ?? mapResult.summary?.matchedFeatures ?? null,
      matchedFeatures: mapResult.summary?.matchedFeatures ?? null
    });
    if (mapResult.resolvedLocationText) {
      this.previousLocationText = mapResult.resolvedLocationText;
    } else if (mapResult.request?.locationText) {
      this.previousLocationText = mapResult.request.locationText;
    }
    if (mapResult.matchedAddress || mapResult.origin?.matchedAddress) {
      this.previousMatchedAddress = mapResult.matchedAddress || mapResult.origin?.matchedAddress;
    }
    recordConversationFromMapResult(prompt, mapResult);
    this.detailPanel?.setQuerySummary(mapResult);
    if (aiMeta?.planner) {
      this.detailPanel?.setField('Execution', 'AI planned · Deterministic GIS');
      this.detailPanel?.setField('Model', `${aiMeta.planner.providerLabel || aiMeta.planner.provider} · ${aiMeta.planner.model}`);
    }
    this.syncWorkspaceContext();
    this.initMapSelection();
    resizeMapView();
    this.setConversationResponse(responseForMapResult(mapResult, expansion));
    markMapDiagStage('executeServerMapQuery_success');
    return mapResult;
  }

  async handleMapCommandBody(body, prompt, catalog, expansion = null, aiMeta = null, commandId = this.activeCommandId) {
    markMapDiagStage('result_type', {
      action: body.action,
      plan: body.summary?.action || body.request?.action,
      conceptId: body.summary?.conceptId || body.datasetResults?.[0]?.conceptId,
      sourceType: body.summary?.layerSource || body.datasetResults?.[0]?.sourceType,
      layerSource: body.summary?.layerSource,
      matchedFeatures: body.summary?.matchedFeatures
    });

    if (aiMeta?.planner) {
      this.commandBar?.setAiGovernanceChain(['AI interpreted', 'IQAI validated', 'GIS executed']);
      this.commandBar?.setAiFeedback(aiMeta.interpretation || body.canonicalUtterance || '');
    }

    if (body.action === 'CLEAR') {
      await this.clearTransientMapResults();
      this.lastMapResult = null;
      this.lastXrayMapResult = null;
      this.detailPanel?.clearQueryState();
      this.clearMapPresentation();
      this.initMapSelection();
      resetRendererDisplayState(commandId);
      const empty = buildEmptyCanonicalResult(commandId, { command: prompt, operation: 'CLEAR' });
      commitCanonicalToTransaction(commandId, empty);
      markCommandStage(commandId, 'canonical_commit', { canonical: empty });
      markCommandStage(commandId, 'renderer_settled');
      settleDeterministicCommand(commandId, empty);
      resizeMapView();
      this.setConversationResponse(responseForResultCleared());
      return null;
    }

    if (body.action === 'LIST_LAYERS') {
      this.lastMapResult = body;
      recordConversationFromList(prompt, body, catalog);
      this.detailPanel?.setLayerList(body);
      this.updateMapPresentation(body);
      this.setConversationResponse(responseForListLayers(body.layers?.length || 0));
      return body;
    }

    if (body.action === 'CATEGORY_COUNTS_WITHIN') {
      let mapResult = body;
      this.lastXrayMapResult = mapResult;
      this.lastXrayPresentation = await getSourcePresentation(getOsmNaAmenitiesSourceDef());
      const categories = mapResult.xrayResult?.categories || [];
      this.visibleCategories = new Set(categories.map((entry) => entry.value).filter(Boolean));
      this.xrayTableViewMode = 'categories';
      await clearXrayOperationalDisplay();
      await renderMapResultOnRuntime(mapResult);
      mapResult.iqaiResultLayerIds = getIqaiResultLayerIds();
      this.lastMapResult = mapResult;
      if (mapResult.resolvedLocationText) {
        this.previousLocationText = mapResult.resolvedLocationText;
      }
      if (mapResult.matchedAddress || mapResult.origin?.matchedAddress) {
        this.previousMatchedAddress = mapResult.matchedAddress || mapResult.origin?.matchedAddress;
      }
      recordConversationFromMapResult(prompt, mapResult);
      this.detailPanel?.setCategoryCountsReadout(mapResult);
      this.updateMapPresentation(mapResult);
      await this.syncXrayOperationalFromVisible();
      this.eventTray?.setResultsOpen(true);
      this.refreshCategoryTableUI();
      this.syncWorkspaceContext();
      this.initMapSelection();
      resizeMapView();
      this.setConversationResponse(responseForMapResult(mapResult, expansion));
      return mapResult;
    }

    if (body.action === 'LAYER_CONTROL') {
      await executeLayerControl(body.layerControl);
      this.lastMapResult = body;
      recordConversationFromLayerControls(prompt, body.layerControl.operation, [body.layerControl], catalog);
      syncCatalogVisibilityFromRuntime();
      this.syncWorkspaceContext();
      this.detailPanel?.setQuerySummary(body);
      this.updateMapPresentation(body);
      this.setConversationResponse(responseForLayerControls(body.layerControl.operation, [{ title: body.layerControl.title }]));
      return body;
    }

    let mapResult = body;
    const requestContext = this.buildCommandRequestContext(body);
    setCommandRequestContext(commandId, requestContext);
    updateCommandTransactionMeta(commandId, {
      operation: requestContext.requestedOperation,
      dataset: requestContext.requestedDatasetLabel
    });
    const operation = requestContext.requestedOperation;
    const dataset = requestContext.requestedDatasetLabel;
    const priorAccounting = typeof window !== 'undefined'
      ? window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__?.totalMatchingObjectIds ?? null
      : null;
    recordCommandLifecycle('begin', {
      commandId,
      command: prompt,
      operation,
      dataset,
      priorAccounting,
      clientWebMapQueries: body.clientWebMapQueries?.length || 0
    });
    resetDeterministicExecutionState(prompt);
    recordCommandBoundary('handleMapCommandBody_pre_query', {
      version: A1_APP_SHELL_VERSION,
      commandId,
      command: prompt,
      operation,
      dataset,
      priorAccounting,
      clientWebMapQueries: body.clientWebMapQueries?.length || 0
    });
    if (body.clientWebMapQueries?.length) {
      markMapDiagStage('client_webmap_queries_entered', {
        queryCount: body.clientWebMapQueries.length
      });
      mapResult = await executeClientWebMapLayerQueries(body);
    } else {
      mapResult = applyPrimaryDatasetResultState({ ...body });
    }
    mapResult.commandId = commandId;
    markCommandStage(commandId, 'query_complete', {
      matchedFeatures: mapResult.summary?.matchedFeatures ?? null,
      queryPopulation: mapResult.resultAccounting?.totalMatchingObjectIds
        ?? mapResult.datasetResults?.[0]?.completeObjectIds?.length
        ?? null,
      dataset: requestContext.requestedDatasetLabel
        || mapResult.summary?.dataset
        || mapResult.datasetResults?.[0]?.displayName
        || null
    });

    const isCountOnly = String(operation || '').toUpperCase() === 'COUNT'
      || mapResult.summary?.displayMode === 'count';
    const presentation = await this.resolveFeatureLegendPresentationAsync(mapResult);
    attachCategorySummary(mapResult, presentation);
    await this.enrichExternalPresentation(mapResult);

    if (isCountOnly) {
      await this.updateMapPresentation(mapResult);
      markCommandStage(commandId, 'presentation_complete');
      return this.finalizeSpatialCommand(commandId, mapResult, prompt, presentation, expansion);
    }

    markMapDiagStage('renderMapResultOnRuntime_entered', {
      commandId,
      action: mapResult.action,
      datasetResultCount: mapResult.datasetResults?.length,
      matchedFeatures: mapResult.summary?.matchedFeatures
    });
    await setDeterministicResultsCategoryFilter(null);
    await renderMapResultOnRuntime(mapResult);
    attachCategorySummary(mapResult, presentation);
    markCommandStage(commandId, 'render_complete', {
      renderingMode: typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__?.mode : null
    });
    setOperationalLegendContent(null);
    markMapDiagStage('executeServerMapQuery_post_render');
    mapResult.iqaiResultLayerIds = getIqaiResultLayerIds();
    await this.updateMapPresentation(mapResult);
    markCommandStage(commandId, 'presentation_complete');
    return this.finalizeSpatialCommand(commandId, mapResult, prompt, presentation, expansion, aiMeta);
  }

  async handleConversationMetaAction(expanded, prompt, catalog, commandId = this.activeCommandId) {
    switch (expanded.metaAction) {
      case 'RESET_MAP': {
        await clearMapResultsOnRuntime();
        const result = await restoreMapLayerVisibility();
        syncCatalogVisibilityFromRuntime();
        resetConversationState();
        this.lastMapResult = null;
        this.previousLocationText = null;
        this.previousMatchedAddress = null;
        this.detailPanel?.clearQueryState();
        this.clearMapPresentation();
        clearIqaiSelection(true);
        resetRendererDisplayState(commandId);
        if (typeof window !== 'undefined') {
          window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__ = null;
          window.__IQAI_DETERMINISTIC_EXECUTION_RECEIPT__ = null;
          window.__IQAI_RESULT_RENDERER__ = null;
        }
        const empty = buildEmptyCanonicalResult(commandId, {
          command: prompt,
          operation: 'RESET'
        });
        commitCanonicalToTransaction(commandId, empty);
        markCommandStage(commandId, 'canonical_commit', { canonical: empty });
        markCommandStage(commandId, 'renderer_settled');
        settleDeterministicCommand(commandId, empty);
        resizeMapView();
        this.setConversationResponse(responseForReset());
        return true;
      }
      case 'CLEAR_RESULT': {
        await this.clearDeterministicResult(commandId);
        return true;
      }
      case 'HIDE_ALL_DISPLAYED': {
        const result = await executeHideAllDisplayed();
        syncCatalogVisibilityFromRuntime();
        recordConversationFromLayerControls(prompt, 'HIDE_ALL_DISPLAYED', result.layers, catalog);
        this.setConversationResponse(responseForHideAll(result.sourceCount, result.scopedCount));
        return true;
      }
      case 'HIDE_ALL_SOURCE': {
        const result = await executeHideAllSourceLayers();
        syncCatalogVisibilityFromRuntime();
        recordConversationFromLayerControls(prompt, 'HIDE_ALL_SOURCE', result.layers, catalog);
        this.setConversationResponse(responseForHideAllSource(result.count));
        return true;
      }
      case 'HIDE_ALL_OPERATIONAL': {
        const result = await executeHideAllDisplayed();
        syncCatalogVisibilityFromRuntime();
        recordConversationFromLayerControls(prompt, 'HIDE_ALL_DISPLAYED', result.layers, catalog);
        this.setConversationResponse(responseForHideAll(result.sourceCount, result.scopedCount));
        return true;
      }
      case 'SHOW_ALL_OPERATIONAL': {
        const result = await executeShowAllOperational();
        syncCatalogVisibilityFromRuntime();
        recordConversationFromLayerControls(prompt, 'SHOW_ALL_OPERATIONAL', result.layers, catalog);
        this.setConversationResponse(responseForShowAll(result.count));
        return true;
      }
      case 'SHOW_ONLY_LAYERS': {
        const resolved = resolveWebMapLayersFromPhrases(expanded.layerPhrase, catalog);
        if (resolved.error) throw new Error(resolved.error);
        await executeShowOnlyLayers(resolved.matches);
        syncCatalogVisibilityFromRuntime();
        recordConversationFromLayerControls(prompt, 'SHOW_ONLY_LAYERS', resolved.matches, catalog);
        this.setConversationResponse(responseForShowOnly(resolved.matches));
        return true;
      }
      case 'LAYER_REFERENCE': {
        await executeLayerControls(expanded.operation, expanded.layers);
        syncCatalogVisibilityFromRuntime();
        recordConversationFromLayerControls(prompt, expanded.operation, expanded.layers, catalog);
        const controlResult = buildLayerControlsMapResult(
          prompt,
          expanded.operation,
          expanded.layers,
          catalog
        );
        this.lastMapResult = controlResult;
        this.detailPanel?.setQuerySummary(controlResult);
        this.updateMapPresentation(controlResult);
        this.setConversationResponse(responseForLayerControls(expanded.operation, expanded.layers));
        return true;
      }
      case 'HIDE_SCOPED_RESULTS':
      case 'HIDE_QUERY_RESULTS': {
        const state = getConversationState();
        await setIqaiResultsVisible(false, state.lastScopedResultLayerIds || state.lastResultLayerIds);
        this.setConversationResponse(responseForScopedVisibility('HIDE_SCOPED_RESULTS'));
        return true;
      }
      case 'SHOW_SCOPED_RESULTS':
      case 'SHOW_QUERY_RESULTS': {
        const state = getConversationState();
        const layerIds = state.lastScopedResultLayerIds || state.lastResultLayerIds || [];
        const shown = await setIqaiResultsVisible(true, layerIds);
        if (!shown.updated && state.lastExecutablePrompt) {
          await this.executeServerMapQuery(state.lastExecutablePrompt, catalog, 'query_restore');
          return true;
        }
        this.setConversationResponse(responseForScopedVisibility('SHOW_SCOPED_RESULTS'));
        return true;
      }
      case 'ZOOM_SCOPED_RESULTS': {
        const state = getConversationState();
        await zoomToScopedResults(state.lastScopedResultLayerIds || state.lastResultLayerIds || []);
        this.setConversationResponse(responseForScopedVisibility('ZOOM_SCOPED_RESULTS'));
        return true;
      }
      case 'XRAY_ADD_CATEGORY': {
        if (!this.lastXrayMapResult?.xrayResult) {
          this.setConversationResponse('No category summary is active.');
          return true;
        }
        const value = expanded.xrayCategoryValue;
        if (!value) return true;
        await this.toggleXrayCategory(value, true);
        this.setConversationResponse(`Added ${value} to map display.`);
        return true;
      }
      case 'XRAY_REMOVE_CATEGORY': {
        if (!this.lastXrayMapResult?.xrayResult) {
          this.setConversationResponse('No category summary is active.');
          return true;
        }
        const value = expanded.xrayCategoryValue;
        if (!value) return true;
        await this.toggleXrayCategory(value, false);
        this.setConversationResponse(`Removed ${value} from map display.`);
        return true;
      }
      case 'XRAY_CLEAR_CATEGORIES': {
        await this.clearXrayOperationalSelection();
        this.setConversationResponse(responseForResultCleared());
        return true;
      }
      default:
        return false;
    }
  }

  mount() {
    if (!this.root) return;
    applySpatialBrandDocumentTitle('intelligence');
    this.root.className = 'spatial-app';
    this.root.innerHTML = `
      <header class="app-header">
        <div class="iqai-spatial-brand app-header__brand" data-iqai-workspace="intelligence">
          <img
            class="iqai-spatial-brand__logo"
            src="/spatial/assets/iqai-logo.svg"
            width="72"
            height="23"
            alt="IQAI"
          />
          <div class="iqai-spatial-brand__lockup" aria-label="IQAI Spatial Intelligence">
            <span class="iqai-spatial-brand__product">SPATIAL</span>
            <span class="iqai-spatial-brand__sep" aria-hidden="true">·</span>
            <span class="iqai-spatial-brand__workspace">INTELLIGENCE</span>
          </div>
        </div>
        <div class="spatial-header__actions">
          <span class="spatial-system" id="spatial-system-indicator">ArcGIS loading…</span>
          <a class="spatial-header-action" href="/spatial/intelligence-lab/">Open Investigation →</a>
        </div>
      </header>
      <div class="spatial-shell">
        <aside class="control-rail" id="spatial-layer-panel" aria-label="Data and layers"></aside>
        <div class="panel-splitter panel-splitter-col" data-resize="left" role="separator" aria-orientation="vertical" aria-label="Resize layers panel"></div>
        <div class="map-column" aria-label="Map workspace">
          <div id="spatial-command-bar"></div>
          <div id="spatial-research-control-bar" hidden></div>
          <section class="map-stage">
            <div class="map-frame">
              <button type="button" class="panel-reopen panel-reopen-left" data-reopen="left" hidden>Layers</button>
              <button type="button" class="panel-reopen panel-reopen-right" data-reopen="right" hidden>Details</button>
              <button type="button" class="panel-reopen panel-reopen-bottom" data-reopen="bottom" hidden>Results</button>
              <div id="spatial-map-host" class="spatial-map-host" data-spatial-map-host aria-label="Montreal 1 WebMap"></div>
              <div id="spatial-map-controls" class="spatial-map-controls" aria-label="Map navigation"></div>
              <div id="spatial-map-tools" class="spatial-map-tools" aria-label="Map tools"></div>
              <div id="spatial-measure-tools" class="spatial-measure-tools" aria-label="Map measurement"></div>
            </div>
          </section>
        </div>
        <div class="panel-splitter panel-splitter-col" data-resize="right" role="separator" aria-orientation="vertical" aria-label="Resize intelligence panel"></div>
        <aside class="intel-panel" id="spatial-detail-panel" aria-label="Intelligence context"></aside>
        <div class="panel-splitter panel-splitter-row" data-resize="bottom" role="separator" aria-orientation="horizontal" aria-label="Resize execution dock"></div>
        <footer class="execution-drawer context-dock" id="spatial-event-tray" aria-label="Context dock"></footer>
      </div>
    `;

    this.shell = this.root.querySelector('.spatial-shell');
    this.systemIndicator = this.root.querySelector('#spatial-system-indicator');
    this.mapHost = this.root.querySelector('#spatial-map-host');
    this.mapControlsHost = this.root.querySelector('#spatial-map-controls');
    this.mapToolsHost = this.root.querySelector('#spatial-map-tools');
    this.measureToolsHost = this.root.querySelector('#spatial-measure-tools');

    this.layerPanel = new LayerPanel(this.root.querySelector('#spatial-layer-panel'), {
      appShell: this,
      onUserLayerRemoved: () => {
        this.detailPanel?.setSelectedFeatureHtml([]);
      },
      onIntelligenceResult: (result) => this.handleIntelligenceLayerResult(result),
      onIntelligenceError: (error) => {
        this.detailPanel?.setError(error?.message || 'Intelligence research failed.');
      }
    });
    this.commandBar = new CommandBar(this.root.querySelector('#spatial-command-bar'));
    void import('../intelligence-research-control-bar.js').then(({ mountIntelligenceResearchControlBar }) => {
      this.researchControlBar = mountIntelligenceResearchControlBar(
        this.root.querySelector('#spatial-research-control-bar')
      );
    });
    this.detailPanel = new DetailPanel(this.root.querySelector('#spatial-detail-panel'));
    this.eventTray = new EventTray(this.root.querySelector('#spatial-event-tray'));
    this.eventTray?.setMode('map');
    this.wireResultsTable();

    this.commandBar.setDeterministicHandler((prompt) => this.runMapCommand(prompt));
    this.commandBar.setAiHandler((prompt) => this.runAiMapCommand(prompt));
    this.detailPanel.setSignInHandler(() => this.handleSignIn());
    this.pointIntelligenceControl = new PointIntelligenceControl(
      this.detailPanel.pointIntelligenceHost || this.root.querySelector('#spatial-point-intelligence-host')
    );
    this.pointIntelligenceControl.onModeChange = (enabled) => {
      this.mapHost?.classList.toggle('is-point-intel', enabled);
      this.wirePointIntelligence();
    };
    this.unsubscribePointIntelligence = subscribePointIntelligenceState((state) => {
      if (!state.lastResponse) return;
      this.detailPanel?.setPointIntelligenceSummary({
        point: state.lastClickedPoint,
        response: { ...state.lastResponse, summary: state.summary },
        presentation: getPointIntelligencePresentation(state.lastResponse)
      });
    });
    mountPointIntelligenceFocusInteraction(
      this.root.querySelector('#spatial-point-intelligence-section')
    );
    mountPointIntelligenceInspector(
      this.root.querySelector('#spatial-point-intelligence-section')
    );
    mountStreetLevelContext(
      this.root.querySelector('#spatial-point-intelligence-section')
    );
    const mapTimeLensHost = document.createElement('div');
    mapTimeLensHost.id = 'spatial-map-time-lens-host';
    mapTimeLensHost.className = 'spatial-map-time-lens-host';
    this.mapToolsHost?.prepend(mapTimeLensHost);
    this.unsubscribeTemporalController = initPointIntelligenceTemporalController({
      panelHost: this.detailPanel.timeLensHost || this.root.querySelector('#spatial-time-lens-host'),
      mapHost: mapTimeLensHost,
      onTemporalChange: (state) => {
        if (!isTemporalModeExecutable(state.mode)) {
          this.detailPanel?.setPointIntelligenceTemporalNotice({
            state,
            message: getUnsupportedTemporalMessage()
          });
        }
      }
    });
    let lastOpenWorldResponse = null;
    this.openWorldControl = new OpenWorldIntelligenceControl(
      this.detailPanel.openWorldHost || this.root.querySelector('#spatial-open-world-intelligence-host'),
      {
        point: null,
        onResults: (response) => {
          lastOpenWorldResponse = response;
          this.detailPanel?.setOpenWorldIntelligenceSummary(response);
        }
      }
    );
    const resolveOpenWorldResult = (id) => {
      const normalized = lastOpenWorldResponse?.normalized;
      if (!normalized || !id) return null;
      const pool = [
        ...(normalized.spatial || []),
        ...(normalized.results || []),
        ...(normalized.nonSpatial || [])
      ];
      return pool.find((r) => r.id === id) || null;
    };
    mountOpenWorldIntelligenceInteraction(
      this.detailPanel.openWorldResults || this.root.querySelector('#spatial-open-world-intelligence-results'),
      { getResultById: resolveOpenWorldResult }
    );
    this.unsubscribeOpenWorldFocus = mountOpenWorldIntelligenceFocus(
      this.detailPanel.openWorldResults || this.root.querySelector('#spatial-open-world-intelligence-results'),
      { getResultById: resolveOpenWorldResult }
    );
    this.unsubscribeOpenWorldAnchor = subscribePointIntelligenceState((state) => {
      if (state.lastClickedPoint) this.openWorldControl?.setAnchor(state.lastClickedPoint);
    });
    this.panelLayout = new PanelLayout(this.shell);
    this.panelLayout.init();
    this.wireWorkspaceContext();
    this.wirePanelChrome();
    window.addEventListener('resize', () => resizeMapView());

    void this.verifySpatialBackend();
    void this.initArcgis();
  }

  async verifySpatialBackend() {
    try {
      const response = await fetch('/health', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (body.spatialEngine !== 'compound-v1') {
        this.detailPanel?.setError(V1_SERVER_HINT);
      }
      if (body.layerAwareEngine !== 'layer-aware-v1') {
        console.warn('[IQAI] layerAwareEngine missing from /health — layer-aware wiring may be stale');
      }
    } catch {
      this.detailPanel?.setError('Spatial backend is not reachable on this port.');
    }
  }

  updateLayerAwareIndicator(webmapTitle, catalogDiag) {
    const title = webmapTitle || catalogDiag?.webmapTitle || 'Montreal 1';
    const ready = catalogDiag?.ready ? 'READY' : 'PENDING';
    const count = catalogDiag?.layerCount ?? 0;
    const username = this.systemIndicator?.textContent?.includes('·')
      ? this.systemIndicator.textContent.split('·').pop()?.trim()
      : null;
    const userSuffix = username && !username.includes('Layer-aware') ? ` · ${username}` : '';
    this.setSystemIndicator(`${title}${userSuffix} · Layer-aware: ${ready} · Layers: ${count}`);
  }

  formatMapCommandError(message) {
    if (!message) return 'Map command failed';
    if (message === LEGACY_UNSUPPORTED_MESSAGE || message.includes('does not yet support')) {
      return `${V1_SERVER_HINT}`;
    }
    return message;
  }

  wirePanelChrome() {
    if (!this.root || !this.panelLayout) return;
    const layout = this.panelLayout;
    this.root.querySelectorAll('[data-collapse]').forEach((btn) => {
      const panel = btn.dataset.collapse;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        layout.collapse(panel);
        if (panel === 'bottom') {
          this.eventTray?.closeDock();
        }
      });
    });
    this.root.querySelectorAll('[data-reopen]').forEach((btn) => {
      const panel = btn.dataset.reopen;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        layout.expand(panel);
      });
    });
  }

  initMapSelection() {
    void wireFeaturePicking(
      (attributes, graphic) => {
        clearActiveSelection();
        this.detailPanel?.setFeatureDetail(attributes, this.lastMapResult, graphic);
        this.eventTray?.highlightResultsRowFromMap(attributes);
      },
      () => {
        clearActiveSelection();
        if (this.lastMapResult) {
          this.detailPanel?.setQuerySummary(this.lastMapResult);
        } else {
          this.detailPanel?.setSelectedFeatureHtml([]);
        }
      }
    );
    this.wirePointIntelligence();
    void inspectWebMapFeatureLayers();
    this.selectionWired = true;
  }

  wirePointIntelligence() {
    setPointIntelligenceClickMode(isPointIntelligenceModeEnabled(), async (point) => {
      const response = await runPointIntelligenceQuery(point);
      if (response?.stale) return;
      const presentation = getPointIntelligencePresentation(response);
      this.detailPanel?.setPointIntelligenceSummary({
        point,
        response: {
          ...response,
          summary: summarizePointIntelligenceResponse(response)
        },
        presentation
      });
    });
  }

  widgetHosts() {
    return {
      ...this.layerPanel?.getWidgetHosts(),
      mapControlsHost: this.mapControlsHost,
      mapToolsHost: this.mapToolsHost,
      measureToolsHost: this.measureToolsHost
    };
  }

  setSystemIndicator(text) {
    if (this.systemIndicator) this.systemIndicator.textContent = text;
  }

  async ensureOAuthRegistration() {
    if (this.oauthRegistration) return this.oauthRegistration;
    const oauthConfig = await fetchMontrealOAuthConfig();
    this.oauthRegistration = await ensureMontrealOAuthRegistered(oauthConfig);
    return this.oauthRegistration;
  }

  runtimeOptions() {
    const authSetup = new URLSearchParams(window.location.search).get('auth-setup') === '1';
    return {
      autoSignIn: authSetup,
      widgetHosts: this.widgetHosts(),
      onStatus: (payload) => this.onRuntimeStatus(payload)
    };
  }

  async rebuildLiveLayerCatalog() {
    try {
      const { buildWebMapLayerCatalog } = await import('../webmap-layer-catalog.js');
      await buildWebMapLayerCatalog();
    } catch {
      // catalog rebuild is best-effort after live layers mount
    }
  }

  startStmLiveAfterMapReady() {
    if (!this.mapOperational || this.stmLiveHandle) return;
    try {
      this.stmLiveHandle = startStmLiveBusesLayer({
        onRegistered: () => void this.rebuildLiveLayerCatalog(),
        onStatus: (status) => {
          this.detailPanel?.setStmLiveStatus?.(status);
        },
        onError: (error) => {
          console.warn('[IQAI] STM live buses refresh error', error?.message || error);
        }
      });
    } catch (error) {
      console.warn('[IQAI] STM live layer failed to start', error?.message || error);
    }
  }

  startHydroOutagesAfterMapReady() {
    if (!this.mapOperational || this.hydroLiveHandle) return;
    try {
      this.hydroLiveHandle = startHydroQuebecOutagesLayer({
        onRegistered: () => void this.rebuildLiveLayerCatalog(),
        onStatus: (status) => {
          this.detailPanel?.setHydroOutageStatus?.(status);
        },
        onError: (error) => {
          console.warn('[IQAI] Hydro outages refresh error', error?.message || error);
          this.detailPanel?.setHydroOutageStatus?.({
            status: 'ERROR',
            stale: true,
            error: error?.message || 'Hydro outages unavailable',
            source: 'Hydro-Québec Open Data',
            spatialPrecision: 'Approximate outage location'
          });
        }
      });
    } catch (error) {
      console.warn('[IQAI] Hydro outages layer failed to start', error?.message || error);
      this.detailPanel?.setHydroOutageStatus?.({
        status: 'ERROR',
        stale: true,
        error: error?.message || 'Hydro outages unavailable',
        source: 'Hydro-Québec Open Data',
        spatialPrecision: 'Approximate outage location'
      });
    }
  }

  startAircraftLiveAfterMapReady() {
    if (!this.mapOperational || this.aircraftLiveHandle) return;
    try {
      this.aircraftLiveHandle = startAircraftLiveLayer({
        onRegistered: () => void this.rebuildLiveLayerCatalog(),
        onStatus: (status) => {
          this.detailPanel?.setAircraftLiveStatus?.(status);
        },
        onTableUpdate: (model) => {
          if (model) this.eventTray?.applyLiveFeedModel(model);
        },
        onError: (error) => {
          console.warn('[IQAI] Aircraft live refresh error', error?.message || error);
          this.detailPanel?.setAircraftLiveStatus?.({
            status: 'ERROR',
            stale: true,
            error: error?.message || 'Aircraft unavailable',
            source: 'ADSB.lol',
            sourceLicense: 'ODbL',
            aiCost: '$0.00'
          });
        }
      });
    } catch (error) {
      console.warn('[IQAI] Aircraft live layer failed to start', error?.message || error);
      this.detailPanel?.setAircraftLiveStatus?.({
        status: 'ERROR',
        stale: true,
        error: error?.message || 'Aircraft unavailable',
        source: 'ADSB.lol',
        aiCost: '$0.00'
      });
    }
  }

  startVesselsLiveAfterMapReady() {
    if (!this.mapOperational || this.vesselsLiveHandle) return;
    try {
      this.vesselsLiveHandle = startVesselsLiveLayer({
        onRegistered: () => void this.rebuildLiveLayerCatalog(),
        onStatus: (status) => {
          this.detailPanel?.setVesselsLiveStatus?.(status);
        },
        onTableUpdate: (model) => {
          if (model) this.eventTray?.applyLiveFeedModel(model);
        },
        onError: (error) => {
          console.warn('[IQAI] Vessels live refresh error', error?.message || error);
          this.detailPanel?.setVesselsLiveStatus?.({
            status: 'ERROR',
            stale: true,
            error: error?.message || 'Vessels unavailable',
            source: 'AISStream.io',
            keyRequired: /key/i.test(error?.message || ''),
            aiCost: '$0.00'
          });
        }
      });
    } catch (error) {
      console.warn('[IQAI] Vessels live layer failed to start', error?.message || error);
      this.detailPanel?.setVesselsLiveStatus?.({
        status: 'ERROR',
        stale: true,
        error: error?.message || 'Vessels unavailable',
        source: 'AISStream.io',
        aiCost: '$0.00'
      });
    }
  }

  startLiveLayersAfterMapReady() {
    this.startStmLiveAfterMapReady();
    this.startHydroOutagesAfterMapReady();
    this.startAircraftLiveAfterMapReady();
    this.startVesselsLiveAfterMapReady();
    void import('../webmap-layer-catalog.js').then(({ applyStartupLayerVisibilityPolicy, ensureLiveLayerCatalog }) => {
      void applyStartupLayerVisibilityPolicy();
      void ensureLiveLayerCatalog().then((catalog) => {
        syncCatalogVisibilityFromRuntime();
        this.refreshIntelligenceRail(catalog);
      });
    });
  }

  async handleSignIn() {
    this.detailPanel?.setError('');
    this.setSystemIndicator('ArcGIS sign-in…');
    this.detailPanel?.setSignInVisible(false);
    try {
      const reg = await this.ensureOAuthRegistration();
      await signInToMontrealArcgis(reg.IdentityManager, reg.sharingUrl);
      this.setSystemIndicator('Loading Montreal 1…');
      await initSpatialArcgisRuntime(this.mapHost, this.runtimeOptions());
      this.mapOperational = isMapOperational();
      this.layerPanel?.setReady(this.mapOperational);
      resizeMapView();
      this.startLiveLayersAfterMapReady();
    } catch (error) {
      const message = formatArcgisOAuthError(error);
      this.detailPanel?.setError(message);
      this.setSystemIndicator('ArcGIS sign-in failed');
      this.detailPanel?.setSignInVisible(true);
    }
  }

  async initArcgis() {
    if (!this.mapHost) {
      this.detailPanel?.setError('Map container missing.');
      this.setSystemIndicator('ArcGIS error');
      return;
    }
    if (this.arcgisInitStarted) return;
    this.arcgisInitStarted = true;

    try {
      await initSpatialArcgisRuntime(this.mapHost, this.runtimeOptions());
      this.mapOperational = isMapOperational();
      this.layerPanel?.setReady(this.mapOperational);
      resizeMapView();
      this.startLiveLayersAfterMapReady();
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED') {
        this.onRuntimeStatus({ status: 'auth-required', message: 'ArcGIS sign-in required' });
        return;
      }
      this.onRuntimeStatus({
        status: 'error',
        message: error.message || 'ArcGIS initialization failed'
      });
    }
  }

  async runMapCommand(prompt, options = {}) {
    if (!isMapOperational()) {
      this.detailPanel?.setError('ArcGIS map is not ready. Sign in to load Montreal 1.');
      return { commandId: null };
    }
    this.mapOperational = true;

    const { commandId } = options.commandId
      ? { commandId: options.commandId }
      : beginDeterministicCommand({ command: prompt });
    this.activeCommandId = commandId;

    if (!options.suppressDeterministicUi) {
      this.commandBar?.setRunning(true);
    }
    this.detailPanel?.setError('');
    this.setConversationResponse('');
    this.commandBar?.setUnderstoodLine('');
    clearMapCommandDiagnostics();

    try {
      const catalog = await ensureLiveLayerCatalog();
      const catalogDiag = getLayerCatalogDiagnostics();
      this.updateLayerAwareIndicator(catalog?.webmapTitle, catalogDiag);

      if (!catalog?.layers?.length && /what layers|turn on|turn off|hide |zoom to |toggle /i.test(prompt)) {
        throw new Error('Layer catalog not ready. Wait for Layer-aware: READY in the header.');
      }

      const conversation = getConversationState();
      const expanded = expandConversationInput(prompt, conversation);

      if (!expanded.ok) {
        const msg = expanded.clarification || 'Ambiguous request.';
        this.commandBar?.setUnderstoodLine(msg);
        this.setConversationResponse(responseForClarification(msg));
        throw new Error(msg);
      }

      if (expanded.metaAction) {
        const handled = await this.handleConversationMetaAction(expanded, prompt, catalog, commandId);
        if (handled) return { commandId };
      }

      const effectivePrompt = expanded.prompt || prompt;

      const { planSpatialCapability, SPATIAL_CAPABILITY, formatCapabilityUnavailableMessage } = await import('../spatial-capability-router.js');
      const capabilityPlan = planSpatialCapability(effectivePrompt, { catalog });
      if (capabilityPlan.capability === SPATIAL_CAPABILITY.PLACE_POI_SEARCH) {
        if (!capabilityPlan.available) {
          const message = formatCapabilityUnavailableMessage(capabilityPlan);
          this.commandBar?.setUnderstoodLine(message);
          this.setConversationResponse(message);
          throw new Error(message);
        }
        const poiResult = await this.executePlacePoiViaAiMap(effectivePrompt, { commandId, viaAiMap: false });
        if (poiResult) return { commandId };
      }

      const intelligenceResult = capabilityPlan.capability === SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH
        ? await this.tryRunIntelligenceMapCommand(effectivePrompt, { viaAiMap: false })
        : null;
      if (intelligenceResult) {
        return { commandId };
      }

      if (expanded.expansion === 'location_reuse' && conversation.lastMatchedAddress) {
        this.setConversationResponse(responseForLocationReuse(conversation.lastMatchedAddress));
      }

      const layerPlan = planLayerAwareClientCommand(effectivePrompt, catalog);
      if (layerPlan.handled) {
        if (layerPlan.error) {
          throw new Error(layerPlan.error);
        }
        if (layerPlan.action === 'LIST_LAYERS') {
          const listResult = buildListLayersMapResult(effectivePrompt, catalog, layerPlan.filter);
          this.lastMapResult = listResult;
          recordConversationFromList(prompt, listResult, catalog);
          this.detailPanel?.setLayerList(listResult);
          this.updateMapPresentation(listResult);
          this.setConversationResponse(responseForListLayers(listResult.layers?.length || 0));
          settleDeterministicCommand(commandId, null);
          return { commandId, mapResult: listResult };
        }
        if (layerPlan.action === 'LAYER_COMPOUND_CONTROLS') {
          for (const step of layerPlan.operations) {
            await executeLayerControls(step.operation, step.layers);
          }
          syncCatalogVisibilityFromRuntime();
          const controlResult = buildMixedLayerControlsMapResult(
            effectivePrompt,
            layerPlan.operations,
            catalog
          );
          this.lastMapResult = controlResult;
          for (const step of layerPlan.operations) {
            recordConversationFromLayerControls(prompt, step.operation, step.layers, catalog);
          }
          this.detailPanel?.setQuerySummary(controlResult);
          this.updateMapPresentation(controlResult);
          this.setConversationResponse(responseForMixedLayerControls(layerPlan.operations));
          settleDeterministicCommand(commandId, null);
          return { commandId, mapResult: controlResult };
        }
        if (layerPlan.action === 'LAYER_CONTROLS') {
          await executeLayerControls(layerPlan.operation, layerPlan.layers);
          syncCatalogVisibilityFromRuntime();
          const controlResult = buildLayerControlsMapResult(
            effectivePrompt,
            layerPlan.operation,
            layerPlan.layers,
            catalog
          );
          this.lastMapResult = controlResult;
          recordConversationFromLayerControls(prompt, layerPlan.operation, layerPlan.layers, catalog);
          this.detailPanel?.setQuerySummary(controlResult);
          this.updateMapPresentation(controlResult);
          this.setConversationResponse(responseForLayerControls(layerPlan.operation, layerPlan.layers));
          settleDeterministicCommand(commandId, null);
          return { commandId, mapResult: controlResult };
        }
        if (layerPlan.action === 'LAYER_CONTROL') {
          await executeLayerControl(layerPlan.layerControl);
          syncCatalogVisibilityFromRuntime();
          const controlResult = buildLayerControlMapResult(
            effectivePrompt,
            layerPlan.layerControl,
            layerPlan.layer,
            catalog
          );
          this.lastMapResult = controlResult;
          recordConversationFromLayerControls(prompt, layerPlan.layerControl.operation, [layerPlan.layer], catalog);
          this.detailPanel?.setQuerySummary(controlResult);
          this.updateMapPresentation(controlResult);
          this.setConversationResponse(responseForLayerControls(layerPlan.layerControl.operation, [layerPlan.layer]));
          settleDeterministicCommand(commandId, null);
          return { commandId, mapResult: controlResult };
        }
        if (layerPlan.action === 'HIDE_ALL_DISPLAYED' || layerPlan.action === 'HIDE_ALL_OPERATIONAL') {
          const result = await executeHideAllDisplayed();
          syncCatalogVisibilityFromRuntime();
          recordConversationFromLayerControls(prompt, 'HIDE_ALL_DISPLAYED', result.layers, catalog);
          this.setConversationResponse(responseForHideAll(result.sourceCount, result.scopedCount));
          settleDeterministicCommand(commandId, null);
          return { commandId };
        }
        if (layerPlan.action === 'HIDE_ALL_SOURCE') {
          const result = await executeHideAllSourceLayers();
          syncCatalogVisibilityFromRuntime();
          recordConversationFromLayerControls(prompt, 'HIDE_ALL_SOURCE', result.layers, catalog);
          this.setConversationResponse(responseForHideAllSource(result.count));
          settleDeterministicCommand(commandId, null);
          return { commandId };
        }
        if (layerPlan.action === 'SHOW_ALL_OPERATIONAL') {
          const result = await executeShowAllOperational();
          syncCatalogVisibilityFromRuntime();
          recordConversationFromLayerControls(prompt, 'SHOW_ALL_OPERATIONAL', result.layers, catalog);
          this.setConversationResponse(responseForShowAll(result.count));
          settleDeterministicCommand(commandId, null);
          return { commandId };
        }
      }

      const { isTaskGraphV1Enabled, runTaskGraphMapCommand } = await import('../orchestrator/orchestrator-client.js');
      if (
        isTaskGraphV1Enabled()
        && capabilityPlan.capability === SPATIAL_CAPABILITY.DETERMINISTIC_GIS
        && /\bfire stations?\b/i.test(effectivePrompt)
        && /\bwithin\s+\d+/i.test(effectivePrompt)
      ) {
        const tgResult = await runTaskGraphMapCommand(effectivePrompt, {
          appShell: this,
          catalog,
          commandId,
          expansion: expanded.expansion
        });
        if (tgResult.handled) {
          settleDeterministicCommand(commandId, getCommittedCanonicalResult(commandId));
          return { commandId, mapResult: tgResult.mapResult };
        }
      }

      const mapResult = await this.executeServerMapQuery(effectivePrompt, catalog, expanded.expansion);
      if (mapResult?.error) {
        throw new Error(mapResult.error);
      }
      return { commandId, mapResult };
    } catch (error) {
      settleDeterministicCommand(commandId, getCommittedCanonicalResult(commandId));
      const diagnostic = error?.iqaiMapDiagnostic || getLastMapCommandError();
      if (!diagnostic) {
        captureMapCommandFailure('runMapCommand', error, { prompt, commandId });
      }
      const message = diagnostic
        ? formatMapCommandFailureMessage(diagnostic)
        : (this.formatMapCommandError(error.message) || 'Map command failed');
      if (!this.commandBar?.responseLine?.textContent) {
        this.setConversationResponse(responseForError(message));
      }
      this.detailPanel?.setError(message);
      throw error;
    } finally {
      if (!options.suppressDeterministicUi) {
        this.commandBar?.setRunning(false);
      }
    }
  }

  async runAiMapCommand(prompt) {
    if (!isMapOperational()) {
      this.detailPanel?.setError('ArcGIS map is not ready. Sign in to load Montreal 1.');
      return { rejected: true };
    }

    const priorPresentationTarget = this._presentationTarget;
    this._presentationTarget = 'ai-map';
    const { commandId } = beginDeterministicCommand({ command: prompt, source: 'ai-map' });
    this.activeCommandId = commandId;

    this.commandBar?.setAiRunning(true);
    this.commandBar?.setAiPhase('Planning…');
    this.commandBar?.setAiPresentation({ message: '', chain: [] });
    clearMapCommandDiagnostics();

    try {
      const catalog = await ensureLiveLayerCatalog();
      const { planSpatialCapability } = await import('../spatial-capability-router.js');
      const capabilityPlan = planSpatialCapability(prompt, { catalog });
      this.commandBar?.setAiPhase(`Routing ${capabilityPlan.capability || 'request'}…`);
      return await this.dispatchAiMapCapability(prompt, capabilityPlan, commandId);
    } catch (error) {
      const diagnostic = error?.iqaiMapDiagnostic || getLastMapCommandError();
      if (!diagnostic) {
        captureMapCommandFailure('runAiMapCommand', error, { prompt, commandId });
      }
      const message = diagnostic
        ? formatMapCommandFailureMessage(diagnostic)
        : (error.message || 'GIS execution failed for a validated AI MAP plan.');
      this.commandBar?.setAiPhase('');
      this.commandBar?.setAiPresentation({
        message,
        chain: ['Capability routing', 'Failed'],
        severity: 'error'
      });
      this.detailPanel?.setError(message);
      return { rejected: true, status: 'ENGINE_REJECTED', gisExecuted: false, commandId };
    } finally {
      this.commandBar?.setAiRunning(false);
      this._presentationTarget = priorPresentationTarget || null;
    }
  }

  handleIntelligenceLayerResult(result, options = {}) {
    if (!result) return;
    if (!options.viaAiMap && !this.commandBar?._suppressDeterministicFeedback) {
      this.setConversationResponse(result.message || 'Intelligence layer updated.');
    }
    this.detailPanel?.setError('');
    if (result.state === 'degraded') {
      this.detailPanel?.setError('Some live intelligence sources returned partial coverage.');
    }
  }

  async tryRunIntelligenceMapCommand(prompt, options = {}) {
    const { parseIntelligenceMapIntent, buildIntelligenceRequestFromIntent } = await import('../intelligence-layer-intent.js');
    const { isProgressiveIntelligenceV1Enabled } = await import('../orchestrator/orchestrator-config.js');
    const { runProgressiveIntelligenceCommand } = await import('../orchestrator/progressive-orchestrator-client.js');
    const { isProgressiveVerticalSliceQuery } = await import('../orchestrator/progressive-slice-intent.js');
    const intent = parseIntelligenceMapIntent(prompt);
    if (!intent && !isProgressiveVerticalSliceQuery(prompt)) return null;

    if (options.viaAiMap) {
      this.commandBar?.setAiPhase('Researching intelligence…');
      this._presentationTarget = 'ai-map';
    } else {
      this.commandBar?.setUnderstoodLine('Researching intelligence…');
    }

    try {
      if (isProgressiveIntelligenceV1Enabled()) {
        const request = intent
          ? buildIntelligenceRequestFromIntent(intent)
          : {
            query: prompt,
            conceptId: 'fires',
            geography: 'Greater Montréal',
            timeWindow: '30d'
          };
        const result = await runProgressiveIntelligenceCommand({
          ...request,
          query: prompt || request.query || request.sourceText,
          sourceText: prompt || request.sourceText || null
        }, {
          appShell: this,
          commandId: options.commandId
        });
        if (!result.handled) {
          throw new Error('Governed progressive intelligence path unavailable.');
        }
        const chain = [
          'Governed intelligence',
          result.mappedCount > 0 ? 'Features mapped' : 'No admissible events mapped'
        ];
        const message = result.message
          || (result.mappedCount > 0
            ? `Mapped ${result.mappedCount} governed event(s).`
            : 'No admissible events mapped for this query.');
        if (options.viaAiMap) {
          this.commandBar?.setAiPhase('');
          this.commandBar?.setAiPresentation({
            message,
            chain,
            severity: result.mappedCount > 0 ? 'success' : 'warning'
          });
          return { rejected: false, gisExecuted: false, intelligenceLayer: true, governed: true, result };
        }
        this.commandBar?.setUnderstoodLine(message);
        return { rejected: false, intelligenceLayer: true, governed: true, result };
      }

      const { runIntelligenceLayerResearch } = await import('../intelligence-layer-service.js');
      const result = await runIntelligenceLayerResearch(intent, { allowUngovernedLiveMap: true });
      this.handleIntelligenceLayerResult(result, { viaAiMap: options.viaAiMap });
      if (options.viaAiMap) {
        this.commandBar?.setAiPhase('');
        this.commandBar?.setAiPresentation({
          message: result.message,
          chain: ['Intelligence research', 'Layer created'],
          severity: result.state === 'degraded' ? 'warning' : 'success'
        });
        return { rejected: false, gisExecuted: false, intelligenceLayer: true, result };
      }
      this.commandBar?.setUnderstoodLine(result.message);
      this.setConversationResponse(result.message);
      return { rejected: false, intelligenceLayer: true, result };
    } catch (error) {
      const message = error?.message || 'Intelligence research failed.';
      if (options.viaAiMap) {
        this.commandBar?.setAiPhase('');
        this.commandBar?.setAiPresentation({
          message,
          chain: ['Intelligence research', 'Failed'],
          severity: 'error'
        });
      } else {
        this.commandBar?.setUnderstoodLine(message);
      }
      this.detailPanel?.setError(message);
      return { rejected: true, intelligenceLayer: true, error: message };
    }
  }

  onRuntimeStatus(payload) {
    if (payload.status === 'auth-required') {
      this.mapOperational = false;
      this.setSystemIndicator('ArcGIS sign-in required');
      this.detailPanel?.setSignInVisible(true);
      this.detailPanel?.setError('');
      this.layerPanel?.setReady(false);
      return;
    }
    if (payload.status === 'catalog-ready') {
      const title = payload.webmapTitle || 'Montreal 1';
      const userSuffix = payload.username ? ` · ${payload.username}` : '';
      this.setSystemIndicator(
        `${title}${userSuffix} · Layer-aware: READY · Layers: ${payload.layerCount ?? 0}`
      );
      this.refreshIntelligenceRail({
        webmapTitle: title,
        layers: getWebMapLayerCatalogSnapshot()?.layers || []
      });
      return;
    }
    if (payload.status === 'connected') {
      this.mapOperational = true;
      const title = payload.webmapTitle || 'Montreal 1';
      this.detailPanel?.setSignInVisible(false);
      this.detailPanel?.setError('');
      this.layerPanel?.setReady(true);
      void ensureLiveLayerCatalog().then(() => {
        const diag = getLayerCatalogDiagnostics();
        const userSuffix = payload.username ? ` · ${payload.username}` : '';
        this.setSystemIndicator(
          `${title}${userSuffix} · Layer-aware: ${diag.ready ? 'READY' : 'PENDING'} · Layers: ${diag.layerCount}`
        );
        if (!diag.ready) {
          console.warn('[IQAI] Layer catalog empty after WebMap connect');
        }
      });
      this.initMapSelection();
      resizeMapView();
      this.startLiveLayersAfterMapReady();
      return;
    }
    if (payload.status === 'error') {
      this.mapOperational = false;
      this.setSystemIndicator('ArcGIS error');
      this.detailPanel?.setError(payload.message || 'ArcGIS error');
      this.detailPanel?.setSignInVisible(false);
      return;
    }
    this.setSystemIndicator(payload.message || 'ArcGIS loading…');
  }

  diagnostics() {
    return {
      mapViewCreateCount: getMapViewCreateCount(),
      webMapCreateCount: getWebMapCreateCount(),
      mapContainers: document.querySelectorAll('[data-spatial-map-host]').length,
      mapOperational: isMapOperational(),
      layerListItems: document.querySelectorAll('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').length
    };
  }
}
