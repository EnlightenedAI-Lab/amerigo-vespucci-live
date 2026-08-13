/**
 * Compact Point Intelligence analyst control — Point | Auto area | Draw area.
 */
import {
  POINT_INTELLIGENCE_UI_ENABLED,
  POINT_INTELLIGENCE_FAMILY_GROUPS
} from './point-intelligence-config.js';
import {
  getPointIntelligenceAcquisitionMode,
  getPointIntelligencePresentation,
  isPointIntelligenceModeEnabled,
  setPointIntelligenceAcquisitionMode,
  setPointIntelligenceModeEnabled,
  subscribePointIntelligenceState
} from './point-intelligence-service.js';
import { formatPointIntelligenceStatus } from './point-intelligence-status.js';
import {
  clearAcquisition,
  redraw,
  setDrawTool,
  startDraw
} from './point-intelligence-area-controller.js';

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
            <span>Enable</span>
          </label>
        </div>
        <div class="pi-control__modes" role="group" aria-label="Acquisition mode">
          <button type="button" class="pi-control__mode" data-pi-acq="POINT">Point</button>
          <button type="button" class="pi-control__mode" data-pi-acq="AUTO">Auto area</button>
          <button type="button" class="pi-control__mode" data-pi-acq="AREA">Draw area</button>
        </div>
        <div class="pi-control__area" id="spatial-pi-area" hidden>
          <div class="pi-control__tools" role="group" aria-label="Draw tool">
            <button type="button" class="pi-control__tool is-active" data-pi-draw="polygon">Polygon</button>
            <button type="button" class="pi-control__tool" data-pi-draw="rectangle">Rectangle</button>
          </div>
          <div class="pi-control__actions">
            <button type="button" class="pi-control__action" data-pi-area="draw">Draw</button>
            <button type="button" class="pi-control__action" data-pi-area="redraw">Redraw</button>
          </div>
        </div>
        <div class="pi-control__actions" id="spatial-pi-clear-row">
          <button type="button" class="pi-control__action" data-pi-area="clear">Clear</button>
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
    this.areaEl = this.host.querySelector('#spatial-pi-area');
  }

  bind() {
    this.modeInput?.addEventListener('change', () => {
      const enabled = Boolean(this.modeInput?.checked);
      setPointIntelligenceModeEnabled(enabled);
      this.onModeChange?.(enabled);
      this.updateHint(enabled, getPointIntelligenceAcquisitionMode());
    });
    this.host?.addEventListener('click', (event) => {
      const acq = event.target?.closest?.('[data-pi-acq]');
      if (acq) {
        setPointIntelligenceAcquisitionMode(acq.getAttribute('data-pi-acq'));
        this.sync();
        return;
      }
      const tool = event.target?.closest?.('[data-pi-draw]');
      if (tool) {
        setDrawTool(tool.getAttribute('data-pi-draw'));
        this.host.querySelectorAll('[data-pi-draw]').forEach((button) => {
          button.classList.toggle('is-active', button === tool);
        });
        return;
      }
      const action = event.target?.closest?.('[data-pi-area]');
      if (!action) return;
      const name = action.getAttribute('data-pi-area');
      if (name === 'draw') void startDraw();
      if (name === 'redraw') void redraw();
      if (name === 'clear') void clearAcquisition();
    });
  }

  updateHint(enabled, acquisitionMode = getPointIntelligenceAcquisitionMode()) {
    if (!this.hintEl) return;
    if (!enabled) {
      this.hintEl.textContent = 'Off — map clicks use normal feature selection.';
      return;
    }
    this.hintEl.textContent = acquisitionMode === 'AREA'
      ? 'Draw area — optional analyst polygon. Primary path is Auto area.'
      : acquisitionMode === 'POINT'
        ? 'Point — click the map to query verified families at that location.'
        : 'Auto area — click the map. IQAI maps evidence at true coordinates and draws the acquisition footprint.';
  }

  sync(state) {
    const enabled = state?.modeEnabled ?? isPointIntelligenceModeEnabled();
    const acquisitionMode = state?.acquisitionMode ?? getPointIntelligenceAcquisitionMode();
    if (this.modeInput) this.modeInput.checked = enabled;
    if (this.areaEl) this.areaEl.hidden = !enabled || acquisitionMode !== 'AREA';
    this.host?.querySelectorAll('[data-pi-acq]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-pi-acq') === acquisitionMode);
      button.disabled = !enabled;
    });
    this.updateHint(enabled, acquisitionMode);
    const response = state?.lastResponse;
    const presentation = !response
      ? formatPointIntelligenceStatus('IDLE')
      : (response?.queryState === 'QUERYING' || state?.queryPhase === 'QUERYING'
        ? formatPointIntelligenceStatus('QUERYING')
        : getPointIntelligencePresentation(response));
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
