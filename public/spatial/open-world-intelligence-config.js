/**
 * Open-world intelligence (Agent 2) — Agent 1 configuration constants.
 */
export const OPEN_WORLD_SEARCH_PATH = '/api/spatial/open-world-intelligence/search';

export const AGENT2_INTERPRETATION = Object.freeze({
  APPEARED: 'APPEARED',
  ACTIVE: 'ACTIVE',
  KNOWN_AS_OF: 'KNOWN_AS_OF'
});

export const AGENT2_ENTITY_KIND = Object.freeze({
  OPERATIONAL_INCIDENT: 'OPERATIONAL_INCIDENT',
  EVENT_CANDIDATE: 'EVENT_CANDIDATE',
  OBSERVATION: 'OBSERVATION'
});

export const AGENT2_SOURCE_FAMILIES = Object.freeze({
  NEWS: 'NEWS',
  X: 'X',
  BLUESKY: 'BLUESKY',
  SOCIAL: 'SOCIAL',
  VIDEO: 'VIDEO'
});

export const DEFAULT_OPEN_WORLD_RADIUS_METERS = 3000;
