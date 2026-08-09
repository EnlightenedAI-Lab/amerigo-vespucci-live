/**
 * Generic IQAI live-object snapshot diff engine (no source-specific fields).
 */

/**
 * @param {object[]} objects
 * @param {(object) => string} getStableId
 */
export function indexLiveObjectsById(objects, getStableId) {
  const map = new Map();
  for (const object of objects || []) {
    const id = String(object?.liveObjectId || getStableId(object) || '').trim();
    if (!id || map.has(id)) continue;
    map.set(id, object);
  }
  return map;
}

/**
 * @param {object[]} objects
 * @param {Set<string>} knownIds
 * @param {(object) => string} getStableId
 */
export function planLiveObjectEdits(objects, knownIds, getStableId) {
  const currentIds = new Set();
  const toAdd = [];
  const toUpdate = [];

  for (const object of objects || []) {
    const id = String(object?.liveObjectId || getStableId(object) || '').trim();
    if (!id || currentIds.has(id)) continue;
    currentIds.add(id);
    if (knownIds.has(id)) toUpdate.push(id);
    else toAdd.push(id);
  }

  const toDelete = [];
  for (const id of knownIds) {
    if (!currentIds.has(id)) toDelete.push(id);
  }

  return { toAdd, toUpdate, toDelete, currentIds };
}

/**
 * @param {object} adapter
 * @param {object} [options]
 */
export function describeLiveObjectAdapter(adapter) {
  return {
    sourceId: adapter.sourceId,
    sourceName: adapter.sourceName,
    sourceClass: adapter.sourceClass,
    sourceUrl: adapter.sourceUrl,
    sourceLicense: adapter.sourceLicense,
    refreshMs: adapter.refreshMs,
    methods: ['fetchSnapshot()', 'normalize(raw, meta)', 'getStableId(object)']
  };
}

/**
 * @param {{
 *   status: string,
 *   objectCount?: number,
 *   feedTimestamp?: string|null,
 *   receivedAt?: string|null,
 *   refreshMs?: number,
 *   error?: string|null,
 *   stale?: boolean
 * }} snapshot
 */
export function buildLiveEngineDiagnostics(snapshot = {}) {
  return {
    objectCount: snapshot.objectCount ?? 0,
    lastSuccessfulUpdate: snapshot.receivedAt || null,
    feedTimestamp: snapshot.feedTimestamp || null,
    receivedAt: snapshot.receivedAt || null,
    refreshIntervalMs: snapshot.refreshMs ?? null,
    status: snapshot.status || 'ERROR',
    error: snapshot.error || null,
    stale: Boolean(snapshot.stale)
  };
}
