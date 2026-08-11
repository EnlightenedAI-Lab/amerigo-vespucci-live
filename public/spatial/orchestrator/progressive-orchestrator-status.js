/**
 * Progressive intelligence status projection for analyst UI.
 */
const STATUS_LABELS = Object.freeze({
  UNDERSTANDING: 'Understanding request',
  RESEARCHING: 'Researching & mapping',
  ENRICHING: 'Enriching',
  COMPLETE: 'Complete',
  DEGRADED: 'Complete (degraded)',
  FAILED: 'Failed',
  NEEDS_INPUT: 'Needs input'
});

/**
 * @param {'UNDERSTANDING'|'RESEARCHING'|'ENRICHING'|'COMPLETE'|'DEGRADED'|'FAILED'|'NEEDS_INPUT'} phase
 * @param {object} [metrics]
 */
export function projectProgressiveOrchestratorStatus(phase, metrics = {}) {
  const sourceCount = metrics.sourceCount ?? 0;
  const mappedCount = metrics.mappedCount ?? 0;
  let label = STATUS_LABELS[phase] || phase;

  if (phase === 'RESEARCHING' || phase === 'ENRICHING') {
    const parts = ['RESEARCHING'];
    if (sourceCount > 0) parts.push(`${sourceCount} SOURCES`);
    if (mappedCount > 0) parts.push(`${mappedCount} EVENT${mappedCount === 1 ? '' : 'S'} MAPPED`);
    if (phase === 'ENRICHING' || metrics.enriching) parts.push('ENRICHING…');
    label = parts.join(' · ');
  }

  return {
    schemaVersion: '1.0.0',
    phase,
    label,
    sourceCount,
    mappedCount,
    enriching: Boolean(metrics.enriching || phase === 'ENRICHING'),
    updatedAt: new Date().toISOString()
  };
}
