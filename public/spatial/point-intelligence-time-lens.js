/**
 * Time Lens UI — compact temporal mode control for Point Intelligence.
 */
import { PI_TIME_MODE } from './point-intelligence-temporal-state.js';
import {
  formatTemporalStateSummary,
  getPointIntelligenceTemporalState,
  localDateTimeInputToUtcIso,
  setPointIntelligenceTemporalState,
  subscribePointIntelligenceTemporalState,
  toLocalDateTimeInputValue
} from './point-intelligence-temporal-state.js';
import {
  getPointIntelligenceTemporalSupportModel,
  getTemporalSupportLevel,
  TEMPORAL_SUPPORT
} from './point-intelligence-temporal-support.js';
import { getUnsupportedTemporalMessage } from './point-intelligence-temporal-gate.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function supportLabel(mode) {
  const level = getTemporalSupportLevel(mode);
  if (level === TEMPORAL_SUPPORT.SUPPORTED_NOW) return 'Supported now';
  if (level === TEMPORAL_SUPPORT.FUTURE_READY) return 'Future-ready';
  return 'Not applicable';
}

export class PointIntelligenceTimeLens {
  /** @param {HTMLElement} host */
  constructor(host, options = {}) {
    this.host = host;
    this.compact = Boolean(options.compact);
    this.unsubscribe = null;
    this.expanded = false;
    this.render();
    this.bind();
    this.unsubscribe = subscribePointIntelligenceTemporalState((state) => this.sync(state));
    this.sync(getPointIntelligenceTemporalState());
  }

  render() {
    if (!this.host) return;
    this.host.innerHTML = `
      <section class="pi-time-lens${this.compact ? ' pi-time-lens--compact' : ''}"
        id="spatial-time-lens" aria-label="Time Lens">
        <button type="button" class="pi-time-lens__trigger" data-pi-time-lens-toggle aria-expanded="false">
          <span class="pi-time-lens__label" data-pi-time-lens-headline>TIME · LATEST</span>
          <span class="pi-time-lens__detail" data-pi-time-lens-detail>Latest available evidence</span>
        </button>
        <div class="pi-time-lens__panel" data-pi-time-lens-panel hidden>
          <div class="pi-time-lens__modes" role="radiogroup" aria-label="Temporal mode">
            <label class="pi-time-lens__mode">
              <input type="radio" name="pi-time-mode" value="LATEST" checked />
              <span>LATEST</span>
              <em>${escapeHtml(supportLabel(PI_TIME_MODE.LATEST))}</em>
            </label>
            <label class="pi-time-lens__mode">
              <input type="radio" name="pi-time-mode" value="AT" />
              <span>AT</span>
              <em>${escapeHtml(supportLabel(PI_TIME_MODE.AT))}</em>
            </label>
            <label class="pi-time-lens__mode">
              <input type="radio" name="pi-time-mode" value="RANGE" />
              <span>RANGE</span>
              <em>${escapeHtml(supportLabel(PI_TIME_MODE.RANGE))}</em>
            </label>
          </div>
          <div class="pi-time-lens__inputs" data-pi-time-lens-at hidden>
            <label class="pi-time-lens__field">
              <span>Reference instant</span>
              <input type="datetime-local" data-pi-time-at />
            </label>
          </div>
          <div class="pi-time-lens__inputs" data-pi-time-lens-range hidden>
            <label class="pi-time-lens__field">
              <span>Start</span>
              <input type="datetime-local" data-pi-time-range-start />
            </label>
            <label class="pi-time-lens__field">
              <span>End</span>
              <input type="datetime-local" data-pi-time-range-end />
            </label>
          </div>
          <p class="pi-time-lens__validation" data-pi-time-lens-validation hidden></p>
          <p class="pi-time-lens__support" data-pi-time-lens-support hidden></p>
        </div>
      </section>`;

    this.triggerEl = this.host.querySelector('[data-pi-time-lens-toggle]');
    this.panelEl = this.host.querySelector('[data-pi-time-lens-panel]');
    this.headlineEl = this.host.querySelector('[data-pi-time-lens-headline]');
    this.detailEl = this.host.querySelector('[data-pi-time-lens-detail]');
    this.validationEl = this.host.querySelector('[data-pi-time-lens-validation]');
    this.supportEl = this.host.querySelector('[data-pi-time-lens-support]');
    this.atPanel = this.host.querySelector('[data-pi-time-lens-at]');
    this.rangePanel = this.host.querySelector('[data-pi-time-lens-range]');
    this.atInput = this.host.querySelector('[data-pi-time-at]');
    this.rangeStartInput = this.host.querySelector('[data-pi-time-range-start]');
    this.rangeEndInput = this.host.querySelector('[data-pi-time-range-end]');
    this.modeInputs = [...this.host.querySelectorAll('input[name="pi-time-mode"]')];
  }

  bind() {
    this.triggerEl?.addEventListener('click', () => {
      this.expanded = !this.expanded;
      if (this.panelEl) this.panelEl.hidden = !this.expanded;
      this.triggerEl?.setAttribute('aria-expanded', String(this.expanded));
    });

    for (const input of this.modeInputs) {
      input.addEventListener('change', () => this.applyMode(input.value));
    }

    this.atInput?.addEventListener('change', () => this.applyAt());
    this.rangeStartInput?.addEventListener('change', () => this.applyRange());
    this.rangeEndInput?.addEventListener('change', () => this.applyRange());
  }

  applyMode(mode) {
    const current = getPointIntelligenceTemporalState();
    if (mode === PI_TIME_MODE.LATEST) {
      setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST, displayTimezone: current.displayTimezone });
      return;
    }
    if (mode === PI_TIME_MODE.AT) {
      const local = this.atInput?.value
        || toLocalDateTimeInputValue(current.at, current.displayTimezone)
        || '2026-08-03T21:00';
      if (this.atInput) this.atInput.value = local;
      const at = localDateTimeInputToUtcIso(local, current.displayTimezone);
      setPointIntelligenceTemporalState({
        mode: PI_TIME_MODE.AT,
        at,
        displayTimezone: current.displayTimezone
      });
      return;
    }
    if (mode === PI_TIME_MODE.RANGE) {
      const startLocal = this.rangeStartInput?.value
        || toLocalDateTimeInputValue(current.rangeStart, current.displayTimezone)
        || '2026-08-03T21:00';
      const endLocal = this.rangeEndInput?.value
        || toLocalDateTimeInputValue(current.rangeEnd, current.displayTimezone)
        || '2026-08-04T06:00';
      if (this.rangeStartInput) this.rangeStartInput.value = startLocal;
      if (this.rangeEndInput) this.rangeEndInput.value = endLocal;
      setPointIntelligenceTemporalState({
        mode: PI_TIME_MODE.RANGE,
        rangeStart: localDateTimeInputToUtcIso(startLocal, current.displayTimezone),
        rangeEnd: localDateTimeInputToUtcIso(endLocal, current.displayTimezone),
        displayTimezone: current.displayTimezone
      });
    }
  }

  applyAt() {
    const current = getPointIntelligenceTemporalState();
    const local = this.atInput?.value;
    setPointIntelligenceTemporalState({
      mode: PI_TIME_MODE.AT,
      at: localDateTimeInputToUtcIso(local, current.displayTimezone),
      displayTimezone: current.displayTimezone
    });
  }

  applyRange() {
    const current = getPointIntelligenceTemporalState();
    setPointIntelligenceTemporalState({
      mode: PI_TIME_MODE.RANGE,
      rangeStart: localDateTimeInputToUtcIso(this.rangeStartInput?.value, current.displayTimezone),
      rangeEnd: localDateTimeInputToUtcIso(this.rangeEndInput?.value, current.displayTimezone),
      displayTimezone: current.displayTimezone
    });
  }

  sync(state) {
    const summary = formatTemporalStateSummary(state);
    if (this.headlineEl) this.headlineEl.textContent = summary.headline;
    if (this.detailEl) this.detailEl.textContent = summary.detail;

    for (const input of this.modeInputs) {
      input.checked = input.value === state.mode;
    }

    if (this.atPanel) this.atPanel.hidden = state.mode !== PI_TIME_MODE.AT;
    if (this.rangePanel) this.rangePanel.hidden = state.mode !== PI_TIME_MODE.RANGE;

    if (state.mode === PI_TIME_MODE.AT && this.atInput && state.at) {
      this.atInput.value = toLocalDateTimeInputValue(state.at, state.displayTimezone);
    }
    if (state.mode === PI_TIME_MODE.RANGE) {
      if (this.rangeStartInput && state.rangeStart) {
        this.rangeStartInput.value = toLocalDateTimeInputValue(state.rangeStart, state.displayTimezone);
      }
      if (this.rangeEndInput && state.rangeEnd) {
        this.rangeEndInput.value = toLocalDateTimeInputValue(state.rangeEnd, state.displayTimezone);
      }
    }

    if (this.validationEl) {
      if (!state.valid && state.validationMessage) {
        this.validationEl.hidden = false;
        this.validationEl.textContent = state.validationMessage;
      } else {
        this.validationEl.hidden = true;
        this.validationEl.textContent = '';
      }
    }

    const support = getPointIntelligenceTemporalSupportModel();
    const unsupported = state.mode !== PI_TIME_MODE.LATEST
      && support[state.mode] === TEMPORAL_SUPPORT.FUTURE_READY;
    if (this.supportEl) {
      if (unsupported) {
        this.supportEl.hidden = false;
        this.supportEl.textContent = getUnsupportedTemporalMessage();
      } else {
        this.supportEl.hidden = true;
        this.supportEl.textContent = '';
      }
    }
  }

  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export function mountPointIntelligenceTimeLens(host, options) {
  if (!host) return null;
  return new PointIntelligenceTimeLens(host, options);
}
