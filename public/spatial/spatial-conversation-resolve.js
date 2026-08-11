/**
 * Deterministic conversation prompt expansion — no LLM.
 */

import { getConversationState } from './spatial-conversation-state.js';
import { matchPhraseToDistinctValues } from './semantic-vocabulary-matcher.js';

const DUPLICATE_FILLER_PATTERN = /\b(to|the|a|an|me|my|and|or)\s+\1\b/gi;

/**
 * Collapse immediately duplicated filler/function words only.
 * @param {string} text
 */
export function collapseDuplicateFillerWords(text) {
  let out = String(text || '');
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(DUPLICATE_FILLER_PATTERN, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

function normalizePrompt(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

const LOCATION_REF_PATTERN = /^(?:there|same location|previous location|that location|this address|same address|cette adresse|même adresse|meme adresse|cet endroit|ici|même lieu|meme lieu)$/i;

function resolveLocationFromState(state) {
  if (state.lastScopedLocation) return state.lastScopedLocation;
  if (state.lastLocationText) return state.lastLocationText;
  if (state.lastMatchedAddress) return state.lastMatchedAddress;
  return null;
}

function hasScopedResults(state) {
  return Boolean(
    state.lastScopedResultLayerIds?.length
    || state.lastScopedDatasets?.length
    || state.lastMapResultSnapshot?.scope === 'scoped'
  );
}

function resolveSourceLayerReference(operation, state) {
  const layers = state.lastReferencedSourceLayers || state.lastReferencedLayers || [];
  if (!layers.length) {
    return {
      ok: false,
      clarification: 'No previous source layers to reference. Specify layer names.'
    };
  }
  return {
    ok: true,
    metaAction: 'LAYER_REFERENCE',
    operation,
    layers,
    scope: 'source'
  };
}

/**
 * Expand conversational references into an executable prompt or meta-action.
 * @param {string} prompt
 * @param {object} [state]
 */
export function expandConversationInput(prompt, state = getConversationState()) {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return { ok: false, clarification: 'Please specify what you want to map.' };
  }

  if (/^(?:reset map|restore map|restore layers|return to original layers|start over)$/i.test(normalized)) {
    return { ok: true, metaAction: 'RESET_MAP' };
  }

  if (/^(?:clear\s+map|clear(?:\s+the)?(?:\s+results?)?|remove(?:\s+the)?\s+results?|remove previous results)$/i.test(normalized)) {
    return { ok: true, metaAction: 'CLEAR_RESULT' };
  }

  if (/^(?:turn off all source layers|hide all source layers)$/i.test(normalized)) {
    return { ok: true, metaAction: 'HIDE_ALL_SOURCE' };
  }

  if (
    /^(?:turn off all layers|hide all layers|turn everything off|turn all layers off|hide everything)$/i.test(normalized)
    || /^(?:turn off|hide|turn off all|hide all)(?:\s+layers)?$/i.test(normalized)
    || /^turn off layers$/i.test(normalized)
    || /^hide layers$/i.test(normalized)
  ) {
    return { ok: true, metaAction: 'HIDE_ALL_DISPLAYED' };
  }

  if (/^(?:turn on all layers|turn all layers on|show all layers)$/i.test(normalized)) {
    return { ok: true, metaAction: 'SHOW_ALL_OPERATIONAL' };
  }

  const onlyMatch = normalized.match(/^show only\s+(.+)$/i);
  if (onlyMatch) {
    return { ok: true, metaAction: 'SHOW_ONLY_LAYERS', layerPhrase: onlyMatch[1].trim() };
  }

  if (/^zoom to (?:these results|those results|the results|scoped results)/i.test(normalized)) {
    if (!hasScopedResults(state)) {
      return { ok: false, clarification: 'No scoped query results to zoom to.' };
    }
    return { ok: true, metaAction: 'ZOOM_SCOPED_RESULTS' };
  }

  if (/^zoom to (?:them|those layers|those|it)$/i.test(normalized)) {
    if (state.lastOperationScope === 'scoped' && hasScopedResults(state)) {
      return { ok: true, metaAction: 'ZOOM_SCOPED_RESULTS' };
    }
    return resolveSourceLayerReference('ZOOM_TO_LAYERS', state);
  }

  if (
    /^(?:hide|turn off|remove) (?:these results|those results|the results|scoped results)/i.test(normalized)
    || /^remove those from view$/i.test(normalized)
  ) {
    if (!hasScopedResults(state)) {
      return { ok: false, clarification: 'No scoped query results to hide.' };
    }
    return { ok: true, metaAction: 'HIDE_SCOPED_RESULTS' };
  }

  if (/^turn them off$/i.test(normalized)) {
    if (state.lastOperationScope === 'scoped' && hasScopedResults(state)) {
      return { ok: true, metaAction: 'HIDE_SCOPED_RESULTS' };
    }
    return resolveSourceLayerReference('HIDE_LAYERS', state);
  }

  if (/^turn them back on$/i.test(normalized)) {
    if (state.lastOperationScope === 'scoped' && hasScopedResults(state)) {
      return { ok: true, metaAction: 'SHOW_SCOPED_RESULTS' };
    }
    return resolveSourceLayerReference('SHOW_LAYERS', state);
  }

  if (/^hide (?:them|those layers|those)$/i.test(normalized)) {
    if (state.lastOperationScope === 'scoped' && hasScopedResults(state)) {
      return { ok: true, metaAction: 'HIDE_SCOPED_RESULTS' };
    }
    return resolveSourceLayerReference('HIDE_LAYERS', state);
  }

  if (/^(?:show them again|turn them back on)$/i.test(normalized)) {
    if (hasScopedResults(state) && state.lastOperationScope === 'scoped') {
      return { ok: true, metaAction: 'SHOW_SCOPED_RESULTS' };
    }
    if (state.lastReferencedSourceLayers?.length || state.lastReferencedLayers?.length) {
      return resolveSourceLayerReference('SHOW_LAYERS', state);
    }
    if (hasScopedResults(state)) {
      return { ok: true, metaAction: 'SHOW_SCOPED_RESULTS' };
    }
    return { ok: false, clarification: 'No previous layers or results to restore.' };
  }

  const makeItKm = normalized.match(/^make it\s+(\d+(?:\.\d+)?)\s*km$/i);
  if (makeItKm) {
    const location = state.lastScopedLocation || resolveLocationFromState(state);
    const datasets = state.lastScopedDatasets || state.lastQueryLayers || [];
    if (!location || !datasets.length) {
      return {
        ok: false,
        clarification: 'No previous scoped query to refine. Run a within-distance query first.'
      };
    }
    const layerPhrase = datasets.map((l) => l.title).filter(Boolean).join(' and ');
    const km = makeItKm[1];
    return {
      ok: true,
      prompt: `Show ${layerPhrase} within ${km} km of ${location}`,
      expansion: 'radius_reuse'
    };
  }

  const insteadRadius = normalized.match(/^within\s+(\d+(?:\.\d+)?)\s*km\s+instead$/i);
  if (insteadRadius) {
    const location = state.lastScopedLocation || resolveLocationFromState(state);
    const datasets = state.lastScopedDatasets || state.lastQueryLayers || [];
    if (!location || !datasets.length) {
      return {
        ok: false,
        clarification: 'No previous query to refine. Specify layers and location first.'
      };
    }
    const layerPhrase = datasets.map((l) => l.title).filter(Boolean).join(' and ');
    return {
      ok: true,
      prompt: `Show ${layerPhrase} within ${insteadRadius[1]} km of ${location}`,
      expansion: 'radius_reuse'
    };
  }

  const nearestRefine = normalized.match(/^only the nearest\s+(\d+)$/i);
  if (nearestRefine) {
    const location = resolveLocationFromState(state);
    const datasets = state.lastScopedDatasets || state.lastQueryLayers || [];
    if (!location || datasets.length !== 1) {
      return {
        ok: false,
        clarification: 'Nearest refinement requires one previous query layer and a resolved location.'
      };
    }
    return {
      ok: true,
      prompt: `Show the ${nearestRefine[1]} nearest ${datasets[0].title} to ${location}`,
      expansion: 'nearest_refine'
    };
  }

  const showThere = normalized.match(/^show\s+(.+?)\s+there$/i);
  if (showThere) {
    const location = resolveLocationFromState(state);
    if (!location) {
      return { ok: false, clarification: 'No previous location is available. Please specify an address or place.' };
    }
    const layerPhrase = showThere[1].trim();
    const radius = state.lastScopedRadiusKm || state.lastRadiusKm;
    if (radius && String(state.lastSpatialOperation || '').includes('WITHIN')) {
      return {
        ok: true,
        prompt: `Show ${layerPhrase} within ${radius} km of ${location}`,
        expansion: 'location_reuse'
      };
    }
    return {
      ok: true,
      prompt: `Show ${layerPhrase} near ${location}`,
      expansion: 'location_reuse'
    };
  }

  if (LOCATION_REF_PATTERN.test(normalized)) {
    const location = resolveLocationFromState(state);
    if (!location) {
      return { ok: false, clarification: 'No previous location is available. Please specify an address or place.' };
    }
    return { ok: true, prompt: location, expansion: 'location_only' };
  }

  const sameRadius = normalized.match(/^same radius$/i);
  if (sameRadius) {
    const radius = state.lastScopedRadiusKm || state.lastRadiusKm;
    const datasets = state.lastScopedDatasets || state.lastQueryLayers || [];
    const location = resolveLocationFromState(state);
    if (!radius || !datasets.length || !location) {
      return { ok: false, clarification: 'No previous radius query to reuse.' };
    }
    const layerPhrase = datasets.map((l) => l.title).join(' and ');
    return {
      ok: true,
      prompt: `Show ${layerPhrase} within ${radius} km of ${location}`,
      expansion: 'same_radius'
    };
  }

  const showMeThe = normalized.match(/^show me the (.+)$/i);
  if (showMeThe && state.lastXrayCategories?.length && state.lastXraySourceId) {
    const phrase = showMeThe[1].trim();
    const values = state.lastXrayCategories.map((entry) => entry.value);
    const match = matchPhraseToDistinctValues(phrase, values);
    if (match.status === 'none') {
      return {
        ok: false,
        clarification: `Category "${phrase}" was not in the previous AOI readout. Choose one of the listed categories.`
      };
    }
    if (match.status === 'ambiguous') {
      return {
        ok: false,
        clarification: `Multiple categories match "${phrase}": ${match.candidates.join(', ')}. Please clarify.`
      };
    }
    return {
      ok: true,
      metaAction: 'XRAY_ADD_CATEGORY',
      xrayCategoryValue: match.value,
      expansion: 'xray_category_followup'
    };
  }

  const addCategory = normalized.match(/^add\s+(.+)$/i);
  if (addCategory && state.lastXrayCategories?.length && state.lastXraySourceId) {
    const phrase = addCategory[1].trim().replace(/\.$/, '');
    const values = state.lastXrayCategories.map((entry) => entry.value);
    const match = matchPhraseToDistinctValues(phrase, values);
    if (match.status === 'none') {
      return {
        ok: false,
        clarification: `Category "${phrase}" was not in the previous AOI readout. Choose one of the listed categories.`
      };
    }
    if (match.status === 'ambiguous') {
      return {
        ok: false,
        clarification: `Multiple categories match "${phrase}": ${match.candidates.join(', ')}. Please clarify.`
      };
    }
    return {
      ok: true,
      metaAction: 'XRAY_ADD_CATEGORY',
      xrayCategoryValue: match.value,
      expansion: 'xray_category_add'
    };
  }

  const removeCategory = normalized.match(/^remove\s+(.+)$/i);
  if (removeCategory && state.lastXrayCategories?.length && state.lastXraySourceId) {
    const phrase = removeCategory[1].trim().replace(/\.$/, '');
    const values = state.lastXrayCategories.map((entry) => entry.value);
    const match = matchPhraseToDistinctValues(phrase, values);
    if (match.status === 'none') {
      return {
        ok: false,
        clarification: `Category "${phrase}" was not in the previous AOI readout.`
      };
    }
    if (match.status === 'ambiguous') {
      return {
        ok: false,
        clarification: `Multiple categories match "${phrase}": ${match.candidates.join(', ')}. Please clarify.`
      };
    }
    return {
      ok: true,
      metaAction: 'XRAY_REMOVE_CATEGORY',
      xrayCategoryValue: match.value,
      expansion: 'xray_category_remove'
    };
  }

  if (/^clear amenities$/i.test(normalized) && state.lastXraySourceId) {
    return { ok: true, metaAction: 'XRAY_CLEAR_CATEGORIES', expansion: 'xray_clear' };
  }

  if (/^last\s+7\s*days?$/i.test(normalized)) {
    return { ok: true, prompt: 'Show crimes in the last 7 days', expansion: 'spvm_follow' };
  }
  if (/^last\s+30\s*days?$/i.test(normalized)) {
    return { ok: true, prompt: 'Show crimes in the last 30 days', expansion: 'spvm_follow' };
  }
  if (/^last\s+90\s*days?$/i.test(normalized)) {
    return { ok: true, prompt: 'Show crimes in the last 90 days', expansion: 'spvm_follow' };
  }
  if (/^make it\s+90\s*days?$/i.test(normalized)) {
    return { ok: true, prompt: 'Show crimes in the last 90 days', expansion: 'spvm_follow' };
  }
  if (/^only vehicle theft$/i.test(normalized)) {
    return { ok: true, prompt: 'Show vehicle thefts in the last 30 days', expansion: 'spvm_follow' };
  }
  if (/^show all crime types$/i.test(normalized)) {
    return { ok: true, prompt: 'show all crime types', expansion: 'spvm_follow' };
  }
  if (/^night only$/i.test(normalized)) {
    return { ok: true, prompt: 'night only', expansion: 'spvm_follow' };
  }
  if (/^all shifts$/i.test(normalized)) {
    return { ok: true, prompt: 'all shifts', expansion: 'spvm_follow' };
  }

  return { ok: true, prompt: substituteInlineLocationRefs(collapseDuplicateFillerWords(prompt), state) };
}

function substituteInlineLocationRefs(prompt, state) {
  let text = String(prompt || '');
  const location = resolveLocationFromState(state);
  if (!location) return text;

  text = text.replace(/\bthere\b/gi, location);
  text = text.replace(/\bsame location\b/gi, location);
  text = text.replace(/\bprevious location\b/gi, location);
  text = text.replace(/\bthat location\b/gi, location);
  return text.trim();
}
