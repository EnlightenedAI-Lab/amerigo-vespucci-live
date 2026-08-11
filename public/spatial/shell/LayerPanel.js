/**
 * Left rail — DATA & LAYERS (catalog-driven tree + hidden ArcGIS LayerList sync).
 */
import { LayerPanelController } from './layer-panel-controller.js';
import { mountArcgisDataAddControl } from '../arcgis-data-add-control.js';
import { mountIntelligenceLayersControl } from '../intelligence-layer-control.js';
import { getWebMapLayerCatalogSnapshot } from '../webmap-layer-catalog.js';

export class LayerPanel {
  /** @param {HTMLElement} root */
  /** @param {object} [options] */
  constructor(root, options = {}) {
    this.root = root;
    this.onUserLayerRemoved = options.onUserLayerRemoved || null;
    this.onIntelligenceResult = options.onIntelligenceResult || null;
    this.onIntelligenceError = options.onIntelligenceError || null;
    this.appShell = options.appShell || null;
    this.controller = null;
    this.arcgisAddControl = null;
    this.intelligenceLayersControl = null;
    this.render();
    this.controller = new LayerPanelController(this.root, {
      onCatalogUpdated: (catalog) => this.refreshCatalog(catalog),
      onUserLayerRemoved: () => this.onUserLayerRemoved?.()
    });
    this.arcgisAddControl = mountArcgisDataAddControl(
      this.root.querySelector('#spatial-arcgis-add-host'),
      { onCatalogUpdated: (catalog) => this.refreshCatalog(catalog) }
    );
    this.intelligenceLayersControl = mountIntelligenceLayersControl(
      this.root.querySelector('#spatial-intel-layers-host'),
      {
        appShell: this.appShell,
        onResult: (result) => this.onIntelligenceResult?.(result),
        onError: (error) => this.onIntelligenceError?.(error)
      }
    );
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <header class="rail-header">
        <h2 class="rail-title">Data &amp; Layers</h2>
        <button type="button" class="rail-collapse-btn" data-collapse="left" aria-label="Collapse layers panel">×</button>
      </header>
      <div class="control-rail__scroll">
        <div class="layers-toolbar">
          <input type="search" class="layers-search" id="spatial-layer-search"
            placeholder="Search layers…" aria-label="Search layers" />
          <button type="button" class="layers-add-btn" id="spatial-add-data-btn" aria-expanded="false"
            aria-controls="spatial-arcgis-add-host">+ Add data</button>
        </div>
        <div id="spatial-arcgis-add-host" class="arcgis-add-host" hidden></div>
        <div id="spatial-intel-layers-host" class="intel-layers-host"></div>
        <details class="layers-panel" open>
          <summary class="layers-panel__title">WebMap layers</summary>
          <div class="layers-panel__body">
            <p class="layer-panel-meta" id="spatial-layer-meta"></p>
            <p class="layer-panel-hint" id="spatial-layer-hint">Loading WebMap layers…</p>
            <div id="spatial-layer-tree" class="layer-tree" aria-label="WebMap layer tree"></div>
          </div>
        </details>
        <div id="spatial-arcgis-layerlist" class="arcgis-layerlist-host" hidden aria-hidden="true"></div>
      </div>
    `;
    this.layerListHost = this.root.querySelector('#spatial-arcgis-layerlist');
    this.hintEl = this.root.querySelector('#spatial-layer-hint');
    this.addDataHost = this.root.querySelector('#spatial-arcgis-add-host');
    this.addDataBtn = this.root.querySelector('#spatial-add-data-btn');
    this.addDataBtn?.addEventListener('click', () => {
      const open = this.addDataHost?.hidden !== false;
      if (this.addDataHost) this.addDataHost.hidden = !open;
      this.addDataBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  setReady(ready, message = '') {
    if (this.controller) {
      this.controller.setReady(ready, message);
    } else if (this.hintEl) {
      this.hintEl.hidden = ready;
      if (!ready && message) this.hintEl.textContent = message;
    }
  }

  refreshCatalog() {
    this.controller?.render(getWebMapLayerCatalogSnapshot());
    this.controller?.openAddedArcgisGroup?.();
  }

  getWidgetHosts() {
    return {
      layerListHost: this.layerListHost
    };
  }
}
