/**
 * Agent 2 provenance inspector — distinct from Agent 5 QueryReceipt inspector.
 */
import { sanitizeOpenWorldInspectorRecord } from './open-world-intelligence-inspector-safe.js';

let hostEl = null;
let lastResult = null;
let mode = 'CLOSED';

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emit() {
  for (const listener of listeners) {
    try {
      listener({ mode, result: lastResult });
    } catch { /* ignore */ }
  }
}

export function closeOpenWorldInspector() {
  mode = 'CLOSED';
  lastResult = null;
  if (hostEl) {
    hostEl.hidden = true;
    hostEl.innerHTML = '';
  }
  emit();
}

export function openOpenWorldInspector(result) {
  if (!result) return;
  mode = 'OPEN';
  lastResult = result;
  render();
  hostEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  emit();
}

function renderField(label, value) {
  if (value == null || value === '') return '';
  return `<div class="owi-inspector__field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderLinkField(label, url) {
  if (!url) return '';
  const safe = escapeHtml(url);
  return `<div class="owi-inspector__field"><dt>${escapeHtml(label)}</dt><dd><a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a></dd></div>`;
}

function render() {
  if (!hostEl || !lastResult) return;
  const r = lastResult;
  hostEl.hidden = false;
  hostEl.innerHTML = `
    <div class="owi-inspector" data-inspector-plane="AGENT2">
      <header class="owi-inspector__header">
        <button type="button" data-owi-inspector-close aria-label="Close provenance">Close</button>
        <h4>${escapeHtml(r.title || 'Open-world provenance')}</h4>
        <div class="owi-inspector__subtitle">${escapeHtml(r.kind || 'RESULT')}${r.eventType ? ` · ${escapeHtml(r.eventType)}` : ''}</div>
      </header>
      <dl class="owi-inspector__grid">
        ${renderField('Headline', r.headline || r.title)}
        ${renderField('Event type', r.eventType)}
        ${renderField('Location', r.locationLabel)}
        ${renderField('Operational incident', r.operationalIncidentId)}
        ${renderField('Event candidate', r.eventCandidateId)}
        ${renderField('Observation', r.observationId)}
        ${renderField('Source family', r.sourceFamily)}
        ${renderField('Primary source', r.primarySource)}
        ${renderField('Publisher', r.publisher)}
        ${renderField('Source ID', r.sourceId)}
        ${renderField('Platform', r.platform)}
        ${renderField('Publication time', r.publicationTime)}
        ${renderField('Occurrence time', r.occurrenceTime || 'UNKNOWN')}
        ${renderField('IQAI knowledge time', r.knowledgeTime)}
        ${renderField('Lifecycle', r.lifecycleState)}
        ${renderField('Revision', r.revisionState)}
        ${renderField('Corroboration', r.corroboration)}
        ${renderField('Spatial precision', r.spatialPrecision)}
        ${renderField('Geometry type', r.geometryType)}
        ${renderField('Spatial', r.spatial ? 'Yes' : 'NO SPATIAL GEOMETRY')}
        ${renderField('Members', r.memberCount)}
        ${renderField('Summary', r.summary || r.excerpt)}
        ${renderLinkField('Source URL', r.canonicalUrl)}
      </dl>
      <details class="owi-inspector__raw">
        <summary>Technical view</summary>
        <pre>${escapeHtml(JSON.stringify(sanitizeOpenWorldInspectorRecord(r.raw || r), null, 2))}</pre>
      </details>
    </div>`;
}

export function mountOpenWorldInspector(host) {
  hostEl = host;
  hostEl?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-owi-inspector-close]')) {
      event.preventDefault();
      event.stopPropagation();
      closeOpenWorldInspector();
    }
  });
}

export function getOpenWorldInspectorState() {
  return { mode, result: lastResult };
}
