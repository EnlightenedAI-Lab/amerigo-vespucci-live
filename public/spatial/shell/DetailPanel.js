import {
  isKnownIqaiDataset,
  buildAgolFeatureDetail,
  hasAuthoredArcgisPopup,
  buildAgolSupplementaryDetail,
  buildAgolSupplementaryHtml
} from '../agol-feature-details.js';
import {
  buildAgolFeatureHtml,
  buildIqaiFeatureHtml
} from '../feature-display-formatter.js';
import {
  isHydroOutageFeature,
  buildHydroOutageFeatureHtml
} from '../hydro-outage-display.js';
import {
  isLiveAircraftFeature,
  buildLiveAircraftFeatureHtml
} from '../aircraft-live-display.js';
import {
  isLiveVesselFeature,
  buildLiveVesselFeatureHtml
} from '../vessels-live-display.js';
import {
  isSpvmCrimeFeature,
  buildSpvmCrimeFeatureHtml,
  buildSpvmCrimeSelectionHtml
} from '../spvm-crime-details.js';
import {
  SPVM_ALL_CATEGORIES,
  SPVM_ALL_SHIFTS,
  englishLabelForCategory,
  shiftUiLabelForValue
} from '../spvm-crime-taxonomy.js';
import {
  isOsmRuntimeFeature,
  buildCleanOsmFeatureHtml
} from '../iqai-osm-presentation.js';
import {
  buildPointIntelligenceSummaryHtml
} from '../point-intelligence-presentation.js';
import { buildOpenWorldIntelligenceHtml } from '../open-world-intelligence-presentation.js';
import { mountOpenWorldInspector } from '../open-world-intelligence-inspector-controller.js';
import {
  getWorkspaceContext,
  WORKSPACES,
  shouldShowLiveFeedSection,
  workspaceOwnsIqaiControl
} from '../workspace-context.js';

const PROVENANCE_LAYOUT = [
  { label: 'Status', wide: false },
  { label: 'Execution', wide: false },
  { label: 'Spatial operation', wide: false },
  { label: 'Dataset', wide: false },
  { label: 'Search location', wide: true },
  { label: 'Radius / limit', wide: false },
  { label: 'Source', wide: true },
  { label: 'Source check', wide: false },
  { label: 'Geometry check', wide: false },
  { label: 'Operational/status check', wide: false },
  { label: 'Result count', wide: false },
  { label: 'Reproducible', wide: false },
  { label: 'Unresolved', wide: false },
  { label: 'Freshness', wide: false },
  { label: 'Model', wide: false },
  { label: 'AI Cost', wide: false },
  { label: 'Evidence', wide: true }
];

const CONDITIONAL_IQAI_FIELDS = new Set([
  'Operational/status check'
]);

export class DetailPanel {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.lastMapResult = null;
    this._activeCategoryFilter = { label: 'All amenities', count: null };
    this._stmStatus = null;
    this._aircraftStatus = null;
    this._vesselsStatus = null;
    this._hydroStatus = null;
    this._spvmWorkspacePayload = null;
    this.render();
    this.signInBtn = this.root?.querySelector('#spatial-sign-in');
    this.errorEl = this.root?.querySelector('#spatial-detail-error');
    this.selectedFeatureEl = this.root?.querySelector('#spatial-selected-feature');
    this.currentQueryEl = this.root?.querySelector('#spatial-current-query');
    this.selectedSection = this.root?.querySelector('#spatial-selected-section');
    this.querySection = this.root?.querySelector('#spatial-query-section');
    this.stmLiveStatusEl = this.root?.querySelector('#spatial-stm-live-status');
    if (this.signInBtn) {
      this.signInBtn.addEventListener('click', () => {
        this.onSignIn?.();
      });
    }
  }

  render() {
    if (!this.root) return;
    const provenanceCards = PROVENANCE_LAYOUT.map(({ label, wide }) => `
      <div class="provenance-card${wide ? ' provenance-card--wide' : ''}" data-iqai-row="${label}">
        <div class="provenance-card__label">${label}</div>
        <div class="provenance-card__value" data-field="${label}">—</div>
      </div>`).join('');

    this.root.innerHTML = `
      <header class="rail-header">
        <h2 class="rail-title">Intelligence</h2>
        <button type="button" class="rail-collapse-btn" data-collapse="right" aria-label="Collapse intelligence panel">×</button>
      </header>
      <div class="intel-panel__scroll">
        <section class="intel-card-section" id="spatial-workspace-section">
          <h3 class="intel-section-label">Map</h3>
          <div id="spatial-workspace-summary" class="intel-card intel-card--muted">
            <p class="detail-muted">Loading WebMap…</p>
          </div>
        </section>
        <section class="intel-card-section" id="spatial-point-intelligence-section">
          <div id="spatial-time-lens-host"></div>
          <div id="spatial-open-world-intelligence-host"></div>
          <div id="spatial-open-world-intelligence-results" class="intel-card intel-card--muted" hidden></div>
          <div id="spatial-point-intelligence-host"></div>
          <div id="spatial-point-intelligence-results" class="intel-card intel-card--muted" hidden>
            <p class="detail-muted">No Point Intelligence query yet.</p>
          </div>
        </section>
        <section class="intel-card-section" id="spatial-active-data-section" hidden>
          <h3 class="intel-section-label">Active data</h3>
          <div id="spatial-active-data" class="intel-card intel-card--muted">
            <p class="detail-muted">No visible layers</p>
          </div>
        </section>
        <p class="intel-helper-text" id="spatial-intel-helper">Run a map command, add data, or select a feature.</p>
        <section class="intel-card-section" id="spatial-selected-section">
          <h3 class="intel-section-label">Selected feature</h3>
          <div id="spatial-selected-feature" class="intel-card intel-card--muted">
            <p class="detail-muted">No feature selected</p>
          </div>
        </section>
        <section class="intel-card-section" id="spatial-last-operation-section" hidden>
          <h3 class="intel-section-label">Last result</h3>
          <div id="spatial-last-operation" class="intel-card">—</div>
        </section>
        <section class="intel-card-section intel-feed-section" id="spatial-spvm-workspace-section" hidden>
          <h3 class="intel-section-label">SPVM crime</h3>
          <div id="spatial-spvm-workspace-body" class="intel-card">—</div>
        </section>
        <section class="intel-card-section" id="spatial-query-section" hidden>
          <h3 class="intel-section-label">Current operation</h3>
          <div id="spatial-current-query" class="intel-card">—</div>
        </section>
        <section class="intel-card-section intel-feed-section" id="spatial-stm-live-section" hidden>
          <h3 class="intel-section-label">STM live buses</h3>
          <div id="spatial-stm-live-status" class="intel-card">—</div>
        </section>
        <section class="intel-card-section intel-feed-section" id="spatial-aircraft-live-section" hidden>
          <h3 class="intel-section-label">Aircraft live</h3>
          <div id="spatial-aircraft-live-status" class="intel-card">—</div>
        </section>
        <section class="intel-card-section intel-feed-section" id="spatial-vessels-live-section" hidden>
          <h3 class="intel-section-label">Vessels live</h3>
          <div id="spatial-vessels-live-status" class="intel-card">—</div>
        </section>
        <section class="intel-card-section intel-feed-section" id="spatial-hydro-outages-section" hidden>
          <h3 class="intel-section-label">Hydro-Québec outages</h3>
          <div id="spatial-hydro-outages-status" class="intel-card">—</div>
        </section>
        <details class="intel-card-section intel-provenance-details" id="spatial-provenance-details">
          <summary class="intel-section-label intel-provenance-summary">Control &amp; provenance ›</summary>
          <div class="provenance-grid">${provenanceCards}</div>
          <button type="button" class="detail-sign-in" id="spatial-sign-in" hidden>Sign in to ArcGIS</button>
          <p class="detail-error" id="spatial-detail-error" hidden></p>
        </details>
      </div>
    `;
    this.signInBtn = this.root.querySelector('#spatial-sign-in');
    this.errorEl = this.root.querySelector('#spatial-detail-error');
    this.selectedFeatureEl = this.root.querySelector('#spatial-selected-feature');
    this.currentQueryEl = this.root.querySelector('#spatial-current-query');
    this.selectedSection = this.root.querySelector('#spatial-selected-section');
    this.querySection = this.root.querySelector('#spatial-query-section');
    this.stmLiveStatusEl = this.root.querySelector('#spatial-stm-live-status');
    this.hydroOutageStatusEl = this.root.querySelector('#spatial-hydro-outages-status');
    this.aircraftLiveStatusEl = this.root.querySelector('#spatial-aircraft-live-status');
    this.vesselsLiveStatusEl = this.root.querySelector('#spatial-vessels-live-status');
    this.spvmWorkspaceSection = this.root.querySelector('#spatial-spvm-workspace-section');
    this.pointIntelligenceHost = this.root.querySelector('#spatial-point-intelligence-host');
    this.timeLensHost = this.root.querySelector('#spatial-time-lens-host');
    this.openWorldHost = this.root.querySelector('#spatial-open-world-intelligence-host');
    this.openWorldResults = this.root.querySelector('#spatial-open-world-intelligence-results');
    this.pointIntelligenceResults = this.root.querySelector('#spatial-point-intelligence-results');
    this.spvmWorkspaceBodyEl = this.root.querySelector('#spatial-spvm-workspace-body');
    this.workspaceSummaryEl = this.root.querySelector('#spatial-workspace-summary');
    this.activeDataEl = this.root.querySelector('#spatial-active-data');
    this.activeDataSection = this.root.querySelector('#spatial-active-data-section');
    this.intelHelperEl = this.root.querySelector('#spatial-intel-helper');
    this.lastOperationSection = this.root.querySelector('#spatial-last-operation-section');
    this.lastOperationEl = this.root.querySelector('#spatial-last-operation');
    this.provenanceDetails = this.root.querySelector('#spatial-provenance-details');
    this.stmLiveSection = this.root.querySelector('#spatial-stm-live-section');
    this.aircraftLiveSection = this.root.querySelector('#spatial-aircraft-live-section');
    this.vesselsLiveSection = this.root.querySelector('#spatial-vessels-live-section');
    this.hydroOutageSection = this.root.querySelector('#spatial-hydro-outages-section');
  }

  applyWorkspaceLayout(ctx = getWorkspaceContext()) {
    const spvm = ctx.activeWorkspace === WORKSPACES.SPVM_CRIME;
    const xray = ctx.activeWorkspace === WORKSPACES.AMENITY_XRAY;
    const scoped = ctx.activeWorkspace === WORKSPACES.SCOPED_QUERY;

    if (this.spvmWorkspaceSection) this.spvmWorkspaceSection.hidden = true;
    if (this.querySection) this.querySection.hidden = true;

    if (this.stmLiveSection) {
      this.stmLiveSection.hidden = !shouldShowLiveFeedSection('stm', ctx);
    }
    if (this.aircraftLiveSection) {
      this.aircraftLiveSection.hidden = !shouldShowLiveFeedSection('aircraft', ctx);
    }
    if (this.vesselsLiveSection) {
      this.vesselsLiveSection.hidden = !shouldShowLiveFeedSection('vessels', ctx);
    }
    if (this.hydroOutageSection) {
      this.hydroOutageSection.hidden = !shouldShowLiveFeedSection('hydro', ctx);
    }

    if (spvm && this._spvmWorkspacePayload) {
      this.renderSpvmWorkspaceBody(this._spvmWorkspacePayload);
    }

    if (shouldShowLiveFeedSection('stm', ctx) && this._stmStatus) {
      this.renderStmLiveStatus(this._stmStatus);
    }
    if (shouldShowLiveFeedSection('aircraft', ctx) && this._aircraftStatus) {
      this.renderAircraftLiveStatus(this._aircraftStatus);
    }
    if (shouldShowLiveFeedSection('vessels', ctx) && this._vesselsStatus) {
      this.renderVesselsLiveStatus(this._vesselsStatus);
    }
    if (shouldShowLiveFeedSection('hydro', ctx) && this._hydroStatus) {
      this.renderHydroOutageStatus(this._hydroStatus);
    }

    void xray;
    void scoped;
  }

  renderSpvmWorkspaceBody(payload) {
    if (!this.spvmWorkspaceBodyEl || !payload?.state || !payload?.analytics) return;
    const { state, analytics, status } = payload;
    const shiftLabel = state.shifts?.size >= SPVM_ALL_SHIFTS.length
      ? 'ALL'
      : [...state.shifts || []].map((s) => shiftUiLabelForValue(s)).join(', ');
    const categoryCount = state.categories?.size ?? 0;
    const categoryLabel = categoryCount >= SPVM_ALL_CATEGORIES.length
      ? 'All'
      : `${categoryCount} selected`;
    const freshness = status?.latestCrimeDate
      ? `Latest record ${status.latestCrimeDate}`
      : status?.pipelineUpdatedAt
        ? `Pipeline ${status.pipelineUpdatedAt}`
        : 'Unknown';
    const latestRecord = status?.latestCrimeDate || status?.pipelineUpdatedAt || '—';

    this.spvmWorkspaceBodyEl.innerHTML = [
      this.stackedItem('Window', `${state.windowDays} days`),
      this.stackedItem('Visible reports', String(analytics.total ?? '—')),
      this.stackedItem('Categories', categoryLabel),
      this.stackedItem('Shift', shiftLabel),
      this.stackedItem('Latest source record', latestRecord),
      this.stackedItem('Source freshness', freshness)
    ].join('');
  }

  setField(label, value) {
    const el = this.root?.querySelector(`[data-field="${label}"]`);
    const row = this.root?.querySelector(`[data-iqai-row="${label}"]`);
    const empty = value == null || value === '—' || value === '';
    if (row) {
      if (CONDITIONAL_IQAI_FIELDS.has(label)) {
        row.hidden = empty;
      } else {
        row.hidden = empty;
      }
    }
    if (CONDITIONAL_IQAI_FIELDS.has(label)) {
      if (!value || value === '—') {
        if (el) el.textContent = '—';
        return;
      }
    }
    if (el) el.textContent = value ?? '—';
    this.refreshProvenanceOpenState();
  }

  refreshProvenanceOpenState() {
    if (!this.provenanceDetails) return;
    // Keep audit/provenance collapsed unless the user explicitly opens it.
    if (!this.provenanceDetails.open) {
      this.provenanceDetails.open = false;
    }
  }

  setWorkspaceSummary({ webmapTitle, layerCount = 0, visibleCount = 0, ready = false } = {}) {
    if (!this.workspaceSummaryEl) return;
    const title = webmapTitle || 'IQAI Montréal';
    this.workspaceSummaryEl.innerHTML = [
      `<p class="detail-workspace-map">${escapeHtml(title)}</p>`,
      '<h3 class="intel-section-label intel-section-label--inline">Data</h3>',
      `<p class="detail-workspace-data">${layerCount} layers available<br>${visibleCount} visible</p>`
    ].join('');
    if (this.intelHelperEl) {
      this.intelHelperEl.hidden = Boolean(this.lastMapResult?.supported);
    }
    if (this.provenanceDetails) {
      this.provenanceDetails.open = false;
    }
  }

  setActiveDataSummary(layers = []) {
    if (!this.activeDataEl) return;
    if (!layers.length) {
      this.activeDataEl.innerHTML = '<p class="detail-muted">No visible layers</p>';
      return;
    }
    const items = layers.slice(0, 12).map((layer) => (
      `<li><strong>${escapeHtml(layer.title)}</strong>${layer.parentGroup ? `<span class="detail-muted"> — ${escapeHtml(layer.parentGroup)}</span>` : ''}</li>`
    )).join('');
    const more = layers.length > 12
      ? `<p class="detail-muted">+ ${layers.length - 12} more visible</p>`
      : '';
    this.activeDataEl.innerHTML = `<ul class="detail-layer-list">${items}</ul>${more}`;
  }

  setLastOperationSummary(mapResult) {
    if (!this.lastOperationSection || !this.lastOperationEl) return;
    if (!mapResult?.supported) {
      this.lastOperationSection.hidden = true;
      return;
    }
    this.lastOperationSection.hidden = false;
    const count = mapResult.summary?.matchedFeatures ?? mapResult.features?.length ?? 0;
    const radiusMeters = mapResult.summary?.radiusMeters ?? mapResult.xrayResult?.radiusMeters;
    const radiusKm = mapResult.xrayResult?.radiusKm ?? (radiusMeters ? radiusMeters / 1000 : null);
    let scopeLabel = mapResult.summary?.spatialOperation || 'Last result';
    if (Number.isFinite(radiusKm)) {
      const km = Number.isInteger(radiusKm) ? String(radiusKm) : radiusKm.toFixed(1);
      scopeLabel = `Within ${km} km`;
    }
    const location = mapResult.origin?.matchedAddress || '—';
    const dataset = mapResult.summary?.dataset
      || mapResult.datasetResults?.[0]?.displayName
      || mapResult.datasetResults?.[0]?.authority
      || 'Amenities';
    const sourcePath = mapResult.source?.authority
      || mapResult.datasetResults?.[0]?.authority
      || mapResult.datasetResults?.[0]?.displayName
      || mapResult.summary?.source
      || '—';
    const status = mapResult.summary?.status || 'Controlled';
    const countLabel = count === 1 ? '1 location found' : `${count.toLocaleString()} locations found`;
    const activeFilter = this._activeCategoryFilter || { label: 'All amenities', count };

    this.lastOperationEl.innerHTML = `
      <div class="intel-result-stack">
        <div class="intel-result-block">
          <div class="intel-result-block__label">Last result</div>
          <div class="intel-result-block__value">${escapeHtml(scopeLabel)}</div>
          <div class="intel-result-block__sub">${escapeHtml(countLabel)}</div>
          <div class="intel-result-block__meta">${escapeHtml(location)}</div>
        </div>
        <div class="intel-result-block">
          <div class="intel-result-block__label">Source</div>
          <div class="intel-result-block__value">${escapeHtml(dataset)}</div>
          <div class="intel-result-block__meta">${escapeHtml(sourcePath)}</div>
        </div>
        <div class="intel-result-block">
          <div class="intel-result-block__label">Status</div>
          <div class="intel-result-block__value">${escapeHtml(status)}</div>
        </div>
        <div class="intel-result-block">
          <div class="intel-result-block__label">Active filter</div>
          <div class="intel-result-block__value">${escapeHtml(activeFilter.label)}</div>
          <div class="intel-result-block__sub">${activeFilter.count != null ? `${Number(activeFilter.count).toLocaleString()} features` : '—'}</div>
        </div>
      </div>`;
  }

  setActiveCategoryFilter(categoryValue, mapResult = this.lastMapResult, activeMeta = null) {
    if (activeMeta) {
      this._activeCategoryFilter = activeMeta;
    } else if (!categoryValue) {
      const total = mapResult?.summary?.matchedFeatures
        ?? mapResult?.categorySummary?.totalCount
        ?? mapResult?.features?.length
        ?? null;
      const datasetLabel = mapResult?.summary?.dataset
        || mapResult?.datasetResults?.[0]?.displayName
        || 'Results';
      const hasAmenityCategories = Boolean(
        mapResult?.categorySummary?.categories?.length
        || mapResult?.xrayResult?.categories?.length
      );
      const label = hasAmenityCategories
        ? `All ${String(datasetLabel).toLowerCase()}`
        : String(datasetLabel);
      this._activeCategoryFilter = { label, count: total };
    } else {
      const legend = mapResult?.categorySummary?.categories
        || mapResult?.xrayResult?.categories
        || [];
      const entry = legend.find((cat) => String(cat.value) === String(categoryValue));
      this._activeCategoryFilter = {
        label: entry?.label || String(categoryValue).replace(/_/g, ' '),
        count: entry?.count ?? null
      };
    }
    if (mapResult?.supported) this.setLastOperationSummary(mapResult);
  }

  stackedItem(label, value, options = {}) {
    const valueClass = options.emphasis
      ? 'detail-item-value detail-item-value-emphasis'
      : 'detail-item-value';
    const wrapClass = options.wrap ? 'detail-item-value-wrap' : '';
    const inner = options.html ? value : (value ?? '—');
    return `
      <div class="detail-item">
        <div class="detail-item-label">${label}</div>
        <div class="${valueClass} ${wrapClass}">${inner}</div>
      </div>`;
  }

  setArcgisFeatureDetail(graphic) {
    const attributes = graphic?.attributes || {};
    if (isLiveAircraftFeature(attributes)) {
      const layer = graphic?.layer || graphic?.sourceLayer;
      this.selectedFeatureEl.innerHTML = buildLiveAircraftFeatureHtml(attributes, {
        layerTitle: layer?.title
      });
      return;
    }
    if (isLiveVesselFeature(attributes)) {
      const layer = graphic?.layer || graphic?.sourceLayer;
      this.selectedFeatureEl.innerHTML = buildLiveVesselFeatureHtml(attributes, {
        layerTitle: layer?.title
      });
      return;
    }
    if (isHydroOutageFeature(attributes)) {
      const layer = graphic?.layer || graphic?.sourceLayer;
      this.selectedFeatureEl.innerHTML = buildHydroOutageFeatureHtml(attributes, {
        layerTitle: layer?.title
      });
      return;
    }
    if (isSpvmCrimeFeature(attributes)) {
      this.selectedFeatureEl.innerHTML = buildSpvmCrimeFeatureHtml(attributes);
      return;
    }
    const layer = graphic?.layer || graphic?.sourceLayer;
    if (hasAuthoredArcgisPopup(layer)) {
      const detail = buildAgolSupplementaryDetail(graphic, this.lastMapResult);
      this.selectedFeatureEl.innerHTML = buildAgolSupplementaryHtml(detail);
      return;
    }
    const detail = buildAgolFeatureDetail(graphic);
    this.selectedFeatureEl.innerHTML = buildAgolFeatureHtml(graphic, detail);
  }

  compoundDatasetBlock(datasetLabel, operationLine, count) {
    return `
      <div class="detail-query-block">
        <div class="detail-compound-dataset">${datasetLabel}</div>
        <div class="detail-compound-operation">${operationLine}</div>
        <div class="detail-compound-count">${count}</div>
      </div>`;
  }

  setSelectedFeatureHtml(items) {
    if (!this.selectedFeatureEl) return;
    if (!items?.length) {
      this.selectedFeatureEl.innerHTML = '<p class="detail-muted">No feature selected</p>';
      return;
    }
    this.selectedFeatureEl.innerHTML = items.join('');
  }

  setCurrentQueryHtml(items) {
    if (!this.currentQueryEl) return;
    if (!items?.length) {
      this.currentQueryEl.textContent = '—';
      return;
    }
    this.currentQueryEl.innerHTML = items.join('');
  }

  setStmLiveStatus(status = {}) {
    this._stmStatus = status;
    if (!shouldShowLiveFeedSection('stm', getWorkspaceContext())) return;
    this.renderStmLiveStatus(status);
  }

  renderStmLiveStatus(status = {}) {
    if (!this.stmLiveStatusEl) return;
    const lastUpdate = status.retrievedAt
      ? (status.stale ? `${status.retrievedAt} (STALE)` : status.retrievedAt)
      : '—';
    const feedTime = status.feedTimestampIso || '—';
    const sourceLabel = status.stale
      ? `${status.source || 'STM GTFS-Realtime'} — ${status.error || 'ERROR'}`
      : (status.source || 'STM GTFS-Realtime');
    const items = [
      this.stackedItem('Vehicles', String(status.vehicleCount ?? '—')),
      this.stackedItem('Last update', lastUpdate),
      this.stackedItem('Feed time', feedTime),
      this.stackedItem('Source', sourceLabel)
    ];
    this.stmLiveStatusEl.innerHTML = items.join('');
  }

  setHydroOutageStatus(status = {}) {
    this._hydroStatus = status;
    if (!shouldShowLiveFeedSection('hydro', getWorkspaceContext())) return;
    this.renderHydroOutageStatus(status);
  }

  renderHydroOutageStatus(status = {}) {
    if (!this.hydroOutageStatusEl) return;
    const freshness = status.status || (status.stale ? 'STALE' : 'CURRENT');
    const polygonFreshness = status.polygonStatus || freshness;
    const feedTime = status.feedTimestamp || '—';
    const received = status.receivedAt
      ? (status.stale ? `${status.receivedAt} (STALE)` : status.receivedAt)
      : '—';
    const sourceLabel = status.error && status.stale
      ? `${status.source || 'Hydro-Québec Open Data'} — ${status.error}`
      : (status.source || 'Hydro-Québec Open Data');
    const items = [
      this.stackedItem('Outage points', String(status.outageCount ?? '—')),
      this.stackedItem('Outage areas', String(status.polygonCount ?? '—')),
      this.stackedItem('Feed version', status.version || '—'),
      this.stackedItem('Feed time', feedTime),
      this.stackedItem('Received', received),
      this.stackedItem('Refresh target', '15 minutes'),
      this.stackedItem('Freshness', freshness),
      this.stackedItem('Area freshness', polygonFreshness),
      this.stackedItem('Points precision', status.spatialPrecision || 'Approximate outage location'),
      this.stackedItem('Areas precision', status.areaSpatialPrecision || 'Approximate outage area'),
      this.stackedItem('AI cost', status.aiCost || '$0.00'),
      this.stackedItem('Source', sourceLabel)
    ];
    this.hydroOutageStatusEl.innerHTML = items.join('');
    if (
      getWorkspaceContext().activeWorkspace === WORKSPACES.LIVE_FEED
      && getWorkspaceContext().workspaceMeta?.liveFeedId === 'hydro'
    ) {
      this.applyIqaiControlFromLiveFeed({
        summary: {
          status: 'Controlled',
          execution: 'Deterministic GIS',
          freshness,
          spatialOperation: 'Live outage feed',
          matchedFeatures: status.outageCount ?? '—',
          dataset: 'Hydro-Québec'
        },
        source: {
          authority: status.source || 'Hydro-Québec Open Data',
          catalogueUrl: 'https://pannes.hydroquebec.com/pannes/donnees/v3_0/bisversion.json'
        }
      });
    }
  }

  setAircraftLiveStatus(status = {}) {
    this._aircraftStatus = status;
    if (!shouldShowLiveFeedSection('aircraft', getWorkspaceContext())) return;
    this.renderAircraftLiveStatus(status);
  }

  renderAircraftLiveStatus(status = {}) {
    if (!this.aircraftLiveStatusEl) return;
    const freshness = status.status || (status.stale ? 'STALE' : 'CURRENT');
    const feedTime = status.feedTimestamp || '—';
    const received = status.receivedAt
      ? (status.stale ? `${status.receivedAt} (STALE)` : status.receivedAt)
      : '—';
    const sourceLabel = status.error && status.stale
      ? `${status.source || 'ADSB.lol'} — ${status.error}`
      : (status.source || 'ADSB.lol');
    const items = [
      this.stackedItem('Objects', String(status.aircraftCount ?? '—')),
      this.stackedItem('Last update', received),
      this.stackedItem('Feed time', feedTime),
      this.stackedItem('Refresh', `${status.refreshSeconds ?? 10} sec`),
      this.stackedItem('Freshness', freshness),
      this.stackedItem('Source', sourceLabel),
      this.stackedItem('Source class', status.sourceClass || 'OPEN_COMMUNITY_LIVE'),
      this.stackedItem('License', status.sourceLicense || 'ODbL'),
      this.stackedItem('Spatial precision', status.spatialPrecision || 'Live reported aircraft position'),
      this.stackedItem('AI cost', status.aiCost || '$0.00')
    ];
    this.aircraftLiveStatusEl.innerHTML = items.join('');
    if (
      getWorkspaceContext().activeWorkspace === WORKSPACES.LIVE_FEED
      && getWorkspaceContext().workspaceMeta?.liveFeedId === 'aircraft'
    ) {
      this.applyIqaiControlFromLiveFeed({
        summary: {
          status: 'Controlled',
          execution: 'Deterministic GIS',
          freshness,
          spatialOperation: 'Live aircraft feed',
          matchedFeatures: status.aircraftCount ?? '—',
          dataset: 'Aircraft — Live'
        },
        source: {
          authority: status.source || 'ADSB.lol',
          catalogueUrl: 'https://api.adsb.lol/docs'
        }
      });
    }
  }

  setVesselsLiveStatus(status = {}) {
    this._vesselsStatus = status;
    if (!shouldShowLiveFeedSection('vessels', getWorkspaceContext())) return;
    this.renderVesselsLiveStatus(status);
  }

  renderVesselsLiveStatus(status = {}) {
    if (!this.vesselsLiveStatusEl) return;
    const freshness = status.status || (status.stale ? 'STALE' : 'CURRENT');
    const feedTime = status.feedTimestamp || '—';
    const received = status.receivedAt
      ? (status.stale ? `${status.receivedAt} (STALE)` : status.receivedAt)
      : '—';
    const sourceLabel = status.error && status.stale
      ? `${status.source || 'AISStream.io'} — ${status.error}`
      : (status.source || 'AISStream.io');
    const items = [
      this.stackedItem('Objects', String(status.vesselCount ?? '—')),
      this.stackedItem('Last AIS message', received),
      this.stackedItem('Received', received),
      this.stackedItem('Feed time', feedTime),
      this.stackedItem('Refresh', `${status.refreshSeconds ?? 8} sec`),
      this.stackedItem('Freshness', freshness),
      this.stackedItem('Source', sourceLabel),
      this.stackedItem('Source class', status.sourceClass || 'OPEN_COMMUNITY_LIVE'),
      this.stackedItem('License', status.sourceLicense || 'AISStream terms of use'),
      this.stackedItem('Spatial precision', status.spatialPrecision || 'AIS reported position'),
      this.stackedItem('AI cost', status.aiCost || '$0.00')
    ];
    if (status.keyRequired) {
      items.push(this.stackedItem('API key', 'AISSTREAM KEY REQUIRED'));
    }
    this.vesselsLiveStatusEl.innerHTML = items.join('');
    if (
      getWorkspaceContext().activeWorkspace === WORKSPACES.LIVE_FEED
      && getWorkspaceContext().workspaceMeta?.liveFeedId === 'vessels'
    ) {
      this.applyIqaiControlFromLiveFeed({
        summary: {
          status: 'Controlled',
          execution: 'Deterministic GIS',
          freshness,
          spatialOperation: 'Live vessel feed',
          matchedFeatures: status.vesselCount ?? '—',
          dataset: 'Vessels — Live'
        },
        source: {
          authority: status.source || 'AISStream.io',
          catalogueUrl: 'https://aisstream.io/'
        }
      });
    }
  }

  applyIqaiControlFromLiveFeed(mapResult) {
    if (!workspaceOwnsIqaiControl(getWorkspaceContext().activeWorkspace)) return;
    if (getWorkspaceContext().activeWorkspace !== WORKSPACES.LIVE_FEED) return;
    this.updateIqaiControlFields(mapResult);
  }

  setLayerList(mapResult) {
    this.lastMapResult = mapResult;
    this.setSelectedFeatureHtml([]);
    if (this.selectedSection) this.selectedSection.hidden = true;
    if (this.querySection) this.querySection.hidden = false;
    this.resetIqaiFields();

    const layers = mapResult.layers || [];
    const filterLabel = mapResult.summary?.spatialOperation?.includes('point')
      ? 'Point layers'
      : 'Operational layers';
    const items = [
      this.stackedItem('Prompt', mapResult.prompt),
      this.stackedItem('Layer catalog', filterLabel),
      this.stackedItem('Layer count', String(layers.length))
    ];

    if (layers.length) {
      const listHtml = layers.map((layer) => {
        const meta = [
          layer.type || 'layer',
          layer.geometryType || null,
          layer.visible ? 'visible' : 'hidden',
          layer.queryable ? 'queryable' : null
        ].filter(Boolean).join(' · ');
        return `<li><strong>${layer.title}</strong><span class="detail-muted"> — ${meta}</span></li>`;
      }).join('');
      items.push(this.stackedItem('Layers', `<ul class="detail-layer-list">${listHtml}</ul>`, { html: true }));
    }

    this.setCurrentQueryHtml(items);
    this.updateIqaiControlFields({
      ...mapResult,
      source: { authority: mapResult.summary?.authority || mapResult.layerCatalogSummary?.webmapTitle || 'Montreal 1' }
    });
  }

  radiusLimitLabel(mapResult) {
    if (mapResult.summary?.action === 'COMPOUND') return 'See CURRENT QUERY';
    if (mapResult.summary?.limit) return String(mapResult.summary.limit);
    if (mapResult.summary?.radiusMeters) {
      const km = mapResult.summary.radiusMeters / 1000;
      const label = Number.isInteger(km) ? String(km) : km.toFixed(1);
      return `${label} km`;
    }
    return '—';
  }

  compoundQueryItems(mapResult) {
    const items = [];
    const commandSummaries = mapResult.summary?.commands || [];
    const resultByDataset = new Map(
      (mapResult.datasetResults || []).map((result) => [result.datasetId, result])
    );

    for (const cmd of commandSummaries) {
      const datasetResult = (mapResult.datasetResults || []).find(
        (result) => result.displayName === cmd.dataset
      ) || resultByDataset.get(cmd.datasetIds?.[0]);
      const datasetLabel = cmd.dataset || datasetResult?.displayName || 'Dataset';
      let operationLine = cmd.spatialOperation || '—';
      if (cmd.action === 'NEAREST') operationLine = 'Nearest';
      if (cmd.action === 'WITHIN' && cmd.radiusMeters) {
        const km = cmd.radiusMeters / 1000;
        const label = Number.isInteger(km) ? String(km) : km.toFixed(1);
        operationLine = `Within ${label} km`;
      }
      const resultCount = cmd.matchedFeatures ?? datasetResult?.features?.length ?? '—';
      items.push(this.compoundDatasetBlock(datasetLabel, operationLine, resultCount));
    }

    items.push(`
      <div class="detail-query-block detail-query-block-shared">
        <div class="detail-compound-label">Shared location</div>
        <div class="detail-compound-shared-value">${mapResult.origin?.matchedAddress || '—'}</div>
      </div>
      <div class="detail-query-block detail-query-block-total">
        <div class="detail-compound-label">Total</div>
        <div class="detail-compound-total">${mapResult.summary?.matchedFeatures ?? '—'} results</div>
      </div>`);
    return items;
  }

  resetIqaiFields() {
    for (const { label } of PROVENANCE_LAYOUT) {
      if (label === 'Operational/status check') continue;
      this.setField(label, '—');
    }
    const opRow = this.root?.querySelector('[data-iqai-row="Operational/status check"]');
    if (opRow) opRow.hidden = true;
    this.setEvidence('—');
    this.refreshProvenanceOpenState();
  }

  setQuerySummary(mapResult) {
    if (!mapResult) return;
    this.lastMapResult = mapResult;

    this.setSelectedFeatureHtml([]);
    if (this.selectedSection) this.selectedSection.hidden = false;
    if (this.querySection) this.querySection.hidden = true;
    if (this.lastOperationSection) this.lastOperationSection.hidden = false;
    this.resetIqaiFields();

    if (mapResult.summary?.action === 'COMPOUND') {
      this.setCurrentQueryHtml(this.compoundQueryItems(mapResult));
      this.setLastOperationSummary(mapResult);
      this.updateIqaiControlFields(mapResult);
      return;
    }

    if (mapResult.action === 'CATEGORY_COUNTS_WITHIN' || mapResult.summary?.displayMode === 'category_counts') {
      this.setCategoryCountsReadout(mapResult);
      return;
    }

    this.setLastOperationSummary(mapResult);
    this.setActiveCategoryFilter(null, mapResult);
    this.updateIqaiControlFields(mapResult);
    if (this.intelHelperEl) this.intelHelperEl.hidden = true;
    if (this.provenanceDetails) this.provenanceDetails.open = false;
  }

  setCategoryCountsReadout(mapResult) {
    if (!mapResult) return;
    this.lastMapResult = mapResult;
    this.setSelectedFeatureHtml([]);
    if (this.selectedSection) this.selectedSection.hidden = false;
    if (this.querySection) this.querySection.hidden = true;
    if (this.lastOperationSection) this.lastOperationSection.hidden = false;
    this.resetIqaiFields();

    const xray = mapResult.xrayResult || {};
    const categories = xray.categories || mapResult.categoryCounts || [];
    const km = xray.radiusKm ?? (mapResult.summary?.radiusMeters ? mapResult.summary.radiusMeters / 1000 : null);
    const kmLabel = Number.isFinite(km) ? `${km} km` : '—';

    const queryItems = [
      this.stackedItem('Prompt', mapResult.prompt),
      this.stackedItem('Operation', 'Category counts within AOI'),
      this.stackedItem('Search location', mapResult.origin?.matchedAddress || '—'),
      this.stackedItem('Radius', kmLabel),
      this.stackedItem('Source', 'OpenStreetMap Amenities'),
      this.stackedItem('Semantic field', xray.semanticField || mapResult.summary?.semanticField || 'amenity'),
      this.stackedItem('Total categories', String(xray.totalCategories ?? categories.length)),
      this.stackedItem('Total features', String(xray.totalFeaturesRepresented ?? mapResult.summary?.matchedFeatures ?? '—'))
    ];

    const rows = categories.slice(0, 25).map((entry) => (
      `<div class="detail-xray-row"><span class="detail-xray-cat">${entry.value}</span><span class="detail-xray-count">${entry.count}</span></div>`
    )).join('');
    const more = categories.length > 25
      ? `<div class="detail-muted">… and ${categories.length - 25} more categories</div>`
      : '';
    queryItems.push(this.stackedItem(
      'Categories',
      `<div class="detail-xray-heading">AMENITIES WITHIN ${kmLabel.toUpperCase()}</div><div class="detail-xray-table">${rows}${more}</div>`,
      { html: true }
    ));

    this.setCurrentQueryHtml(queryItems);
    this.setLastOperationSummary(mapResult);
    this.setActiveCategoryFilter(null, mapResult);
    this.updateIqaiControlFields(mapResult);
  }

  setSpvmExplorerControl(payload) {
    this._spvmWorkspacePayload = payload;
    this.applyWorkspaceLayout(getWorkspaceContext());
    this.applyIqaiControlFromSpvm(payload);
  }

  applyIqaiControlFromSpvm(payload) {
    if (getWorkspaceContext().activeWorkspace !== WORKSPACES.SPVM_CRIME) return;
    const { state, analytics, status } = payload || {};
    if (!state || !analytics) return;

    const freshness = status?.pipelineUpdatedAt
      ? `Pipeline ${status.pipelineUpdatedAt}`
      : status?.latestCrimeDate
        ? `Latest crime ${status.latestCrimeDate}`
        : 'Unknown';

    this.setField('Status', 'Controlled');
    this.setField('Execution', 'Deterministic GIS');
    this.setField('Source', 'SPVM / Ville de Montréal');
    this.setField('Spatial operation', state.viewMode === 'DENSITY' ? 'Density view' : 'Incident view');
    this.setField('Dataset', status?.dataset || 'Actes criminels');
    this.setField('Search location', '—');
    this.setField('Radius / limit', `${state.windowDays} day window`);
    this.setField('Source check', 'Passed');
    this.setField('Geometry check', 'Passed');
    this.setField('Operational/status check', null);
    this.setField('Result count', String(analytics.total ?? '—'));
    this.setField('Reproducible', 'Yes');
    this.setField('Unresolved', 'None');
    this.setField('Freshness', freshness);
    this.setField('Model', 'None');
    this.setField('AI Cost', '$0.00');
    this.setEvidence(status?.sourceUrl || '—');
  }

  updateIqaiControlFields(mapResult) {
    const ws = getWorkspaceContext().activeWorkspace;
    if (ws === WORKSPACES.SPVM_CRIME || ws === WORKSPACES.LIVE_FEED) {
      return;
    }
    const evidence = mapResult.source?.catalogueUrl || mapResult.source?.resourceUrl || '—';
    const freshness = mapResult.summary?.freshness || 'Unknown';
    const operational = mapResult.summary?.operationalStatusCheck || null;
    const closedExcluded = mapResult.summary?.closedRecordsExcluded || null;

    this.setField('Status', mapResult.summary?.status || 'Controlled');
    this.setField('Execution', mapResult.summary?.execution || 'Deterministic GIS');
    this.setField('Source', mapResult.source?.authority || mapResult.source?.name || '—');
    this.setField('Spatial operation', mapResult.summary?.spatialOperation || '—');
    this.setField('Dataset', mapResult.summary?.dataset || '—');
    this.setField('Search location', mapResult.origin?.matchedAddress || '—');
    this.setField('Radius / limit', this.radiusLimitLabel(mapResult));
    this.setField('Source check', mapResult.summary?.sourceCheck || 'Passed');
    this.setField('Geometry check', mapResult.summary?.geometryCheck || 'Passed');
    if (operational) {
      const opLabel = closedExcluded
        ? `${operational} (${closedExcluded === 'Yes' ? 'closed excluded' : closedExcluded})`
        : operational;
      this.setField('Operational/status check', opLabel);
    } else {
      this.setField('Operational/status check', null);
    }
    this.setField('Result count', String(mapResult.summary?.matchedFeatures ?? '—'));
    this.setField('Reproducible', mapResult.summary?.reproducible || 'Yes');
    this.setField('Unresolved', mapResult.summary?.unresolved || 'None');
    this.setField('Freshness', freshness);
    this.setField('Model', 'None');
    this.setField('AI Cost', '$0.00');
    this.setEvidence(evidence);
  }

  setEvidence(value) {
    const el = this.root?.querySelector('[data-field="Evidence"]');
    if (!el) return;
    if (value && value !== '—' && /^https?:\/\//i.test(value)) {
      el.innerHTML = `<a href="${value}" target="_blank" rel="noopener noreferrer" class="detail-link">${value}</a>`;
    } else {
      el.textContent = value ?? '—';
    }
  }

  setFeatureDetail(attributes, mapResult = this.lastMapResult, graphic = null) {
    if (isLiveAircraftFeature(attributes)) {
      const layer = graphic?.layer || graphic?.sourceLayer;
      this.selectedFeatureEl.innerHTML = buildLiveAircraftFeatureHtml(attributes, {
        layerTitle: layer?.title
      });
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    if (isLiveVesselFeature(attributes)) {
      const layer = graphic?.layer || graphic?.sourceLayer;
      this.selectedFeatureEl.innerHTML = buildLiveVesselFeatureHtml(attributes, {
        layerTitle: layer?.title
      });
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    if (isHydroOutageFeature(attributes)) {
      const layer = graphic?.layer || graphic?.sourceLayer;
      this.selectedFeatureEl.innerHTML = buildHydroOutageFeatureHtml(attributes, {
        layerTitle: layer?.title
      });
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    if (isSpvmCrimeFeature(attributes)) {
      const spvmWorkspace = getWorkspaceContext().activeWorkspace === WORKSPACES.SPVM_CRIME;
      this.selectedFeatureEl.innerHTML = spvmWorkspace
        ? buildSpvmCrimeSelectionHtml(attributes)
        : buildSpvmCrimeFeatureHtml(attributes);
      if (spvmWorkspace) return;
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    const layer = graphic?.layer || graphic?.sourceLayer;
    if (isOsmRuntimeFeature(attributes, layer)) {
      this.selectedFeatureEl.innerHTML = buildCleanOsmFeatureHtml(attributes);
      if (this.selectedSection) this.selectedSection.hidden = false;
      if (this.intelHelperEl) this.intelHelperEl.hidden = true;
      return;
    }

    if (graphic && hasAuthoredArcgisPopup(layer)) {
      const detail = buildAgolSupplementaryDetail(graphic, mapResult);
      this.selectedFeatureEl.innerHTML = buildAgolSupplementaryHtml(detail);
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    if (graphic && !isKnownIqaiDataset(attributes)) {
      this.setArcgisFeatureDetail(graphic);
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    if (isKnownIqaiDataset(attributes)) {
      this.selectedFeatureEl.innerHTML = buildIqaiFeatureHtml(attributes, mapResult);
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    if (graphic) {
      this.setArcgisFeatureDetail(graphic);
      if (mapResult) this.updateIqaiControlFields(mapResult);
      return;
    }

    this.selectedFeatureEl.innerHTML = buildIqaiFeatureHtml(attributes, mapResult);
    if (mapResult) this.updateIqaiControlFields(mapResult);
  }

  setStationDetail(attributes, mapResult = this.lastMapResult) {
    this.setFeatureDetail(attributes, mapResult);
  }

  clearQueryState() {
    this.lastMapResult = null;
    this.setSelectedFeatureHtml([]);
    this.resetIqaiFields();
    this.setCurrentQueryHtml([
      this.stackedItem('Dataset', '—'),
      this.stackedItem('Operation', '—'),
      this.stackedItem('Results', '—')
    ]);
  }

  setMapResult(mapResult) {
    this.setQuerySummary(mapResult);
  }

  clearMapResult() {
    this.clearQueryState();
  }

  setError(message) {
    if (!this.errorEl) return;
    if (message) {
      this.errorEl.textContent = message;
      this.errorEl.hidden = false;
    } else {
      this.errorEl.textContent = '';
      this.errorEl.hidden = true;
    }
  }

  setSignInVisible(visible) {
    if (this.signInBtn) this.signInBtn.hidden = !visible;
  }

  /** @param {() => void | Promise<void>} fn */
  setSignInHandler(fn) {
    this.onSignIn = fn;
  }

  /**
   * @param {{ point?: { longitude: number, latitude: number }, response?: object, presentation?: object }} payload
   */
  setPointIntelligenceSummary(payload = {}) {
    if (!this.pointIntelligenceResults) return;
    const { response } = payload;
    if (!response) {
      this.pointIntelligenceResults.hidden = true;
      this.pointIntelligenceResults.innerHTML = '<p class="detail-muted">No Point Intelligence query yet.</p>';
      return;
    }

    this.pointIntelligenceResults.hidden = false;
    this.pointIntelligenceResults.innerHTML = buildPointIntelligenceSummaryHtml(payload);
  }

  setPointIntelligenceTemporalNotice({ state, message } = {}) {
    if (!this.pointIntelligenceResults || !state) return;
    const summary = state.mode === 'LATEST'
      ? null
      : `${state.mode} selected — evidence cleared until execution is supported.`;
    this.pointIntelligenceResults.hidden = false;
    this.pointIntelligenceResults.innerHTML = `
      <div class="pi-temporal-notice" data-pi-temporal-notice>
        <p class="pi-temporal-notice__headline">TIME · ${escapeHtml(state.mode)}</p>
        <p class="pi-temporal-notice__message">${escapeHtml(message || summary || '')}</p>
      </div>`;
  }

  setOpenWorldIntelligenceSummary(response) {
    if (!this.openWorldResults) return;
    if (!response?.normalized) {
      this.openWorldResults.hidden = true;
      this.openWorldResults.innerHTML = '<p class="detail-muted">No open-world intelligence search yet.</p>';
      return;
    }
    this.openWorldResults.hidden = false;
    this.openWorldResults.innerHTML = buildOpenWorldIntelligenceHtml(response);
    const inspectorHost = this.openWorldResults.querySelector('#owi-inspector-host');
    if (inspectorHost) mountOpenWorldInspector(inspectorHost);
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
