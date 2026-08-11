/**
 * Open-world intelligence panel presentation.
 */
import { AGENT2_ENTITY_KIND } from './open-world-intelligence-config.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
}

function renderResultCard(item) {
  const family = item.sourceFamily
    ? `<span class="owi-family owi-family--${escapeHtml(item.sourceFamily).toLowerCase()}">${escapeHtml(item.sourceFamily)}</span>`
    : '';
  const spatial = item.spatial
    ? `<span class="owi-spatial-badge">Spatial</span>`
    : `<span class="owi-spatial-badge owi-spatial-badge--none">NO SPATIAL GEOMETRY</span>`;
  const eventType = item.eventType
    ? `<span class="owi-event-type">${escapeHtml(item.eventType)}</span>`
    : '';
  const location = item.locationLabel
    ? `<p class="owi-result__location">${escapeHtml(item.locationLabel)}</p>`
    : '';
  const sourceLine = [
    item.primarySource ? escapeHtml(item.primarySource) : '',
    item.sourceId ? escapeHtml(item.sourceId) : '',
    item.publisher && item.publisher !== item.primarySource ? escapeHtml(item.publisher) : ''
  ].filter(Boolean).join(' · ');
  const timeLine = [
    item.occurrenceTime ? `Occurred · ${escapeHtml(formatTime(item.occurrenceTime))}` : '',
    item.publicationTime ? `Published · ${escapeHtml(formatTime(item.publicationTime))}` : ''
  ].filter(Boolean).join(' · ');
  const excerpt = item.excerpt || item.summary || null;

  return `
    <article class="owi-result" data-owi-result-id="${escapeHtml(item.id)}" data-owi-kind="${escapeHtml(item.kind)}" tabindex="0">
      <header class="owi-result__head">
        <h5 class="owi-result__title">${escapeHtml(item.title)}</h5>
        <div class="owi-result__badges">
          ${eventType}
          ${family}
          ${spatial}
        </div>
      </header>
      ${location}
      ${sourceLine ? `<p class="owi-result__source">${sourceLine}</p>` : ''}
      ${timeLine ? `<p class="owi-result__meta">${timeLine}</p>` : ''}
      ${excerpt ? `<p class="owi-result__excerpt">${escapeHtml(excerpt)}</p>` : ''}
      <div class="owi-result__actions">
        <button type="button" class="owi-inspect-btn" data-owi-inspect>Provenance</button>
      </div>
    </article>`;
}

function renderMapAccounting(summary, accounting) {
  if (!accounting) return '';
  const parts = [
    `${summary.spatialResults} rendered on map`,
    summary.nonSpatialResults ? `${summary.nonSpatialResults} non-spatial` : null,
    accounting.agent2IncidentsDedupRemoved ? `${accounting.agent2IncidentsDedupRemoved} deduplicated` : null,
    accounting.incidentsOutOfRadius ? `${accounting.incidentsOutOfRadius} outside radius` : null
  ].filter(Boolean);
  return `<p class="owi__map-accounting">Map accounting · ${parts.join(' · ')}</p>`;
}

export function buildOpenWorldIntelligenceHtml(state = {}) {
  const normalized = state.normalized;
  if (!normalized) {
    return '<p class="detail-muted">No open-world intelligence search yet.</p>';
  }

  const { summary, accounting } = normalized;
  const spatialItems = normalized.spatial || [];
  const incidents = normalized.operationalIncidents || [];
  const spatialEvents = spatialItems.filter((item) => item.kind !== AGENT2_ENTITY_KIND.OPERATIONAL_INCIDENT);
  const nonSpatial = normalized.nonSpatial || [];

  return `
    <section class="owi" data-plane="AGENT2">
      <header class="owi__header">
        <h3 class="owi__title">Open-world intelligence</h3>
        <p class="owi__subtitle">Agent 2 · separate from Point Intelligence</p>
      </header>
      <div class="owi__summary">
        <p>${summary.totalMatches} intelligence matches · ${summary.spatialResults} spatial · ${summary.nonSpatialResults} non-spatial · ${summary.sourceFamilies} source families</p>
        ${renderMapAccounting(summary, accounting)}
      </div>
      <section class="owi__section" aria-label="Spatial intelligence">
        <h4>Spatial intelligence (${spatialItems.length})</h4>
        ${spatialItems.length ? spatialItems.map(renderResultCard).join('') : '<p class="detail-muted">No spatial intelligence in context.</p>'}
      </section>
      ${incidents.length !== spatialItems.length ? `
      <section class="owi__section" aria-label="Operational incidents">
        <h4>Operational incidents (${incidents.length})</h4>
        ${incidents.map(renderResultCard).join('')}
      </section>` : ''}
      ${spatialEvents.length ? `
      <section class="owi__section" aria-label="Event candidates">
        <h4>Event candidates (${spatialEvents.length})</h4>
        ${spatialEvents.map(renderResultCard).join('')}
      </section>` : ''}
      <section class="owi__section" aria-label="Non-spatial intelligence">
        <h4>Non-spatial intelligence (${nonSpatial.length})</h4>
        ${nonSpatial.length ? nonSpatial.map(renderResultCard).join('') : '<p class="detail-muted">No non-spatial results.</p>'}
      </section>
      <div id="owi-inspector-host" class="owi-inspector-host" hidden></div>
    </section>`;
}

export { AGENT2_ENTITY_KIND };
