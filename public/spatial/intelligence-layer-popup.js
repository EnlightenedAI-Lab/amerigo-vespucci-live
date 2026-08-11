/**
 * Intelligence event popup content — analyst-facing, concise.
 */
import { summarizeEventSources } from './intelligence-layer-model.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return 'Unknown';
  try {
    const d = new Date(value);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(value);
  }
}

/**
 * @param {object} attrs
 */
export function buildIntelligencePopupHtml(attrs = {}) {
  const concept = String(attrs.conceptLabel || attrs.concept || 'EVENT').toUpperCase();
  const title = attrs.title || 'Untitled event';
  const occurred = formatDate(attrs.occurredAt);
  const locationParts = [attrs.locationText, attrs.neighbourhood, attrs.municipality].filter(Boolean);
  const location = locationParts.join(' · ') || 'Location unresolved';
  const sources = summarizeEventSources({
    sourceReports: attrs.sourceReportsJson ? JSON.parse(attrs.sourceReportsJson) : []
  });

  const sourceList = sources.names.length
    ? `<ul class="intel-popup__sources">${sources.names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '<p class="intel-popup__muted">No sources listed</p>';

  return `
    <div class="intel-popup">
      <p class="intel-popup__type">${escapeHtml(concept)}</p>
      <h4 class="intel-popup__title">${escapeHtml(title)}</h4>
      ${attrs.description ? `<p class="intel-popup__desc">${escapeHtml(attrs.description)}</p>` : ''}
      <p class="intel-popup__meta"><strong>Occurred:</strong><br>${escapeHtml(occurred)}</p>
      <p class="intel-popup__meta"><strong>Location:</strong><br>${escapeHtml(location)}</p>
      <p class="intel-popup__meta"><strong>Sources:</strong> ${sources.count}</p>
      ${sourceList}
      <button type="button" class="intel-popup__evidence-btn" data-intel-event-id="${escapeHtml(attrs.eventId)}">View evidence</button>
    </div>`;
}

/**
 * @param {object} event
 * @param {object} request
 */
export function eventToFeatureAttributes(event, request = {}) {
  const sources = summarizeEventSources(event);
  return {
    eventId: event.eventId || null,
    concept: event.concept || request.query || null,
    conceptLabel: request.conceptLabel || event.concept || null,
    title: event.title || 'Untitled event',
    description: event.description || null,
    occurredAt: event.occurredAt || null,
    publishedAt: event.publishedAt || null,
    municipality: event.municipality || null,
    neighbourhood: event.neighbourhood || null,
    locationText: event.locationText || null,
    geometrySource: event.geometrySource || null,
    evidenceOrigin: event.evidenceOrigin || event.provenance || null,
    confidence: event.confidence ?? null,
    sourceCount: sources.count,
    primarySource: sources.names[0] || null,
    sourceReportsJson: JSON.stringify(event.sourceReports || []),
    mappable: event.mappable ? 1 : 0
  };
}
