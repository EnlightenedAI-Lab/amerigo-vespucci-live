/**
 * Analyst-safe explanation — separates evidence, authoritative GIS, computed facts, interpretation.
 */
/**
 * @param {object} input
 */
export function buildCrossAgentAnalystExplanation(input = {}) {
  const event = input.event || input.governed?.candidate || {};
  const hospital = input.hospital || {};
  const spatialFact = input.spatialFact || {};
  const locationText = event.locationText || event.municipality || 'the reported location';
  const hospitalName = hospital.name || hospital.featureId || 'the hospital';
  const distanceMeters = spatialFact.distanceMeters ?? hospital.distanceMeters;

  const evidenceFact = `A governed incident (“${event.title || 'incident'}”) was reported at ${locationText}.`;
  const authoritativeGisFact = `Hospital “${hospitalName}” is located at authoritative ODHF geometry (${hospital.latitude?.toFixed?.(5) ?? '—'}, ${hospital.longitude?.toFixed?.(5) ?? '—'}).`;
  const computedSpatialFact = Number.isFinite(distanceMeters)
    ? `Hospital “${hospitalName}” is ${Math.round(distanceMeters)} metres from the governed incident location (within ${spatialFact.thresholdMeters || 2000} m threshold, geodesic WGS84).`
    : `No deterministic within-threshold hospital relationship was computed for this event.`;

  const interpretation = Number.isFinite(distanceMeters)
    ? 'This incident MAY therefore be relevant to hospital access or operations planning. This is not proof of disruption, closure, or operational impact.'
    : 'No proximity-based hospital relevance can be stated without a computed spatial fact.';

  return {
    eventId: event.eventId || input.governed?.governedEventId,
    hospitalId: spatialFact.hospitalId || hospital.featureId,
    spatialFactId: spatialFact.spatialFactId || null,
    sections: {
      evidenceFact,
      authoritativeGisFact,
      computedSpatialFact,
      interpretation
    },
    unsupportedDisruptionInference: false
  };
}

/**
 * @param {object[]} explanations
 */
export function buildCrossAgentAnalysisSummary(explanations = [], meta = {}) {
  return {
    objective: meta.objective || null,
    timeWindowDays: meta.timeWindowDays || null,
    eventsAnalyzed: meta.eventsAnalyzed || 0,
    spatialFactsProduced: meta.spatialFactsProduced || 0,
    explanations,
    analystNote: 'Evidence facts, authoritative GIS facts, and computed spatial facts precede any interpretation. Proximity does not prove hospital impact.'
  };
}
