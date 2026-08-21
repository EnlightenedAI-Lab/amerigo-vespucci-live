/**
 * Canonical Ville de Montréal hydrant ObjectRef + inspector facts.
 * Identity is ID_BI from the municipal record. Graphics ids are not identity.
 */

import {
  OBJECT_IDENTITY_STABILITY,
  createObjectRef,
  failClosed,
  objectRefKey
} from '../../foundation/contracts/index.js';
import { HYDRANT_SOURCE } from '../../brain/ask-map-intent.js';
import { indexCollection } from './index.js';

export const HYDRANT_KIND = 'hydrant';
export const HYDRANT_NAMESPACE = 'ville-montreal';
export const HYDRANT_SELECT_ACTION = 'SELECT_HYDRANT';
export const HYDRANT_CLEAR_ACTION = 'CLEAR_HYDRANT';
export const HYDRANT_INVENTORY_POSITION_LABEL = 'VILLE INVENTORY POSITION';

const recordsById = new Map();
let loadedCollection = null;
let loadedIndex = null;
let lastAuthoritativeHits = [];

function text(value) {
  const next = String(value ?? '').trim();
  return next || null;
}

function sourceOf(hitOrFeature) {
  return hitOrFeature?.feature?.properties?.source
    || hitOrFeature?.properties?.source
    || hitOrFeature?.source
    || {};
}

function labOf(hitOrFeature) {
  return hitOrFeature?.feature?.properties?.lab
    || hitOrFeature?.properties?.lab
    || hitOrFeature?.lab
    || {};
}

export function hydrantIdBi(hitOrFeature) {
  const src = sourceOf(hitOrFeature);
  const lab = labOf(hitOrFeature);
  return text(src.ID_BI || lab.sourceId || hitOrFeature?.sourceId || hitOrFeature?.assetId);
}

export function hydrantCoordinates(hitOrFeature) {
  const coords = hitOrFeature?.feature?.geometry?.coordinates
    || hitOrFeature?.geometry?.coordinates
    || null;
  const longitude = Number.isFinite(Number(hitOrFeature?.longitude))
    ? Number(hitOrFeature.longitude)
    : Number(coords?.[0]);
  const latitude = Number.isFinite(Number(hitOrFeature?.latitude))
    ? Number(hitOrFeature.latitude)
    : Number(coords?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

export function hydrantDatasetVersion(hitOrFeature) {
  const src = sourceOf(hitOrFeature);
  const lab = labOf(hitOrFeature);
  return text(
    src.DATE_MAJ
    || lab.updateDate
    || (lab.retrievedAt ? String(lab.retrievedAt).slice(0, 10) : null)
    || HYDRANT_SOURCE.datasetId
  ) || 'unknown';
}

export function createHydrantObjectRef(hitOrFeature) {
  const id = hydrantIdBi(hitOrFeature);
  if (!id) {
    throw new Error('Hydrant ObjectRef requires municipal ID_BI.');
  }
  const src = sourceOf(hitOrFeature);
  const address = text(src.ADRESSE || labOf(hitOrFeature).sourceName);
  return createObjectRef({
    namespace: HYDRANT_NAMESPACE,
    kind: HYDRANT_KIND,
    id,
    datasetRef: `ville-montreal:bornes-incendie:${HYDRANT_SOURCE.datasetId}`,
    datasetVersion: hydrantDatasetVersion(hitOrFeature),
    sourceRef: HYDRANT_SOURCE.dataUrl,
    identityStability: OBJECT_IDENTITY_STABILITY.DATASET_VERSIONED,
    label: address ? `HYDRANT · ID_BI ${id} · ${address}` : `HYDRANT · ID_BI ${id}`,
    geometryRef: `geojson:hydrant:${id}`
  });
}

export function rememberHydrantRecord(hit, extra = {}) {
  const objectRef = createHydrantObjectRef(hit);
  const coords = hydrantCoordinates(hit);
  const src = sourceOf(hit);
  const lab = labOf(hit);
  const record = Object.freeze({
    objectRef,
    objectRefKey: objectRefKey(objectRef),
    sourceId: objectRef.id,
    idBi: objectRef.id,
    longitude: coords?.longitude ?? null,
    latitude: coords?.latitude ?? null,
    address: text(src.ADRESSE || lab.sourceName),
    installDate: text(src.DATE_INSTALLATION),
    updateDate: text(src.DATE_MAJ || lab.updateDate),
    retrievedAt: text(lab.retrievedAt),
    coordinateSource: text(src.ADRESSE_R_M) || (src.COORDONNEE_SPATIALE_X != null ? 'Ville de Montréal geomatics' : null),
    distanceMeters: Number.isFinite(Number(hit?.distanceMeters))
      ? Number(hit.distanceMeters)
      : (Number.isFinite(Number(extra.distanceMeters)) ? Number(extra.distanceMeters) : null),
    provider: text(lab.provider) || HYDRANT_SOURCE.provider,
    dataset: text(lab.dataset) || HYDRANT_SOURCE.dataset,
    datasetId: text(lab.datasetId) || HYDRANT_SOURCE.datasetId,
    license: text(lab.license),
    legalNote: text(lab.legalNote),
    sourceUrl: text(lab.sourceUrl),
    identityField: HYDRANT_SOURCE.identityField,
    feature: hit?.feature || hit || null
  });
  recordsById.set(objectRef.id, record);
  return record;
}

export function rememberHydrantHits(hits) {
  lastAuthoritativeHits = Array.isArray(hits) ? hits.slice() : [];
  const remembered = [];
  for (const hit of lastAuthoritativeHits) {
    try {
      remembered.push(rememberHydrantRecord(hit));
    } catch {
      // Skip records that cannot form a municipal ObjectRef.
    }
  }
  return remembered;
}

export function getHydrantRecord(idBi) {
  const id = text(idBi);
  return id ? recordsById.get(id) || null : null;
}

function indexForCollection(collection) {
  if (collection && collection === loadedCollection && loadedIndex) return loadedIndex;
  return indexCollection(collection, 'hydrant');
}

async function loadAuthoritativeCollection(options = {}) {
  if (options.collection?.features) return options.collection;
  if (loadedCollection?.features) return loadedCollection;
  const fetchFn = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (typeof fetchFn !== 'function') {
    failClosed('HYDRANT_RECORD_NOT_RESOLVED', 'Authoritative Ville hydrant records are not available.');
  }
  const response = await fetchFn(HYDRANT_SOURCE.dataUrl);
  if (!response?.ok) {
    failClosed('HYDRANT_RECORD_NOT_RESOLVED', 'Authoritative Ville hydrant records failed to load.');
  }
  const body = await response.json();
  if (!Array.isArray(body?.features)) {
    failClosed('HYDRANT_RECORD_NOT_RESOLVED', 'Authoritative Ville hydrant payload is not a FeatureCollection.');
  }
  loadedCollection = body;
  loadedIndex = indexCollection(body, 'hydrant');
  return body;
}

export async function resolveHydrantRecord(idBi, options = {}) {
  const id = text(idBi);
  if (!id) {
    failClosed('HYDRANT_RECORD_NOT_RESOLVED', 'Hydrant hitTest did not yield a municipal ID_BI.');
  }
  const warm = getHydrantRecord(id);
  if (warm) return warm;

  const painted = lastAuthoritativeHits.find((hit) => text(hit?.sourceId) === id || hydrantIdBi(hit) === id);
  if (painted) return rememberHydrantRecord(painted);

  const collection = await loadAuthoritativeCollection(options);
  const index = options.collection
    ? indexCollection(collection, 'hydrant')
    : (loadedIndex || indexForCollection(collection));
  const item = index.findBySourceId(id);
  const feature = item?.feature || null;
  const sourceId = text(item?.sourceId);
  const municipalId = text(feature?.properties?.source?.ID_BI);
  if (!feature || (sourceId && sourceId !== id) || (municipalId && municipalId !== id)) {
    failClosed(
      'HYDRANT_RECORD_NOT_RESOLVED',
      `Authoritative Ville hydrant record was not found for ID_BI ${id}.`,
      { idBi: id }
    );
  }
  return rememberHydrantRecord({
    sourceId: id,
    feature
  });
}

export function hydrantUnresolvedInspector(idBi, error) {
  const id = text(idBi) || 'unknown';
  const code = error?.code || 'HYDRANT_RECORD_NOT_RESOLVED';
  const message = text(error?.message) || 'Authoritative Ville hydrant record was not found.';
  return {
    body: `${code}\nID_BI ${id}\n${message}`,
    html: `
    <article class="iqai-v2-ops-object" data-iqai-hydrant-error="${escapeHtml(code)}">
      <header>
        <p>HYDRANT</p>
        <h3>${escapeHtml(code)}</h3>
        <p>ID_BI ${escapeHtml(id)}</p>
      </header>
      <section>
        <p>${escapeHtml(message)}</p>
        <p>No hydrant ObjectRef was created.</p>
      </section>
    </article>
    `
  };
}

export function getHydrantRecordByRef(ref) {
  if (!ref) return null;
  if (ref.kind && ref.kind !== HYDRANT_KIND) return null;
  return getHydrantRecord(ref.id) || (ref.objectRefKey ? [...recordsById.values()].find((item) => item.objectRefKey === ref) : null);
}

export function clearHydrantRecords() {
  recordsById.clear();
}

function haversineMeters(lon1, lat1, lon2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6378137 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceFromFocusMeters(record, focus) {
  const lon = Number(focus?.longitude ?? focus?.geometry?.coordinates?.[0]);
  const lat = Number(focus?.latitude ?? focus?.geometry?.coordinates?.[1]);
  if (!record || !Number.isFinite(record.longitude) || !Number.isFinite(record.latitude)) return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return Number.isFinite(record.distanceMeters) ? record.distanceMeters : null;
  return haversineMeters(lon, lat, record.longitude, record.latitude);
}

export function hydrantInspectorFacts(record, focus = null) {
  if (!record) return null;
  const distance = distanceFromFocusMeters(record, focus);
  const facts = [
    ['OBJECT', 'HYDRANT'],
    ['PROVIDER', record.provider],
    ['DATASET', record.dataset],
    ['ID_BI', record.idBi],
    ['ADDRESS', record.address],
    ['LONGITUDE', Number.isFinite(record.longitude) ? record.longitude.toFixed(6) : null],
    ['LATITUDE', Number.isFinite(record.latitude) ? record.latitude.toFixed(6) : null],
    ['POSITION KIND', HYDRANT_INVENTORY_POSITION_LABEL],
    ['DISTANCE FROM PIN', Number.isFinite(distance) ? `${distance.toFixed(1)} m` : null],
    ['INSTALL DATE', record.installDate && record.installDate !== '1900-01-01' ? record.installDate : null],
    ['INVENTORY DATE', record.updateDate],
    ['RETRIEVED', record.retrievedAt],
    ['LICENSE', record.license],
    ['SOURCE URL', record.sourceUrl]
  ].filter(([, value]) => value);
  const limitations = [
    record.legalNote,
    'Pressure, flow, and in-service status are not claimed.',
    'Physical hydrant visibility in Street 360 is NOT CONFIRMED.',
    'The marker is the municipal inventory position, not a Google-modeled hydrant.'
  ].filter(Boolean);
  return { facts, limitations, record };
}

export function renderHydrantInspector(record, focus = null) {
  const model = hydrantInspectorFacts(record, focus);
  if (!model) return '';
  const rows = model.facts.map(([label, value]) => `<p><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</p>`).join('');
  const limits = model.limitations.map((item) => `<p>${escapeHtml(item)}</p>`).join('');
  return `
    <article class="iqai-v2-ops-object" data-iqai-hydrant-object="${escapeHtml(record.idBi)}">
      <header>
        <p>HYDRANT</p>
        <h3>ID_BI ${escapeHtml(record.idBi)}</h3>
        <p>${escapeHtml(record.address || HYDRANT_INVENTORY_POSITION_LABEL)}</p>
      </header>
      <section>
        <h4>Source information</h4>
        ${rows}
      </section>
      <section>
        <h4>Limitations</h4>
        ${limits}
      </section>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function hydrantInspectorBody(record, focus = null) {
  const model = hydrantInspectorFacts(record, focus);
  if (!model) return 'No hydrant ObjectRef acquired.';
  return [
    'OBJECT ACQUIRED',
    ...model.facts.map(([label, value]) => `${label}: ${value}`),
    ...model.limitations.map((item) => `LIMITATION: ${item}`)
  ].join('\n');
}
