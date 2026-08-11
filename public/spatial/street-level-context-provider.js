/**
 * Street-level context provider boundary.
 * Keeps Google (and future providers) out of map-selection / Point Intelligence flow.
 */
import { STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE } from './street-level-context-config.js';
import { createGoogleStreetViewProvider } from './google-street-view-provider.js';

export { computeCoordinateOffsetMeters } from './street-level-context-geometry.js';

/**
 * @param {string} [providerId]
 * @param {object} [options]
 */
export function createStreetLevelContextProvider(providerId = STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE, options = {}) {
  if (providerId === STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE) {
    return createGoogleStreetViewProvider(options);
  }
  throw new Error(`Unsupported street-level context provider: ${providerId}`);
}
