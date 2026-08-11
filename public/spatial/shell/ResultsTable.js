import {
  buildResultsTableModel,
  buildCategorySummaryTableModel,
  filterRows,
  sortRows,
  paginateRows,
  getRowCellValue,
  RESULTS_TABLE_PAGE_SIZE
} from '../results-table-model.js';
import { formatAmenityCategory } from '../iqai-osm-presentation.js';
import { renderCategoryChipSwatch } from '../operational-legend.js';

export class ResultsTable {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    this.model = null;
    this.mode = 'features';
    this.viewMode = 'categories';
    this.operationalMode = false;
    this.featuresTruncated = false;
    this.isOpen = false;
    this.filterText = '';
    this.sortColumn = 'distanceMeters';
    this.sortDirection = 'asc';
    this.page = 1;
    this.visibleColumns = new Set();
    this.advancedColumnsOpen = false;
    this.selectedRowId = null;
    this.selectedCategory = null;
    this.categoryExpanded = false;
    this.workspaceTab = 'categories';
    this.resultMeta = null;
    this.onRowSelect = null;
    this.onCategoryToggle = null;
    this.onOperationalAction = null;
    this.renderShell();
    this.bind();
  }

  renderShell() {
    if (!this.host) return;
    this.host.innerHTML = `
      <div class="results-table-panel" hidden>
        <div class="results-workspace">
          <div class="results-workspace-summary" hidden></div>
          <header class="results-workspace-header">
            <div class="results-workspace-tabs" hidden>
              <button type="button" class="results-workspace-tab is-active" data-results-tab="categories">Categories</button>
              <button type="button" class="results-workspace-tab" data-results-tab="features">Features</button>
            </div>
            <div class="results-workspace-actions">
              <button type="button" class="results-workspace-clear" data-op="clear_result">Clear result</button>
            </div>
          </header>
          <div class="results-categories-pane">
            <div class="results-category-grid"></div>
            <button type="button" class="results-category-more" hidden>Show more categories</button>
          </div>
          <div class="results-features-pane" hidden>
            <div class="results-table-toolbar">
              <input type="search" class="results-table-search" placeholder="Filter features…" aria-label="Filter results table" />
              <span class="results-table-meta" aria-live="polite"></span>
            </div>
            <div class="results-table-scroll">
              <table class="results-table">
                <thead></thead>
                <tbody></tbody>
              </table>
            </div>
            <div class="results-table-footer">
              <button type="button" class="results-table-page-prev" disabled>Prev</button>
              <span class="results-table-page-label">Page 1</span>
              <button type="button" class="results-table-page-next" disabled>Next</button>
            </div>
          </div>
        </div>
        <div class="iqai-legend-diagnostic" hidden aria-hidden="true">
          <div class="iqai-legend-diagnostic__native-host"></div>
          <div class="iqai-legend-diagnostic__iqai-host"></div>
        </div>
      </div>
    `;
    this.panelEl = this.host.querySelector('.results-table-panel');
    this.summaryEl = this.host.querySelector('.results-workspace-summary');
    this.workspaceTabsEl = this.host.querySelector('.results-workspace-tabs');
    this.workspaceActionsEl = this.host.querySelector('.results-workspace-actions');
    this.categoriesPaneEl = this.host.querySelector('.results-categories-pane');
    this.featuresPaneEl = this.host.querySelector('.results-features-pane');
    this.operationalEl = this.host.querySelector('.results-table-operational');
    this.visibilityStatusEl = this.host.querySelector('.results-table-visibility-status');
    this.opHintEl = this.host.querySelector('.results-table-op-hint');
    this.searchEl = this.host.querySelector('.results-table-search');
    this.metaEl = this.host.querySelector('.results-table-meta');
    this.categoryGridEl = this.host.querySelector('.results-category-grid');
    this.categoryMoreBtn = this.host.querySelector('.results-category-more');
    this.legendDiagnosticEl = this.host.querySelector('.iqai-legend-diagnostic');
    this.legendDiagnosticNativeHost = this.host.querySelector('.iqai-legend-diagnostic__native-host');
    this.legendDiagnosticIqaiHost = this.host.querySelector('.iqai-legend-diagnostic__iqai-host');
    this.tableEl = this.host.querySelector('.results-table');
    this.theadEl = this.tableEl?.querySelector('thead');
    this.tbodyEl = this.tableEl?.querySelector('tbody');
    this.pageLabelEl = this.host.querySelector('.results-table-page-label');
    this.prevBtn = this.host.querySelector('.results-table-page-prev');
    this.nextBtn = this.host.querySelector('.results-table-page-next');
  }

  bind() {
    this.searchEl?.addEventListener('input', () => {
      this.filterText = this.searchEl.value || '';
      this.page = 1;
      this.renderBody();
    });
    this.prevBtn?.addEventListener('click', () => {
      if (this.page > 1) {
        this.page -= 1;
        this.renderBody();
      }
    });
    this.nextBtn?.addEventListener('click', () => {
      this.page += 1;
      this.renderBody();
    });
    this.categoryMoreBtn?.addEventListener('click', () => {
      this.categoryExpanded = !this.categoryExpanded;
      this.renderCategoryGrid();
    });
    this.workspaceTabsEl?.querySelectorAll('.results-workspace-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.resultsTab;
        if (!tab) return;
        this.setWorkspaceTab(tab);
      });
    });
    this.workspaceActionsEl?.querySelector('[data-op="clear_result"]')?.addEventListener('click', () => {
      this.onClearResult?.();
    });
  }

  getLegendDiagnosticHosts() {
    return {
      panel: this.legendDiagnosticEl,
      nativeHost: this.legendDiagnosticNativeHost,
      iqaiHost: this.legendDiagnosticIqaiHost
    };
  }

  setLegendDiagnosticVisible(show) {
    if (this.legendDiagnosticEl) {
      this.legendDiagnosticEl.hidden = true;
      this.legendDiagnosticEl.setAttribute('aria-hidden', 'true');
    }
    void show;
  }

  setWorkspaceTab(tab) {
    const next = tab === 'features' ? 'features' : 'categories';
    this.workspaceTab = next;
    if (this.mode === 'category_summary') {
      this.viewMode = next;
      if (next === 'features' && this.onOperationalAction) {
        this.onOperationalAction('features');
        return;
      }
      if (next === 'categories' && this.onOperationalAction) {
        this.onOperationalAction('categories');
        return;
      }
    }
    this.syncWorkspaceLayout();
    if (this.isOpen) this.renderBody();
  }

  syncWorkspaceLayout() {
    const hasGrid = this.hasCategoryGrid();
    const hasModel = Boolean(this.model);
    const useTabs = hasModel && (hasGrid || this.mode === 'features');

    if (this.workspaceTabsEl) this.workspaceTabsEl.hidden = !useTabs;
    if (this.workspaceActionsEl) {
      this.workspaceActionsEl.hidden = !this.model;
    }
    if (this.summaryEl) this.summaryEl.hidden = !hasModel;

    this.workspaceTabsEl?.querySelectorAll('.results-workspace-tab').forEach((btn) => {
      const active = btn.dataset.resultsTab === this.workspaceTab;
      btn.classList.toggle('is-active', active);
    });

    const showCategories = this.workspaceTab === 'categories';
    const showFeatures = this.workspaceTab === 'features';
    if (this.categoriesPaneEl) this.categoriesPaneEl.hidden = !showCategories;
    if (this.featuresPaneEl) this.featuresPaneEl.hidden = !showFeatures;

    if (showCategories && hasModel) {
      this.renderSummaryCards();
      if (hasGrid) {
        this.renderCategoryGrid();
      } else {
        this.renderDatasetLegendCard();
      }
    }
  }

  hasCategoryGrid() {
    if (this.mode === 'category_summary' && this.viewMode === 'categories') return true;
    if (this.mode === 'category_summary') return false;
    return this.mode === 'features' && Boolean(this.model?.categorySummary?.categories?.length);
  }

  hasCategoryWorkspace() {
    return this.hasCategoryGrid() || Boolean(this.model);
  }

  resolveScopeLabel() {
    const meta = this.resultMeta || {};
    if (meta.scopeLabel) return meta.scopeLabel;
    if (meta.radiusLabel) return meta.radiusLabel;
    const km = meta.radiusKm ?? (meta.radiusMeters ? meta.radiusMeters / 1000 : null);
    if (Number.isFinite(km)) {
      const label = Number.isInteger(km) ? String(km) : km.toFixed(1);
      return `Within ${label} km`;
    }
    return meta.operation || 'Current result';
  }

  resolveDatasetLabel() {
    const meta = this.resultMeta || {};
    return meta.dataset || 'Results';
  }

  resolveAllResultsLabel() {
    const dataset = this.resolveDatasetLabel();
    if (this.model?.categorySummary?.categories?.length) {
      return `All ${String(dataset).toLowerCase()}`;
    }
    return dataset;
  }

  resolveActiveFilterLabel() {
    if (this.mode === 'category_summary') {
      const visible = (this.model?.rows || []).filter((row) => row.selected).length;
      const total = this.model?.totalCount ?? 0;
      if (visible === total) return { label: 'All categories', count: this.model?.representedFeatures ?? null };
      return { label: `${visible} categories visible`, count: visible };
    }
    if (!this.selectedCategory) {
      const total = this.model?.categorySummary?.totalCount ?? this.model?.totalCount ?? 0;
      return { label: this.resolveAllResultsLabel(), count: total };
    }
    const entry = (this.model?.categorySummary?.categories || []).find((cat) => (
      String(cat.value) === String(this.selectedCategory)
    ));
    return {
      label: entry?.label || formatAmenityCategory(this.selectedCategory),
      count: entry?.count ?? null
    };
  }

  renderSummaryCards() {
    if (!this.summaryEl) return;
    const summary = this.model?.categorySummary;
    const categories = summary?.categories
      || (this.mode === 'category_summary' ? (this.model?.rows || []).map((row) => ({
        label: formatAmenityCategory(row.values?.category),
        count: row.values?.count
      })) : []);
    const categoryCount = this.mode === 'category_summary'
      ? (this.model?.totalCount ?? categories.length)
      : categories.length;
    const totalCount = summary?.totalCount
      ?? this.model?.resultTotalCount
      ?? this.model?.representedFeatures
      ?? this.model?.totalCount
      ?? categories.reduce((sum, entry) => sum + (entry.count || 0), 0);
    const active = this.resolveActiveFilterLabel();
    const scope = this.resolveScopeLabel();
    const dataset = this.resolveDatasetLabel();
    const hasGrid = this.hasCategoryGrid();

    this.summaryEl.innerHTML = `
      <div class="results-metric-card">
        <div class="results-metric-card__label">${escapeHtml(scope)}</div>
        <div class="results-metric-card__value">${Number(totalCount).toLocaleString()}</div>
        <div class="results-metric-card__sub">${escapeHtml(dataset)}</div>
      </div>
      <div class="results-metric-card">
        <div class="results-metric-card__label">${hasGrid ? 'Categories in result' : 'Result dataset'}</div>
        <div class="results-metric-card__value">${hasGrid ? Number(categoryCount).toLocaleString() : escapeHtml(dataset)}</div>
        <div class="results-metric-card__sub">${hasGrid ? 'Distinct values' : scope}</div>
      </div>
      <div class="results-metric-card">
        <div class="results-metric-card__label">Active filter</div>
        <div class="results-metric-card__value">${escapeHtml(active.label)}</div>
        <div class="results-metric-card__sub">${active.count != null ? `${Number(active.count).toLocaleString()} features` : '—'}</div>
      </div>`;
    this.summaryEl.hidden = false;
  }

  renderCategoryGrid() {
    if (!this.categoryGridEl) return;
    const xrayCategories = this.mode === 'category_summary' && this.viewMode === 'categories';
    const scopedCategories = this.mode === 'features' && this.model?.categorySummary?.categories?.length;
    if (!xrayCategories && !scopedCategories) {
      this.categoryGridEl.innerHTML = '';
      if (this.categoryMoreBtn) this.categoryMoreBtn.hidden = true;
      return;
    }

    const summary = scopedCategories ? this.model.categorySummary : null;
    const categories = scopedCategories
      ? summary.categories
      : (this.model?.rows || []).map((row) => ({
        value: row.categoryValue,
        label: formatAmenityCategory(row.values?.category),
        count: row.values?.count,
        symbolUrl: row.symbolUrl,
        selected: row.selected
      }));

    const maxVisible = this.categoryExpanded ? categories.length : 24;
    const visible = categories.slice(0, maxVisible);
    const hiddenCount = categories.length - visible.length;
    const totalCount = summary?.totalCount
      ?? categories.reduce((sum, entry) => sum + (entry.count || 0), 0);

    const allActive = scopedCategories && !this.selectedCategory;
    const allLabel = this.resolveAllResultsLabel();
    const allCard = scopedCategories ? `
      <button type="button" class="results-category-card results-category-card--all${allActive ? ' is-active' : ''}" data-category="">
        <span class="results-category-card__symbol results-category-card__symbol--neutral" aria-hidden="true"></span>
        <span class="results-category-card__body">
          <span class="results-category-card__label">${escapeHtml(allLabel)}</span>
          <span class="results-category-card__count">${Number(totalCount).toLocaleString()}</span>
        </span>
      </button>` : '';

    const categoryCards = visible.map((entry) => {
      const active = scopedCategories
        ? this.selectedCategory === entry.value
        : Boolean(entry.selected);
      const swatch = entry.symbolUrl
        ? `<img class="results-category-card__symbol" src="${entry.symbolUrl}" alt="" />`
        : renderCategoryChipSwatch(entry);
      const label = entry.label || formatAmenityCategory(entry.value);
      return `
        <button type="button" class="results-category-card${active ? ' is-active' : ''}" data-category="${entry.value || ''}">
          ${swatch}
          <span class="results-category-card__body">
            <span class="results-category-card__label">${label}</span>
            <span class="results-category-card__count">${Number(entry.count || 0).toLocaleString()}</span>
          </span>
        </button>`;
    }).join('');

    this.categoryGridEl.innerHTML = `${allCard}${categoryCards}`;

    if (this.categoryMoreBtn) {
      this.categoryMoreBtn.hidden = hiddenCount <= 0 && !this.categoryExpanded;
      this.categoryMoreBtn.textContent = this.categoryExpanded
        ? 'Show fewer categories'
        : `Show ${hiddenCount} more categories`;
    }

    this.categoryGridEl.querySelectorAll('.results-category-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.category;
        if (scopedCategories) {
          if (value === '') {
            this.setCategoryFilter(null);
            return;
          }
          if (!value) return;
          this.setCategoryFilter(this.selectedCategory === value ? null : value);
          return;
        }
        if (!value) return;
        const row = this.model?.rows?.find((entry) => entry.categoryValue === value);
        const nextSelected = row ? !row.selected : true;
        if (this.onCategoryToggle) this.onCategoryToggle(value, nextSelected);
      });
    });
  }

  renderDatasetLegendCard() {
    if (!this.categoryGridEl) return;
    const dataset = this.resolveDatasetLabel();
    const scope = this.resolveScopeLabel();
    const total = this.model?.resultTotalCount
      ?? this.model?.categorySummary?.totalCount
      ?? this.model?.totalCount
      ?? 0;
    const symbolUrl = this.model?.categorySummary?.datasetSymbolUrl
      || this.model?.categorySummary?.symbolUrl
      || null;
    const swatch = symbolUrl
      ? `<img class="results-category-card__symbol" src="${symbolUrl}" alt="" />`
      : '<span class="results-category-card__symbol results-category-card__symbol--neutral" aria-hidden="true"></span>';

    this.categoryGridEl.innerHTML = `
      <div class="results-category-card is-active results-category-card--dataset" aria-current="true">
        ${swatch}
        <span class="results-category-card__body">
          <span class="results-category-card__label">${escapeHtml(dataset)}</span>
          <span class="results-category-card__count">${Number(total).toLocaleString()} ${escapeHtml(scope.toLowerCase())}</span>
        </span>
      </div>`;
    if (this.categoryMoreBtn) this.categoryMoreBtn.hidden = true;
  }

  renderCategoryStrip() {
    this.syncWorkspaceLayout();
  }

  setCategoryFilterHandler(handler) {
    this.onCategoryFilter = handler;
  }

  setCategoryFilter(categoryValue) {
    this.selectedCategory = categoryValue || null;
    this.page = 1;
    this.syncWorkspaceLayout();
    if (this.onCategoryFilter) this.onCategoryFilter(this.selectedCategory);
    if (this.onCategoryFilterChange) this.onCategoryFilterChange(this.selectedCategory, this.resolveActiveFilterLabel());
    if (this.isOpen) this.renderBody();
  }

  setCategoryFilterChangeHandler(handler) {
    this.onCategoryFilterChange = handler;
  }

  setRowSelectHandler(handler) {
    this.onRowSelect = handler;
  }

  setCategoryToggleHandler(handler) {
    this.onCategoryToggle = handler;
  }

  setClearResultHandler(handler) {
    this.onClearResult = handler;
  }

  setOperationalActionHandler(handler) {
    this.onOperationalAction = handler;
  }

  setOperationalMode(enabled, options = {}) {
    this.operationalMode = Boolean(enabled);
    void options;
  }

  updateVisibilityStatus(visibleCount, totalCount) {
    void visibleCount;
    void totalCount;
  }

  setViewMode(mode) {
    this.viewMode = mode === 'features' ? 'features' : 'categories';
    this.workspaceTab = this.viewMode;
    this.syncWorkspaceLayout();
    if (this.columnsBtn) {
      this.columnsBtn.hidden = this.mode === 'category_summary' && this.viewMode === 'categories';
    }
  }

  updateViewModeButtons() {
    void 0;
  }

  setOpen(open) {
    this.isOpen = Boolean(open);
    if (this.panelEl) this.panelEl.hidden = !this.isOpen;
    if (this.isOpen) {
      this.syncWorkspaceLayout();
      if (this.model) this.renderBody();
    }
  }

  isResultsOpen() {
    return this.isOpen;
  }

  /**
   * @param {object} mapResult
   * @param {{ presentation?: object, mode?: string, selectedCategories?: Set<string>|string[], operationalMode?: boolean }} [options]
   */
  setMapResult(mapResult, options = {}) {
    this.resultMeta = options.resultMeta || buildResultMetaFromMapResult(mapResult);
    const summaryModel = options.mode === 'category_summary'
      || mapResult?.action === 'CATEGORY_COUNTS_WITHIN'
      || mapResult?.summary?.displayMode === 'category_counts'
      ? buildCategorySummaryTableModel(mapResult, options.presentation, {
        visibleCategories: options.visibleCategories ?? options.selectedCategories
      })
      : null;

    if (summaryModel) {
      this.applyModel(summaryModel, 'category_summary');
      const visibleSet = options.visibleCategories instanceof Set
        ? options.visibleCategories
        : (options.selectedCategories instanceof Set
          ? options.selectedCategories
          : new Set(options.visibleCategories || options.selectedCategories || []));
      this.setOperationalMode(Boolean(options.operationalMode ?? true), {
        showAllDisabled: false,
        showAllHint: 'Map display uses remote FeatureLayer with AOI + category filter (no IQAI materialization).',
        visibleCount: visibleSet.size,
        totalCount: summaryModel.totalCount
      });
      this.setViewMode('categories');
      return;
    }

    const featureModel = buildResultsTableModel(mapResult, {
      presentation: options.presentation || null
    });
    if (!featureModel) {
      this.clear();
      return;
    }
    if (mapResult?.resultAccounting) {
      featureModel.resultTotalCount = mapResult.resultAccounting.totalMatchingObjectIds
        ?? mapResult.summary?.matchedFeatures
        ?? featureModel.totalCount;
      featureModel.resultAccounting = mapResult.resultAccounting;
    } else if (mapResult?.summary?.matchedFeatures != null) {
      featureModel.resultTotalCount = mapResult.summary.matchedFeatures;
    }
    this.applyModel(featureModel, 'features');
    this.setOperationalMode(false);
  }

  applyOperationalFeaturesModel(model, truncated = false) {
    if (!model) return;
    this.featuresTruncated = Boolean(truncated);
    this.applyModel(model, 'operational_features');
    this.setViewMode('features');
    this.setOperationalMode(true);
  }

  applyLiveFeedModel(model) {
    if (!model) return;
    this.featuresTruncated = false;
    this.applyModel(model, 'live_feed');
    this.setOperationalMode(false);
    if (this.operationalEl) this.operationalEl.hidden = true;
  }

  applySpvmCrimeModel(model) {
    if (!model) return;
    this.featuresTruncated = false;
    this.applyModel(model, 'spvm_crime');
    this.setOperationalMode(false);
    if (this.operationalEl) this.operationalEl.hidden = true;
  }

  applyModel(model, mode) {
    this.model = model;
    this.mode = mode;
    this.filterText = '';
    this.page = 1;
    this.selectedRowId = null;
    this.selectedCategory = null;
    this.categoryExpanded = false;
    this.workspaceTab = (mode === 'operational_features' || mode === 'live_feed' || mode === 'spvm_crime')
      ? 'features'
      : 'categories';
    if (this.searchEl) this.searchEl.value = '';
    this.visibleColumns = new Set(
      (model.columns || []).filter((col) => col.defaultVisible).map((col) => col.id)
    );
    if (mode === 'category_summary') {
      this.sortColumn = 'count';
      this.sortDirection = 'desc';
    } else if (mode === 'spvm_crime' || model.columns?.some((col) => col.id === 'date')) {
      this.sortColumn = 'date';
      this.sortDirection = 'desc';
    } else if (model.columns?.some((col) => col.id === 'distanceMeters')) {
      this.sortColumn = 'distanceMeters';
      this.sortDirection = 'asc';
    } else if (model.columns?.some((col) => col.id === 'name')) {
      this.sortColumn = 'name';
      this.sortDirection = 'asc';
    }
    if (this.columnsBtn) {
      this.columnsBtn.hidden = mode === 'category_summary' && this.viewMode === 'categories';
    }
    this.syncWorkspaceLayout();
    if (this.isOpen) this.renderBody();
  }

  updateCategorySelection(visibleCategories) {
    if (!this.model || this.mode !== 'category_summary') return;
    const visibleSet = visibleCategories instanceof Set
      ? visibleCategories
      : new Set(visibleCategories || []);
    for (const row of this.model.rows) {
      row.selected = visibleSet.has(row.categoryValue);
    }
    this.updateVisibilityStatus(visibleSet.size, this.model.totalCount);
    this.syncWorkspaceLayout();
    if (this.isOpen) this.renderBody();
  }

  clear() {
    this.model = null;
    this.mode = 'features';
    this.viewMode = 'categories';
    this.workspaceTab = 'categories';
    this.resultMeta = null;
    this.operationalMode = false;
    this.featuresTruncated = false;
    this.selectedRowId = null;
    this.filterText = '';
    this.page = 1;
    if (this.searchEl) this.searchEl.value = '';
    if (this.tbodyEl) this.tbodyEl.innerHTML = '';
    if (this.theadEl) this.theadEl.innerHTML = '';
    if (this.metaEl) this.metaEl.textContent = '';
    if (this.panelEl) this.panelEl.hidden = true;
    this.isOpen = false;
    if (this.operationalEl) this.operationalEl.hidden = true;
    if (this.summaryEl) this.summaryEl.hidden = true;
    if (this.categoryGridEl) this.categoryGridEl.innerHTML = '';
  }

  highlightRow(rowId) {
    this.selectedRowId = rowId || null;
    if (!this.tbodyEl) return;
    this.tbodyEl.querySelectorAll('tr').forEach((row) => {
      row.classList.toggle('is-selected', row.dataset.rowId === this.selectedRowId);
    });
    const selected = this.tbodyEl.querySelector('tr.is-selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  highlightFromMapAttributes(attributes) {
    if (!attributes || !this.model) return;
    if (this.mode === 'category_summary' && this.viewMode === 'categories') return;
    const mapObjectId = attributes.OBJECTID ?? attributes.ObjectID ?? attributes.objectId ?? attributes.id;
    const row = this.model.rows.find((entry) => {
      const idMatch = Number(entry.mapObjectId) === Number(mapObjectId)
        || String(entry.mapObjectId) === String(mapObjectId)
        || (attributes.id && String(entry.recordId) === String(attributes.id));
      const layerMatch = entry.layerId === 'live-aircraft'
        || entry.layerId === 'live-vessels'
        || entry.layerId === 'spvm-recent-crime'
        || entry.layerId === 'iqai-deterministic-results'
        || entry.layerId === 'iqai-xray-operational'
        || !entry.layerId
        || entry.layerId === attributes.layerId;
      return idMatch && layerMatch;
    });
    if (row) this.highlightRow(row.rowId);
  }

  workingRows() {
    if (!this.model) return [];
    let rows = this.model.rows;
    if (this.selectedCategory && this.mode === 'features') {
      const field = this.model.categorySummary?.field || 'amenity';
      rows = rows.filter((row) => {
        const value = row.values?.[field] ?? row.values?.amenity ?? row.values?.category;
        return String(value) === String(this.selectedCategory);
      });
    }
    rows = filterRows(rows, this.filterText);
    rows = sortRows(rows, this.sortColumn, this.sortDirection);
    return rows;
  }

  renderBody() {
    if (!this.model || !this.theadEl || !this.tbodyEl) return;

    if (this.workspaceTab === 'categories' && !(this.mode === 'category_summary' && this.viewMode === 'categories')) {
      return;
    }

    const columns = (this.model.columns || []).filter((col) => col.defaultVisible);
    const rows = this.workingRows();
    const { page, totalPages, pageRows } = paginateRows(rows, this.page, RESULTS_TABLE_PAGE_SIZE);
    this.page = page;
    const totalScoped = this.model?.resultTotalCount
      ?? this.model?.categorySummary?.totalCount
      ?? this.model?.totalCount
      ?? 0;
    const activeScoped = rows.length;

    if (this.metaEl) {
      if (this.mode === 'category_summary' && this.viewMode === 'categories') {
        const represented = this.model.representedFeatures;
        const suffix = represented != null ? ` · ${represented} represented` : '';
        this.metaEl.textContent = `${rows.length} categor${rows.length === 1 ? 'y' : 'ies'}${suffix}`;
      } else if (this.mode === 'operational_features') {
        const trunc = this.featuresTruncated ? ' · capped at 500 for table' : '';
        this.metaEl.textContent = `${activeScoped} row${activeScoped === 1 ? '' : 's'} in current view${trunc}`;
      } else if (this.selectedCategory) {
        this.metaEl.textContent = `${activeScoped} row${activeScoped === 1 ? '' : 's'} · ${Number(totalScoped).toLocaleString()} in current result`;
      } else {
        this.metaEl.textContent = `${activeScoped} row${activeScoped === 1 ? '' : 's'} · ${Number(totalScoped).toLocaleString()} in current result`;
      }
    }

    const headerCells = columns.map((col) => {
      if (col.id === '_select') return `<th class="results-table-select-col" aria-label="Select"></th>`;
      const active = this.sortColumn === col.id;
      const arrow = active ? (this.sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th><button type="button" class="results-table-sort" data-sort="${col.id}">${col.label}${arrow}</button></th>`;
    }).join('');
    this.theadEl.innerHTML = `<tr>${headerCells}</tr>`;
    this.theadEl.querySelectorAll('.results-table-sort').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colId = btn.dataset.sort;
        if (!colId) return;
        if (this.sortColumn === colId) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortColumn = colId;
          this.sortDirection = colId === 'count' ? 'desc' : 'asc';
        }
        this.renderBody();
      });
    });

    this.tbodyEl.innerHTML = pageRows.map((row) => {
      const cells = columns.map((col) => {
        const value = getRowCellValue(row, col.id);
        if (col.id === '_symbol' || col.id === '_select') {
          return `<td class="results-table-symbol-cell">${value}</td>`;
        }
        const display = col.canonical === 'category' && row.values?.[col.id]
          ? formatAmenityCategory(row.values[col.id])
          : value;
        return `<td>${display}</td>`;
      }).join('');
      const selected = row.rowId === this.selectedRowId ? ' is-selected' : '';
      return `<tr class="results-table-row${selected}" data-row-id="${row.rowId}" tabindex="0">${cells}</tr>`;
    }).join('');

    this.tbodyEl.querySelectorAll('.results-table-cat-check').forEach((input) => {
      input.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      input.addEventListener('change', () => {
        const category = input.dataset.category;
        if (!category || !this.onCategoryToggle) return;
        this.onCategoryToggle(category, input.checked);
      });
    });

    this.tbodyEl.querySelectorAll('.results-table-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        const rowId = tr.dataset.rowId;
        const row = this.model.rows.find((entry) => entry.rowId === rowId);
        if (!row) return;
        if (this.mode === 'category_summary' && this.viewMode === 'categories') {
          const checkbox = tr.querySelector('.results-table-cat-check');
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
            if (this.onCategoryToggle) {
              this.onCategoryToggle(row.categoryValue, checkbox.checked);
            }
          }
          return;
        }
        this.highlightRow(rowId);
        if (this.onRowSelect) this.onRowSelect(row);
      });
    });

    if (this.pageLabelEl) this.pageLabelEl.textContent = `Page ${page} / ${totalPages}`;
    if (this.prevBtn) this.prevBtn.disabled = page <= 1;
    if (this.nextBtn) this.nextBtn.disabled = page >= totalPages;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildResultMetaFromMapResult(mapResult) {
  if (!mapResult) return {};
  const summary = mapResult.summary || {};
  const datasetResult = mapResult.datasetResults?.[0];
  const radiusMeters = summary.radiusMeters ?? mapResult.xrayResult?.radiusMeters;
  const radiusKm = mapResult.xrayResult?.radiusKm ?? (radiusMeters ? radiusMeters / 1000 : null);
  let scopeLabel = summary.spatialOperation || summary.operation || null;
  if (!scopeLabel && Number.isFinite(radiusKm)) {
    const label = Number.isInteger(radiusKm) ? String(radiusKm) : radiusKm.toFixed(1);
    scopeLabel = `Within ${label} km`;
  }
  return {
    operation: summary.spatialOperation || summary.action || mapResult.action,
    scopeLabel,
    radiusMeters,
    radiusKm,
    dataset: summary.dataset
      || datasetResult?.displayName
      || datasetResult?.authority
      || 'Results',
    location: mapResult.origin?.matchedAddress || mapResult.matchedAddress || null
  };
}
