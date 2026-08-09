import { DEFAULT_RESULT_SYMBOL } from './result-symbol-registry.js';
import { matchPhraseToDistinctValues, formatSemanticDisplayName } from './semantic-vocabulary-matcher.js';

const AMENITY_DETAIL_FIELDS = [
  { label: 'Name', attribute: 'name' },
  { label: 'Address', attribute: 'addr_street' },
  { label: 'City', attribute: 'addr_city' },
  { label: 'Amenity', attribute: 'amenity' },
  { label: 'Distance from query', attribute: 'distanceLabel' },
  { label: 'Source', attribute: 'sourceName' },
  { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
];

/**
 * @param {object} source
 * @param {string} semanticValue
 * @param {string} semanticField
 */
export function buildDynamicSemanticCategory(source, semanticValue, semanticField) {
  const field = semanticField || source.semanticField || source.categoryField;
  const displayName = formatSemanticDisplayName(semanticValue);
  return {
    conceptId: `AMENITY:${semanticValue}`,
    displayName,
    pluralLabel: displayName,
    sourceId: source.id,
    semanticField: field,
    semanticValue,
    dynamic: true,
    filter: {
      field,
      operator: 'EQ',
      value: semanticValue
    },
    iqaiType: 'osm_amenity',
    symbol: { ...DEFAULT_RESULT_SYMBOL },
    detailFields: AMENITY_DETAIL_FIELDS
  };
}

/**
 * Resolve phrase against preloaded vocabulary contexts (sync).
 * @param {string} phrase
 * @param {object[]} vocabularyContexts
 */
export function resolveDynamicSemanticFromVocabulary(phrase, vocabularyContexts) {
  if (!phrase || !vocabularyContexts?.length) return null;

  let ambiguous = null;
  for (const ctx of vocabularyContexts) {
    const match = matchPhraseToDistinctValues(phrase, ctx.values);
    if (match.status === 'matched') {
      return buildDynamicSemanticCategory(ctx.source, match.value, ctx.semanticField);
    }
    if (match.status === 'ambiguous') {
      ambiguous = {
        ambiguous: true,
        candidates: match.candidates,
        sourceId: ctx.source.id
      };
    }
  }

  return ambiguous;
}
