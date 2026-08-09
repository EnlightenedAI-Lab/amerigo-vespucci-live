/**
 * Left sidebar — hosts native ArcGIS LayerList (WebMap-backed).
 */
export class LayerPanel {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.layerListHost = null;
    this.render();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <header class="panel-heading panel-heading-with-action">
        <span>LAYERS</span>
        <button type="button" class="panel-collapse-btn" data-collapse="left" aria-label="Collapse layers panel">×</button>
      </header>
      <div class="layer-panel-body">
        <p class="layer-panel-hint" id="spatial-layer-hint">Loading WebMap layers…</p>
        <div id="spatial-arcgis-layerlist" class="arcgis-layerlist-host" aria-label="ArcGIS layer list"></div>
      </div>
    `;
    this.layerListHost = this.root.querySelector('#spatial-arcgis-layerlist');
    this.hintEl = this.root.querySelector('#spatial-layer-hint');
  }

  setReady(ready) {
    if (this.hintEl) this.hintEl.hidden = ready;
  }

  getWidgetHosts() {
    return {
      layerListHost: this.layerListHost
    };
  }
}
