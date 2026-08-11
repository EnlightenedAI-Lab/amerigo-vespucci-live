/**
 * Normalize live-search response into intelligence layer presentation model.
 */

/**
 * @param {object} raw
 * @param {object} request
 */
export function normalizeIntelligenceSearchResponse(raw, request = {}) {
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const mappable = events.filter((e) => e.mappable && e.geometry);
  const unresolved = events.filter((e) => !e.mappable || !e.geometry);

  const conceptLabel = request.conceptLabel || request.query || 'Intelligence';
  const geography = request.geography || raw?.geographicScope?.label || 'Area';
  const timeLabel = request.timeLabel || 'Recent';

  const layerTitle = `${conceptLabel} — ${geography} — ${timeLabel}`;

  const liveStatus = raw?.liveRetrieval?.status || 'SKIPPED';
  const executionStatus = raw?.executionStatus || 'SUCCESS';
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings : [];

  let state = 'complete';
  if (executionStatus === 'PARTIAL' || liveStatus === 'DEGRADED' || liveStatus === 'PARTIAL') {
    state = 'degraded';
  }

  return {
    layerTitle,
    request,
    query: raw?.query || request.query,
    geography,
    timeLabel,
    conceptLabel,
    totalEvents: events.length,
    mappedCount: mappable.length,
    unresolvedCount: unresolved.length,
    events,
    mappableEvents: mappable,
    unresolvedEvents: unresolved,
    combined: raw?.combined || {},
    liveRetrieval: raw?.liveRetrieval || null,
    receipt: raw?.receipt || null,
    executionStatus,
    warnings,
    state,
    searchedAt: new Date().toISOString(),
    researchAudit: raw?.researchAudit || null,
    temporalGate: raw?.temporalGate || null,
    researchConsolidation: raw?.researchConsolidation || null,
    researchPerformance: raw?.researchPerformance || null
  };
}

/**
 * @param {object} normalized
 */
export function formatIntelligenceResultMessage(normalized) {
  if (!normalized) return 'No intelligence results.';
  const {
    totalEvents, mappedCount, unresolvedCount, layerTitle, state, warnings
  } = normalized;
  const parts = [
    `Found ${totalEvents} distinct event${totalEvents === 1 ? '' : 's'} reported in ${normalized.geography} during ${normalized.timeLabel.toLowerCase()}.`,
    `${mappedCount} had supported map locations and were added to the map`,
    unresolvedCount > 0 ? `${unresolvedCount} remain location-unresolved` : null
  ].filter(Boolean);
  let message = `${parts[0]} ${mappedCount} had supported map locations and were added to the map`;
  if (unresolvedCount > 0) message += `; ${unresolvedCount} remain location-unresolved`;
  message += '.';
  if (layerTitle) message += `\n\nAdded layer:\n${layerTitle}`;
  if (state === 'degraded' && warnings.length) {
    message += '\n\nSome live sources returned partial coverage.';
  }
  return message;
}

/**
 * @param {object} event
 */
export function summarizeEventSources(event) {
  const reports = Array.isArray(event?.sourceReports) ? event.sourceReports : [];
  const names = [...new Set(reports.map((r) => r.sourceName || r.publisher).filter(Boolean))];
  return {
    count: reports.length,
    names: names.slice(0, 5),
    urls: reports.map((r) => r.sourceUrl || r.canonicalUrl).filter(Boolean).slice(0, 5)
  };
}
