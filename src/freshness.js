/** Position freshness thresholds in seconds. */
export const FRESHNESS_THRESHOLDS = {
  fresh: 600,
  aging: 3600
};

/**
 * Classify how fresh a position timestamp is.
 * @param {Date|string|number|null} lastAIS
 * @param {Date|number} [now]
 * @returns {'fresh'|'aging'|'stale'|'unknown'}
 */
export function classifyFreshness(lastAIS, now = Date.now()) {
  if (!lastAIS) return 'unknown';
  const timestamp = lastAIS instanceof Date ? lastAIS.getTime() : new Date(lastAIS).getTime();
  if (!Number.isFinite(timestamp)) return 'unknown';
  const ageSeconds = (now - timestamp) / 1000;
  if (ageSeconds <= FRESHNESS_THRESHOLDS.fresh) return 'fresh';
  if (ageSeconds <= FRESHNESS_THRESHOLDS.aging) return 'aging';
  return 'stale';
}

/**
 * @param {Date|string|number|null} lastAIS
 * @param {Date|number} [now]
 * @returns {number|null} Age in seconds, or null if unknown.
 */
export function positionAgeSeconds(lastAIS, now = Date.now()) {
  if (!lastAIS) return null;
  const timestamp = lastAIS instanceof Date ? lastAIS.getTime() : new Date(lastAIS).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((now - timestamp) / 1000));
}
