/**
 * Open-world intelligence control — keyword + interpretation + search trigger.
 */
import { PI_KNOWLEDGE_SEMANTICS, setPointIntelligenceTemporalState, getPointIntelligenceTemporalState } from './point-intelligence-temporal-state.js';
import { runOpenWorldIntelligenceSearch, subscribeOpenWorldIntelligenceState } from './open-world-intelligence-service.js';
import { isAgent2TemporalQuerySupported } from './open-world-intelligence-temporal-mapping.js';
import { buildOpenWorldIntelligenceHtml } from './open-world-intelligence-presentation.js';
import { mountOpenWorldInspector, openOpenWorldInspector } from './open-world-intelligence-inspector-controller.js';
import { selectOpenWorldIntelligenceResult } from './open-world-intelligence-focus-controller.js';

export class OpenWorldIntelligenceControl {
  /** @param {HTMLElement} host */
  constructor(host, options = {}) {
    this.host = host;
    this.onResults = options.onResults;
    this.point = options.point || null;
    this.render();
    this.bind();
    this.unsubscribe = subscribeOpenWorldIntelligenceState((state) => this.sync(state));
  }

  render() {
    if (!this.host) return;
    this.host.innerHTML = `
      <section class="owi-control" id="spatial-open-world-intelligence" aria-label="Open-world intelligence">
        <div class="owi-control__head">
          <h3 class="owi-control__title">Open-world intelligence</h3>
          <span class="owi-control__plane">Agent 2</span>
        </div>
        <label class="owi-control__field">
          <span>Keyword</span>
          <input type="search" id="owi-keyword" placeholder="e.g. bridge" autocomplete="off" />
        </label>
        <fieldset class="owi-control__interpretation">
          <legend>Interpretation</legend>
          <label><input type="radio" name="owi-interpretation" value="APPEARED" checked /> APPEARED</label>
          <label><input type="radio" name="owi-interpretation" value="ACTIVE" /> ACTIVE</label>
          <label><input type="radio" name="owi-interpretation" value="KNOWN_AS_OF" /> KNOWN AS OF</label>
        </fieldset>
        <p class="owi-control__support" data-owi-support hidden></p>
        <button type="button" class="owi-control__search" data-owi-search>Search intelligence</button>
        <p class="owi-control__status" data-owi-status hidden></p>
      </section>`;
    this.keywordInput = this.host.querySelector('#owi-keyword');
    this.supportEl = this.host.querySelector('[data-owi-support]');
    this.statusEl = this.host.querySelector('[data-owi-status]');
    this.interpretationInputs = [...this.host.querySelectorAll('input[name="owi-interpretation"]')];
  }

  bind() {
    this.host?.querySelector('[data-owi-search]')?.addEventListener('click', () => {
      void this.executeSearch();
    });
    this.keywordInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void this.executeSearch();
    });
    for (const input of this.interpretationInputs) {
      input.addEventListener('change', () => this.updateSupportMessage());
    }
    this.updateSupportMessage();
  }

  getInterpretation() {
    const selected = this.interpretationInputs.find((i) => i.checked);
    return selected?.value || PI_KNOWLEDGE_SEMANTICS.APPEARED;
  }

  updateSupportMessage() {
    const temporal = getPointIntelligenceTemporalState();
    const support = isAgent2TemporalQuerySupported({
      timeMode: temporal.mode,
      interpretation: this.getInterpretation()
    });
    if (!this.supportEl) return;
    if (support.status !== 'SUPPORTED') {
      this.supportEl.hidden = false;
      this.supportEl.textContent = support.message || 'Unsupported temporal combination.';
    } else {
      this.supportEl.hidden = true;
      this.supportEl.textContent = '';
    }
  }

  async executeSearch() {
    const interpretation = this.getInterpretation();
    setPointIntelligenceTemporalState({
      ...getPointIntelligenceTemporalState(),
      interpretationMode: interpretation
    });
    const response = await runOpenWorldIntelligenceSearch({
      keyword: this.keywordInput?.value || '',
      interpretation,
      point: this.point
    });
    if (this.statusEl) {
      if (response.searchState === 'UNSUPPORTED' || response.searchState === 'INVALID_REQUEST') {
        this.statusEl.hidden = false;
        this.statusEl.textContent = response.error || response.message || response.searchState;
      } else if (response.stale) {
        this.statusEl.hidden = false;
        this.statusEl.textContent = 'Stale response ignored.';
      } else {
        this.statusEl.hidden = true;
        this.statusEl.textContent = '';
      }
    }
    this.onResults?.(response);
    return response;
  }

  sync(state) {
    this.updateSupportMessage();
    if (state.lastResponse?.normalized) {
      this.onResults?.(state.lastResponse);
    }
  }

  setAnchor(point) {
    this.point = point;
  }

  destroy() {
    this.unsubscribe?.();
  }
}

export function mountOpenWorldIntelligenceInteraction(container, options = {}) {
  if (!container) return;
  const inspectorHost = container.querySelector('#owi-inspector-host')
    || container.querySelector('[data-owi-inspector-host]');
  if (inspectorHost) mountOpenWorldInspector(inspectorHost);

  container.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest('[data-owi-result-id]');
    if (!card) return;
    const id = card.getAttribute('data-owi-result-id');
    if (!id) return;

    if (target.closest('[data-owi-inspect]')) {
      event.preventDefault();
      event.stopPropagation();
      const result = options.getResultById?.(id);
      if (result) {
        void selectOpenWorldIntelligenceResult(id);
        openOpenWorldInspector(result);
      }
      return;
    }

    void selectOpenWorldIntelligenceResult(id);
  });
}

export { buildOpenWorldIntelligenceHtml };
