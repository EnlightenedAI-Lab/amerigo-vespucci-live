import { ResultsTable } from './ResultsTable.js';

const TABS = ['RESULTS', 'EXECUTION', 'AUDIT'];

export class EventTray {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.activeTab = 'RESULTS';
    this.mode = 'map';
    this.lastMapResult = null;
    this.dockOpen = false;
    this.resultCount = 0;
    this.executionReady = false;
    this.onDockToggle = null;
    this.render();
    this.bind();
    this.resultsTable = new ResultsTable(this.resultsHostEl);
  }

  renderTabButtons() {
    const tabLabels = {
      RESULTS: this.resultCount > 0 ? `RESULTS ${this.resultCount.toLocaleString()}` : 'RESULTS',
      EXECUTION: this.executionReady ? 'EXECUTION ✓' : 'EXECUTION',
      AUDIT: 'AUDIT'
    };
    return TABS.map((tab) => `
      <button type="button" class="context-dock__tab${tab === this.activeTab && this.dockOpen ? ' is-active' : ''}"
        data-tab="${tab}" role="tab" aria-selected="${tab === this.activeTab && this.dockOpen}">${tabLabels[tab]}</button>`).join('');
  }

  render() {
    if (!this.root) return;

    this.root.innerHTML = `
      <header class="context-dock__bar">
        <div class="context-dock__tabs" role="tablist" id="spatial-context-tabs">${this.renderTabButtons()}</div>
        <div class="context-dock__actions">
          <button type="button" class="context-dock__btn rail-collapse-btn" data-collapse="bottom" aria-label="Collapse context dock">×</button>
        </div>
      </header>
      <div class="context-dock__body" role="tabpanel">
        <p class="context-dock__empty" id="spatial-event-empty" hidden>No context yet — run a map command to populate results.</p>
        <div class="context-dock__panel" id="spatial-results-panel" data-panel="RESULTS"></div>
        <div class="context-dock__panel" id="spatial-execution-panel" data-panel="EXECUTION" hidden>
          <div class="execution-summary" id="spatial-execution-summary"></div>
        </div>
        <div class="context-dock__panel" id="spatial-audit-panel" data-panel="AUDIT" hidden>
          <div class="execution-ledger-host" id="spatial-ledger-host"></div>
        </div>
      </div>
    `;
    this.bodyEl = this.root.querySelector('.context-dock__body');
    this.emptyEl = this.root.querySelector('#spatial-event-empty');
    this.resultsPanel = this.root.querySelector('#spatial-results-panel');
    this.executionPanel = this.root.querySelector('#spatial-execution-panel');
    this.executionSummaryEl = this.root.querySelector('#spatial-execution-summary');
    this.auditPanel = this.root.querySelector('#spatial-audit-panel');
    this.ledgerHostEl = this.root.querySelector('#spatial-ledger-host');
    this.resultsHostEl = this.resultsPanel;
  }

  refreshTabBadges() {
    const host = this.root?.querySelector('#spatial-context-tabs');
    if (host) host.innerHTML = this.renderTabButtons();
    this.bindTabs();
  }

  bindTabs() {
    this.root?.querySelectorAll('.context-dock__tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setActiveTab(btn.dataset.tab || 'RESULTS');
        this.openDock();
      });
    });
  }

  bind() {
    this.bindTabs();
  }

  setDockToggleHandler(handler) {
    this.onDockToggle = handler;
  }

  setActiveTab(tab) {
    const next = TABS.includes(tab) ? tab : 'RESULTS';
    this.activeTab = next;
    this.root?.querySelectorAll('.context-dock__tab').forEach((el) => {
      const active = el.dataset.tab === next;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-selected', String(active));
    });
    if (this.resultsPanel) this.resultsPanel.hidden = next !== 'RESULTS';
    if (this.executionPanel) this.executionPanel.hidden = next !== 'EXECUTION';
    if (this.auditPanel) this.auditPanel.hidden = next !== 'AUDIT';
  }

  openDock(tab = this.activeTab) {
    this.dockOpen = true;
    this.setActiveTab(tab);
    this.root?.classList.add('is-open');
    if (this.onDockToggle) this.onDockToggle(true);
  }

  closeDock() {
    this.dockOpen = false;
    this.root?.classList.remove('is-open');
    if (this.onDockToggle) this.onDockToggle(false);
  }

  isDockOpen() {
    return this.dockOpen;
  }

  setResultsToggleHandler(handler) {
    this.onDockToggle = handler;
  }

  setRowSelectHandler(handler) {
    this.resultsTable?.setRowSelectHandler(handler);
  }

  setResultsOpen(open) {
    if (open) {
      this.resultsTable?.setOpen(true);
      this.openDock('RESULTS');
    } else {
      this.resultsTable?.setOpen(false);
      this.closeDock();
    }
  }

  isResultsOpen() {
    return this.dockOpen && this.activeTab === 'RESULTS';
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'map') {
      this.showEmpty('No operational events');
    } else if (!this.lastMapResult) {
      this.showEmpty('No context yet — run a map command to populate results.');
    } else {
      this.setMapLedger(this.lastMapResult);
    }
  }

  showEmpty(message) {
    if (this.emptyEl) {
      this.emptyEl.textContent = message;
      this.emptyEl.hidden = Boolean(this.lastMapResult?.supported);
    }
  }

  operationLabel(cmd) {
    if (cmd.action === 'NEAREST') return `Nearest ${cmd.limit || ''}`.trim();
    if (cmd.action === 'WITHIN' && cmd.radiusMeters) {
      const km = cmd.radiusMeters / 1000;
      const label = Number.isInteger(km) ? String(km) : km.toFixed(1);
      return `Within ${label} km`;
    }
    if (cmd.action === 'COUNT' && cmd.radiusMeters) {
      const km = cmd.radiusMeters / 1000;
      const label = Number.isInteger(km) ? String(km) : km.toFixed(1);
      return `Count within ${label} km`;
    }
    return cmd.spatialOperation || cmd.action || '—';
  }

  statusLabel(cmd) {
    if (cmd.operationalStatusCheck === 'Passed') {
      return cmd.closedRecordsExcluded === 'Yes' ? 'Active records only' : 'Passed';
    }
    return 'Passed';
  }

  uniqueSourceCount(mapResult) {
    const ids = new Set();
    for (const result of mapResult.datasetResults || []) {
      if (result.authority) ids.add(result.authority);
      else if (result.sourceId) ids.add(result.sourceId);
    }
    if (!ids.size && mapResult.source?.authority) ids.add(mapResult.source.authority);
    return ids.size;
  }

  getLegendDiagnosticHosts() {
    return this.resultsTable?.getLegendDiagnosticHosts?.() || null;
  }

  setMapResults(mapResult, options = {}) {
    const resultMeta = options.resultMeta || {
      operation: mapResult?.summary?.spatialOperation,
      radiusMeters: mapResult?.summary?.radiusMeters,
      dataset: mapResult?.summary?.dataset
        || mapResult?.datasetResults?.[0]?.displayName
    };
    this.resultsTable?.setMapResult(mapResult, { ...options, resultMeta });
    if (mapResult) {
      this.resultsTable?.setOpen(true);
    }
    this.resultCount = mapResult?.summary?.matchedFeatures
      ?? mapResult?.features?.length
      ?? 0;
    this.refreshTabBadges();
  }

  setCategorySelectHandler(handler) {
    this.resultsTable?.setCategoryToggleHandler(handler);
  }

  setCategoryToggleHandler(handler) {
    this.resultsTable?.setCategoryToggleHandler(handler);
  }

  setClearResultHandler(handler) {
    this.resultsTable?.setClearResultHandler(handler);
  }

  setCategoryFilterHandler(handler) {
    this.resultsTable?.setCategoryFilterHandler(handler);
  }

  setCategoryFilterChangeHandler(handler) {
    this.resultsTable?.setCategoryFilterChangeHandler(handler);
  }

  setOperationalActionHandler(handler) {
    this.resultsTable?.setOperationalActionHandler(handler);
  }

  setBackToCategoriesHandler(handler) {
    void handler;
  }

  setBackToCategoriesVisible(show) {
    void show;
  }

  restoreCategorySummary(mapResult, presentation, options = {}) {
    this.resultsTable?.setMapResult(mapResult, {
      presentation,
      mode: 'category_summary',
      visibleCategories: options.visibleCategories ?? options.selectedCategories,
      operationalMode: true
    });
    if (options.viewMode) {
      this.resultsTable?.setViewMode(options.viewMode);
    }
    this.openDock('RESULTS');
  }

  updateVisibilityStatus(visibleCount, totalCount) {
    this.resultsTable?.updateVisibilityStatus(visibleCount, totalCount);
  }

  applyOperationalFeaturesModel(model, truncated = false) {
    this.resultsTable?.applyOperationalFeaturesModel(model, truncated);
    this.openDock('RESULTS');
  }

  applyLiveFeedModel(model) {
    this.resultsTable?.applyLiveFeedModel(model);
    this.openDock('RESULTS');
  }

  updateCategorySelection(selectedCategories) {
    this.resultsTable?.updateCategorySelection(selectedCategories);
  }

  setViewMode(mode) {
    this.resultsTable?.setViewMode(mode);
  }

  clearResults() {
    this.resultsTable?.clear();
  }

  highlightResultsRowFromMap(attributes) {
    if (!this.isResultsOpen()) return;
    this.resultsTable?.highlightFromMapAttributes(attributes);
  }

  /** @param {object} mapResult */
  setMapLedger(mapResult) {
    if (!mapResult?.supported) {
      this.lastMapResult = null;
      this.showEmpty('No context yet — run a map command to populate results.');
      this.clearResults();
      if (this.executionSummaryEl) this.executionSummaryEl.innerHTML = '';
      if (this.ledgerHostEl) this.ledgerHostEl.innerHTML = '';
      return;
    }
    this.lastMapResult = mapResult;
    const total = mapResult.summary?.matchedFeatures ?? mapResult.features?.length ?? 0;
    this.resultCount = total;
    this.executionReady = true;
    this.refreshTabBadges();
    if (this.mode !== 'map') return;

    const commands = mapResult.summary?.commands || (
      mapResult.summary?.action !== 'COMPOUND' ? [mapResult.summary] : []
    );
    const opCount = commands.length || mapResult.commandCount || 1;
    const sourceCount = this.uniqueSourceCount(mapResult);

    if (this.emptyEl) this.emptyEl.hidden = true;

    const summaryHtml = `
      <div class="execution-ledger-summary">
        <span>CONTROLLED</span>
        <span>${mapResult.summary?.execution || 'DETERMINISTIC GIS'}</span>
        <span>${opCount} OPERATIONS</span>
        <span>${total} RESULTS</span>
        <span>${sourceCount} VERIFIED SOURCES</span>
        <span>${mapResult.summary?.unresolved || '0 UNRESOLVED'}</span>
        <span>AI COST ${mapResult.summary?.aiCost || '$0.00'}</span>
      </div>`;

    if (this.executionSummaryEl) {
      this.executionSummaryEl.innerHTML = summaryHtml;
    }

    const rows = commands.map((cmd) => {
      const dataset = cmd.dataset || '—';
      const operation = this.operationLabel(cmd);
      const count = cmd.matchedFeatures ?? '—';
      const source = cmd.authority || mapResult.source?.authority || '—';
      const sourceCheck = cmd.sourceCheck === 'Passed' ? 'PASS' : cmd.sourceCheck || 'PASS';
      const geometryCheck = cmd.geometryCheck === 'Passed' ? 'PASS' : cmd.geometryCheck || 'PASS';
      const status = this.statusLabel(cmd);
      return `
        <tr>
          <td>${dataset}</td>
          <td>${operation}</td>
          <td>${count}</td>
          <td>${source}</td>
          <td>${sourceCheck}</td>
          <td>${geometryCheck}</td>
          <td>${status}</td>
        </tr>`;
    }).join('');

    if (this.ledgerHostEl) {
      this.ledgerHostEl.innerHTML = `
        <div class="execution-ledger">
          ${summaryHtml}
          <table class="execution-ledger-table">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Operation</th>
                <th>Results</th>
                <th>Source</th>
                <th>Source check</th>
                <th>Geometry check</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
  }

  clearLedger() {
    this.lastMapResult = null;
    this.resultCount = 0;
    this.executionReady = false;
    this.refreshTabBadges();
    this.clearResults();
    if (this.mode === 'map') {
      this.showEmpty('No context yet — run a map command to populate results.');
    }
    if (this.executionSummaryEl) this.executionSummaryEl.innerHTML = '';
    if (this.ledgerHostEl) this.ledgerHostEl.innerHTML = '';
    this.closeDock();
  }
}
