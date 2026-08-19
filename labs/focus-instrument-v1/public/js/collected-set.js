/**
 * Lab-only collected set. Separate from the single active ObjectRef lock.
 * Not production Spatial V2. Do not import into production.
 */

export const COLLECTED_SET_CONTRACT = 'iqai.lab.collectedset.v1';

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

export function createCollectedSet() {
  const id = (globalThis.crypto?.randomUUID?.() || `set-${Date.now()}`).replace(/-/g, '').slice(0, 12);
  return {
    contract: COLLECTED_SET_CONTRACT,
    setId: `iqai-set-${id}`,
    createdAt: new Date().toISOString(),
    objectRefs: []
  };
}

export function slimObjectRef(objectRef) {
  if (!objectRef?.ok) return null;
  return {
    contract: objectRef.contract,
    objectKey: objectRef.objectKey,
    objectClass: objectRef.objectClass,
    authority: objectRef.authority ? { ...objectRef.authority } : null,
    sourceId: objectRef.sourceId,
    anchor: objectRef.anchor ? { lat: objectRef.anchor.lat, lng: objectRef.anchor.lng } : null,
    attributesRef: objectRef.attributesRef ? { ...objectRef.attributesRef } : null,
    provenance: objectRef.provenance ? { ...objectRef.provenance } : null,
    overlay: objectRef.overlay ? { name: objectRef.overlay.name, kind: objectRef.overlay.kind } : null
  };
}

export function collectionRowFrom(objectRef, derived) {
  const src = derived?.sourceAttributes || {};
  const hMin = src.hAccMin;
  const hMax = src.hAccMax;
  const vMin = src.vAccMin;
  const vMax = src.vAccMax;
  return {
    object_key: blank(objectRef?.objectKey),
    object_class: blank(objectRef?.objectClass),
    authority_provider: blank(objectRef?.authority?.provider),
    source_id: blank(objectRef?.sourceId),
    name_context: blank(derived?.name || derived?.address || objectRef?.overlay?.name),
    latitude: objectRef?.anchor?.lat != null ? Number(objectRef.anchor.lat).toFixed(6) : '',
    longitude: objectRef?.anchor?.lng != null ? Number(objectRef.anchor.lng).toFixed(6) : '',
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
    h_accuracy: (hMin != null || hMax != null) ? `${num(hMin, 2)}-${num(hMax, 2)}` : '',
    v_accuracy: (vMin != null || vMax != null) ? `${num(vMin, 2)}-${num(vMax, 2)}` : '',
    dataset: blank(objectRef?.authority?.dataset),
    dataset_uuid: blank(objectRef?.authority?.datasetUuid),
    provenance_method: blank(objectRef?.provenance?.method),
    attributes_ref: blank(objectRef?.attributesRef?.kind)
  };
}

export function addToCollectedSet(set, objectRef, derived) {
  const slim = slimObjectRef(objectRef);
  if (!slim?.sourceId) {
    return { ok: false, reason: 'no-objectref', set };
  }
  const exists = set.objectRefs.some((item) =>
    item.sourceId === slim.sourceId || item.objectKey === slim.objectKey
  );
  if (exists) {
    return { ok: false, reason: 'duplicate', set };
  }
  const next = {
    ...set,
    objectRefs: [
      ...set.objectRefs,
      {
        ...slim,
        collectedAt: new Date().toISOString(),
        row: collectionRowFrom(slim, derived)
      }
    ]
  };
  return { ok: true, reason: 'added', set: next };
}

export function serializeCollectedSet(set) {
  return JSON.parse(JSON.stringify(set));
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function collectedSetToCsv(set) {
  const header = CSV_COLUMNS.join(',');
  const lines = (set?.objectRefs || []).map((item) => {
    const row = item.row || collectionRowFrom(item);
    return CSV_COLUMNS.map((key) => csvEscape(row[key])).join(',');
  });
  return [header, ...lines].join('\n');
}
