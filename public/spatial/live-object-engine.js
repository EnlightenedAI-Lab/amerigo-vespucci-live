/**
 * Generic live-object edit planning (browser).
 */
export function planLiveObjectEdits(objects, knownIds, idField = 'liveObjectId') {
  const currentIds = new Set();
  const toAdd = [];
  const toUpdate = [];

  for (const object of objects || []) {
    const id = String(object?.[idField] || '').trim();
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
