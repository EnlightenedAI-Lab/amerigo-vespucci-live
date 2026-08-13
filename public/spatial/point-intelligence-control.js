/**
 * Compact Point Intelligence analyst control — mode toggle for multi-family queries.
 */
import {
  POINT_INTELLIGENCE_UI_ENABLED,
  POINT_INTELLIGENCE_FAMILY_GROUPS
} from './point-intelligence-config.js';
import {
  getPointIntelligencePresentation,
  isPointIntelligenceModeEnabled,
  setPointIntelligenceModeEnabled,
  subscribePointIntelligenceState
} from './point-intelligence-service.js';
import { formatPointIntelligenceStatus } from './point-intelligence-status.js';

export class PointIntelligenceControl {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    this.unsubscribe = null;
    this.render();
    this.bind();
    if (POINT_INTELLIGENCE_UI_ENABLED) {
      this.unsubscribe = subscribePointIntelligenceState((state) => this.sync(state));
      this.sync();
    }
  }

  render() {
    if (!this.host) return;
    const groupList = POINT_INTELLIGENCE_FAMILY_GROUPS.map((group) => (
      `<li>${group.label}</li>`
    )).join('');
    this.host.innerHTML = `
      <section class="pi-control${POINT_INTELLIGENCE_UI_ENABLED ? '' : ' pi-control--disabled'}" id="spatial-point-intelligence-control" aria-label="Point Intelligence">
        <div class="pi-control__head">
          <h3 class="pi-control__title">Point Intelligence</h3>
          <label class="pi-control__toggle">
            <input type="checkbox" id="spatial-pi-mode" ${POINT_INTELLIGENCE_UI_ENABLED ? '' : 'disabled'} />
            <span>Enable map click</span>
          </label>
        </div>
        <div class="pi-control__families pi-control__families--readonly" id="spatial-pi-families">
          <p class="pi-control__legend">Verified information families</p>
          <ul class="pi-control__family-list">${groupList}</ul>
        </div>
        <p class="pi-control__hint" id="spatial-pi-hint">Off — map clicks use normal feature selection.</p>
        <p class="pi-control__status" id="spatial-pi-status" hidden></p>
      </section>
    `;
    this.modeInput = this.host.querySelector('#spatial-pi-mode');
    this.hintEl = this.host.querySelector('#spatial-pi-hint');
    this.statusEl = this.host.querySelector('#spatial-pi-status');
  }

  bind() {
    this.modeInput?.addEventListener('change', () => {
      const enabled = Boolean(this.modeInput?.checked);
      setPointIntelligenceModeEnabled(enabled);
      this.onModeChange?.(enabled);
      this.updateHint(enabled);
    });
  }

  updateHint(enabled) {
    if (!this.hintEl) return;
    this.hintEl.textContent = enabled
      ? 'On — click the map to query all verified information families at that location.'
      : 'Off — map clicks use normal feature selection.';
  }

  sync(state) {
    const enabled = state?.modeEnabled ?? isPointIntelligenceModeEnabled();
    if (this.modeInput) this.modeInput.checked = enabled;
    this.updateHint(enabled);
    const response = state?.lastResponse;
    const presentation = response?.queryState === 'QUERYING' || state?.queryPhase === 'QUERYING'
      ? formatPointIntelligenceStatus('QUERYING')
      : getPointIntelligencePresentation(response);
    if (this.statusEl) {
      if (!presentation.message) {
        this.statusEl.hidden = true;
        this.statusEl.textContent = '';
      } else {
        this.statusEl.hidden = false;
        this.statusEl.textContent = presentation.message;
        this.statusEl.dataset.severity = presentation.severity;
      }
    }
  }

  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
