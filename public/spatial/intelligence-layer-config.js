/**
 * IQAI Spatial — dynamic intelligence research layer configuration.
 */

export const LIVE_SEARCH_PATH = '/api/spatial/intelligence-layers/research';

export const DEFAULT_GEOGRAPHY = 'Greater Montréal';

export const TIME_WINDOWS = Object.freeze({
  HOURS_24: '24h',
  DAYS_7: '7d',
  DAYS_30: '30d'
});

export const TIME_WINDOW_LABELS = Object.freeze({
  [TIME_WINDOWS.HOURS_24]: 'Last 24 hours',
  [TIME_WINDOWS.DAYS_7]: 'Last 7 days',
  [TIME_WINDOWS.DAYS_30]: 'Last 30 days'
});

/** @readonly */
export const INTELLIGENCE_LAYER_CONCEPTS = Object.freeze([
  { id: 'crime', label: 'Crime', query: 'crime' },
  { id: 'shootings', label: 'Shootings / Firearm Incidents', query: 'shootings firearm' },
  { id: 'kidnappings', label: 'Kidnappings', query: 'kidnappings abductions' },
  { id: 'fires', label: 'Fires', query: 'fires structure fires wildfire' },
  { id: 'protests', label: 'Protests', query: 'protests demonstrations' },
  { id: 'traffic', label: 'Traffic Incidents', query: 'traffic accidents collisions' },
  { id: 'infrastructure', label: 'Infrastructure Disruptions', query: 'infrastructure outages disruptions' },
  { id: 'severe-weather', label: 'Severe Weather', query: 'severe weather storms flooding' }
]);

export const INTELLIGENCE_LAYER_PREFIX = 'iqai-intel-';

export const EXECUTION_STATE = Object.freeze({
  IDLE: 'idle',
  RESEARCHING: 'researching',
  COMPLETE: 'complete',
  DEGRADED: 'degraded',
  FAILED: 'failed'
});

/**
 * @param {string} windowKey
 */
export function resolveTimeWindowDates(windowKey = TIME_WINDOWS.DAYS_7, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  switch (windowKey) {
    case TIME_WINDOWS.HOURS_24:
      start.setHours(start.getHours() - 24);
      break;
    case TIME_WINDOWS.DAYS_30:
      start.setDate(start.getDate() - 30);
      break;
    case TIME_WINDOWS.DAYS_7:
    default:
      start.setDate(start.getDate() - 7);
      break;
  }
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: TIME_WINDOW_LABELS[windowKey] || TIME_WINDOW_LABELS[TIME_WINDOWS.DAYS_7]
  };
}

/**
 * @param {string} conceptId
 */
export function getConceptById(conceptId) {
  return INTELLIGENCE_LAYER_CONCEPTS.find((c) => c.id === conceptId) || null;
}
