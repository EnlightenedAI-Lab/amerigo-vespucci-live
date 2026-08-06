/**
 * Deduplicated attribution rendering for active layers.
 */
export class AttributionManager {
  constructor() {
    /** @type {Map<string, { text: string, provider: string }>} */
    this.active = new Map();
  }

  setActiveLayers(layers) {
    this.active.clear();
    for (const layer of layers) {
      if (!layer?.attribution) continue;
      const key = layer.attribution.trim();
      if (!this.active.has(key)) {
        this.active.set(key, { text: layer.attribution, provider: layer.provider });
      }
    }
  }

  addAttribution(text, provider = 'Unknown') {
    if (!text) return;
    const key = text.trim();
    if (!this.active.has(key)) this.active.set(key, { text, provider });
  }

  renderHtml() {
    return [...this.active.values()].map((a) => `<span class="iqai-attrib">${a.text}</span>`).join(' · ');
  }

  renderText() {
    return [...this.active.values()].map((a) => a.text).join(' · ');
  }

  list() {
    return [...this.active.values()];
  }
}
