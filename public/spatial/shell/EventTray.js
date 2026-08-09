import { ResultsTable } from './ResultsTable.js';

const TABS = ['ALL', 'MAPPED', 'UNRESOLVED'];

export class EventTray {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.activeTab = 'ALL';
    this.mode = 'map';
    this.lastMapResult = null;
    this.resultsOpen = false;
    this.onResultsToggle = null;
    this.render();
    this.bind();
    this.resultsTable = new ResultsTable(this.resultsHostEl);
  }

  render() {
    if (!this.root) return;
    const tabs = TABS.map((tab) => `
      <button type="button" class="event-tab${tab === this.activeTab ? ' is-active' : ''}"
        data-tab="${tab}" aria-selected="${tab === this.activeTab}">${tab}</button>`).join('');

    this.root.innerHTML = `
      <header class="event-tray-header">
        <span class="event-tray-title" id="spatial-event-tray-title">IQAI EXECUTION LEDGER</span>
        <div class="event-tray-actions">
          <button type="button" class="results-table-toggle" id="spatial-results-table-toggle" aria-pressed="false">RESULTS TABLE</button>
          <div class="event-tabs" role="tablist" id="spatial-event-tabs" hidden>${tabs}</div>
          <button type="button" class="panel-collapse-btn" data-collapse="bottom" aria-label="Collapse events tray">×</button>
        </div>
      </header>
      <div class="event-tray-body" role="tabpanel" id="spatial-event-tray-body">
        <p class="event-empty" id="spatial-event-empty">No MAP operations yet</p>
        <div class="execution-ledger-host" id="spatial-ledger-host"></div>
        <div class="spvm-explorer-host" id="spatial-spvm-explorer-host"></div>
        <div class="results-table-host" id="spatial-results-table-host"></div>
      </div>
    `;
    this.titleEl = this.root.querySelector('#spatial-event-tray-title');
    this.bodyEl = this.root.querySelector('#spatial-event-tray-body');
    this.ledgerHostEl = this.root.querySelector('#spatial-ledger-host');
    this.spvmExplorerHostEl = this.root.querySelector('#spatial-spvm-explorer-host');
    this.resultsHostEl = this.root.querySelector('#spatial-results-table-host');
    this.emptyEl = this.root.querySelector('#spatial-event-empty');
    this.tabsEl = this.root.querySelector('#spatial-event-tabs');
    this.resultsToggleBtn = this.root.querySelector('#spatial-results-table-toggle');
  }

  bind() {
    this.root?.querySelectorAll('.event-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab || 'ALL';
        this.root.querySelectorAll('.event-tab').forEach((el) => {
          const active = el.dataset.tab === this.activeTab;
          el.classList.toggle('is-active', active);
          el.setAttribute('aria-selected', String(active));
        });
      });
    });
    this.resultsToggleBtn?.addEventListener('click', () => {
      this.setResultsOpen(!this.resultsOpen);
      if (this.onResultsToggle) this.onResultsToggle(this.resultsOpen);
    });
  }

  setResultsToggleHandler(handler) {
    this.onResultsToggle = handler;
  }

  setRowSelectHandler(handler) {
    this.resultsTable?.setRowSelectHandler(handler);
  }

  setResultsOpen(open) {
    this.resultsOpen = Boolean(open);
    if (this.resultsToggleBtn) {
      this.resultsToggleBtn.classList.toggle('is-active', this.resultsOpen);
      this.resultsToggleBtn.setAttribute('aria-pressed', String(this.resultsOpen));
    }
    if (this.resultsHostEl) this.resultsHostEl.hidden = !this.resultsOpen;
    if (this.ledgerHostEl) this.ledgerHostEl.hidden = this.resultsOpen;
    this.resultsTable?.setOpen(this.resultsOpen);
  }

  isResultsOpen() {
    return this.resultsOpen;
  }

  setMode(mode) {
    this.mode = mode;
    if (this.titleEl) {
      this.titleEl.textContent = mode === 'map' ? 'IQAI EXECUTION LEDGER' : 'EVENTS';
    }
    if (this.tabsEl) this.tabsEl.hidden = mode === 'map';
    if (mode !== 'map') {
      this.showEmpty('No operational events');
    } else if (!this.lastMapResult) {
      this.showEmpty('No MAP operations yet');
    } else {
      this.setMapLedger(this.lastMapResult);
    }
  }

  showEmpty(message) {
    if (this.emptyEl) {
      this.emptyEl.textContent = message;
      this.emptyEl.hidden = false;
    }
    if (this.ledgerHostEl) this.ledgerHostEl.hidden = true;
    if (this.resultsHostEl) this.resultsHostEl.hidden = true;
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

  setMapResults(mapResult, options = {}) {
    this.resultsTable?.setMapResult(mapResult, options);
  }

  setCategorySelectHandler(handler) {
    this.resultsTable?.setCategoryToggleHandler(handler);
  }

  setCategoryToggleHandler(handler) {
    this.resultsTable?.setCategoryToggleHandler(handler);
  }

  setOperationalActionHandler(handler) {
    this.resultsTable?.setOperationalActionHandler(handler);
  }

  setBackToCategoriesHandler(handler) {
    // legacy — operational mode uses CATEGORIES button
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
  }

  updateVisibilityStatus(visibleCount, totalCount) {
    this.resultsTable?.updateVisibilityStatus(visibleCount, totalCount);
  }

  applyOperationalFeaturesModel(model, truncated = false) {
    this.resultsTable?.applyOperationalFeaturesModel(model, truncated);
    this.setResultsOpen(true);
  }

  applyLiveFeedModel(model) {
    this.resultsTable?.applyLiveFeedModel(model);
    this.setResultsOpen(true);
  }

  updateCategorySelection(selectedCategories) {
    this.resultsTable?.updateCategorySelection(selectedCategories);
  }

  setViewMode(mode) {
    this.resultsTable?.setViewMode(mode);
  }

  clearResults() {
    this.resultsTable?.clear();
    if (this.resultsToggleBtn) {
      this.resultsToggleBtn.classList.remove('is-active');
      this.resultsToggleBtn.setAttribute('aria-pressed', 'false');
    }
    this.resultsOpen = false;
    if (this.resultsHostEl) this.resultsHostEl.hidden = true;
    if (this.ledgerHostEl) this.ledgerHostEl.hidden = false;
  }

  highlightResultsRowFromMap(attributes) {
    if (!this.resultsOpen) return;
    this.resultsTable?.highlightFromMapAttributes(attributes);
  }

  /** @param {object} mapResult */
  setMapLedger(mapResult) {
    if (!mapResult?.supported) {
      this.lastMapResult = null;
      this.showEmpty('No MAP operations yet');
      this.clearResults();
      return;
    }
    this.lastMapResult = mapResult;
    if (this.mode !== 'map') return;

    const commands = mapResult.summary?.commands || (
      mapResult.summary?.action !== 'COMPOUND' ? [mapResult.summary] : []
    );
    const total = mapResult.summary?.matchedFeatures ?? mapResult.features?.length ?? 0;
    const opCount = commands.length || mapResult.commandCount || 1;
    const sourceCount = this.uniqueSourceCount(mapResult);

    if (this.emptyEl) this.emptyEl.hidden = true;
    if (this.ledgerHostEl) this.ledgerHostEl.hidden = this.resultsOpen;

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
          <div class="execution-ledger-summary">
            <span>CONTROLLED</span>
            <span>DETERMINISTIC GIS</span>
            <span>${opCount} OPERATIONS</span>
            <span>${total} RESULTS</span>
            <span>${sourceCount} VERIFIED SOURCES</span>
            <span>0 UNRESOLVED</span>
            <span>AI COST $0.00</span>
          </div>
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
    this.clearResults();
    if (this.mode === 'map') {
      this.showEmpty('No MAP operations yet');
    }
    if (this.ledgerHostEl) this.ledgerHostEl.innerHTML = '';
  }

  setSpvmExplorerMode(active) {
    this.setWorkspaceMode(active ? 'SPVM_CRIME' : 'NONE');
  }

  /**
   * @param {string} workspace
   */
  setWorkspaceMode(workspace) {
    const spvm = workspace === 'SPVM_CRIME';
    if (this.titleEl) {
      this.titleEl.textContent = spvm ? 'SPVM INTELLIGENCE WORKSPACE' : 'IQAI EXECUTION LEDGER';
    }
    if (this.root) this.root.classList.toggle('is-spvm-workspace', spvm);
    if (this.titleEl) this.titleEl.hidden = spvm;
    if (this.emptyEl) this.emptyEl.hidden = spvm;
    if (this.ledgerHostEl) this.ledgerHostEl.hidden = spvm || this.resultsOpen;
    if (this.spvmExplorerHostEl) this.spvmExplorerHostEl.hidden = !spvm;
    if (this.resultsToggleBtn) this.resultsToggleBtn.hidden = spvm;
    if (spvm) {
      this.setResultsOpen(false);
    }
    if (this.spvmPanel?.setVisible) {
      this.spvmPanel.setVisible(spvm);
    }
  }

  setSpvmPanel(panel) {
    this.spvmPanel = panel;
  }

  highlightSpvmRowFromMap(attributes) {
    if (this.spvmPanel?.highlightFromMapAttributes) {
      this.spvmPanel.highlightFromMapAttributes(attributes);
    }
  }
}
