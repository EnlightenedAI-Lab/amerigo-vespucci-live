/**
 * IQAI Deterministic Trust / Fidelity Strip — operator instrument panel.
 */
import { subscribeFidelitySelection, FIDELITY_SELECTION_MODES } from './fidelity-selection-hub.js';
import { subscribeIntelligenceLayersState } from './intelligence-layer-service.js';
import {
  buildFidelityStripModel,
  buildIntegrityAssessTarget,
  CARD_KEYS
} from './fidelity-strip-model.js';
import { getGovernedEvent } from './governed-event-store.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchIntegrityAssessment(governed) {
  if (!governed) return null;
  const target = buildIntegrityAssessTarget(governed);
  if (!target?.eventId) return null;
  try {
    const res = await fetch('/api/spatial/intelligence/evidence-integrity/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [target], batch: false })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return null;
    return body.assessments?.[0] || null;
  } catch {
    return null;
  }
}

export class FidelityStrip {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    this.selection = { mode: FIDELITY_SELECTION_MODES.NONE };
    this.layerState = null;
    this.integrityCache = new Map();
    this.pendingIntegrityKey = null;
    this.unsubSelection = subscribeFidelitySelection((selection) => {
      this.selection = selection;
      void this.render();
    });
    this.unsubLayers = subscribeIntelligenceLayersState((state) => {
      this.layerState = state;
      if (this.selection.mode === FIDELITY_SELECTION_MODES.RUN_LAYER) {
        void this.render();
      } else if (this.selection.mode === FIDELITY_SELECTION_MODES.NONE && (state.layers || []).length) {
        publishRunLayerIfIdle(this);
      }
    });
  }

  destroy() {
    this.unsubSelection?.();
    this.unsubLayers?.();
  }

  async render() {
    if (!this.host) return;
    let integrityAssessment = null;
    const eventId = this.selection.eventId || this.selection.attributes?.eventId;
    if (this.selection.mode === FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT && eventId) {
      const cacheKey = eventId;
      if (this.integrityCache.has(cacheKey)) {
        integrityAssessment = this.integrityCache.get(cacheKey);
      } else if (this.pendingIntegrityKey !== cacheKey) {
        this.pendingIntegrityKey = cacheKey;
        const governed = getGovernedEvent(eventId);
        integrityAssessment = await fetchIntegrityAssessment(governed);
        if (integrityAssessment) this.integrityCache.set(cacheKey, integrityAssessment);
        this.pendingIntegrityKey = null;
        if (this.selection.eventId !== eventId && this.selection.attributes?.eventId !== eventId) return;
      }
    }

    const model = buildFidelityStripModel({
      selection: this.selection,
      layerState: this.layerState,
      integrityAssessment
    });

    if (!model.visible) {
      this.host.hidden = true;
      this.host.innerHTML = '';
      return;
    }

    this.host.hidden = false;
    const cards = model.cards || {};
    const cardHtml = CARD_KEYS.map((key) => {
      const card = cards[key] || { primary: '—', secondary: null };
      const tone = key === 'ADMISSION' && card.primary === 'HOLD' ? ' is-hold'
        : key === 'ADMISSION' && card.primary === 'REJECT' ? ' is-reject'
          : key === 'INTEGRITY' && card.primary !== 'NOT ASSESSED' ? ' is-integrity'
            : '';
      return `
        <button type="button" class="fidelity-strip__card${tone}" data-fidelity-card="${key}" title="${escapeHtml(card.secondary || key)}">
          <span class="fidelity-strip__label">${key}</span>
          <span class="fidelity-strip__value">${escapeHtml(card.primary)}</span>
          ${card.secondary ? `<span class="fidelity-strip__sub">${escapeHtml(card.secondary)}</span>` : ''}
        </button>`;
    }).join('');

    this.host.innerHTML = `
      <div class="fidelity-strip" role="region" aria-label="IQAI deterministic fidelity" data-fidelity-mode="${escapeHtml(model.mode)}">
        <div class="fidelity-strip__cards">${cardHtml}</div>
        ${model.epistemicBanner ? `<p class="fidelity-strip__epistemic">${escapeHtml(model.epistemicBanner)}</p>` : ''}
      </div>`;

    if (typeof window !== 'undefined') {
      window.__IQAI_FIDELITY_STRIP__ = model;
    }
  }
}

function publishRunLayerIfIdle(strip) {
  if (strip.selection.mode !== FIDELITY_SELECTION_MODES.NONE) return;
  const layers = strip.layerState?.layers || [];
  if (!layers.length) return;
  import('./fidelity-selection-hub.js').then(({ publishFidelitySelection, FIDELITY_SELECTION_MODES: MODES }) => {
    publishFidelitySelection({ mode: MODES.RUN_LAYER });
  });
}

/**
 * @param {HTMLElement} host
 */
export function mountFidelityStrip(host) {
  if (!host) return null;
  return new FidelityStrip(host);
}

export async function runFidelityStripSelfTest() {
  const { publishFidelitySelection, clearFidelitySelection, FIDELITY_SELECTION_MODES: MODES } = await import('./fidelity-selection-hub.js');
  const { registerGovernedEvent } = await import('./governed-event-store.js');
  registerGovernedEvent('self-test', {
    admissionDecision: {
      outcome: 'ADMIT',
      reasonCodes: ['ADMITTED'],
      sourceFacts: { sourceIntelligenceClass: 'EDITORIAL_NEWS', isOfficial: false },
      spatialFacts: { locationPrecision: 'EXACT_PLACE', spatialConflict: false, geometryProvided: true },
      temporalFacts: { occurrenceKnown: true, occurredAt: '2026-08-01T03:00:00Z', publishedAt: '2026-08-01T08:00:00Z' },
      evidenceLineageFacts: { corroborationSummary: 'SINGLE_LINEAGE', lineageCount: 1, independentLineageCount: 1, sourceReportCount: 1 }
    },
    candidate: { eventId: 'self-test', title: 'Self test' }
  });
  publishFidelitySelection({ mode: MODES.INTELLIGENCE_EVENT, eventId: 'self-test', attributes: { eventId: 'self-test', iqaiFidelityPlane: 'INTELLIGENCE' } });
  await new Promise((r) => setTimeout(r, 100));
  const model = typeof window !== 'undefined' ? window.__IQAI_FIDELITY_STRIP__ : null;
  clearFidelitySelection();
  return {
    ok: Boolean(model?.visible && model?.cards?.ADMISSION?.primary === 'ADMIT'),
    model
  };
}

if (typeof window !== 'undefined') {
  window.__IQAI_RUN_FIDELITY_STRIP_SELF_TEST__ = runFidelityStripSelfTest;
}
