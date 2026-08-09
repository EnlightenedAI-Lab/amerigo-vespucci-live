/**
 * Future RELATED INTELLIGENCE seam — no connectors in this pass.
 *
 * SPVM Intelligence UI → IQAI Intelligence subsystem → normalized evidence objects.
 */

/**
 * @param {{ reportDate?: string|null, timeWindow?: string, category?: string, shift?: string, areaType?: string, areaId?: string|null, areaName?: string|null, pdqId?: string|null, recordKey?: string|null }} ctx
 */
export function buildRelatedIntelligenceRequest(ctx) {
  return {
    type: 'RELATED_INTELLIGENCE_QUERY',
    status: 'NOT_CONNECTED',
    scope: {
      reportDate: ctx.reportDate || null,
      timeWindow: ctx.timeWindow || 'off',
      category: ctx.category || null,
      shift: ctx.shift || 'all',
      areaType: ctx.areaType || 'all',
      areaId: ctx.areaId || null,
      areaName: ctx.areaName || null,
      pdqId: ctx.pdqId || null,
      recordKey: ctx.recordKey || null
    },
    sources: ['news', 'social', 'official_observations', 'video', 'other_permitted'],
    note: 'Future subsystem returns Observation / Claim / Evidence / Event objects. No automatic linkage to SPVM incident identity.'
  };
}

export function relatedIntelligencePlaceholder(request) {
  if (!request?.scope?.reportDate && request?.scope?.timeWindow === 'off') {
    return 'Related intelligence is not queried until a reported-activity date or recent window is selected.';
  }
  return 'Related intelligence connectors are not enabled in this lab build. '
    + 'When connected, IQAI Intelligence will query permitted external sources for the selected report date/window '
    + 'without asserting they refer to the same SPVM published record.';
}
