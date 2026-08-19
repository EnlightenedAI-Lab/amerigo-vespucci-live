/**
 * Session collected set. Separate from the bright-red acquired lock.
 * WorldState.selection.objectRefs = collected ∪ acquired; primary = acquired.
 */

export const CSV_COLUMNS = Object.freeze([
  'object_key',
  'object_class',
  'authority_provider',
  'source_id',
  'name_context',
  'latitude',
  'longitude',
  'source_area_m2',
  'derived_area_m2',
  'perimeter_m',
  'height_min_m',
  'height_max_m',
  'elev_min_m',
  'elev_max_m',
  'quality',
  'acquisition_method',
  'provider',
  'date_min',
  'date_max',
  'h_accuracy',
  'v_accuracy',
  'dataset',
  'dataset_uuid',
  'provenance_method',
  'attributes_ref'
]);

function blank(value) {
  return value == null || value === '' ? '' : value;
}

function num(value, digits = 3) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function createCollectedSet() {
  const id = (globalThis.crypto?.randomUUID?.() || `set-${Date.now()}`).replace(/-/g, '').slice(0, 12);
  return {
    setId: `iqai-set-${id}`,
    createdAt: new Date().toISOString(),
    items: []
  };
}

export function collectionRowFrom(objectRef, derived) {
  const src = derived?.sourceAttributes || {};
  return {
    object_key: blank(objectRef ? `${objectRef.namespace}:${objectRef.kind}:${objectRef.id}` : ''),
    object_class: blank(objectRef?.kind),
    authority_provider: blank(objectRef?.namespace),
    source_id: blank(objectRef?.id),
    name_context: blank(derived?.name || derived?.address || objectRef?.label),
    latitude: derived?.centroid?.lat != null ? Number(derived.centroid.lat).toFixed(6) : '',
    longitude: derived?.centroid?.lng != null ? Number(derived.centroid.lng).toFixed(6) : '',
    source_area_m2: num(src.buildingArea, 1),
    derived_area_m2: num(derived?.derived?.area, 1),
    perimeter_m: num(derived?.derived?.perimeter, 1),
    height_min_m: num(src.heightMin, 2),
    height_max_m: num(src.heightMax, 2),
    elev_min_m: num(src.elevMin, 2),
    elev_max_m: num(src.elevMax, 2),
    quality: blank(src.quality),
    acquisition_method: blank(src.acquisition),
    provider: blank(src.provider),
    date_min: blank(src.dateMin),
    date_max: blank(src.dateMax),
    h_accuracy: (src.hAccMin != null || src.hAccMax != null) ? `${num(src.hAccMin, 2)}-${num(src.hAccMax, 2)}` : '',
    v_accuracy: (src.vAccMin != null || src.vAccMax != null) ? `${num(src.vAccMin, 2)}-${num(src.vAccMax, 2)}` : '',
    dataset: blank(objectRef?.sourceRef),
    dataset_uuid: blank(objectRef?.datasetRef),
    provenance_method: 'vector-selection',
    attributes_ref: 'authority-record'
  };
}

export function addToCollectedSet(set, objectRef, derived) {
  if (!objectRef?.id) return { ok: false, reason: 'no-objectref', set };
  const exists = set.items.some((item) => item.objectRef.id === objectRef.id);
  if (exists) return { ok: false, reason: 'duplicate', set };
  return {
    ok: true,
    reason: 'added',
    set: {
      ...set,
      items: [
        ...set.items,
        {
          objectRef,
          sourceId: objectRef.id,
          collectedAt: new Date().toISOString(),
          row: collectionRowFrom(objectRef, derived)
        }
      ]
    }
  };
}

export function collectedSetToCsv(set) {
  const header = CSV_COLUMNS.join(',');
  const lines = (set?.items || []).map((item) => {
    const row = item.row || {};
    return CSV_COLUMNS.map((key) => csvEscape(row[key])).join(',');
  });
  return [header, ...lines].join('\n');
}
