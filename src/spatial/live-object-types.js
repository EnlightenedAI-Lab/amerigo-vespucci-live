/** Shared live-object vocabulary (source-agnostic). */

export const LIVE_OBJECT_FRESHNESS = {
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  ERROR: 'ERROR'
};

export const LIVE_SOURCE_CLASS = {
  OPEN_COMMUNITY_LIVE: 'OPEN_COMMUNITY_LIVE',
  TRUSTED_EXTERNAL: 'TRUSTED_EXTERNAL'
};

/**
 * Adapter contract (documented for future Exo / AIS / REM feeds):
 *
 * @typedef {object} LiveObjectAdapter
 * @property {string} sourceId
 * @property {string} sourceName
 * @property {string} sourceClass
 * @property {string} sourceUrl
 * @property {string} sourceLicense
 * @property {number} refreshMs
 * @property {(options?: object) => Promise<{ raw: object, feedTimestamp: string|null, receivedAt: string }>} fetchSnapshot
 * @property {(raw: object, meta?: object) => object[]} normalize
 * @property {(object: object) => string} getStableId
 */
