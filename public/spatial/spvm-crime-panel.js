/**
 * SPVM intelligence workspace panel — OVERVIEW / TIME / CATEGORIES / RECORDS / RELATIONSHIPS.
 */

import { ResultsTable } from './shell/ResultsTable.js';
import { findSpvmRowForAttributes } from './spvm-crime-results.js';
import { categorySymbolStyle } from './spvm-crime-explorer.js';
import { SPVM_LAYER_ID } from './spvm-recent-crime-config.js';
import { WORKSPACE_GEOMETRY_MODES } from './workspace-geometry.js';

const TABS = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'time', label: 'TIME' },
  { id: 'categories', label: 'CATEGORIES' },
  { id: 'records', label: 'RECORDS' },
  { id: 'relationships', label: 'RELATIONSHIPS' }
];

export class SpvmCrimePanel {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    this.activeTab = 'overview';
    this.payload = null;
    this.onWindowDays = null;
    this.onShiftUi = null;
    this.onViewMode = null;
    this.onCategoryToggle = null;
    this.onCategorySelectAll = null;
    this.onCategoryClearAll = null;
    this.onRowSelect = null;
    this.onWorkspaceAction = null;
    this.render();
    this.resultsTable = new ResultsTable(this.recordsHost);
    this.resultsTable.setOperationalMode(false);
    this.resultsTable.setRowSelectHandler((row) => {
      if (this.onRowSelect) this.onRowSelect(row);
    });
    this.renderRelationships();
  }

  render() {
    if (!this.host) return;
    this.host.innerHTML = `
      <div class="spvm-workspace" hidden>
        <div class="spvm-workspace-header">
          <div class="spvm-workspace-header-left">
            <span class="spvm-workspace-title">SPVM CRIME</span>
            <span class="spvm-workspace-metrics" data-spvm-metrics>—</span>
          </div>
          <div class="spvm-workspace-controls">
            <button type="button" class="workspace-geo-btn" data-workspace-action="collapse" aria-label="Collapse workspace">—</button>
            <button type="button" class="workspace-geo-btn" data-workspace-action="toggle-maximize">MAXIMIZE</button>
            <button type="button" class="workspace-geo-btn" data-workspace-action="expand" hidden>EXPAND</button>
          </div>
        </div>
        <div class="spvm-workspace-body" data-spvm-workspace-body>
        <div class="spvm-filter-bar">
          <div class="spvm-filter-group">
            <span class="spvm-filter-label">TIME</span>
            <div class="spvm-filter-buttons" data-spvm-window></div>
          </div>
          <div class="spvm-filter-group">
            <span class="spvm-filter-label">SHIFT</span>
            <div class="spvm-filter-buttons" data-spvm-shift></div>
          </div>
          <div class="spvm-filter-group">
            <span class="spvm-filter-label">VIEW</span>
            <div class="spvm-filter-buttons" data-spvm-view></div>
          </div>
        </div>
        <div class="spvm-tabs" role="tablist"></div>
        <div class="spvm-tab-panels">
          <div class="spvm-tab-panel" data-tab-panel="overview"></div>
          <div class="spvm-tab-panel" data-tab-panel="time" hidden></div>
          <div class="spvm-tab-panel" data-tab-panel="categories" hidden></div>
          <div class="spvm-tab-panel" data-tab-panel="records" hidden>
            <div class="spvm-records-host"></div>
          </div>
          <div class="spvm-tab-panel" data-tab-panel="relationships" hidden></div>
        </div>
        </div>
      </div>
    `;
    this.rootEl = this.host.querySelector('.spvm-workspace');
    this.headerEl = this.host.querySelector('.spvm-workspace-header');
    this.workspaceBodyEl = this.host.querySelector('[data-spvm-workspace-body]');
    this.metricsEl = this.host.querySelector('[data-spvm-metrics]');
    this.windowHost = this.host.querySelector('[data-spvm-window]');
    this.shiftHost = this.host.querySelector('[data-spvm-shift]');
    this.viewHost = this.host.querySelector('[data-spvm-view]');
    this.tabsHost = this.host.querySelector('.spvm-tabs');
    this.overviewPanel = this.host.querySelector('[data-tab-panel="overview"]');
    this.timePanel = this.host.querySelector('[data-tab-panel="time"]');
    this.categoriesPanel = this.host.querySelector('[data-tab-panel="categories"]');
    this.recordsPanel = this.host.querySelector('[data-tab-panel="records"]');
    this.relationshipsPanel = this.host.querySelector('[data-tab-panel="relationships"]');
    this.recordsHost = this.host.querySelector('.spvm-records-host');
    this.tabPanelsEl = this.host.querySelector('.spvm-tab-panels');

    this.tabsHost.innerHTML = TABS.map((tab) => `
      <button type="button" class="spvm-tab${tab.id === this.activeTab ? ' is-active' : ''}"
        data-spvm-tab="${tab.id}" role="tab">${tab.label}</button>`).join('');

    this.windowHost.innerHTML = `
      <button type="button" class="spvm-filter-btn" data-window="7">7D</button>
      <button type="button" class="spvm-filter-btn" data-window="30">30D</button>
      <button type="button" class="spvm-filter-btn" data-window="90">90D</button>`;

    this.shiftHost.innerHTML = `
      <button type="button" class="spvm-filter-btn" data-shift="ALL">ALL</button>
      <button type="button" class="spvm-filter-btn" data-shift="DAY">DAY</button>
      <button type="button" class="spvm-filter-btn" data-shift="EVENING">EVENING</button>
      <button type="button" class="spvm-filter-btn" data-shift="NIGHT">NIGHT</button>`;

    this.viewHost.innerHTML = `
      <button type="button" class="spvm-filter-btn" data-view="INCIDENTS">INCIDENTS</button>
      <button type="button" class="spvm-filter-btn" data-view="DENSITY">DENSITY</button>`;

    this.bind();
    this.bindWorkspaceControls();
    this.syncTabPanels();
  }

  syncTabPanels() {
    for (const panel of this.host?.querySelectorAll('[data-tab-panel]') || []) {
      const isActive = panel.dataset.tabPanel === this.activeTab;
      panel.hidden = !isActive;
      panel.classList.toggle('is-active', isActive);
    }
    this.tabsHost?.querySelectorAll('[data-spvm-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.spvmTab === this.activeTab);
      btn.setAttribute('aria-selected', String(btn.dataset.spvmTab === this.activeTab));
    });
  }

  renderActiveTab(payload = this.payload) {
    if (!payload?.state) return;
    switch (this.activeTab) {
      case 'overview':
        this.renderOverview(payload);
        break;
      case 'time':
        this.renderTime(payload);
        break;
      case 'categories':
        this.renderCategories(payload);
        break;
      case 'records':
        if (payload.tableModel) {
          this.resultsTable.applySpvmCrimeModel(payload.tableModel);
        }
        this.resultsTable.setOpen(true);
        break;
      case 'relationships':
        this.renderRelationships();
        break;
      default:
        break;
    }
  }

  resolveDisplayState(payload = this.payload) {
    const status = payload?.dataStatus || 'IDLE';
    if (status === 'LOADING' || status === 'IDLE') {
      return { kind: 'loading', message: 'Loading SPVM crime data…' };
    }
    if (status === 'ERROR') {
      return {
        kind: 'error',
        message: payload?.dataError || 'SPVM crime data could not be loaded.'
      };
    }
    const total = payload?.analytics?.total ?? 0;
    if (total === 0) {
      return { kind: 'zero', message: 'No reports match the current filters.' };
    }
    return { kind: 'ready' };
  }

  bindWorkspaceControls() {
    this.host?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-workspace-action]');
      if (!btn || btn.hidden || !this.onWorkspaceAction) return;
      this.onWorkspaceAction(btn.dataset.workspaceAction);
    });
  }

  /**
   * @param {{ mode?: string, dockedHeight?: number }} geometry
   */
  applyWorkspaceGeometry(geometry = {}) {
    const collapsed = geometry.mode === WORKSPACE_GEOMETRY_MODES.COLLAPSED;
    const maximized = geometry.mode === WORKSPACE_GEOMETRY_MODES.MAXIMIZED;

    if (this.rootEl) {
      this.rootEl.classList.toggle('is-collapsed', collapsed);
      this.rootEl.classList.toggle('is-maximized', maximized);
    }
    if (this.headerEl) this.headerEl.classList.toggle('is-collapsed', collapsed);
    if (this.workspaceBodyEl) this.workspaceBodyEl.hidden = collapsed;

    const collapseBtn = this.host?.querySelector('[data-workspace-action="collapse"]');
    const maximizeBtn = this.host?.querySelector('[data-workspace-action="toggle-maximize"]');
    const expandBtn = this.host?.querySelector('[data-workspace-action="expand"]');

    if (collapseBtn) collapseBtn.hidden = collapsed;
    if (maximizeBtn) {
      maximizeBtn.hidden = collapsed;
      maximizeBtn.textContent = maximized ? 'RESTORE' : 'MAXIMIZE';
    }
    if (expandBtn) expandBtn.hidden = !collapsed;

    if (this.payload) {
      this.renderHeader(this.payload);
    }
  }

  bind() {
    this.windowHost?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-window]');
      if (!btn || !this.onWindowDays) return;
      this.onWindowDays(Number(btn.dataset.window));
    });
    this.shiftHost?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-shift]');
      if (!btn || !this.onShiftUi) return;
      this.onShiftUi(btn.dataset.shift);
    });
    this.viewHost?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-view]');
      if (!btn || !this.onViewMode) return;
      this.onViewMode(btn.dataset.view);
    });
    this.tabsHost?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-spvm-tab]');
      if (!btn) return;
      this.setActiveTab(btn.dataset.spvmTab);
    });
    this.categoriesPanel?.addEventListener('click', (event) => {
      const selectAll = event.target.closest('[data-spvm-cat-all]');
      const clearAll = event.target.closest('[data-spvm-cat-clear]');
      if (selectAll && this.onCategorySelectAll) this.onCategorySelectAll();
      if (clearAll && this.onCategoryClearAll) this.onCategoryClearAll();
      const checkbox = event.target.closest('.spvm-cat-check');
      if (checkbox && this.onCategoryToggle) {
        this.onCategoryToggle(checkbox.dataset.category, checkbox.checked);
      }
    });
  }

  setActiveTab(tabId) {
    this.activeTab = tabId;
    this.syncTabPanels();
    this.renderActiveTab(this.payload);
  }

  setVisible(visible) {
    if (this.rootEl) this.rootEl.hidden = !visible;
    if (this.host) this.host.classList.toggle('is-active', Boolean(visible));
  }

  /**
   * @param {object} payload
   */
  update(payload) {
    this.payload = payload;
    if (!payload?.state) return;
    this.renderHeader(payload);
    this.renderFilterStates(payload.state);
    this.renderActiveTab(payload);
  }

  renderHeader(payload) {
    if (!this.metricsEl || !payload?.state) return;
    const display = this.resolveDisplayState(payload);
    const collapsed = this.rootEl?.classList.contains('is-collapsed');
    if (display.kind === 'loading') {
      this.metricsEl.textContent = collapsed ? '· Loading SPVM crime data…' : 'Loading SPVM crime data…';
      return;
    }
    if (display.kind === 'error') {
      this.metricsEl.textContent = collapsed ? '· SPVM data unavailable' : 'SPVM data unavailable';
      return;
    }
    const days = payload.state.windowDays;
    const count = payload.analytics?.total ?? 0;
    const line = `${days} DAYS · ${count.toLocaleString()} REPORTS`;
    this.metricsEl.textContent = collapsed ? `· ${line}` : line;
  }

  renderFilterStates(state) {
    this.windowHost?.querySelectorAll('[data-window]').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.window) === state.windowDays);
    });
    const shiftKey = this.resolveShiftUiKey(state.shifts);
    this.shiftHost?.querySelectorAll('[data-shift]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.shift === shiftKey);
    });
    this.viewHost?.querySelectorAll('[data-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === state.viewMode);
    });
  }

  resolveShiftUiKey(shifts) {
    if (!shifts || shifts.size >= 3) return 'ALL';
    if (shifts.size === 1 && shifts.has('jour')) return 'DAY';
    if (shifts.size === 1 && shifts.has('soir')) return 'EVENING';
    if (shifts.size === 1 && shifts.has('nuit')) return 'NIGHT';
    return 'ALL';
  }

  renderOverview(payload) {
    const { analytics, state } = payload;
    if (!this.overviewPanel) return;
    const display = this.resolveDisplayState(payload);
    if (display.kind !== 'ready') {
      this.overviewPanel.innerHTML = `
        <div class="spvm-summary spvm-panel-scroll">
          <div class="spvm-muted">${display.message}</div>
        </div>`;
      return;
    }
    if (!analytics) return;
    const days = state.windowDays;
    const top = analytics.topCategory;
    const categoryLines = analytics.categoryRows
      .filter((row) => row.count > 0)
      .map((row) => `<div class="spvm-summary-row"><span>${row.english}</span><span>${row.count}</span></div>`)
      .join('');
    const shiftLines = analytics.shiftRows
      .map((row) => `<div class="spvm-summary-row"><span>${row.label}</span><span>${row.count}</span></div>`)
      .join('');
    const pdqLines = analytics.topPdqs.length
      ? analytics.topPdqs.map((row) => `<div class="spvm-summary-row"><span>PDQ ${row.pdq}</span><span>${row.count}</span></div>`).join('')
      : '<div class="spvm-muted">No PDQ data in current filter</div>';

    this.overviewPanel.innerHTML = `
      <div class="spvm-summary spvm-panel-scroll">
        <div class="spvm-summary-stat"><span>Mapped reports</span><strong>${analytics.total}</strong></div>
        ${top ? `<div class="spvm-summary-stat"><span>Top category</span><strong>${top.english} — ${top.count}</strong></div>` : ''}
        <div class="spvm-summary-section">CATEGORY COUNTS</div>
        <div class="spvm-summary-table">${categoryLines || '<div class="spvm-muted">No records</div>'}</div>
        <div class="spvm-summary-section">SHIFT</div>
        <div class="spvm-summary-table">${shiftLines}</div>
        <div class="spvm-summary-section">PDQ (top 5)</div>
        <div class="spvm-summary-table">${pdqLines}</div>
      </div>`;
    void days;
  }

  renderTime(payload) {
    const { analytics } = payload;
    if (!this.timePanel) return;
    const display = this.resolveDisplayState(payload);
    if (display.kind !== 'ready') {
      this.timePanel.innerHTML = `
        <div class="spvm-timeline spvm-panel-scroll">
          <div class="spvm-muted">${display.message}</div>
        </div>`;
      return;
    }
    if (!analytics) return;
    const max = analytics.timelineMax || 1;
    const bars = analytics.timelineRows.map((row) => {
      const height = Math.max(4, Math.round((row.count / max) * 64));
      return `
        <div class="spvm-timeline-day">
          <div class="spvm-timeline-bar-wrap">
            <div class="spvm-timeline-bar" style="height:${height}px" title="${row.count}"></div>
          </div>
          <div class="spvm-timeline-label">${row.label}</div>
          <div class="spvm-timeline-count">${row.count}</div>
        </div>`;
    }).join('');

    this.timePanel.innerHTML = `
      <div class="spvm-timeline spvm-panel-scroll">
        <div class="spvm-timeline-chart">${bars || '<div class="spvm-muted">No daily counts</div>'}</div>
      </div>`;
  }

  renderCategories(payload) {
    const { analytics, state } = payload;
    if (!this.categoriesPanel) return;
    const display = this.resolveDisplayState(payload);
    if (display.kind !== 'ready') {
      this.categoriesPanel.innerHTML = `
        <div class="spvm-categories spvm-panel-scroll">
          <div class="spvm-muted">${display.message}</div>
        </div>`;
      return;
    }
    if (!analytics) return;
    const rows = analytics.categoryRows.map((row) => {
      const selected = state.categories.has(row.french);
      const color = categorySymbolStyle(row.french) || '#888';
      return `
        <tr class="spvm-cat-row">
          <td class="spvm-cat-select"><input type="checkbox" class="spvm-cat-check"
            data-category="${row.french.replace(/"/g, '&quot;')}" ${selected ? 'checked' : ''} /></td>
          <td class="spvm-cat-symbol"><span class="spvm-cat-swatch" style="background:${color}"></span></td>
          <td>${row.english}</td>
          <td class="spvm-cat-count">${row.count}</td>
        </tr>`;
    }).join('');

    this.categoriesPanel.innerHTML = `
      <div class="spvm-categories spvm-panel-scroll">
        <div class="spvm-cat-legend-note">Category symbols control map visibility.</div>
        <div class="spvm-cat-actions">
          <button type="button" class="spvm-cat-action" data-spvm-cat-all>SELECT ALL</button>
          <button type="button" class="spvm-cat-action" data-spvm-cat-clear>CLEAR ALL</button>
        </div>
        <table class="spvm-cat-table">
          <thead>
            <tr>
              <th>SELECT</th>
              <th>SYMBOL</th>
              <th>CRIME TYPE</th>
              <th>COUNT</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  renderRelationships() {
    if (!this.relationshipsPanel) return;
    this.relationshipsPanel.innerHTML = `
      <div class="spvm-relationships spvm-panel-scroll">
        <p class="spvm-placeholder-title">RELATIONSHIP INTELLIGENCE</p>
        <p class="spvm-muted">Relationship intelligence coming in next phase.</p>
        <p class="spvm-muted">Nearby incidents, shared patterns, and cross-source links will appear here.</p>
      </div>`;
  }

  highlightFromMapAttributes(attributes) {
    if (this.activeTab !== 'records' || !this.payload?.tableModel) return;
    const row = findSpvmRowForAttributes(this.payload.tableModel, attributes);
    if (row) this.resultsTable.highlightRow(row.rowId);
  }

  getLayerId() {
    return SPVM_LAYER_ID;
  }
}
