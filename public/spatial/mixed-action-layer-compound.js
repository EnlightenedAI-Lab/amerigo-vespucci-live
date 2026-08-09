/**
 * Mixed-action layer compound parsing — per-clause visibility verb binding.
 */

import {
  resolveWebMapLayersFromPhrases
} from './webmap-layer-catalog.js';
import { SHOW_CLAUSE_PATTERN, VISIBILITY_CLAUSE_BOUNDARY } from './show-verb-family.js';
import { parseTrailingVisibilityClause } from './trailing-visibility-phrase.js';

const CLAUSE_BOUNDARY = VISIBILITY_CLAUSE_BOUNDARY;
const SHOW_CLAUSE = SHOW_CLAUSE_PATTERN;
const HIDE_CLAUSE = /^(?:hide|turn off|disable|switch off)\s+(.+)$/i;
const REMOVE_FROM_VIEW = /^remove\s+(.+?)\s+from\s+view$/i;
const REMOVE_FROM_VIEW_ALT = /^remove\s+from\s+view\s+(.+)$/i;
const COMPOUND_SEGMENT_BOUNDARY = /(?:,\s*|\s+and\s+)/i;

/**
 * Parse one clause into operation + raw layer phrase (leading or trailing).
 * @param {string} clause
 */
export function parseVisibilityClause(clause) {
  const text = String(clause || '').trim();
  if (!text) return null;

  let match = text.match(SHOW_CLAUSE);
  if (match) return { operation: 'SHOW_LAYERS', layerPhrase: match[1].trim() };

  match = text.match(HIDE_CLAUSE);
  if (match) return { operation: 'HIDE_LAYERS', layerPhrase: match[1].trim() };

  match = text.match(REMOVE_FROM_VIEW);
  if (match) return { operation: 'HIDE_LAYERS', layerPhrase: match[1].trim() };

  match = text.match(REMOVE_FROM_VIEW_ALT);
  if (match) return { operation: 'HIDE_LAYERS', layerPhrase: match[1].trim() };

  return parseTrailingVisibilityClause(text);
}

function countParsedVisibilitySegments(text) {
  const parts = String(text || '')
    .trim()
    .split(COMPOUND_SEGMENT_BOUNDARY)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return 0;
  let parsed = 0;
  for (const part of parts) {
    if (parseVisibilityClause(part)) parsed += 1;
  }
  return parsed;
}

/**
 * Split prompt into independent visibility clauses (verb-led or trailing segments).
 * @param {string} normalized
 */
export function splitVisibilityClauses(normalized) {
  const text = String(normalized || '').trim().replace(/,\s+and\s+/gi, ', ');
  if (!text) return [];

  const leadingParts = text.split(CLAUSE_BOUNDARY).map((part) => part.trim()).filter(Boolean);
  if (leadingParts.length > 1) return leadingParts;

  if (countParsedVisibilitySegments(text) >= 2) {
    return text.split(COMPOUND_SEGMENT_BOUNDARY).map((part) => part.trim()).filter(Boolean);
  }

  return [text];
}

/**
 * Plan ordered mixed-action layer controls when multiple verb-led clauses are present.
 * @param {string} normalized
 * @param {object | null} catalog
 * @returns {null | { operations: object[] } | { error: string }}
 */
export function planMixedActionLayerCompound(normalized, catalog) {
  const clauses = splitVisibilityClauses(normalized);
  if (clauses.length <= 1) return null;

  const operations = [];
  for (const clause of clauses) {
    const parsed = parseVisibilityClause(clause);
    if (!parsed) {
      return {
        error: 'Unsupported deterministic MAP operation'
      };
    }

    const phrase = parsed.layerPhrase;
    if (/^(?:them|those layers|those|it)$/i.test(phrase)) {
      return { error: 'Ambiguous layer reference.' };
    }
    if (/^(?:all source layers|source layers)$/i.test(phrase)) {
      return { error: 'Unsupported deterministic MAP operation' };
    }
    if (/^(?:all layers|layers|everything)$/i.test(phrase)) {
      return { error: 'Unsupported deterministic MAP operation' };
    }

    const resolved = resolveWebMapLayersFromPhrases(phrase, catalog);
    if (resolved.error) {
      return { error: resolved.error };
    }
    if (!resolved.matches.length) {
      return {
        error: `Layer not available in the current map or verified library: ${phrase}`
      };
    }

    operations.push({
      operation: parsed.operation,
      layers: resolved.matches
    });
  }

  if (!operations.length) return null;
  return { operations };
}
