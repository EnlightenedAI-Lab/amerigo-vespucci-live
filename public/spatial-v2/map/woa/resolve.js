/**
 * Intended-geometry resolution from registered selectable sources.
 *
 * Overlap roles:
 *   asset      — point urban asset (hydrant, traffic signal)
 *   object     — specific geometry (building, sidewalk)
 *   area       — named surface (park)
 *   container  — containing parcel (evaluation unit)
 *
 * Click acquires the intended green candidate immediately.
 * A container under a building is ordinary coverage, not a forced choice.
 */

export function specificSources(sources = []) {
  return sources.filter((source) => (source.overlap || 'object') !== 'container');
}

export function containerSources(sources = []) {
  return sources.filter((source) => source.overlap === 'container');
}

export function resolveCandidates(indexes, lat, lng, sources = []) {
  const hits = [];
  for (const source of sources) {
    if (source?.selectable !== true) continue;
    const index = indexes[source.objectClass];
    if (!index) continue;
    const hit = index.findAt(lat, lng, source.nearMeters ?? 12);
    if (!hit?.item) continue;
    hits.push({
      objectClass: source.objectClass,
      label: source.label,
      relation: hit.relation,
      range: hit.range,
      item: hit.item,
      overlap: source.overlap || 'object',
      priority: source.priority ?? 100
    });
  }
  return hits;
}

export function insideHits(hits) {
  return (hits || []).filter((hit) => hit.relation === 'inside');
}

function sortByPriority(list) {
  return [...list].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

function pickRole(list, role) {
  return sortByPriority(list.filter((hit) => (hit.overlap || 'object') === role))[0] || null;
}

export function pickIntended(hits) {
  const inside = (hits || []).filter((hit) => hit.relation === 'inside');
  const near = (hits || []).filter((hit) => hit.relation === 'near');
  return pickRole(inside, 'asset')
    || pickRole(inside, 'object')
    || pickRole(inside, 'area')
    || pickRole(near, 'asset')
    || pickRole(near, 'object')
    || pickRole(near, 'area')
    || pickRole(inside, 'container')
    || pickRole(near, 'container')
    || sortByPriority(hits || [])[0]
    || null;
}

export function choosePreview(hits, { chosenClass = null } = {}) {
  if (!hits.length) {
    return {
      preview: null,
      ambiguous: false,
      needsChoice: false,
      overlapAvailable: false,
      insideCount: 0
    };
  }
  const inside = insideHits(hits);
  const ambiguous = inside.length >= 2;
  const chosen = chosenClass && hits.find((hit) => hit.objectClass === chosenClass);
  const hasAsset = inside.some((hit) => hit.overlap === 'asset');
  const hasObject = inside.some((hit) => (hit.overlap || 'object') === 'object');
  const hasArea = inside.some((hit) => hit.overlap === 'area');
  const hasContainer = inside.some((hit) => hit.overlap === 'container');
  const overlapAvailable = Boolean(inside.length >= 2 && (
    ((hasObject || hasArea) && hasContainer)
    || (hasAsset && (hasObject || hasArea || hasContainer))
  ));
  if (chosen) {
    return {
      preview: chosen,
      ambiguous,
      needsChoice: false,
      overlapAvailable,
      insideCount: inside.length
    };
  }
  return {
    preview: pickIntended(hits),
    ambiguous,
    needsChoice: false,
    overlapAvailable,
    insideCount: inside.length
  };
}
