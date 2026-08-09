/**
 * Deterministic category phrase matching against FeatureLayer distinct values.
 * Browser-safe copy — keep in sync with src/spatial/semantic-vocabulary-matcher.js
 * No LLM / fuzzy guessing.
 */

/**
 * @param {string} text
 */
export function normalizeCategoryToken(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

/**
 * Expand normalized token into deterministic match variants.
 * @param {string} text
 */
export function expandCategoryVariants(text) {
  const norm = normalizeCategoryToken(text);
  if (!norm) return new Set();

  const variants = new Set([norm]);
  if (norm.endsWith('s') && norm.length > 3) {
    variants.add(norm.slice(0, -1));
  }
  if (norm.endsWith('ies') && norm.length > 4) {
    variants.add(`${norm.slice(0, -3)}y`);
  }
  if (norm.includes('_')) {
    const compact = norm.replace(/_/g, '');
    variants.add(compact);
    if (compact.endsWith('s') && compact.length > 3) {
      variants.add(compact.slice(0, -1));
    }
  }
  return variants;
}

/**
 * @param {string} phrase
 * @param {string[]} distinctValues
 * @returns {{ status: 'matched', value: string } | { status: 'ambiguous', candidates: string[] } | { status: 'none' }}
 */
export function matchPhraseToDistinctValues(phrase, distinctValues) {
  const phraseVariants = expandCategoryVariants(phrase);
  if (!phraseVariants.size) return { status: 'none' };

  const matches = [];
  for (const value of distinctValues) {
    const valueVariants = expandCategoryVariants(value);
    const overlap = [...phraseVariants].some((variant) => valueVariants.has(variant));
    if (overlap) matches.push(value);
  }

  const unique = [...new Set(matches)];
  if (unique.length === 1) return { status: 'matched', value: unique[0] };
  if (unique.length > 1) return { status: 'ambiguous', candidates: unique };
  return { status: 'none' };
}

/**
 * @param {string} value
 */
export function formatSemanticDisplayName(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}
