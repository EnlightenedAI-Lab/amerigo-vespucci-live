import { SOURCE_IDS } from './approved-external-source-registry.js';
import { getResultSymbol } from './result-symbol-registry.js';

export const CONCEPT_IDS = {
  TOILETS: 'TOILETS'
};

/** @type {object[]} */
export const SEMANTIC_CATEGORIES = [
  {
    conceptId: CONCEPT_IDS.TOILETS,
    displayName: 'Public toilets',
    pluralLabel: 'public toilets',
    aliases: [
      'bathroom',
      'bathrooms',
      'restroom',
      'restrooms',
      'washroom',
      'washrooms',
      'toilet',
      'toilets',
      'wc',
      'public toilet',
      'public toilets'
    ],
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    filter: {
      field: 'amenity',
      operator: 'EQ',
      value: 'toilets'
    },
    iqaiType: 'osm_toilet',
    symbol: getResultSymbol(CONCEPT_IDS.TOILETS),
    detailFields: [
      { label: 'Name', attribute: 'name' },
      { label: 'Address', attribute: 'addr_street' },
      { label: 'City', attribute: 'addr_city' },
      { label: 'Wheelchair', attribute: 'wheelchair' },
      { label: 'Fee', attribute: 'fee' },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ]
  }
];

export function getSemanticCategoryById(conceptId) {
  return SEMANTIC_CATEGORIES.find((entry) => entry.conceptId === conceptId) || null;
}

export function resolveSemanticCategoryFromText(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  let best = null;
  let bestLen = 0;
  for (const category of SEMANTIC_CATEGORIES) {
    for (const alias of category.aliases) {
      const aliasNorm = alias
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (normalized.includes(aliasNorm) && aliasNorm.length > bestLen) {
        best = category;
        bestLen = aliasNorm.length;
      }
    }
  }
  return best;
}

export function resolveSemanticCategoriesFromPhrase(phrase) {
  const parts = String(phrase || '')
    .split(/\s+(?:and|et)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const categories = [];
  const seen = new Set();
  for (const part of parts) {
    const category = resolveSemanticCategoryFromText(part);
    if (!category) return { categories: [], unresolved: part };
    if (!seen.has(category.conceptId)) {
      seen.add(category.conceptId);
      categories.push(category);
    }
  }
  return { categories, unresolved: null };
}
