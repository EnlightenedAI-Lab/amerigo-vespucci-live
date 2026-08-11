/**
 * Reliability / Trust top bar — compact header presentation of latest AI Map run.
 */
import {
  buildReliabilityTopBarModel,
  shouldApplyReceiptUpdate
} from './reliability-top-bar-model.js';
import { getGovernedEventStoreSnapshot } from './governed-event-store.js';

const RECEIPT_PATH = '/api/spatial/ai-map/last-receipt';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ReliabilityTopBar {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    this.receipt = null;
    this.context = 'INTELLIGENCE';
    this.detailOpen = false;
    this.onReceiptUpdated = this.onReceiptUpdated.bind(this);
    this.onContextUpdated = this.onContextUpdated.bind(this);
    this.onClear = this.onClear.bind(this);
    this.onHostClick = (event) => {
      if (event.target.closest('.reliability-top-bar__trigger')) {
        this.detailOpen = !this.detailOpen;
        this.render();
      }
    };
    this.host.addEventListener('click', this.onHostClick);
    window.addEventListener('iqai-ai-map-receipt-updated', this.onReceiptUpdated);
    window.addEventListener('iqai-reliability-context', this.onContextUpdated);
    window.addEventListener('iqai-reliability-clear', this.onClear);
    void this.refreshFromServer();
  }

  onReceiptUpdated(event) {
    const receipt = event?.detail?.receipt || event?.detail || null;
    if (!receipt || !shouldApplyReceiptUpdate(receipt, this.receipt)) return;
    this.receipt = receipt;
    this.context = 'INTELLIGENCE';
    this.render();
  }

  onContextUpdated(event) {
    const context = event?.detail?.context || 'INTELLIGENCE';
    this.context = context;
    this.render();
  }

  onClear() {
    this.receipt = null;
    this.context = 'INTELLIGENCE';
    this.render();
  }

  async refreshFromServer() {
    try {
      const response = await fetch(RECEIPT_PATH, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (body?.ok && body.receipt && shouldApplyReceiptUpdate(body.receipt, this.receipt)) {
        this.receipt = body.receipt;
        this.render();
      }
    } catch {
      /* ignore */
    }
  }

  getGovernedLookup() {
    if (typeof window === 'undefined') return {};
    return getGovernedEventStoreSnapshot();
  }

  buildModel() {
    return buildReliabilityTopBarModel({
      receipt: this.receipt,
      context: this.context,
      governedLookup: this.getGovernedLookup()
    });
  }

  render() {
    if (!this.host) return;
    const model = this.buildModel();
    if (typeof window !== 'undefined') {
      window.__IQAI_RELIABILITY_TOP_BAR__ = model;
    }
    if (!model.visible) {
      this.host.hidden = true;
      this.host.innerHTML = '';
      return;
    }

    this.host.hidden = false;
    const pills = (model.pills || []).map((pill) => {
      const tone = pill.tone ? ` reliability-top-bar__pill--${pill.tone}` : '';
      return `<span class="reliability-top-bar__pill${tone}" title="${escapeHtml(pill.key)}"><span class="reliability-top-bar__pill-key">${escapeHtml(pill.key)}</span><span class="reliability-top-bar__pill-value">${escapeHtml(pill.value)}</span></span>`;
    }).join('<span class="reliability-top-bar__sep" aria-hidden="true">|</span>');

    const detailRows = (model.detail?.rows || []).map((row) => (
      `<div class="reliability-top-bar__detail-row"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`
    )).join('');

    this.host.innerHTML = `
      <div class="reliability-top-bar" role="status" aria-live="polite">
        <button type="button" class="reliability-top-bar__trigger" aria-expanded="${this.detailOpen ? 'true' : 'false'}">
          ${pills}
        </button>
        <div class="reliability-top-bar__detail${this.detailOpen ? ' is-open' : ''}" hidden="${this.detailOpen ? 'false' : 'true'}">
          <div class="reliability-top-bar__detail-title">${escapeHtml(model.detail?.title || 'RELIABILITY')}</div>
          ${detailRows}
        </div>
      </div>`;
  }

  destroy() {
    this.host?.removeEventListener('click', this.onHostClick);
    window.removeEventListener('iqai-ai-map-receipt-updated', this.onReceiptUpdated);
    window.removeEventListener('iqai-reliability-context', this.onContextUpdated);
    window.removeEventListener('iqai-reliability-clear', this.onClear);
  }
}

/**
 * @param {HTMLElement} host
 */
export function mountReliabilityTopBar(host) {
  if (!host) return null;
  return new ReliabilityTopBar(host);
}

export function publishReliabilityContext(context) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('iqai-reliability-context', { detail: { context } }));
}

export function publishReliabilityClear() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('iqai-reliability-clear'));
}

export function publishAiMapReceiptUpdated(receipt) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('iqai-ai-map-receipt-updated', { detail: { receipt } }));
}
