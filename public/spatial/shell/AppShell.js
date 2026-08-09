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
  selectRuntimeLayerFeature
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
  startSpvmRecentCrimeLayer,
  onSpvmVisibilityChange,
  syncSpvmVisibility
} from '../spvm-recent-crime.js';
import { SpvmCrimePanel } from '../spvm-crime-panel.js';
import {
  activateSpvmExplorer,
  deactivateSpvmExplorer,
  subscribeSpvmExplorer,
  setSpvmWindowDays,
  setSpvmShiftUi,
  setSpvmViewMode,
  toggleSpvmCategory,
  selectAllSpvmCategories,
  clearAllSpvmCategories,
  applySpvmExplorerState,
  selectSpvmCrimeFeature,
  isSpvmExplorerActive,
  getAnalytics,
  getSpvmFilterState,
  refreshSpvmExplorerIfVisible
} from '../spvm-crime-explorer.js';
import { matchSpvmCrimeIntent, spvmIntentResponse } from '../spvm-crime-intent.js';
import { SPVM_LAYER_ID } from '../spvm-recent-crime-config.js';
import {
  WORKSPACES,
  SELECTION_TYPES,
  setActiveWorkspace,
  setActiveSelection,
  clearActiveSelection,
  subscribeWorkspaceContext,
  getWorkspaceContext
} from '../workspace-context.js';
import { subscribeWorkspaceGeometry } from '../workspace-geometry.js';
import { isSpvmCrimeFeature } from '../spvm-crime-details.js';
import {
  getSourcePresentation,
  inheritSourceRenderer,
  getOsmNaAmenitiesSourceDef
} from '../source-presentation.js';
import {
  syncXrayOperationalDisplay,
  clearXrayOperationalDisplay,
  queryXrayOperationalFeatures
} from '../xray-operational-map.js';
import { buildOperationalFeaturesTableModel } from '../results-table-model.js';
import {
  buildOperationalLegendEntries,
  renderOperationalLegendHtml
} from '../operational-legend.js';
import { setOperationalLegendContent } from '../spatial-arcgis-runtime.js';
import {
  clearMapCommandDiagnostics,
  markMapDiagStage,
  captureMapCommandFailure,
  formatMapCommandFailureMessage,
  getLastMapCommandError,
  snapshotApiBody,
  wrapMapCommandError
} from '../map-command-diagnostics.js';

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
    this.spvmCrimeHandle = null;
    this.spvmCrimePanel = null;
    this.spvmExplorerUnsubscribe = null;
    this.workspaceUnsubscribe = null;
    this.workspaceGeometryUnsubscribe = null;
    this.lastXrayMapResult = null;
    this.lastXrayPresentation = null;
    /** Authoritative X-ray amenity visibility — checked checkbox = member of this Set. */
    this.visibleCategories = new Set();
    this.xrayTableViewMode = 'categories';
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

  updateMapPresentation(mapResult) {
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
    } else {
      this.eventTray?.setMapResults(mapResult);
    }
  }

  async enrichExternalPresentation(mapResult) {
    if (!mapResult?.datasetResults?.length) return;
    for (const result of mapResult.datasetResults) {
      if (result.sourceType !== 'TRUSTED_EXTERNAL' && result.sourceId !== 'OSM_NA_AMENITIES') continue;
      const presentation = this.lastXrayPresentation || await getSourcePresentation(getOsmNaAmenitiesSourceDef());
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
    this.setConversationResponse(`All ${xray.categories.length} categories visible on map.`);
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
      if (open && this.panelLayout) {
        this.panelLayout.expand('bottom');
        if (this.panelLayout.bottomHeight < 200) {
          this.panelLayout.bottomHeight = 220;
          this.panelLayout.applyLayout();
        }
      }
    });
    this.eventTray.setRowSelectHandler(async (row) => {
      const isLiveFeed = row.layerId === 'live-aircraft' || row.layerId === 'live-vessels';
      const isSpvmCrime = row.layerId === SPVM_LAYER_ID;
      const selection = isSpvmCrime
        ? await selectSpvmCrimeFeature(row.recordId || row.mapObjectId)
        : isLiveFeed
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
        if (isSpvmCrime) {
          setActiveSelection({
            type: SELECTION_TYPES.TABLE_ROW,
            layerId: SPVM_LAYER_ID,
            recordId: String(selection.graphic.attributes?.id || row.recordId || ''),
            attributes: selection.graphic.attributes
          });
        }
        this.detailPanel?.setFeatureDetail(
          selection.graphic.attributes,
          this.lastMapResult,
          selection.graphic
        );
        if (isSpvmCrime) {
          this.eventTray?.highlightSpvmRowFromMap(selection.graphic.attributes);
        } else {
          this.eventTray?.highlightResultsRowFromMap(selection.graphic.attributes);
        }
      }
    });
    this.eventTray.setCategoryToggleHandler(async (categoryValue, selected) => {
      await this.toggleXrayCategory(categoryValue, selected);
    });
    this.eventTray.setOperationalActionHandler(async (action) => {
      switch (action) {
        case 'show_all':
          await this.selectAllVisibleCategories();
          break;
        case 'clear':
          await this.clearAllVisibleCategories();
          this.setConversationResponse('Amenity display cleared. X-ray category summary retained.');
          break;
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

  wireSpvmVisibility() {
    if (this.spvmVisibilityUnsubscribe) return;
    try {
      this.spvmVisibilityUnsubscribe = onSpvmVisibilityChange((visible) => {
        if (visible) void this.activateSpvmExplorerUi();
        else void this.deactivateSpvmExplorerUi();
      });
    } catch (error) {
      console.warn('[IQAI] SPVM visibility wiring failed', error?.message || error);
    }
  }

  wireSpvmCrimeExplorer() {
    if (!this.spvmCrimePanel) return;

    try {
      this.spvmCrimePanel.onWindowDays = (days) => void setSpvmWindowDays(days).catch((error) => {
        console.warn('[IQAI] SPVM window filter failed', error?.message || error);
      });
      this.spvmCrimePanel.onShiftUi = (key) => void setSpvmShiftUi(key).catch((error) => {
        console.warn('[IQAI] SPVM shift filter failed', error?.message || error);
      });
      this.spvmCrimePanel.onViewMode = (mode) => void setSpvmViewMode(mode).catch((error) => {
        console.warn('[IQAI] SPVM view mode failed', error?.message || error);
      });
      this.spvmCrimePanel.onCategoryToggle = (french, selected) => void toggleSpvmCategory(french, selected).catch((error) => {
        console.warn('[IQAI] SPVM category toggle failed', error?.message || error);
      });
      this.spvmCrimePanel.onCategorySelectAll = () => void selectAllSpvmCategories().catch((error) => {
        console.warn('[IQAI] SPVM select all failed', error?.message || error);
      });
      this.spvmCrimePanel.onCategoryClearAll = () => void clearAllSpvmCategories().catch((error) => {
        console.warn('[IQAI] SPVM clear all failed', error?.message || error);
      });
      this.spvmCrimePanel.onRowSelect = async (row) => {
        try {
          const selection = await selectSpvmCrimeFeature(row.recordId || row.mapObjectId);
          if (selection.ok && selection.graphic) {
            setActiveSelection({
              type: SELECTION_TYPES.TABLE_ROW,
              layerId: SPVM_LAYER_ID,
              recordId: String(selection.graphic.attributes?.id || row.recordId || ''),
              attributes: selection.graphic.attributes
            });
            this.detailPanel?.setFeatureDetail(
              selection.graphic.attributes,
              this.lastMapResult,
              selection.graphic
            );
            this.spvmCrimePanel.highlightFromMapAttributes(selection.graphic.attributes);
          }
        } catch (error) {
          console.warn('[IQAI] SPVM row select failed', error?.message || error);
        }
      };

      this.spvmExplorerUnsubscribe = subscribeSpvmExplorer((payload) => {
        try {
          this.spvmCrimePanel?.update(payload);
          if (payload.active) {
            this.detailPanel?.setSpvmExplorerControl(payload);
          }
        } catch (error) {
          console.warn('[IQAI] SPVM explorer update failed', error?.message || error);
        }
      });
    } catch (error) {
      console.warn('[IQAI] SPVM explorer wiring failed', error?.message || error);
    }
  }

  wireWorkspaceContext() {
    try {
      this.workspaceUnsubscribe = subscribeWorkspaceContext((ctx) => {
        this.detailPanel?.applyWorkspaceLayout(ctx);
        this.eventTray?.setWorkspaceMode(ctx.activeWorkspace);
        if (ctx.activeWorkspace === WORKSPACES.SPVM_CRIME) {
          this.panelLayout?.setWorkspaceBottomMode(true, WORKSPACES.SPVM_CRIME);
          this.panelLayout?.expand('bottom');
        } else {
          this.panelLayout?.setWorkspaceBottomMode(false);
        }
      });
    } catch (error) {
      console.warn('[IQAI] workspace context wiring failed', error?.message || error);
    }
  }

  wireWorkspaceGeometry() {
    if (this.spvmCrimePanel) {
      this.spvmCrimePanel.onWorkspaceAction = (action) => this.handleWorkspaceGeometryAction(action);
    }
    try {
      this.workspaceGeometryUnsubscribe = subscribeWorkspaceGeometry((geometry) => {
        this.spvmCrimePanel?.applyWorkspaceGeometry?.(geometry);
      });
    } catch (error) {
      console.warn('[IQAI] workspace geometry wiring failed', error?.message || error);
    }
  }

  handleWorkspaceGeometryAction(action) {
    const layout = this.panelLayout;
    if (!layout) return;
    switch (action) {
      case 'collapse':
        layout.collapseWorkspace();
        break;
      case 'expand':
        layout.expandWorkspace();
        break;
      case 'toggle-maximize':
        layout.toggleMaximizeWorkspace();
        break;
      default:
        break;
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
    if (isSpvmExplorerActive()) return WORKSPACES.SPVM_CRIME;
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

  async activateSpvmExplorerUi() {
    try {
      setActiveWorkspace(WORKSPACES.SPVM_CRIME, {
        visibleLayerIds: this.collectVisibleLayerIds()
      });
      this.eventTray?.setWorkspaceMode(WORKSPACES.SPVM_CRIME);
      this.spvmCrimePanel?.setVisible(true);
      if (this.panelLayout) {
        this.panelLayout.setWorkspaceBottomMode(true, WORKSPACES.SPVM_CRIME);
        this.panelLayout.expand('bottom');
      }
      await activateSpvmExplorer();
    } catch (error) {
      console.warn('[IQAI] SPVM explorer activation failed', error?.message || error);
    }
  }

  async deactivateSpvmExplorerUi() {
    try {
      await deactivateSpvmExplorer();
      clearActiveSelection();
      this.eventTray?.setWorkspaceMode(WORKSPACES.NONE);
      this.spvmCrimePanel?.setVisible(false);
      this.panelLayout?.setWorkspaceBottomMode(false);
      this.syncWorkspaceContext();
      if (this.lastMapResult) {
        this.detailPanel?.setQuerySummary(this.lastMapResult);
      }
    } catch (error) {
      console.warn('[IQAI] SPVM explorer deactivation failed', error?.message || error);
    }
  }

  async handleSpvmCrimeIntent(intent, prompt) {
    if (intent.turnLayerOn) {
      syncSpvmVisibility(true);
      syncCatalogVisibilityFromRuntime();
    }

    let nextState = intent.state;
    if (intent.action === 'SPVM_PATCH' || isSpvmExplorerActive()) {
      const current = isSpvmExplorerActive() ? getSpvmFilterState() : createDefaultSpvmFilterState();
      nextState = cloneSpvmFilterState(current);
      const patch = intent.patch || intent.state || {};
      if (patch.windowDays) nextState.windowDays = patch.windowDays;
      if (patch.categories) nextState.categories = new Set(patch.categories);
      if (patch.shifts) nextState.shifts = new Set(patch.shifts);
      if (patch.viewMode) nextState.viewMode = patch.viewMode;
    }

    if (nextState) {
      await applySpvmExplorerState(nextState);
    }
    await this.activateSpvmExplorerUi();
    const analytics = getAnalytics();
    this.commandBar?.setUnderstoodLine(prompt);
    this.setConversationResponse(spvmIntentResponse({ state: nextState }, analytics));
    this.detailPanel?.setSpvmExplorerControl({
      state: nextState,
      analytics,
      status: null,
      active: true
    });
  }

  setConversationResponse(text) {
    this.commandBar?.setResponseLine(text || '');
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

    markMapDiagStage('result_type', {
      action: body.action,
      plan: body.summary?.action || body.request?.action,
      conceptId: body.summary?.conceptId || body.datasetResults?.[0]?.conceptId,
      sourceType: body.summary?.layerSource || body.datasetResults?.[0]?.sourceType,
      layerSource: body.summary?.layerSource,
      matchedFeatures: body.summary?.matchedFeatures
    });

    if (body.action === 'CLEAR') {
      await clearMapResultsOnRuntime();
      this.lastMapResult = null;
      this.detailPanel?.clearQueryState();
      this.clearMapPresentation();
      this.initMapSelection();
      resizeMapView();
      this.setConversationResponse('Map results cleared.');
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
    if (body.clientWebMapQueries?.length) {
      markMapDiagStage('client_webmap_queries_entered', {
        queryCount: body.clientWebMapQueries.length
      });
      mapResult = await executeClientWebMapLayerQueries(body);
    }

    markMapDiagStage('renderMapResultOnRuntime_entered', {
      action: mapResult.action,
      datasetResultCount: mapResult.datasetResults?.length,
      matchedFeatures: mapResult.summary?.matchedFeatures
    });
    await this.enrichExternalPresentation(mapResult);
    await renderMapResultOnRuntime(mapResult);
    setOperationalLegendContent(null);
    markMapDiagStage('executeServerMapQuery_post_render');
    mapResult.iqaiResultLayerIds = getIqaiResultLayerIds();
    this.lastMapResult = mapResult;

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
    this.updateMapPresentation(mapResult);
    this.syncWorkspaceContext();
    this.initMapSelection();
    resizeMapView();
    this.setConversationResponse(responseForMapResult(mapResult, expansion));
    markMapDiagStage('executeServerMapQuery_success');
    return mapResult;
  }

  async handleConversationMetaAction(expanded, prompt, catalog) {
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
        resizeMapView();
        this.setConversationResponse(responseForReset());
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
          this.setConversationResponse('No X-ray category summary is active.');
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
          this.setConversationResponse('No X-ray category summary is active.');
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
        this.setConversationResponse('Amenity display cleared. X-ray category summary retained.');
        return true;
      }
      default:
        return false;
    }
  }

  mount() {
    if (!this.root) return;
    this.root.className = 'spatial-shell';
    this.root.innerHTML = `
      <header class="spatial-header">
        <div class="spatial-header-left">
          <span class="spatial-brand">IQAI SPATIAL</span>
          <nav class="spatial-nav" aria-label="Primary">
            <button type="button" class="spatial-nav-item is-active" disabled>MAP</button>
            <button type="button" class="spatial-nav-item" disabled>INVESTIGATE</button>
            <button type="button" class="spatial-nav-item" disabled>HISTORY</button>
          </nav>
        </div>
        <div class="spatial-header-right">
          <span class="spatial-system" id="spatial-system-indicator">ArcGIS loading…</span>
        </div>
      </header>
      <div class="spatial-workspace">
        <aside class="spatial-sidebar-left" id="spatial-layer-panel" aria-label="Layers"></aside>
        <div class="panel-splitter panel-splitter-col" data-resize="left" role="separator" aria-orientation="vertical" aria-label="Resize layers panel"></div>
        <section class="spatial-center" aria-label="Map workspace">
          <div id="spatial-command-bar"></div>
          <div class="spatial-map-wrap">
            <button type="button" class="panel-reopen panel-reopen-left" data-reopen="left" hidden>Layers</button>
            <button type="button" class="panel-reopen panel-reopen-right" data-reopen="right" hidden>Details</button>
            <button type="button" class="panel-reopen panel-reopen-bottom" data-reopen="bottom" hidden>Events</button>
            <div id="spatial-map-host" class="spatial-map-host" data-spatial-map-host aria-label="Montreal 1 WebMap"></div>
            <div id="spatial-map-controls" class="spatial-map-controls" aria-label="Map navigation"></div>
            <div id="spatial-map-tools" class="spatial-map-tools" aria-label="Map tools"></div>
            <div id="spatial-measure-tools" class="spatial-measure-tools" aria-label="Map measurement"></div>
          </div>
        </section>
        <div class="panel-splitter panel-splitter-col" data-resize="right" role="separator" aria-orientation="vertical" aria-label="Resize details panel"></div>
        <aside class="spatial-sidebar-right" id="spatial-detail-panel" aria-label="Details"></aside>
      </div>
      <div class="panel-splitter panel-splitter-row" data-resize="bottom" role="separator" aria-orientation="horizontal" aria-label="Resize events tray"></div>
      <footer class="spatial-event-tray" id="spatial-event-tray" aria-label="Events"></footer>
    `;

    this.systemIndicator = this.root.querySelector('#spatial-system-indicator');
    this.mapHost = this.root.querySelector('#spatial-map-host');
    this.mapControlsHost = this.root.querySelector('#spatial-map-controls');
    this.mapToolsHost = this.root.querySelector('#spatial-map-tools');
    this.measureToolsHost = this.root.querySelector('#spatial-measure-tools');

    this.layerPanel = new LayerPanel(this.root.querySelector('#spatial-layer-panel'));
    this.commandBar = new CommandBar(this.root.querySelector('#spatial-command-bar'));
    this.detailPanel = new DetailPanel(this.root.querySelector('#spatial-detail-panel'));
    this.eventTray = new EventTray(this.root.querySelector('#spatial-event-tray'));
    try {
      this.spvmCrimePanel = new SpvmCrimePanel(
        this.eventTray.spvmExplorerHostEl || this.root.querySelector('#spatial-spvm-explorer-host')
      );
      this.eventTray.setSpvmPanel(this.spvmCrimePanel);
      this.wireSpvmCrimeExplorer();
      this.wireSpvmVisibility();
    } catch (error) {
      console.warn('[IQAI] SPVM explorer panel failed to initialize', error?.message || error);
      this.spvmCrimePanel = null;
    }

    this.commandBar.setModeHandler((mode) => this.eventTray?.setMode(mode));
    this.eventTray?.setMode('map');
    this.wireResultsTable();

    this.commandBar.setRunHandler((prompt) => this.runMapCommand(prompt));
    this.detailPanel.setSignInHandler(() => this.handleSignIn());
    this.panelLayout = new PanelLayout(this.root);
    this.panelLayout.init();
    this.wireWorkspaceContext();
    this.wireWorkspaceGeometry();
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
        const layer = graphic?.layer || graphic?.sourceLayer;
        if (isSpvmCrimeFeature(attributes)) {
          setActiveSelection({
            type: SELECTION_TYPES.MAP_FEATURE,
            layerId: layer?.id || SPVM_LAYER_ID,
            recordId: String(attributes.id || attributes.OBJECTID || ''),
            attributes
          });
        } else {
          clearActiveSelection();
        }
        this.detailPanel?.setFeatureDetail(attributes, this.lastMapResult, graphic);
        if (isSpvmExplorerActive()) {
          this.eventTray?.highlightSpvmRowFromMap(attributes);
        } else {
          this.eventTray?.highlightResultsRowFromMap(attributes);
        }
      },
      () => {
        clearActiveSelection();
        if (getWorkspaceContext().activeWorkspace === WORKSPACES.SPVM_CRIME) {
          this.detailPanel?.setSelectedFeatureHtml([]);
          this.detailPanel?.applyWorkspaceLayout(getWorkspaceContext());
        } else if (this.lastMapResult) {
          this.detailPanel?.setQuerySummary(this.lastMapResult);
        } else {
          this.detailPanel?.setSelectedFeatureHtml([]);
        }
      }
    );
    void inspectWebMapFeatureLayers();
    this.selectionWired = true;
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
    return {
      autoSignIn: false,
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

  startSpvmRecentCrimeAfterMapReady() {
    if (!this.mapOperational || this.spvmCrimeHandle) return;
    try {
      this.spvmCrimeHandle = startSpvmRecentCrimeLayer({
        onRegistered: () => {
          void this.rebuildLiveLayerCatalog();
          void import('../spvm-crime-explorer.js').then(async ({ initSpvmCrimeExplorer, refreshSpvmExplorerIfVisible }) => {
            await initSpvmCrimeExplorer();
            await refreshSpvmExplorerIfVisible();
          });
        }
      });
    } catch (error) {
      console.warn('[IQAI] SPVM recent crime layer failed to start', error?.message || error);
    }
  }

  startLiveLayersAfterMapReady() {
    this.startStmLiveAfterMapReady();
    this.startHydroOutagesAfterMapReady();
    this.startAircraftLiveAfterMapReady();
    this.startVesselsLiveAfterMapReady();
    this.startSpvmRecentCrimeAfterMapReady();
    void import('../webmap-layer-catalog.js').then(({ applyStartupLayerVisibilityPolicy }) => {
      void applyStartupLayerVisibilityPolicy();
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

  async runMapCommand(prompt) {
    if (!isMapOperational()) {
      this.detailPanel?.setError('ArcGIS map is not ready. Sign in to load Montreal 1.');
      return;
    }
    this.mapOperational = true;

    this.commandBar?.setRunning(true);
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
        const handled = await this.handleConversationMetaAction(expanded, prompt, catalog);
        if (handled) return;
      }

      const effectivePrompt = expanded.prompt || prompt;

      const spvmIntent = matchSpvmCrimeIntent(effectivePrompt, conversation);
      if (spvmIntent?.action === 'SPVM_SPATIAL_DEFERRED') {
        const msg = spvmIntent.clarification || 'SPVM spatial query not available.';
        this.commandBar?.setUnderstoodLine(msg);
        this.setConversationResponse(msg);
        return;
      }
      if (spvmIntent?.action === 'SPVM_EXPLORE' || spvmIntent?.action === 'SPVM_PATCH') {
        await this.handleSpvmCrimeIntent(spvmIntent, prompt);
        return;
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
          return;
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
          return;
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
          return;
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
          return;
        }
        if (layerPlan.action === 'HIDE_ALL_DISPLAYED' || layerPlan.action === 'HIDE_ALL_OPERATIONAL') {
          const result = await executeHideAllDisplayed();
          syncCatalogVisibilityFromRuntime();
          recordConversationFromLayerControls(prompt, 'HIDE_ALL_DISPLAYED', result.layers, catalog);
          this.setConversationResponse(responseForHideAll(result.sourceCount, result.scopedCount));
          return;
        }
        if (layerPlan.action === 'HIDE_ALL_SOURCE') {
          const result = await executeHideAllSourceLayers();
          syncCatalogVisibilityFromRuntime();
          recordConversationFromLayerControls(prompt, 'HIDE_ALL_SOURCE', result.layers, catalog);
          this.setConversationResponse(responseForHideAllSource(result.count));
          return;
        }
        if (layerPlan.action === 'SHOW_ALL_OPERATIONAL') {
          const result = await executeShowAllOperational();
          syncCatalogVisibilityFromRuntime();
          recordConversationFromLayerControls(prompt, 'SHOW_ALL_OPERATIONAL', result.layers, catalog);
          this.setConversationResponse(responseForShowAll(result.count));
          return;
        }
      }

      await this.executeServerMapQuery(effectivePrompt, catalog, expanded.expansion);
    } catch (error) {
      const diagnostic = error?.iqaiMapDiagnostic || getLastMapCommandError();
      if (!diagnostic) {
        captureMapCommandFailure('runMapCommand', error, { prompt });
      }
      const message = diagnostic
        ? formatMapCommandFailureMessage(diagnostic)
        : (this.formatMapCommandError(error.message) || 'Map command failed');
      if (!this.commandBar?.responseLine?.textContent) {
        this.setConversationResponse(responseForError(message));
      }
      this.detailPanel?.setError(message);
    } finally {
      this.commandBar?.setRunning(false);
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
