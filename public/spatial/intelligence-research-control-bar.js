/**
 * Compact evidence / research control bar above the map.
 */
import { subscribeIntelligenceLayersState } from './intelligence-layer-service.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function providerLabel(active) {
  const labels = [];
  if (active.gemini) labels.push('GEMINI');
  if (active.openai) labels.push('GPT');
  if (active.grok) labels.push('GROK');
  if (active.iqai) labels.push('IQAI');
  return labels.length ? labels.join(' · ') : '—';
}

function analysisLabel(audit) {
  if (audit.deepseekInvoked) return 'DEEPSEEK';
  return '—';
}

function provenanceLabel(raw, normalized) {
  const reports = (normalized?.events || []).flatMap((event) => event.sourceReports || []);
  if (!reports.length) return 'NONE';
  const hasLive = reports.some((report) => report.evidenceOrigin === 'live' || report.documentId);
  const hasCorpus = reports.some((report) => report.observationId || report.evidenceOrigin === 'corpus');
  if (hasLive && hasCorpus) return 'PARTIAL';
  if (reports.length > 0) return 'COMPLETE';
  return 'PARTIAL';
}

function retrievalLabel(raw, normalized, audit) {
  if (!normalized) return 'IDLE';
  const liveSearch = audit.googleSearchInvoked || audit.webSearchInvoked || audit.xSearchInvoked;
  if (!liveSearch) return 'CORPUS ONLY';
  if ((normalized.totalEvents || 0) > 0) return 'SUCCESS';
  return 'PARTIAL';
}

function coverageLabel(raw, normalized, audit) {
  if (!normalized) return 'IDLE';
  const liveSearch = audit.googleSearchInvoked || audit.webSearchInvoked || audit.xSearchInvoked;
  if (liveSearch) return 'OPEN WEB · NON-EXHAUSTIVE';
  if (normalized.state === 'degraded') return 'PARTIAL';
  if ((normalized.totalEvents || 0) > 0) return 'CORPUS';
  return 'PARTIAL';
}

/**
 * @param {object} state
 */
export function buildResearchControlBarModel(state = {}) {
  const latest = (state.layers || []).at(-1);
  const normalized = latest?.normalized || null;
  const raw = latest?.raw || null;
  const audit = normalized?.researchAudit || raw?.researchAudit || {};
  const temporalGate = normalized?.temporalGate || raw?.temporalGate || null;
  const consolidation = raw?.researchConsolidation || null;
  const performance = raw?.researchPerformance || normalized?.researchPerformance || null;
  const dispositions = consolidation?.reportDispositions || null;

  return {
    active: Boolean(latest),
    layerTitle: normalized?.layerTitle || null,
    research: {
      mode: audit.execution || audit.mode || raw?.contract?.mode || 'IDLE',
      providers: providerLabel({
        openai: audit.openaiInvoked === true,
        gemini: audit.geminiInvoked === true,
        grok: audit.grokInvoked === true,
        iqai: audit.iqaiCorpusInvoked === true
      })
    },
    analysis: analysisLabel(audit),
    evidence: {
      reports: dispositions?.reportsRetrieved
        ?? consolidation?.rawSourceReports
        ?? raw?.live?.sourceReports
        ?? normalized?.totalEvents
        ?? 0,
      domains: (normalized?.combined?.domains || raw?.combined?.domains || []).length,
      candidates: dispositions?.candidateEventsExtracted ?? null,
      admitted: dispositions?.admitted ?? null,
      hold: dispositions?.hold ?? null,
      reject: dispositions?.reject ?? null,
      duplicates: dispositions?.duplicates ?? null,
      mapped: dispositions?.mapped ?? normalized?.mappedCount ?? null,
      missingOccurrence: dispositions?.missingOccurrence ?? null,
      geocodeFailures: dispositions?.geocodeFailures ?? null
    },
    provenance: provenanceLabel(raw, normalized),
    spatial: {
      mapped: normalized?.mappedCount ?? 0,
      unresolved: normalized?.unresolvedCount ?? 0
    },
    temporal: {
      enforced: Boolean(temporalGate),
      label: temporalGate ? 'IN WINDOW' : '—',
      rejected: temporalGate?.rejected || 0
    },
    retrieval: retrievalLabel(raw, normalized, audit),
    coverage: coverageLabel(raw, normalized, audit),
    performance
  };
}

export class IntelligenceResearchControlBar {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    this.unsubscribe = subscribeIntelligenceLayersState((state) => this.render(state));
  }

  render(state = {}) {
    if (!this.host) return;
    const model = buildResearchControlBarModel(state);
    if (!model.active) {
      this.host.hidden = true;
      this.host.innerHTML = '';
      return;
    }

    this.host.hidden = false;
    this.host.innerHTML = `
      <div class="iqai-control-bar" role="status" aria-live="polite">
        <div class="iqai-control-bar__metric" title="Research providers">
          <span class="iqai-control-bar__label">RESEARCH</span>
          <span class="iqai-control-bar__value">${escapeHtml(model.research.providers)}</span>
        </div>
        ${model.analysis !== '—' ? `
        <div class="iqai-control-bar__metric" title="Cross-evidence analysis provider">
          <span class="iqai-control-bar__label">ANALYSIS</span>
          <span class="iqai-control-bar__value">${escapeHtml(model.analysis)}</span>
        </div>` : ''}
        <div class="iqai-control-bar__metric" title="Grounded source reports">
          <span class="iqai-control-bar__label">EVIDENCE</span>
          <span class="iqai-control-bar__value">${model.evidence.reports} reports${model.evidence.candidates != null ? ` · ${model.evidence.candidates} candidates` : ''}${model.evidence.admitted != null ? ` · ${model.evidence.admitted} admitted` : ''}${model.evidence.hold ? ` · ${model.evidence.hold} held` : ''}${model.evidence.reject ? ` · ${model.evidence.reject} rejected` : ''}${model.evidence.duplicates ? ` · ${model.evidence.duplicates} duplicate` : ''}</span>
        </div>
        <div class="iqai-control-bar__metric" title="Evidence provenance status">
          <span class="iqai-control-bar__label">PROVENANCE</span>
          <span class="iqai-control-bar__value">${escapeHtml(model.provenance)}</span>
        </div>
        <div class="iqai-control-bar__metric" title="Mapped vs unresolved events">
          <span class="iqai-control-bar__label">SPATIAL</span>
          <span class="iqai-control-bar__value">${model.spatial.mapped} mapped · ${model.spatial.unresolved} unresolved${model.evidence.missingOccurrence ? ` · ${model.evidence.missingOccurrence} no occurrence` : ''}${model.evidence.geocodeFailures ? ` · ${model.evidence.geocodeFailures} geocode fail` : ''}</span>
        </div>
        <div class="iqai-control-bar__metric" title="Temporal gate">
          <span class="iqai-control-bar__label">TEMPORAL</span>
          <span class="iqai-control-bar__value">${escapeHtml(model.temporal.label)}</span>
        </div>
        <div class="iqai-control-bar__metric" title="Open-web retrieval status">
          <span class="iqai-control-bar__label">RETRIEVAL</span>
          <span class="iqai-control-bar__value">${escapeHtml(model.retrieval)}</span>
        </div>
        <div class="iqai-control-bar__metric" title="Research coverage scope">
          <span class="iqai-control-bar__label">COVERAGE</span>
          <span class="iqai-control-bar__value">${escapeHtml(model.coverage)}</span>
        </div>
      </div>`;
  }

  destroy() {
    this.unsubscribe?.();
  }
}

/**
 * @param {HTMLElement} host
 */
export function mountIntelligenceResearchControlBar(host) {
  if (!host) return null;
  return new IntelligenceResearchControlBar(host);
}
