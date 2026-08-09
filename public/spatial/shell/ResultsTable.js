import {
  buildResultsTableModel,
  buildCategorySummaryTableModel,
  filterRows,
  sortRows,
  paginateRows,
  getRowCellValue,
  RESULTS_TABLE_PAGE_SIZE
} from '../results-table-model.js';

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
    this.selectedRowId = null;
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
        <div class="results-table-operational" hidden>
          <button type="button" class="results-table-op-btn" data-op="show_all">SELECT ALL</button>
          <button type="button" class="results-table-op-btn" data-op="clear">CLEAR ALL</button>
          <button type="button" class="results-table-op-btn is-active" data-op="categories">CATEGORIES</button>
          <button type="button" class="results-table-op-btn" data-op="features">FEATURES</button>
          <span class="results-table-visibility-status" hidden></span>
          <span class="results-table-op-hint" hidden></span>
        </div>
        <div class="results-table-toolbar">
          <input type="search" class="results-table-search" placeholder="Filter rows…" aria-label="Filter results table" />
          <div class="results-table-toolbar-actions">
            <button type="button" class="results-table-columns-btn" aria-haspopup="true">Columns</button>
            <span class="results-table-meta" aria-live="polite"></span>
          </div>
        </div>
        <div class="results-table-columns-menu" hidden></div>
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
    `;
    this.panelEl = this.host.querySelector('.results-table-panel');
    this.operationalEl = this.host.querySelector('.results-table-operational');
    this.visibilityStatusEl = this.host.querySelector('.results-table-visibility-status');
    this.opHintEl = this.host.querySelector('.results-table-op-hint');
    this.searchEl = this.host.querySelector('.results-table-search');
    this.metaEl = this.host.querySelector('.results-table-meta');
    this.columnsMenuEl = this.host.querySelector('.results-table-columns-menu');
    this.columnsBtn = this.host.querySelector('.results-table-columns-btn');
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
    this.columnsBtn?.addEventListener('click', () => {
      const hidden = this.columnsMenuEl?.hidden;
      this.columnsMenuEl.hidden = !hidden;
    });
    this.operationalEl?.querySelectorAll('.results-table-op-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.op;
        if (!action || !this.onOperationalAction) return;
        this.onOperationalAction(action);
      });
    });
    document.addEventListener('click', (event) => {
      if (!this.columnsMenuEl || this.columnsMenuEl.hidden) return;
      const target = event.target;
      if (target instanceof Element && this.host?.contains(target)) return;
      this.columnsMenuEl.hidden = true;
    });
  }

  setRowSelectHandler(handler) {
    this.onRowSelect = handler;
  }

  setCategoryToggleHandler(handler) {
    this.onCategoryToggle = handler;
  }

  setOperationalActionHandler(handler) {
    this.onOperationalAction = handler;
  }

  setOperationalMode(enabled, options = {}) {
    this.operationalMode = Boolean(enabled);
    if (this.operationalEl) this.operationalEl.hidden = !this.operationalMode;
    if (this.opHintEl) {
      const hint = options.showAllHint || '';
      this.opHintEl.textContent = hint;
      this.opHintEl.hidden = !hint;
    }
    const showAllBtn = this.operationalEl?.querySelector('[data-op="show_all"]');
    if (showAllBtn) {
      showAllBtn.disabled = Boolean(options.showAllDisabled);
      showAllBtn.title = options.showAllDisabledReason || 'Select all categories for remote map display';
    }
    this.updateVisibilityStatus(options.visibleCount, options.totalCount);
    this.updateViewModeButtons();
  }

  updateVisibilityStatus(visibleCount, totalCount) {
    if (!this.visibilityStatusEl) return;
    if (totalCount == null || totalCount <= 0) {
      this.visibilityStatusEl.hidden = true;
      this.visibilityStatusEl.textContent = '';
      return;
    }
    const visible = visibleCount ?? 0;
    this.visibilityStatusEl.textContent = `${visible} / ${totalCount} visible`;
    this.visibilityStatusEl.hidden = false;
  }

  setViewMode(mode) {
    this.viewMode = mode === 'features' ? 'features' : 'categories';
    this.updateViewModeButtons();
    if (this.columnsBtn) {
      this.columnsBtn.hidden = this.mode === 'category_summary' && this.viewMode === 'categories';
    }
  }

  updateViewModeButtons() {
    if (!this.operationalEl) return;
    this.operationalEl.querySelectorAll('.results-table-op-btn').forEach((btn) => {
      const op = btn.dataset.op;
      const active = op === this.viewMode
        || (op === 'categories' && this.viewMode === 'categories')
        || (op === 'features' && this.viewMode === 'features');
      btn.classList.toggle('is-active', active && (op === 'categories' || op === 'features'));
    });
  }

  setOpen(open) {
    this.isOpen = Boolean(open);
    if (this.panelEl) this.panelEl.hidden = !this.isOpen;
    if (this.isOpen && this.model) this.renderBody();
  }

  isResultsOpen() {
    return this.isOpen;
  }

  /**
   * @param {object} mapResult
   * @param {{ presentation?: object, mode?: string, selectedCategories?: Set<string>|string[], operationalMode?: boolean }} [options]
   */
  setMapResult(mapResult, options = {}) {
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

    const featureModel = buildResultsTableModel(mapResult);
    if (!featureModel) {
      this.clear();
      return;
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
    this.renderColumnsMenu();
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
    if (this.isOpen) this.renderBody();
  }

  clear() {
    this.model = null;
    this.mode = 'features';
    this.viewMode = 'categories';
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
    if (this.columnsBtn) this.columnsBtn.hidden = false;
    if (this.columnsMenuEl) {
      this.columnsMenuEl.hidden = true;
      this.columnsMenuEl.innerHTML = '';
    }
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
        || entry.layerId === 'iqai-xray-operational'
        || !entry.layerId
        || entry.layerId === attributes.layerId;
      return idMatch && layerMatch;
    });
    if (row) this.highlightRow(row.rowId);
  }

  renderColumnsMenu() {
    if (!this.columnsMenuEl || !this.model) return;
    if (this.mode === 'category_summary' && this.viewMode === 'categories') {
      this.columnsMenuEl.innerHTML = '';
      return;
    }
    const items = this.model.columns.map((col) => {
      const checked = this.visibleColumns.has(col.id);
      return `<label class="results-table-column-item"><input type="checkbox" data-column="${col.id}" ${checked ? 'checked' : ''} /> ${col.label}</label>`;
    }).join('');
    this.columnsMenuEl.innerHTML = items;
    this.columnsMenuEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => {
        const columnId = input.dataset.column;
        if (!columnId) return;
        if (input.checked) this.visibleColumns.add(columnId);
        else if (this.visibleColumns.size > 1) this.visibleColumns.delete(columnId);
        else input.checked = true;
        this.renderBody();
      });
    });
  }

  workingRows() {
    if (!this.model) return [];
    let rows = filterRows(this.model.rows, this.filterText);
    rows = sortRows(rows, this.sortColumn, this.sortDirection);
    return rows;
  }

  renderBody() {
    if (!this.model || !this.theadEl || !this.tbodyEl) return;

    const columns = this.model.columns.filter((col) => this.visibleColumns.has(col.id));
    const rows = this.workingRows();
    const { page, totalPages, pageRows } = paginateRows(rows, this.page, RESULTS_TABLE_PAGE_SIZE);
    this.page = page;

    if (this.metaEl) {
      if (this.mode === 'category_summary' && this.viewMode === 'categories') {
        const represented = this.model.representedFeatures;
        const suffix = represented != null ? ` · ${represented} represented` : '';
        this.metaEl.textContent = `${rows.length} categor${rows.length === 1 ? 'y' : 'ies'}${suffix}`;
      } else if (this.mode === 'operational_features') {
        const trunc = this.featuresTruncated ? ' · capped at 500 for table' : '';
        this.metaEl.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} · selected categories${trunc}`;
      } else {
        this.metaEl.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${this.model.totalCount} scoped`;
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
        return `<td>${value}</td>`;
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
