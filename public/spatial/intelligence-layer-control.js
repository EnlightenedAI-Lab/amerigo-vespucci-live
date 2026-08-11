/**
 * Intelligence Layers panel — compact permanent research controls.
 */
import {
  INTELLIGENCE_LAYER_CONCEPTS,
  TIME_WINDOWS,
  TIME_WINDOW_LABELS,
  DEFAULT_GEOGRAPHY,
  EXECUTION_STATE
} from './intelligence-layer-config.js';
import {
  runIntelligenceLayerResearch,
  refreshIntelligenceLayer,
  removeIntelligenceLayer,
  toggleIntelligenceLayer,
  zoomToIntelligenceLayer,
  subscribeIntelligenceLayersState
} from './intelligence-layer-service.js';

export class IntelligenceLayersControl {
  /** @param {HTMLElement} host */
  constructor(host, options = {}) {
    this.host = host;
    this.onResult = options.onResult || null;
    this.onError = options.onError || null;
    this.appShell = options.appShell || null;
    this.timeWindow = TIME_WINDOWS.DAYS_7;
    this.geography = DEFAULT_GEOGRAPHY;
    this.unsubscribe = null;
    this.render();
    this.bind();
    this.unsubscribe = subscribeIntelligenceLayersState((state) => this.renderActiveLayers(state));
  }

  render() {
    if (!this.host) return;
    this.host.innerHTML = `
      <section class="intel-layers" aria-label="Intelligence layers">
        <h3 class="intel-layers__title">Intelligence layers</h3>
        <div class="intel-layers__controls">
          <label class="intel-layers__field">
            <span class="intel-layers__label">Time</span>
            <select id="intel-layers-time" class="intel-layers__select">
              ${Object.entries(TIME_WINDOW_LABELS).map(([value, label]) => (
    `<option value="${value}" ${value === this.timeWindow ? 'selected' : ''}>${label}</option>`
  )).join('')}
            </select>
          </label>
          <p class="intel-layers__geo" id="intel-layers-geo">${DEFAULT_GEOGRAPHY}</p>
        </div>
        <div class="intel-layers__concepts" id="intel-layers-concepts">
          ${INTELLIGENCE_LAYER_CONCEPTS.map((c) => (
    `<button type="button" class="intel-layers__concept" data-intel-concept="${c.id}">${c.label}</button>`
  )).join('')}
        </div>
        <p class="intel-layers__status" id="intel-layers-status" hidden></p>
        <div class="intel-layers__active" id="intel-layers-active"></div>
        <div class="intel-layers__unresolved" id="intel-layers-unresolved" hidden></div>
      </section>`;
    this.timeSelect = this.host.querySelector('#intel-layers-time');
    this.statusEl = this.host.querySelector('#intel-layers-status');
    this.activeEl = this.host.querySelector('#intel-layers-active');
    this.unresolvedEl = this.host.querySelector('#intel-layers-unresolved');
  }

  bind() {
    this.host?.addEventListener('click', (event) => {
      const conceptBtn = event.target.closest('[data-intel-concept]');
      if (conceptBtn) {
        void this.runConcept(conceptBtn.dataset.intelConcept);
        return;
      }
      const refreshBtn = event.target.closest('[data-intel-refresh]');
      if (refreshBtn) {
        void this.handleRefresh(refreshBtn.dataset.intelRefresh);
        return;
      }
      const removeBtn = event.target.closest('[data-intel-remove]');
      if (removeBtn) {
        void this.handleRemove(removeBtn.dataset.intelRemove);
        return;
      }
      const zoomBtn = event.target.closest('[data-intel-zoom]');
      if (zoomBtn) {
        void zoomToIntelligenceLayer(zoomBtn.dataset.intelZoom);
      }
    });
    this.host?.addEventListener('change', (event) => {
      const input = event.target;
      if (input?.matches('[data-intel-visible]')) {
        void toggleIntelligenceLayer(input.dataset.intelVisible, input.checked);
      }
      if (input?.id === 'intel-layers-time') {
        this.timeWindow = input.value;
      }
    });
  }

  setStatus(message, kind = 'info') {
    if (!this.statusEl) return;
    this.statusEl.hidden = !message;
    this.statusEl.textContent = message || '';
    this.statusEl.dataset.kind = kind;
  }

  setBusy(busy, message = 'Researching intelligence…') {
    const buttons = this.host?.querySelectorAll('.intel-layers__concept') || [];
    for (const btn of buttons) btn.disabled = busy;
    if (this.timeSelect) this.timeSelect.disabled = busy;
    if (busy) this.setStatus(message, 'researching');
  }

  async runConcept(conceptId) {
    if (!conceptId) return;
    this.setBusy(true);
    try {
      const { isProgressiveIntelligenceV1Enabled } = await import('../orchestrator/orchestrator-config.js');
      const { runProgressiveIntelligenceCommand } = await import('../orchestrator/progressive-orchestrator-client.js');
      const { buildIntelligenceRequestFromIntent } = await import('./intelligence-layer-intent.js');
      if (isProgressiveIntelligenceV1Enabled()) {
        const request = buildIntelligenceRequestFromIntent({
          conceptId,
          geography: this.geography,
          timeWindow: this.timeWindow
        });
        const result = await runProgressiveIntelligenceCommand(request, {
          appShell: this.appShell
        });
        const kind = result.mappedCount > 0 ? 'success' : 'degraded';
        this.setStatus(result.message, kind);
        this.onResult?.(result);
        return;
      }
      const result = await runIntelligenceLayerResearch({
        conceptId,
        geography: this.geography,
        timeWindow: this.timeWindow
      }, { allowUngovernedLiveMap: true });
      const kind = result.state === EXECUTION_STATE.DEGRADED ? 'degraded' : 'success';
      this.setStatus(result.message, kind);
      this.onResult?.(result);
    } catch (error) {
      this.setStatus(error?.message || 'Intelligence research failed.', 'error');
      this.onError?.(error);
    } finally {
      this.setBusy(false);
    }
  }

  async handleRefresh(layerId) {
    if (!layerId) return;
    this.setBusy(true, 'Refreshing intelligence…');
    try {
      const result = await refreshIntelligenceLayer(layerId);
      this.setStatus(result.message, result.state === EXECUTION_STATE.DEGRADED ? 'degraded' : 'success');
      this.onResult?.(result);
    } catch (error) {
      this.setStatus(error?.message || 'Refresh failed.', 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async handleRemove(layerId) {
    if (!layerId) return;
    await removeIntelligenceLayer(layerId);
    this.setStatus('Intelligence layer removed.', 'info');
  }

  renderActiveLayers(state = {}) {
    const layers = state.layers || [];
    const researching = state.activeResearch?.state === EXECUTION_STATE.RESEARCHING;

    if (researching && !this.statusEl?.textContent) {
      this.setStatus('Researching intelligence…', 'researching');
    }

    if (!this.activeEl) return;
    if (!layers.length) {
      this.activeEl.innerHTML = '<p class="intel-layers__empty">No active intelligence layers.</p>';
      if (this.unresolvedEl) this.unresolvedEl.hidden = true;
      return;
    }

    this.activeEl.innerHTML = layers.map((entry) => {
      const n = entry.normalized;
      const title = n?.layerTitle || entry.request?.query || 'Intelligence layer';
      const total = n?.totalEvents ?? 0;
      const mapped = n?.mappedCount ?? 0;
      const unresolved = n?.unresolvedCount ?? 0;
      const refreshed = entry.lastRefreshedAt
        ? new Date(entry.lastRefreshedAt).toLocaleString()
        : '—';
      return `
        <article class="intel-layer-row" data-intel-layer-id="${entry.layerId}">
          <label class="intel-layer-row__head">
            <input type="checkbox" data-intel-visible="${entry.layerId}" checked />
            <span class="intel-layer-row__title">${escapeHtml(title)}</span>
          </label>
          <p class="intel-layer-row__meta">${total} event${total === 1 ? '' : 's'} · ${mapped} mapped · ${unresolved} unresolved</p>
          <p class="intel-layer-row__meta">${escapeHtml(n?.timeLabel || '')} · refreshed ${escapeHtml(refreshed)}</p>
          <div class="intel-layer-row__actions">
            <button type="button" data-intel-zoom="${entry.layerId}" title="Zoom to layer">↗</button>
            <button type="button" data-intel-refresh="${entry.layerId}" title="Refresh">↻</button>
            <button type="button" data-intel-remove="${entry.layerId}" title="Remove">×</button>
          </div>
        </article>`;
    }).join('');

    const latest = layers[layers.length - 1]?.normalized;
    if (latest?.unresolvedEvents?.length && this.unresolvedEl) {
      this.unresolvedEl.hidden = false;
      this.unresolvedEl.innerHTML = `
        <h4 class="intel-layers__unresolved-title">Location unresolved (${latest.unresolvedCount})</h4>
        <ul class="intel-layers__unresolved-list">
          ${latest.unresolvedEvents.slice(0, 8).map((e) => (
    `<li><strong>${escapeHtml(e.title || 'Event')}</strong>${e.locationText ? ` — ${escapeHtml(e.locationText)}` : ''}</li>`
  )).join('')}
        </ul>`;
    } else if (this.unresolvedEl) {
      this.unresolvedEl.hidden = true;
    }
  }

  destroy() {
    this.unsubscribe?.();
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function mountIntelligenceLayersControl(host, options = {}) {
  if (!host) return null;
  return new IntelligenceLayersControl(host, options);
}
