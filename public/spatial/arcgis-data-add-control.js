/**
 * ADD ARCGIS DATA — compact search + direct-add control.
 */
import {
  addArcgisDataFromInput,
  previewArcgisPortalItem,
  searchArcgisData,
  zoomToUserAddedLayer
} from './arcgis-data-add-service.js';
import { formatUserAddedSourceSummary } from './arcgis-data-add-provenance.js';
import {
  ARCGIS_CONTENT_SOURCES,
  SEARCH_SORT_OPTIONS,
  SEARCH_SORT_LABELS
} from './arcgis-data-add-search-config.js';

export class ArcgisDataAddControl {
  /**
   * @param {HTMLElement} host
   * @param {object} options
   */
  constructor(host, options = {}) {
    this.host = host;
    this.onCatalogUpdated = options.onCatalogUpdated || null;
    this.searchResults = [];
    this.selectedResultId = null;
    this.source = ARCGIS_CONTENT_SOURCES.ARCGIS_ONLINE;
    this.sort = SEARCH_SORT_OPTIONS.RELEVANCE;
    this.mapAreaOnly = false;
    this.render();
    this.bind();
  }

  render() {
    if (!this.host) return;
    this.host.innerHTML = `
      <section class="arcgis-add-control" id="spatial-arcgis-add-control" aria-label="Add ArcGIS data">
        <h3 class="arcgis-add-control__title">Add ArcGIS data</h3>
        <div class="arcgis-add-control__grid">
          <label class="arcgis-add-control__field">
            <span class="arcgis-add-control__label">Source</span>
            <select id="arcgis-add-source" class="arcgis-add-control__select">
              <option value="${ARCGIS_CONTENT_SOURCES.ARCGIS_ONLINE}">ArcGIS Online</option>
              <option value="${ARCGIS_CONTENT_SOURCES.LIVING_ATLAS}">Living Atlas</option>
            </select>
          </label>
          <label class="arcgis-add-control__field">
            <span class="arcgis-add-control__label">Sort</span>
            <select id="arcgis-add-sort" class="arcgis-add-control__select">
              ${Object.entries(SEARCH_SORT_LABELS).map(([value, label]) => (
                `<option value="${value}">${label}</option>`
              )).join('')}
            </select>
          </label>
        </div>
        <div class="arcgis-add-control__section">
          <label class="arcgis-add-control__label" for="arcgis-add-search-input">Search</label>
          <div class="arcgis-add-control__row">
            <input type="search" id="arcgis-add-search-input" class="arcgis-add-control__input"
              placeholder="wildfire Montreal" autocomplete="off" />
            <button type="button" class="arcgis-add-control__btn" id="arcgis-add-search-btn">Search</button>
          </div>
          <label class="arcgis-add-control__check">
            <input type="checkbox" id="arcgis-add-map-area" />
            <span>Current map area only</span>
          </label>
        </div>
        <div class="arcgis-add-control__section">
          <label class="arcgis-add-control__label" for="arcgis-add-direct-input">Direct add</label>
          <div class="arcgis-add-control__row">
            <input type="text" id="arcgis-add-direct-input" class="arcgis-add-control__input"
              placeholder="Paste ArcGIS URL or item ID" autocomplete="off" />
            <button type="button" class="arcgis-add-control__btn" id="arcgis-add-direct-btn">Add</button>
          </div>
        </div>
        <p class="arcgis-add-control__status" id="arcgis-add-status" hidden></p>
        <div class="arcgis-add-control__results" id="arcgis-add-results" hidden></div>
        <div class="arcgis-add-control__preview" id="arcgis-add-preview" hidden></div>
      </section>
    `;

    this.sourceSelect = this.host.querySelector('#arcgis-add-source');
    this.sortSelect = this.host.querySelector('#arcgis-add-sort');
    this.searchInput = this.host.querySelector('#arcgis-add-search-input');
    this.searchBtn = this.host.querySelector('#arcgis-add-search-btn');
    this.mapAreaCheckbox = this.host.querySelector('#arcgis-add-map-area');
    this.directInput = this.host.querySelector('#arcgis-add-direct-input');
    this.directBtn = this.host.querySelector('#arcgis-add-direct-btn');
    this.statusEl = this.host.querySelector('#arcgis-add-status');
    this.resultsEl = this.host.querySelector('#arcgis-add-results');
    this.previewEl = this.host.querySelector('#arcgis-add-preview');
  }

  bind() {
    this.sourceSelect?.addEventListener('change', () => {
      this.source = this.sourceSelect.value;
    });
    this.sortSelect?.addEventListener('change', () => {
      this.sort = this.sortSelect.value;
    });
    this.mapAreaCheckbox?.addEventListener('change', () => {
      this.mapAreaOnly = Boolean(this.mapAreaCheckbox.checked);
    });
    this.searchBtn?.addEventListener('click', () => void this.handleSearch());
    this.searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.handleSearch();
    });
    this.directBtn?.addEventListener('click', () => void this.handleDirectAdd());
    this.directInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.handleDirectAdd();
    });
    this.resultsEl?.addEventListener('click', (event) => {
      const previewBtn = event.target.closest('[data-arcgis-preview-id]');
      const addBtn = event.target.closest('[data-arcgis-add-id]');
      if (previewBtn) void this.handlePreview(previewBtn.dataset.arcgisPreviewId);
      if (addBtn) void this.handleAddItem(addBtn.dataset.arcgisAddId);
    });
    this.previewEl?.addEventListener('click', (event) => {
      const addBtn = event.target.closest('[data-arcgis-preview-add]');
      if (addBtn) void this.handleAddItem(addBtn.dataset.arcgisPreviewAdd);
    });
  }

  getSearchOptions() {
    return {
      source: this.sourceSelect?.value || this.source,
      sort: this.sortSelect?.value || this.sort,
      mapAreaOnly: Boolean(this.mapAreaCheckbox?.checked)
    };
  }

  setStatus(message, tone = 'info') {
    if (!this.statusEl) return;
    this.statusEl.hidden = !message;
    this.statusEl.textContent = message || '';
    this.statusEl.dataset.tone = tone;
  }

  setBusy(busy) {
    if (this.searchBtn) this.searchBtn.disabled = busy;
    if (this.directBtn) this.directBtn.disabled = busy;
  }

  async handleSearch() {
    const query = this.searchInput?.value?.trim();
    if (!query) {
      this.setStatus('Enter a search term.', 'warn');
      return;
    }
    this.setBusy(true);
    const searchOptions = this.getSearchOptions();
    this.setStatus(`Searching ${searchOptions.source === ARCGIS_CONTENT_SOURCES.LIVING_ATLAS ? 'Living Atlas' : 'ArcGIS Online'}…`, 'info');
    this.previewEl.hidden = true;
    try {
      const response = await searchArcgisData(query, searchOptions);
      this.searchResults = response.results || [];
      this.renderSearchResults(response);
      const extentNote = response.extentRestricted ? ' · map area only' : '';
      const sortLabel = SEARCH_SORT_LABELS[response.sort] || response.sort;
      this.setStatus(
        this.searchResults.length
          ? `${this.searchResults.length} result(s) · ${sortLabel}${extentNote}`
          : `No results for "${response.query}". Try a broader term or different source.`,
        this.searchResults.length ? 'success' : 'warn'
      );
    } catch (error) {
      this.renderSearchResults({ results: [] });
      this.setStatus(error?.message || 'Portal search failed.', 'error');
    } finally {
      this.setBusy(false);
    }
  }

  renderSearchResults(response) {
    if (!this.resultsEl) return;
    const results = response?.results || [];
    if (!results.length) {
      this.resultsEl.hidden = true;
      this.resultsEl.innerHTML = '';
      return;
    }
    this.resultsEl.hidden = false;
    this.resultsEl.innerHTML = results.map((item) => `
      <article class="arcgis-add-result" data-item-id="${escapeAttr(item.id)}">
        <div class="arcgis-add-result__head">
          <h4 class="arcgis-add-result__title">${escapeHtml(item.title)}</h4>
          <span class="arcgis-add-result__type">${escapeHtml(item.type || 'Item')}</span>
        </div>
        <p class="arcgis-add-result__meta">
          ${escapeHtml(item.owner || 'unknown owner')}
          ${item.modified ? ` · updated ${formatDate(item.modified)}` : ''}
          ${item.numViews != null ? ` · ${Number(item.numViews).toLocaleString()} views` : ''}
          ${item.access ? ` · ${escapeHtml(item.access)}` : ''}
          ${item.geographicRelevance === 'in-map-extent' ? ' · in map area' : ''}
        </p>
        ${item.snippet ? `<p class="arcgis-add-result__snippet">${escapeHtml(item.snippet)}</p>` : ''}
        <div class="arcgis-add-result__actions">
          <button type="button" class="arcgis-add-control__btn arcgis-add-control__btn--ghost"
            data-arcgis-preview-id="${escapeAttr(item.id)}">Preview</button>
          <button type="button" class="arcgis-add-control__btn"
            data-arcgis-add-id="${escapeAttr(item.id)}">Add to map</button>
        </div>
      </article>
    `).join('');
  }

  async handlePreview(itemId) {
    if (!itemId) return;
    this.setBusy(true);
    this.setStatus('Loading item preview…', 'info');
    try {
      const searchOptions = this.getSearchOptions();
      const { metadata, resolved } = await previewArcgisPortalItem(itemId, searchOptions);
      this.selectedResultId = itemId;
      this.previewEl.hidden = false;
      this.previewEl.innerHTML = `
        <div class="arcgis-add-preview__card">
          <h4 class="arcgis-add-preview__title">${escapeHtml(metadata.title)}</h4>
          <p class="arcgis-add-preview__meta">${escapeHtml(formatUserAddedSourceSummary({
            itemTitle: metadata.title,
            owner: metadata.owner,
            itemType: metadata.type,
            access: metadata.access,
            sourceLabel: metadata.sourceLabel
          }))}</p>
          ${metadata.snippet ? `<p class="arcgis-add-preview__snippet">${escapeHtml(metadata.snippet)}</p>` : ''}
          <p class="arcgis-add-preview__layer">Layer type: ${escapeHtml(resolved.layer?.type || 'unknown')}</p>
          <div class="arcgis-add-result__actions">
            <button type="button" class="arcgis-add-control__btn"
              data-arcgis-preview-add="${escapeAttr(itemId)}">Add to map</button>
          </div>
        </div>
      `;
      this.setStatus(`Preview ready: ${metadata.title}`, 'success');
    } catch (error) {
      this.previewEl.hidden = true;
      this.setStatus(error?.message || 'Preview failed.', 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async handleAddItem(itemId) {
    if (!itemId) return;
    const searchOptions = this.getSearchOptions();
    const resultMeta = this.searchResults.find((item) => item.id === itemId);
    await this.addResolved(itemId, {
      contentSource: searchOptions.source,
      sourceLabel: resultMeta?.sourceLabel
    });
  }

  async handleDirectAdd() {
    const value = this.directInput?.value?.trim();
    if (!value) {
      this.setStatus('Paste an ArcGIS item URL, item ID, or service URL.', 'warn');
      return;
    }
    await this.addResolved(value);
  }

  async addResolved(input, extra = {}) {
    this.setBusy(true);
    this.setStatus('Adding layer…', 'info');
    try {
      const result = await addArcgisDataFromInput(input, {
        ...extra,
        contentSource: extra.contentSource || null,
        onCatalogUpdated: (catalog) => this.onCatalogUpdated?.(catalog)
      });
      if (result.status === 'ALREADY_ADDED') {
        this.setStatus(result.message, 'warn');
        if (result.entry?.layer) await zoomToUserAddedLayer(result.entry.layer);
        return;
      }
      this.setStatus(result.message || 'Layer added.', 'success');
      this.onCatalogUpdated?.(result.catalog);
      if (this.directInput) this.directInput.value = '';
    } catch (error) {
      this.setStatus(error?.message || 'Could not add layer.', 'error');
    } finally {
      this.setBusy(false);
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

export function mountArcgisDataAddControl(host, options = {}) {
  if (!host) return null;
  return new ArcgisDataAddControl(host, options);
}
