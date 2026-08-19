/**
 * Operator-facing Inspector V2.
 * Concise publisher fields first. Raw source record collapsed by default.
 * Does not invent missing values.
 */

import { classLabel, displayName } from './adapter.js';
import { formatArea } from '../focus/objects.js';

function text(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s || null;
}

function dateOnly(value) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

function add(rows, label, value) {
  const shown = text(value);
  if (!shown) return;
  rows.push({ label, value: shown });
}

function meters(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(digits)} m`;
}

function buildingRows(src, derived) {
  const rows = [];
  add(rows, 'BUILDING ID', src.feature_id);
  add(rows, 'HEIGHT', meters(src.heightmax ?? src.heightMax, 1));
  const footprint = derived?.area_m2 != null
    ? formatArea(derived.area_m2)
    : (src.bldgarea != null || src.buildingArea != null
      ? formatArea(Number(src.bldgarea ?? src.buildingArea))
      : null);
  add(rows, 'FOOTPRINT AREA', footprint);
  add(rows, 'QUALITY', src.qltylvl_en || src.qltylvl || src.quality);
  add(rows, 'ACQUISITION', src.acqtech_en || src.acqtech || src.acquisition);
  add(rows, 'OBSERVATION DATE', dateOnly(src.datemax || src.dateMax) || dateOnly(src.datemin || src.dateMin));
  return rows;
}

function sidewalkRows(src, derived) {
  const rows = [];
  add(rows, 'SIDEWALK ID', src.ID_VOI_TROTTOIR);
  add(rows, 'TYPE', src.TYPETROTTOIR_REF || src.CATEGORIETROTTOIR_REF);
  add(rows, 'MATERIAL', src.MATERIAUTROTTOIR_REF);
  add(rows, 'OWNER', src.PROPRIETAIRE_REF);
  add(rows, 'USE', src.UTILISATION_REF);
  add(rows, 'CONSTRUCTION', dateOnly(src.DATECONSTRUCTION));
  add(rows, 'AREA', derived?.area_m2 != null ? formatArea(derived.area_m2) : null);
  return rows;
}

function parkRows(src, derived) {
  const rows = [];
  add(rows, 'PARK ID', src.NUM_INDEX);
  add(rows, 'NAME', src.Nom);
  add(rows, 'TYPE', [src.Type, src.Lien].filter(Boolean).join(' · ') || src.TYPO1);
  add(rows, 'MANAGEMENT', src.GESTION);
  add(rows, 'JURISDICTION', src.COMPETENCE);
  add(rows, 'AREA', src.SUPERFICIE != null
    ? `${src.SUPERFICIE}  SOURCE`
    : (derived?.area_m2 != null ? formatArea(derived.area_m2) : null));
  return rows;
}

function uevRows(src) {
  const rows = [];
  add(rows, 'ID_UEV', src.ID_UEV);
  const civic = text(src.CIVIQUE_DEBUT);
  const civicEnd = text(src.CIVIQUE_FIN);
  const street = text(src.NOM_RUE);
  if (civic && street) {
    add(rows, 'ADDRESS', civicEnd && civicEnd !== civic ? `${civic}–${civicEnd} ${street}` : `${civic} ${street}`);
  } else {
    add(rows, 'STREET', street);
  }
  add(rows, 'USE', src.LIBELLE_UTILISATION);
  add(rows, 'USE CODE', src.CODE_UTILISATION);
  add(rows, 'CATEGORY', src.CATEGORIE_UEF);
  add(rows, 'LAND AREA', src.SUPERFICIE_TERRAIN != null ? formatArea(Number(src.SUPERFICIE_TERRAIN)) : null);
  add(rows, 'BUILDING AREA', src.SUPERFICIE_BATIMENT != null ? formatArea(Number(src.SUPERFICIE_BATIMENT)) : null);
  add(rows, 'YEAR BUILT', src.ANNEE_CONSTRUCTION);
  add(rows, 'DWELLINGS', src.NOMBRE_LOGEMENT);
  return rows;
}

function hydrantRows(src) {
  const rows = [];
  add(rows, 'ASSET ID', src.ID_BI);
  add(rows, 'ADDRESS', src.ADRESSE);
  add(rows, 'STATUS', src.STATUT_ACTIF);
  add(rows, 'INSTALLATION DATE', dateOnly(src.DATE_INSTALLATION));
  add(rows, 'OWNER', src.PROPRIETAIRE);
  add(rows, 'JURISDICTION', src.JURIDICTION);
  return rows;
}

function signalRows(src) {
  const rows = [];
  add(rows, 'INTERSECTION ID', src.INT_NO);
  add(rows, 'STREET 1', src.RUE_1);
  add(rows, 'STREET 2', src.RUE_2);
  add(rows, 'BOROUGH', src.ARRONDISSEMENT);
  add(rows, 'STATUS', src.PERMANENT_OU_TEMPORAIRE);
  return rows;
}

function classRows(acquired) {
  const src = acquired?.attributes?.source || {};
  const derived = acquired?.attributes?.derived || {};
  if (acquired.objectClass === 'building') return buildingRows(src, derived);
  if (acquired.objectClass === 'sidewalk') return sidewalkRows(src, derived);
  if (acquired.objectClass === 'park') return parkRows(src, derived);
  if (acquired.objectClass === 'evaluation_unit') return uevRows(src);
  if (acquired.objectClass === 'hydrant') return hydrantRows(src);
  if (acquired.objectClass === 'traffic_signal') return signalRows(src);
  const rows = [];
  add(rows, 'SOURCE ID', acquired.sourceId);
  return rows;
}

export function operatorCard(acquired) {
  if (!acquired) {
    return {
      objectType: 'NO OBJECT',
      name: 'No acquired object',
      primaryId: null,
      rows: [],
      source: null,
      sourceDate: null,
      freshness: null,
      provenance: null,
      limitation: null,
      rawCollapsed: true
    };
  }
  const src = acquired.attributes?.source || {};
  const prov = acquired.provenance || {};
  const sourceDate = dateOnly(prov.updateDate)
    || dateOnly(src.datemax)
    || dateOnly(src.DATE_VERSION)
    || dateOnly(src.DATECONSTRUCTION)
    || dateOnly(src.DATE_INSTALLATION);
  const retrieved = dateOnly(prov.retrievedAt);
  const freshness = sourceDate && retrieved
    ? `Source ${sourceDate} · retrieved ${retrieved}`
    : sourceDate
      ? `Source ${sourceDate}`
      : retrieved
        ? `Retrieved ${retrieved}`
        : null;
  return {
    objectType: classLabel(acquired.objectClass),
    name: displayName(acquired),
    primaryId: acquired.sourceId,
    identityField: acquired.identityField,
    rows: classRows(acquired),
    source: [acquired.provider, acquired.dataset].filter(Boolean).join(' · ') || null,
    sourceDate,
    freshness,
    provenance: prov.license || null,
    limitation: prov.legalNote || null,
    rawCollapsed: true
  };
}

export function rawSourceRows(source) {
  return Object.entries(source || {})
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value)
    }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function inspectorHtml(acquired, { collectedCount = 0 } = {}) {
  const card = operatorCard(acquired);
  if (!acquired) {
    return 'No ObjectRef acquired. Hover/candidate is not acquisition. DROP PIN remains WHERE.';
  }
  const rows = card.rows.map((row) => (
    `<div class="iqai-v2-woa-row"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`
  )).join('');
  const raw = rawSourceRows(acquired.attributes?.source);
  const rawRows = raw.map((row) => (
    `<div class="iqai-v2-woa-row"><span>${escapeHtml(row.key)}</span><strong>${escapeHtml(row.value)}</strong></div>`
  )).join('');
  const ref = acquired.objectRef;
  return `
    <article class="iqai-v2-woa-inspector" data-iqai-woa-inspector="true">
      <p class="iqai-v2-woa-kicker">OBJECT ACQUIRED</p>
      <p class="iqai-v2-woa-kind">${escapeHtml(card.objectType)}</p>
      <h3 class="iqai-v2-woa-name">${escapeHtml(card.name)}</h3>
      <p class="iqai-v2-woa-id">${escapeHtml(card.identityField || 'ID')} ${escapeHtml(card.primaryId || '')}</p>
      ${card.limitation ? `<p class="iqai-v2-woa-legal">${escapeHtml(card.limitation)}</p>` : ''}
      <div class="iqai-v2-woa-rows">${rows}</div>
      <p class="iqai-v2-woa-meta">${escapeHtml(card.source || '')}</p>
      <p class="iqai-v2-woa-meta">${escapeHtml(card.freshness || card.sourceDate || '')}</p>
      <p class="iqai-v2-woa-meta">NAMESPACE ${escapeHtml(ref?.namespace || '')} · KIND ${escapeHtml(ref?.kind || '')}</p>
      <p class="iqai-v2-woa-meta">COLLECTED SET ${escapeHtml(String(collectedCount))}</p>
      <details class="iqai-v2-woa-raw" data-iqai-woa-raw>
        <summary>RAW SOURCE RECORD</summary>
        <div class="iqai-v2-woa-rows">${rawRows || '<p>NOT IN SOURCE</p>'}</div>
      </details>
    </article>
  `.trim();
}
