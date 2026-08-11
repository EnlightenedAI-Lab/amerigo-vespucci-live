/**
 * DATA & LAYERS — client tree built from live WebMap catalog (metadata only).
 */
import {
  getWebMapLayerCatalogSnapshot,
  findRuntimeLayerByCatalogEntry,
  syncCatalogVisibilityFromRuntime,
  isUserAddedCatalogEntry
} from '../webmap-layer-catalog.js';
import { executeLayerControl } from '../webmap-layer-commands.js';
import { removeUserAddedArcgisLayer } from '../arcgis-data-add-service.js';

const UNASSIGNED = 'Unassigned';

function normalizeKey(value) {
  return String(value || '').trim() || UNASSIGNED;
}

function isGroupEntry(entry) {
  return String(entry?.type || '').toLowerCase() === 'group';
}

function isToggleable(entry) {
  if (!entry || isGroupEntry(entry)) return false;
  if (isUserAddedCatalogEntry(entry)) return true;
  if (String(entry.catalogId || '').startsWith('iqai')) return false;
  return entry.type !== 'unknown';
}

/**
 * @param {object[]} layers
 */
export function buildLayerTree(layers = []) {
  const groups = new Map();
  for (const entry of layers) {
    if (isGroupEntry(entry)) continue;
    const group = normalizeKey(entry.parentGroup);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => {
    if (a[0] === UNASSIGNED) return 1;
    if (b[0] === UNASSIGNED) return -1;
    return a[0].localeCompare(b[0]);
  });

  return sortedGroups.map(([name, items]) => ({
    name,
    layers: items.sort((a, b) => String(a.title).localeCompare(String(b.title)))
  }));
}

export class LayerPanelController {
  /** @param {HTMLElement} root */
  constructor(root, options = {}) {
    this.root = root;
    this.onCatalogUpdated = options.onCatalogUpdated || null;
    this.onUserLayerRemoved = options.onUserLayerRemoved || null;
    this.searchEl = root?.querySelector('#spatial-layer-search');
    this.treeHost = root?.querySelector('#spatial-layer-tree');
    this.hintEl = root?.querySelector('#spatial-layer-hint');
    this.metaEl = root?.querySelector('#spatial-layer-meta');
    this.addDataBtn = root?.querySelector('#spatial-add-data-btn');
    this.filter = '';
    this.bind();
  }

  bind() {
    this.searchEl?.addEventListener('input', () => {
      this.filter = this.searchEl.value.trim().toLowerCase();
      this.render();
    });
    this.treeHost?.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return;
      const catalogId = input.dataset.catalogId;
      if (!catalogId) return;
      const entry = getWebMapLayerCatalogSnapshot()?.layers?.find((l) => l.catalogId === catalogId);
      void executeLayerControl({
        operation: input.checked ? 'SHOW_LAYER' : 'HIDE_LAYER',
        catalogId,
        title: entry?.title
      }).then(() => {
        syncCatalogVisibilityFromRuntime();
        this.render();
      }).catch((error) => {
        console.warn('[IQAI] layer toggle failed', error?.message || error);
        input.checked = !input.checked;
      });
    });
    this.treeHost?.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-remove-catalog-id]');
      if (removeBtn) {
        const catalogId = removeBtn.dataset.removeCatalogId;
        if (!catalogId) return;
        void removeUserAddedArcgisLayer(catalogId, {
          onCatalogUpdated: (catalog) => {
            this.onCatalogUpdated?.(catalog);
            this.render(catalog);
          },
          onSelectionCleared: () => this.onUserLayerRemoved?.()
        }).catch((error) => {
          console.warn('[IQAI] remove user layer failed', error?.message || error);
        });
        return;
      }

      const btn = event.target.closest('[data-zoom-catalog-id]');
      if (!btn) return;
      const catalogId = btn.dataset.zoomCatalogId;
      const entry = getWebMapLayerCatalogSnapshot()?.layers?.find((l) => l.catalogId === catalogId);
      const layer = entry ? findRuntimeLayerByCatalogEntry(entry) : null;
      if (!layer) return;
      void import('../spatial-arcgis-runtime.js').then(async ({ getMapView }) => {
        const view = getMapView();
        if (!view) return;
        await layer.when?.();
        const extent = layer.fullExtent;
        if (extent) await view.goTo(extent.expand(1.15));
      }).catch(() => {});
    });
  }

  setReady(ready, message = '') {
    if (this.hintEl) {
      this.hintEl.hidden = ready;
      if (!ready && message) this.hintEl.textContent = message;
      else if (!ready) this.hintEl.textContent = 'Loading WebMap layers…';
    }
  }

  openAddedArcgisGroup() {
    const group = [...this.treeHost?.querySelectorAll('.layer-group') || []]
      .find((el) => el.querySelector('.layer-group__title')?.textContent?.includes('Added ArcGIS data'));
    if (group) group.open = true;
  }

  render(catalog = getWebMapLayerCatalogSnapshot()) {
    if (!this.treeHost) return;
    const layers = Array.isArray(catalog?.layers) ? catalog.layers : [];
    const toggleable = layers.filter(isToggleable);
    const visible = toggleable.filter((l) => l.visible).length;

    if (this.metaEl) {
      this.metaEl.textContent = catalog?.webmapTitle
        ? `${catalog.webmapTitle} · ${visible}/${toggleable.length} visible`
        : `${visible}/${toggleable.length} visible`;
    }

    if (!layers.length) {
      this.treeHost.innerHTML = '<p class="layer-panel-hint">No layers in catalog yet.</p>';
      return;
    }

    const tree = buildLayerTree(toggleable);
    const html = tree.map((group) => {
      const filtered = group.layers.filter((entry) => {
        if (!this.filter) return true;
        const hay = `${entry.title} ${entry.parentGroup || ''}`.toLowerCase();
        return hay.includes(this.filter);
      });
      if (!filtered.length) return '';
      const rows = filtered.map((entry) => {
        const removeBtn = isUserAddedCatalogEntry(entry)
          ? `<button type="button" class="layer-row__remove" data-remove-catalog-id="${entry.catalogId}" title="Remove from map">×</button>`
          : '';
        return `
        <label class="layer-row">
          <input type="checkbox" data-catalog-id="${entry.catalogId}" ${entry.visible ? 'checked' : ''} />
          <span class="layer-row__text">
            <span class="layer-row__title">${escapeHtml(entry.title)}</span>
          </span>
          <button type="button" class="layer-row__zoom" data-zoom-catalog-id="${entry.catalogId}" title="Zoom to layer">↗</button>
          ${removeBtn}
        </label>`;
      }).join('');
      return `
        <details class="layer-group" open>
          <summary class="layer-group__title">${escapeHtml(group.name)} <span class="layer-group__count">${filtered.length}</span></summary>
          <div class="layer-group__body">${rows}</div>
        </details>`;
    }).join('');

    this.treeHost.innerHTML = html || '<p class="layer-panel-hint">No layers match search.</p>';
    this.setReady(true);
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
