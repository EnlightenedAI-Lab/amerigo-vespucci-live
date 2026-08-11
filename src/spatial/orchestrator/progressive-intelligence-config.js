/**
 * Progressive intelligence V1 feature gate — default ON unless explicitly disabled.
 * Set IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED=false for emergency rollback only.
 */

/**
 * @param {string|undefined|null} raw
 */
export function resolveProgressiveIntelligenceV1Enabled(raw = process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED) {
  if (raw == null || raw === '') return true;
  if (/^false$/i.test(String(raw).trim())) return false;
  return /^true$/i.test(String(raw).trim());
}

export const INTERACTIVE_INTELLIGENCE_DEADLINE_MS = Number(
  process.env.IQAI_INTERACTIVE_INTELLIGENCE_DEADLINE_MS || 30_000
);
