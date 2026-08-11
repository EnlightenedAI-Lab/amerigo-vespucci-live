/**
 * Deterministic bilingual ArcGIS portal search query expansion.
 */

function normalizeAscii(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const BOROUGH_AUTHORITY_QUERIES = [
  'owner:ville_montreal arrondissements',
  'owner:VilledeMontreal limites arrondissements',
  'owner:ville.montreal.qc.ca arrondissements',
  'owner:Montreal_Open_Data limites arrondissements'
];

const BIKE_AUTHORITY_QUERIES = [
  'owner:ville_montreal pistes cyclables',
  'owner:VilledeMontreal cycling network',
  'owner:Montreal_Open_Data bike paths',
  'owner:ville.montreal.qc.ca reseau cyclable'
];

const BOROUGH_SYNONYMS = [
  'Montréal borough boundaries',
  'Montreal borough boundaries',
  'Montréal arrondissements',
  'arrondissements Montréal',
  'limites des arrondissements Montréal',
  'boroughs Montreal',
  'Ville de Montréal arrondissements',
  'Montreal administrative boundaries',
  'limites_administratives_agglomeration Montreal',
  'Limites administratives de Montréal'
];

const BIKE_PATH_SYNONYMS = [
  'Montréal bike paths',
  'Montreal bike paths',
  'pistes cyclables Montréal',
  'réseau cyclable Montréal',
  'Montreal cycling network',
  'sentiers cyclables Montréal',
  'reseau cyclable VDM',
  'Réseau cyclable de la VDM',
  'pistes cyclables donnees.montreal'
];

const FLOOD_SYNONYMS = [
  'Montréal flood zones',
  'Montreal flood zones',
  'zones inondables Montréal',
  'inondation Montréal'
];

/**
 * @param {string} query
 * @param {object} [options]
 */
export function expandArcgisDiscoveryQueries(query = '', options = {}) {
  const base = String(query).trim();
  if (!base) return [];

  const normalized = normalizeAscii(base);
  const variants = [];
  const authoritative = options.authoritative === true || /\bauthoritative\b/i.test(base);

  if (authoritative && /\bborough\b|\barrondissement/.test(normalized)) {
    variants.push(...BOROUGH_AUTHORITY_QUERIES);
  }
  if (authoritative && /\bbike\b|\bcycl/.test(normalized)) {
    variants.push(...BIKE_AUTHORITY_QUERIES);
  }

  variants.push(base);

  if (/\bborough\b|\barrondissement/.test(normalized)) {
    variants.push(...BOROUGH_SYNONYMS);
  }
  if (/\bbike\b|\bcycl/.test(normalized)) {
    variants.push(...BIKE_PATH_SYNONYMS);
  }
  if (/\bflood\b|\binond/.test(normalized)) {
    variants.push(...FLOOD_SYNONYMS);
  }

  if (base.includes('Montréal')) variants.push(base.replace(/Montréal/g, 'Montreal'));
  if (base.includes('Montreal')) variants.push(base.replace(/Montreal/g, 'Montréal'));

  return [...new Set(variants)].slice(0, authoritative ? 20 : 8);
}
