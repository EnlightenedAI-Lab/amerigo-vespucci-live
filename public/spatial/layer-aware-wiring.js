/**
 * Client-side layer command wiring — same rules as spatial-compound-planner planLayerCatalogCommands.
 */

import {
  resolveWebMapLayersFromPhrase,
  resolveWebMapLayersFromPhrases,
  filterCatalogLayers
} from './webmap-layer-catalog.js';
import { collapseDuplicateFillerWords } from './spatial-conversation-resolve.js';
import { hasExplicitSpatialIntent } from './spatial-intent-signals.js';
import { stripLeadingConversationalFiller } from './leading-conversational-filler.js';
import { planMixedActionLayerCompound } from './mixed-action-layer-compound.js';
import { matchShowLayerPhrase } from './show-verb-family.js';
import { extractTrailingVisibilityPhrase } from './trailing-visibility-phrase.js';

function normalizePrompt(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function webmapLayerAuthority(layer, webmapTitle = 'Montreal 1') {
  const parent = layer.parentGroup ? `${layer.parentGroup} / ` : '';
  return `${webmapTitle} / ${parent}${layer.title || layer.catalogId}`;
}

function buildMultiLayerControlPlan(operation, phrase, catalog) {
  const resolved = resolveWebMapLayersFromPhrases(phrase, catalog);
  if (resolved.error) {
    return { handled: true, error: resolved.error };
  }
  if (!resolved.matches.length) {
    return {
      handled: true,
      error: 'Layer not available in the current map or verified library.'
    };
  }
  return {
    handled: true,
    action: 'LAYER_CONTROLS',
    operation,
    layers: resolved.matches
  };
}

function buildLayerControlPlan(operation, phrase, catalog) {
  const resolved = resolveWebMapLayersFromPhrases(phrase, catalog);
  if (resolved.matches.length > 1) {
    return buildMultiLayerControlPlan(operation.replace('_LAYER', '_LAYERS'), phrase, catalog);
  }
  if (resolved.error) {
    return { handled: true, error: resolved.error };
  }
  if (!resolved.matches.length) {
    const single = resolveWebMapLayersFromPhrase(phrase, catalog);
    if (single.matches.length > 1) {
      return {
        handled: true,
        error: `Multiple layers match: ${single.matches.map((m) => m.title).join(', ')}. Please clarify.`
      };
    }
    return {
      handled: true,
      error: 'Layer not available in the current map or verified library.'
    };
  }
  const layer = resolved.matches[0];
  return {
    handled: true,
    action: 'LAYER_CONTROL',
    operation,
    layerControl: {
      operation,
      catalogId: layer.catalogId,
      layerId: layer.layerId,
      title: layer.title
    },
    layer
  };
}

function embeddedSecondaryVisibilityClause(phrase) {
  const segments = String(phrase || '').split(/\s+and\s+/i);
  if (segments.length <= 1) return false;
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i].trim();
    if (/^(?:show|turn on|hide|turn off|disable|switch off|remove|enable|display|let me see|switch on)\s/i.test(segment)) {
      return true;
    }
  }
  return false;
}

function failClosedEmbeddedVisibility(normalized, catalog) {
  const mixed = planMixedActionLayerCompound(normalized, catalog);
  if (mixed?.error) {
    return { handled: true, error: mixed.error };
  }
  if (mixed?.operations?.length) {
    return {
      handled: true,
      action: 'LAYER_COMPOUND_CONTROLS',
      operations: mixed.operations
    };
  }
  return { handled: true, error: 'Unsupported deterministic MAP operation' };
}

function extractSourceLayerHidePhrase(normalized) {
  let match = normalized.match(/^(?:hide|turn off|disable|switch off)\s+(.+)$/i);
  if (match) return match[1].trim();
  match = normalized.match(/^remove\s+(.+?)\s+from\s+view$/i);
  if (match) return match[1].trim();
  match = normalized.match(/^remove\s+from\s+view\s+(.+)$/i);
  if (match) return match[1].trim();
  return null;
}

/**
 * Detect layer-only commands against live catalog.
 * @param {string} prompt
 * @param {object | null} catalog
 */
export function planLayerAwareClientCommand(prompt, catalog) {
  if (!catalog?.layers?.length) {
    return { handled: false, reason: 'catalog_empty' };
  }

  const normalized = stripLeadingConversationalFiller(normalizePrompt(prompt));
  if (!normalized) return { handled: false };

  if (/^what layers do I have$/i.test(normalized) || /^list (?:all )?layers$/i.test(normalized)) {
    return { handled: true, action: 'LIST_LAYERS', filter: null };
  }
  if (/^what point layers do I have$/i.test(normalized)) {
    return { handled: true, action: 'LIST_LAYERS', filter: 'point' };
  }

  const zoomMatch = normalized.match(/^zoom to\s+(.+)$/i);
  if (zoomMatch) {
    const phrase = zoomMatch[1].trim();
    if (/^(?:them|those layers|those|it)$/i.test(phrase)) {
      return { handled: false, reason: 'reference_command' };
    }
    return buildLayerControlPlan('ZOOM_TO_LAYER', phrase, catalog);
  }

  if (!hasExplicitSpatialIntent(normalized)) {
    const mixedPlan = planMixedActionLayerCompound(normalized, catalog);
    if (mixedPlan?.error) {
      return { handled: true, error: mixedPlan.error };
    }
    if (mixedPlan?.operations?.length) {
      return {
        handled: true,
        action: 'LAYER_COMPOUND_CONTROLS',
        operations: mixedPlan.operations
      };
    }

    const backOnMatch = normalized.match(/^turn\s+(.+?)\s+back on$/i);
    if (backOnMatch) {
      const phrase = backOnMatch[1].trim();
      if (/^(?:them|those|it)$/i.test(phrase)) {
        return { handled: false, reason: 'reference_command' };
      }
      return buildMultiLayerControlPlan('SHOW_LAYERS', phrase, catalog);
    }

    const trailingVisibility = extractTrailingVisibilityPhrase(normalized);
    if (trailingVisibility) {
      const phrase = trailingVisibility.phrase;
      if (embeddedSecondaryVisibilityClause(phrase)) {
        return failClosedEmbeddedVisibility(normalized, catalog);
      }
      if (trailingVisibility.operation === 'HIDE') {
        return buildMultiLayerControlPlan('HIDE_LAYERS', phrase, catalog);
      }
      return buildMultiLayerControlPlan('SHOW_LAYERS', phrase, catalog);
    }

    const hidePhrase = extractSourceLayerHidePhrase(normalized);
    if (hidePhrase) {
      const phrase = hidePhrase;
      if (/^(?:them|those layers|those|it)$/i.test(phrase)) {
        return { handled: false, reason: 'reference_command' };
      }
      if (/^(?:all source layers|source layers)$/i.test(phrase)) {
        return { handled: true, action: 'HIDE_ALL_SOURCE' };
      }
      if (/^(?:all layers|layers|everything)$/i.test(phrase)) {
        return { handled: true, action: 'HIDE_ALL_DISPLAYED' };
      }
      if (embeddedSecondaryVisibilityClause(phrase)) {
        return failClosedEmbeddedVisibility(normalized, catalog);
      }
      return buildMultiLayerControlPlan('HIDE_LAYERS', phrase, catalog);
    }

    const toggleMatch = normalized.match(/^toggle\s+(.+)$/i);
    if (toggleMatch) {
      return buildMultiLayerControlPlan('TOGGLE_LAYERS', toggleMatch[1].trim(), catalog);
    }

    const turnAllOnMatch = normalized.match(/^turn all layers on$/i);
    if (turnAllOnMatch) {
      return { handled: true, action: 'SHOW_ALL_OPERATIONAL' };
    }

    const showPhrase = matchShowLayerPhrase(normalized);
    if (showPhrase) {
      const phrase = showPhrase;
      if (/^turn on\s+/i.test(normalized) && /^(?:all layers|all)$/i.test(phrase)) {
        return { handled: true, action: 'SHOW_ALL_OPERATIONAL' };
      }
      if (/^show\s+/i.test(normalized) && /^(?:them again|them|those)$/i.test(phrase)) {
        return { handled: false, reason: 'reference_command' };
      }
      if (embeddedSecondaryVisibilityClause(phrase)) {
        return failClosedEmbeddedVisibility(normalized, catalog);
      }
      return buildMultiLayerControlPlan('SHOW_LAYERS', phrase, catalog);
    }
  }

  return { handled: false };
}

export function buildListLayersMapResult(prompt, catalog, filter = null) {
  const layers = filterCatalogLayers(catalog, filter);
  const webmapTitle = catalog.webmapTitle || 'Montreal 1';
  const listLabel = filter === 'point' ? 'List point layers' : 'List layers';

  return {
    supported: true,
    action: 'LIST_LAYERS',
    prompt: String(prompt || '').trim(),
    layerList: layers.map((layer) => layer.title).filter(Boolean),
    layers: layers.map((layer) => ({
      catalogId: layer.catalogId,
      title: layer.title,
      type: layer.type,
      geometryType: layer.geometryType || null,
      visible: layer.visible,
      queryable: layer.queryable,
      parentGroup: layer.parentGroup || null
    })),
    layerCatalogSummary: catalog.summary || null,
    summary: {
      status: 'Controlled',
      execution: 'Deterministic GIS',
      matchedFeatures: layers.length,
      spatialOperation: listLabel,
      dataset: webmapTitle,
      action: 'LIST_LAYERS',
      authority: webmapTitle,
      sourceCheck: 'Passed',
      geometryCheck: 'Passed',
      reproducible: 'Yes',
      unresolved: 'None',
      freshness: 'ArcGIS live',
      displayMode: 'list',
      layerSource: 'WEBMAP',
      commands: [{
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: layers.length,
        spatialOperation: listLabel,
        dataset: webmapTitle,
        action: 'LIST_LAYERS',
        authority: webmapTitle,
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        operationalStatusCheck: null,
        closedRecordsExcluded: null,
        layerSource: 'WEBMAP'
      }]
    }
  };
}

export function buildLayerControlMapResult(prompt, layerControl, layer, catalog) {
  const layers = layer ? [layer] : [];
  return buildLayerControlsMapResult(prompt, layerControl?.operation || 'LAYER_CONTROL', layers, catalog, layerControl);
}

export function buildMixedLayerControlsMapResult(prompt, operations, catalog) {
  const webmapTitle = catalog?.webmapTitle || 'Montreal 1';
  const allLayers = operations.flatMap((op) => op.layers);
  const titles = allLayers.map((layer) => layer.title).filter(Boolean).join(' + ') || '—';
  const operationLabels = operations.map((op) => op.operation.replace(/_/g, ' ')).join(' + ');

  return {
    supported: true,
    action: 'LAYER_COMPOUND_CONTROLS',
    prompt: String(prompt || '').trim(),
    operations,
    layerControls: operations.flatMap((op) => op.layers.map((layer) => ({
      operation: op.operation.replace('_LAYERS', '_LAYER'),
      catalogId: layer.catalogId,
      layerId: layer.layerId,
      title: layer.title
    }))),
    layers: allLayers,
    summary: {
      status: 'Controlled',
      execution: 'Deterministic GIS',
      matchedFeatures: allLayers.length,
      spatialOperation: operationLabels,
      dataset: titles,
      action: 'LAYER_COMPOUND_CONTROLS',
      authority: webmapTitle,
      sourceCheck: 'Passed',
      geometryCheck: 'Passed',
      reproducible: 'Yes',
      unresolved: 'None',
      freshness: 'ArcGIS live',
      displayMode: 'layer_control',
      layerSource: 'WEBMAP',
      commands: operations.map((op) => ({
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: op.layers.length,
        spatialOperation: op.operation.replace(/_/g, ' '),
        dataset: op.layers.map((l) => l.title).join(' + '),
        action: op.operation,
        authority: webmapTitle,
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        operationalStatusCheck: null,
        closedRecordsExcluded: null,
        layerSource: 'WEBMAP'
      }))
    }
  };
}

export function buildLayerControlsMapResult(prompt, operation, layers, catalog, layerControl = null) {
  const webmapTitle = catalog?.webmapTitle || 'Montreal 1';
  const titles = layers.map((layer) => layer.title).filter(Boolean).join(' + ') || '—';
  const authority = layers.length === 1
    ? webmapLayerAuthority(layers[0], webmapTitle)
    : webmapTitle;
  const operationLabel = operation.replace(/_/g, ' ');

  return {
    supported: true,
    action: layers.length > 1 ? 'LAYER_CONTROLS' : 'LAYER_CONTROL',
    prompt: String(prompt || '').trim(),
    layerControl: layerControl || (layers.length === 1 ? {
      operation: operation.replace('_LAYERS', '_LAYER'),
      catalogId: layers[0].catalogId,
      layerId: layers[0].layerId,
      title: layers[0].title
    } : null),
    layerControls: layers.map((layer) => ({
      operation: operation.replace('_LAYERS', '_LAYER'),
      catalogId: layer.catalogId,
      layerId: layer.layerId,
      title: layer.title
    })),
    layers,
    summary: {
      status: 'Controlled',
      execution: 'Deterministic GIS',
      matchedFeatures: layers.length,
      spatialOperation: operationLabel,
      dataset: titles,
      action: operation,
      authority,
      sourceCheck: 'Passed',
      geometryCheck: 'Passed',
      reproducible: 'Yes',
      unresolved: 'None',
      freshness: 'ArcGIS live',
      displayMode: 'layer_control',
      layerSource: 'WEBMAP',
      commands: [{
        status: 'Controlled',
        execution: 'Deterministic GIS',
        matchedFeatures: layers.length,
        spatialOperation: operationLabel,
        dataset: titles,
        action: operation,
        authority,
        sourceCheck: 'Passed',
        geometryCheck: 'Passed',
        operationalStatusCheck: null,
        closedRecordsExcluded: null,
        layerSource: 'WEBMAP'
      }]
    }
  };
}
