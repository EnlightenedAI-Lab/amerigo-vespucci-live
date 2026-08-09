/**
 * Deterministic SPVM crime explorer language — no LLM.
 */

import {
  SPVM_ALL_CATEGORIES,
  SPVM_ALL_SHIFTS,
  matchFrenchCategoryFromPhrase
} from './spvm-crime-taxonomy.js';
import { createDefaultSpvmFilterState, cloneSpvmFilterState } from './spvm-crime-filter.js';

function normalize(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

/**
 * @param {string} prompt
 * @param {object} [conversationState]
 */
export function matchSpvmCrimeIntent(prompt, conversationState = {}) {
  const normalized = normalize(prompt);
  if (!normalized) return null;

  if (/^show all crime types$/i.test(normalized)) {
    return { action: 'SPVM_PATCH', turnLayerOn: true, patch: { categories: new Set(SPVM_ALL_CATEGORIES) } };
  }

  if (/^night only$/i.test(normalized)) {
    return { action: 'SPVM_PATCH', turnLayerOn: true, patch: { shifts: new Set(['nuit']) } };
  }

  if (/^all shifts$/i.test(normalized)) {
    return { action: 'SPVM_PATCH', turnLayerOn: true, patch: { shifts: new Set(SPVM_ALL_SHIFTS) } };
  }

  const makeItDays = normalized.match(/^make it\s+(\d+)\s*days?$/i);
  if (makeItDays) {
    const days = Number(makeItDays[1]);
    if (days === 7 || days === 30 || days === 90) {
      return { action: 'SPVM_PATCH', turnLayerOn: true, patch: { windowDays: days } };
    }
  }

  const lastDays = normalized.match(/^last\s+(\d+)\s*days?$/i);
  if (lastDays) {
    const days = Number(lastDays[1]);
    if (days === 7 || days === 30 || days === 90) {
      return { action: 'SPVM_PATCH', turnLayerOn: true, patch: { windowDays: days } };
    }
  }

  const onlyCategory = normalized.match(/^only\s+(.+)$/i);
  if (onlyCategory) {
    const french = matchFrenchCategoryFromPhrase(onlyCategory[1]);
    if (french) {
      return {
        action: 'SPVM_PATCH',
        turnLayerOn: true,
        patch: { categories: new Set([french]) }
      };
    }
  }

  const spatial = normalized.match(
    /^show\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*km\s+of\s+(.+?)\s+in\s+the\s+last\s+(\d+)\s*days?$/i
  );
  if (spatial) {
    return {
      action: 'SPVM_SPATIAL_DEFERRED',
      clarification: 'SPVM spatial radius queries are not yet wired to the GeoJSON explorer.'
    };
  }

  if (/^show recent crimes$/i.test(normalized)) {
    return { action: 'SPVM_EXPLORE', turnLayerOn: true, state: createDefaultSpvmFilterState() };
  }

  const crimesDays = normalized.match(/^show crimes in the last\s+(\d+)\s*days?$/i);
  if (crimesDays) {
    const days = Number(crimesDays[1]);
    if (days === 7 || days === 30 || days === 90) {
      const state = createDefaultSpvmFilterState();
      state.windowDays = days;
      return { action: 'SPVM_EXPLORE', turnLayerOn: true, state };
    }
  }

  const categoryDays = normalized.match(/^show\s+(.+?)\s+in the last\s+(\d+)\s*days?$/i);
  if (categoryDays) {
    const french = matchFrenchCategoryFromPhrase(categoryDays[1]);
    const days = Number(categoryDays[2]);
    if (french && (days === 7 || days === 30 || days === 90)) {
      const state = createDefaultSpvmFilterState();
      state.windowDays = days;
      state.categories = new Set([french]);
      return { action: 'SPVM_EXPLORE', turnLayerOn: true, state };
    }
  }

  void conversationState;
  return null;
}

export function spvmIntentResponse(intent, analytics) {
  const count = analytics?.total ?? 0;
  const days = intent?.state?.windowDays ?? intent?.patch?.windowDays ?? 30;
  return `SPVM recent crime — last ${days} days: ${count} mapped reports. AI cost $0.00`;
}
