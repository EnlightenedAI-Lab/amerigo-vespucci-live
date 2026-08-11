import { getDatasetById } from './dataset-registry.js';
import {
  loadLanguagePack,
  normalizeForMatch,
  normalizeNumerals,
  stripFillerWords,
  normalizePrompt,
  getDatasetAliasMap,
  CLARIFICATION
} from './spatial-language-pack.js';
import { unconfiguredDatasetMessage } from './mapper-intent.js';
import { matchAmenitiesXrayIntent, buildAmenitiesXrayPlan } from './amenity-xray-intent.js';
import { matchHydroOutageIntent } from './hydro-outage-intent.js';
import { matchAircraftLiveIntent } from './aircraft-live-intent.js';
import { matchVesselsLiveIntent } from './vessels-live-intent.js';
import {
  resolveTargetFromPhrase,
  resolveWebMapLayersFromPhrase,
  LAYER_NOT_AVAILABLE_MESSAGE
} from './webmap-layer-catalog.js';
import { hasExplicitSpatialIntent } from '../../public/spatial/spatial-intent-signals.js';
import { stripLeadingConversationalFiller } from '../../public/spatial/leading-conversational-filler.js';
import { matchShowLayerPhrase } from '../../public/spatial/show-verb-family.js';
import { normalizeTrailingVisibilityToLeading } from '../../public/spatial/trailing-visibility-phrase.js';

function cleanText(text) {
  return String(text || '').trim().replace(/[.?!]+$/g, '').trim();
}

function toRadiusMeters(km) {
  const value = parseFloat(km);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000);
}

function toLimit(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const LAYER_ONLY_ACTIONS = new Set([
  'LIST_LAYERS',
  'SHOW_LAYER',
  'HIDE_LAYER',
  'TOGGLE_LAYER',
  'ZOOM_TO_LAYER'
]);

/**
 * Resolve dataset id from phrase using alias map (longest match).
 * @param {string} phrase
 */
export function resolveDatasetIdFromPhrase(phrase) {
  const aliasMap = getDatasetAliasMap();
  const normalized = normalizeForMatch(phrase);
  if (!normalized) return null;

  let bestId = null;
  let bestLen = 0;
  for (const [alias, id] of aliasMap.entries()) {
    if (normalized.includes(alias) && alias.length > bestLen) {
      bestId = id;
      bestLen = alias.length;
    }
  }
  return bestId;
}

/**
 * Split dataset phrase on and/et into multiple dataset ids.
 * @param {string} phrase
 */
export function resolveDatasetsFromPhrase(phrase) {
  const parts = String(phrase || '')
    .split(/\s+(?:and|et)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return { datasetIds: [], unresolved: phrase };

  const ids = [];
  const seen = new Set();
  for (const part of parts) {
    const id = resolveDatasetIdFromPhrase(part);
    if (!id) return { datasetIds: [], unresolved: part };
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { datasetIds: ids, unresolved: null };
}

function buildTargetCommand(action, target, extra = {}) {
  if (target.ambiguous) {
    return {
      error: true,
      message: `Multiple layers match: ${target.candidates.join(', ')}. Please clarify.`
    };
  }
  if (target.notFound) {
    return {
      error: true,
      message: LAYER_NOT_AVAILABLE_MESSAGE
    };
  }
  if (target.layerSource === 'WEBMAP') {
    return {
      action,
      layerSource: 'WEBMAP',
      webmapLayer: target.webmapLayer,
      webmapCatalogId: target.webmapCatalogId,
      attributeWhere: target.attributeWhere || null,
      displayNameOverride: target.displayNameOverride || null,
      datasetIds: [],
      ...extra
    };
  }
  if (target.layerSource === 'TRUSTED_EXTERNAL') {
    return {
      action,
      layerSource: 'TRUSTED_EXTERNAL',
      conceptId: target.conceptId,
      sourceId: target.sourceId,
      categoryFilter: target.categoryFilter,
      semanticCategory: target.semanticCategory,
      semanticField: target.semanticField || target.categoryFilter?.field || null,
      semanticValue: target.semanticValue || target.categoryFilter?.value || null,
      datasetIds: [],
      ...extra
    };
  }
  return {
    action,
    layerSource: 'VERIFIED',
    datasetIds: target.datasetIds,
    ...extra
  };
}

function resolveQueryTarget(phrase, catalog, plannerOptions = {}) {
  return resolveTargetFromPhrase(phrase, catalog, {
    vocabularyContext: plannerOptions.vocabularyContext || null
  });
}

/**
 * Extract trailing location from compound prompt.
 * @param {string} text
 */
export function extractTrailingLocation(text) {
  const endPatterns = [
    /\s+to\s+(.+)$/i,
    /\s+(?:of|from)\s+(.+)$/i,
    /\s+(?:autour de|around)\s+(.+)$/i,
    /\s+(?:dans un rayon de|à moins de)\s+(.+)$/i,
    /\s+(?:near|près de)\s+(.+)$/i
  ];
  for (const pattern of endPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        body: text.slice(0, match.index).trim(),
        location: cleanText(match[1])
      };
    }
  }

  const deAfterKm = text.match(/^(.+?\d+\s*(?:km|kilometres?|kilometers?))\s+de\s+(.+)$/i);
  if (deAfterKm) {
    return { body: deAfterKm[1].trim(), location: cleanText(deAfterKm[2]) };
  }

  const deAfterProche = text.match(/^(.+?les plus proches?)\s+de\s+(.+)$/i);
  if (deAfterProche) {
    return { body: deAfterProche[1].trim(), location: cleanText(deAfterProche[2]) };
  }

  const closestTo = text.match(/^(.+?closest)\s+to\s+(.+)$/i);
  if (closestTo) {
    return { body: closestTo[1].trim(), location: cleanText(closestTo[2]) };
  }

  return { body: text, location: null };
}

const CLAUSE_BOUNDARY = ' §§§ ';

/**
 * Split compound body on comma / and boundaries into independent clauses.
 * @param {string} body
 * @param {object | null} [catalog]
 */
export function splitCompoundBody(body, catalog = null) {
  const pack = loadLanguagePack();
  const connectors = pack.filler.connectors || [' and ', ' et '];
  let text = String(body || '').trim();
  if (!text) return [body];

  text = text.replace(/,\s+and\s+/gi, CLAUSE_BOUNDARY);
  text = text.replace(
    /,\s+(?=(?:all\s+(?:active\s+)?|the\s+\d+|tous\s+|every\s+|hospitals?|police|fire\s+stations?|schools?|transit|caserne|casernes|poste|postes|pompier|spvm|metro|métro|stm|bus\s+stops?|arrêt))/gi,
    CLAUSE_BOUNDARY
  );

  const commaParts = text.split(CLAUSE_BOUNDARY).map((p) => p.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    const parsed = commaParts.map((part) => parseClause(part, catalog));
    if (parsed.every((p) => p !== null)) return commaParts;
  }

  const pattern = new RegExp(
    connectors.map((c) => escapeRegex(c.trim())).join('|'),
    'i'
  );
  const andParts = text.split(pattern).map((p) => p.trim()).filter(Boolean);
  if (andParts.length <= 1) return [body];

  const parsed = andParts.map((part) => parseClause(part, catalog));
  if (parsed.every((p) => p !== null)) return andParts;
  return [body];
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a single clause into a partial command object.
 * @param {string} clause
 * @param {object | null} [catalog]
 */
export function parseClause(clause, catalog = null, plannerOptions = {}) {
  let text = normalizeNumerals(normalizePrompt(clause));
  text = text.replace(/^the\s+/i, '').trim();
  text = text.replace(/^(?:map|show|display|afficher|montrer|give me|find me|put)\s+(?:the\s+)?/i, '').trim();
  text = text.replace(/^the\s+/i, '').trim();
  text = text.replace(/^every\s+/i, '').trim();
  text = text.replace(/^tous\s+/i, '').trim();
  text = text.replace(/^toutes\s+/i, '').trim();

  const activeOnly = /\b(active only|only active|all active)\b/i.test(text);
  text = text.replace(/\b(active only|only active|all active)\b/gi, '').trim();
  text = text.replace(/^all\s+/i, '').trim();

  const nearestMatch = text.match(/^(\d+)\s+(?:nearest|closest|plus proches?)\s+(.+)$/i)
    || text.match(/^(\d+)\s+(.+?)\s+(?:nearest|closest|plus proches?)$/i)
    || text.match(/^the\s+(\d+)\s+(.+?)\s+closest$/i)
    || text.match(/^the\s+nearest\s+(\d+)\s+(.+)$/i)
    || text.match(/^nearest\s+(\d+)\s+(.+)$/i)
    || text.match(/^the\s+(\d+)\s+(?:nearest|closest)\s+(.+)$/i);
  if (nearestMatch) {
    const limit = toLimit(nearestMatch[1]);
    const datasetPhrase = nearestMatch[2].trim();
    const target = resolveQueryTarget(datasetPhrase, catalog, plannerOptions);
    if (target.error) return null;
    if (target.ambiguous || target.notFound) {
      const { datasetIds } = resolveDatasetsFromPhrase(datasetPhrase);
      if (!datasetIds.length) return null;
      return {
        action: 'NEAREST',
        datasetIds,
        limit,
        activeOnly
      };
    }
    const built = buildTargetCommand('NEAREST', target, { limit, activeOnly });
    if (built.error) return null;
    return built;
  }

  const nearestFr = text.match(/^(?:les\s+)?(\d+)\s+(.+?)\s+les plus proches?$/i);
  if (nearestFr) {
    const target = resolveQueryTarget(nearestFr[2], catalog, plannerOptions);
    if (target.error) return null;
    if (target.ambiguous || target.notFound) {
      const { datasetIds } = resolveDatasetsFromPhrase(nearestFr[2]);
      if (!datasetIds.length) return null;
      return {
        action: 'NEAREST',
        datasetIds,
        limit: toLimit(nearestFr[1]),
        activeOnly
      };
    }
    const built = buildTargetCommand('NEAREST', target, {
      limit: toLimit(nearestFr[1]),
      activeOnly
    });
    if (built.error) return null;
    return built;
  }

  const countMatch = text.match(/^(?:count|how many|number of|combien|nombre de)\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*km$/i)
    || text.match(/^(?:count|how many|combien)\s+(.+?)\s+(?:dans un rayon de|à moins de)\s+(\d+(?:\.\d+)?)\s*km$/i);
  if (countMatch) {
    const target = resolveQueryTarget(countMatch[1], catalog, plannerOptions);
    const distanceKm = parseFloat(countMatch[2]);
    if (target.ambiguous || target.notFound) {
      const { datasetIds } = resolveDatasetsFromPhrase(countMatch[1]);
      if (!datasetIds.length) return null;
      return {
        action: 'COUNT',
        datasetIds,
        distanceKm,
        activeOnly
      };
    }
    const built = buildTargetCommand('COUNT', target, { distanceKm, activeOnly });
    if (built.error) return null;
    return built;
  }

  const withinMatch = text.match(/^(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*(?:km|kilometres?|kilometers?)$/i)
    || text.match(/^(.+?)\s+(?:dans un rayon de|à moins de|autour de)\s+(\d+(?:\.\d+)?)\s*(?:km|kilometres?|kilometers?)$/i)
    || text.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(?:km|kilometres?|kilometers?)$/i);
  if (withinMatch) {
    const target = resolveQueryTarget(withinMatch[1], catalog, plannerOptions);
    const distanceKm = parseFloat(withinMatch[2]);
    if (target.ambiguous || target.notFound) {
      const { datasetIds } = resolveDatasetsFromPhrase(withinMatch[1]);
      if (!datasetIds.length) return null;
      return {
        action: 'WITHIN',
        datasetIds,
        distanceKm,
        activeOnly
      };
    }
    const built = buildTargetCommand('WITHIN', target, { distanceKm, activeOnly });
    if (built.error) return null;
    return built;
  }

  const locateMatch = text.match(/^(?:locate|put a point at|place a point at|mark|localiser|placer un point(?:\s+à)?)\s+(.+)$/i);
  if (locateMatch) {
    return { action: 'LOCATE', datasetIds: [], location: cleanText(locateMatch[1]) };
  }

  const showMontreal = text.match(/^(.+?)\s+in\s+montreal$/i);
  if (showMontreal) {
    const target = resolveQueryTarget(showMontreal[1], catalog, plannerOptions);
    if (target.ambiguous || target.notFound) {
      const { datasetIds } = resolveDatasetsFromPhrase(showMontreal[1]);
      if (!datasetIds.length) return null;
      return { action: 'SHOW', datasetIds, location: 'Montreal', activeOnly };
    }
    const built = buildTargetCommand('SHOW', target, { location: 'Montreal', activeOnly });
    if (built.error) return null;
    return built;
  }

  return null;
}

function buildLayerControlPlan(operation, phrase, catalog) {
  const resolved = resolveWebMapLayersFromPhrase(phrase, catalog);
  if (resolved.matches.length > 1) {
    return {
      supported: false,
      message: `Multiple layers match: ${resolved.matches.map((m) => m.title).join(', ')}. Please clarify.`
    };
  }
  if (!resolved.matches.length) {
    return { supported: false, message: LAYER_NOT_AVAILABLE_MESSAGE };
  }
  const layer = resolved.matches[0];
  return {
    supported: true,
    commands: [{
      action: operation,
      layerSource: 'WEBMAP',
      webmapLayer: layer,
      webmapCatalogId: layer.catalogId,
      datasetIds: []
    }]
  };
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

function planLayerCatalogCommands(normalized, catalog) {
  if (!catalog?.layers?.length) return null;

  const commandText = stripLeadingConversationalFiller(normalized);
  if (!commandText) return null;

  if (/^what layers do I have$/i.test(commandText) || /^list (?:all )?layers$/i.test(commandText)) {
    return { supported: true, commands: [{ action: 'LIST_LAYERS', filter: null }] };
  }
  if (/^what point layers do I have$/i.test(commandText)) {
    return { supported: true, commands: [{ action: 'LIST_LAYERS', filter: 'point' }] };
  }

  const zoomMatch = commandText.match(/^zoom to\s+(.+)$/i);
  if (zoomMatch) {
    return buildLayerControlPlan('ZOOM_TO_LAYER', zoomMatch[1], catalog);
  }

  if (!hasExplicitSpatialIntent(commandText)) {
    const trailingLeading = normalizeTrailingVisibilityToLeading(commandText);
    const layerCommandText = trailingLeading || commandText;

    const hidePhrase = extractSourceLayerHidePhrase(layerCommandText);
    if (hidePhrase) {
      return buildLayerControlPlan('HIDE_LAYER', hidePhrase, catalog);
    }

    const toggleMatch = layerCommandText.match(/^toggle\s+(.+)$/i);
    if (toggleMatch) {
      return buildLayerControlPlan('TOGGLE_LAYER', toggleMatch[1], catalog);
    }

    const showPhrase = matchShowLayerPhrase(layerCommandText);
    if (showPhrase) {
      return buildLayerControlPlan('SHOW_LAYER', showPhrase, catalog);
    }
  }

  return null;
}

function hasQueryTarget(cmd) {
  return Boolean(
    cmd.webmapCatalogId
    || cmd.datasetIds?.length
    || cmd.conceptId
    || cmd.action === 'CATEGORY_COUNTS_WITHIN'
  );
}

/**
 * Build SpatialPlan from normalized prompt.
 * @param {string} prompt
 * @param {{ webmapLayerCatalog?: object }} [options]
 */
export function planCompoundPrompt(prompt, options = {}) {
  const catalog = options.webmapLayerCatalog || null;
  const plannerOptions = {
    vocabularyContext: options.vocabularyContext || null
  };
  const raw = normalizePrompt(prompt);
  if (!raw) {
    return { supported: false, clarification: CLARIFICATION.specifyWhat };
  }

  const stripped = stripFillerWords(raw);
  if (!stripped) {
    return { supported: false, clarification: CLARIFICATION.specifyWhat };
  }

  const normalized = normalizeNumerals(stripped);

  if (/^(?:clear(?:\s+the)?(?:\s+map)?|clear\s+(?:the\s+)?results?|remove(?:\s+the)?\s+results?|effacer|supprimer les résultats)$/i.test(normalized)) {
    return { supported: true, commands: [{ action: 'CLEAR' }] };
  }

  if (!normalized || /^(?:show|map|display|afficher|montrer)$/i.test(normalized)) {
    return { supported: false, clarification: CLARIFICATION.specifyWhat };
  }

  if (/important places/i.test(normalized) || /^important places nearby$/i.test(normalized)) {
    return { supported: false, clarification: CLARIFICATION.specifyDataset };
  }

  if (/^nearby$/i.test(normalized) || /important places nearby/i.test(normalized)) {
    return { supported: false, clarification: CLARIFICATION.specifyDataset };
  }

  const amenitiesMatch = matchAmenitiesXrayIntent(normalized);
  if (amenitiesMatch) {
    const plan = buildAmenitiesXrayPlan(amenitiesMatch);
    if (plan) return plan;
  }

  const aircraftIntent = matchAircraftLiveIntent(normalized);
  if (aircraftIntent) {
    const layerPlan = buildLayerControlPlan('SHOW_LAYER', aircraftIntent.phrase, catalog);
    if (!layerPlan.supported) return layerPlan;
    return {
      supported: true,
      commands: [...layerPlan.commands]
    };
  }

  const vesselsIntent = matchVesselsLiveIntent(normalized);
  if (vesselsIntent) {
    const layerPlan = buildLayerControlPlan('SHOW_LAYER', vesselsIntent.phrase, catalog);
    if (!layerPlan.supported) return layerPlan;
    return {
      supported: true,
      commands: [...layerPlan.commands]
    };
  }

  const hydroIntent = matchHydroOutageIntent(normalized);
  if (hydroIntent) {
    const layerPlan = buildLayerControlPlan('SHOW_LAYER', hydroIntent.phrase, catalog);
    if (!layerPlan.supported) return layerPlan;
    const commands = [...layerPlan.commands];
    if (hydroIntent.locationText) {
      commands.push({
        action: 'LOCATE',
        datasetIds: [],
        location: hydroIntent.locationText,
        radiusMeters: hydroIntent.radiusMeters
      });
    }
    return {
      supported: true,
      commands,
      sharedLocation: hydroIntent.locationText || null
    };
  }

  const layerCatalogPlan = planLayerCatalogCommands(normalized, catalog);
  if (layerCatalogPlan) return layerCatalogPlan;

  const locateFull = normalized.match(/^(?:locate|put a point at|place a point at|map this address|mark|localiser|placer un point(?:\s+à)?)\s+(.+)$/i);
  if (locateFull) {
    return {
      supported: true,
      commands: [{
        action: 'LOCATE',
        datasetIds: [],
        location: cleanText(locateFull[1])
      }]
    };
  }

  const { body, location } = extractTrailingLocation(normalized);

  const singleClause = parseClause(normalized, catalog, plannerOptions)
    || parseClause(body || normalized, catalog, plannerOptions);
  if (singleClause && !location && singleClause.action !== 'NEAREST' && singleClause.action !== 'WITHIN' && singleClause.action !== 'COUNT') {
    if (singleClause.action === 'LOCATE' && singleClause.location) {
      return { supported: true, commands: [singleClause], sharedLocation: singleClause.location };
    }
  }

  const clauseTexts = splitCompoundBody(body || normalized, catalog);
  const commands = [];

  for (const clauseText of clauseTexts) {
    const clause = parseClause(clauseText, catalog, plannerOptions);
    if (!clause) break;
    commands.push(clause);
  }

  if (!commands.length) {
    const withLoc = parseClause(body || normalized, catalog, plannerOptions);
    if (withLoc && location) {
      withLoc.location = location;
      return {
        supported: true,
        commands: [withLoc],
        sharedLocation: location
      };
    }

    const nuclear = normalized.match(/(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*km\s+(?:of|from)\s+(.+)/i);
    if (nuclear) {
      const target = resolveQueryTarget(nuclear[1], catalog, plannerOptions);
      if (target.layerSource === 'WEBMAP') {
        return {
          supported: true,
          commands: [{
            action: 'WITHIN',
            layerSource: 'WEBMAP',
            webmapLayer: target.webmapLayer,
            webmapCatalogId: target.webmapCatalogId,
            datasetIds: [],
            distanceKm: parseFloat(nuclear[2]),
            radiusMeters: toRadiusMeters(nuclear[2]),
            location: cleanText(nuclear[3])
          }],
          sharedLocation: cleanText(nuclear[3])
        };
      }
      if (target.layerSource === 'TRUSTED_EXTERNAL') {
        return {
          supported: true,
          commands: [{
            action: 'WITHIN',
            layerSource: 'TRUSTED_EXTERNAL',
            conceptId: target.conceptId,
            sourceId: target.sourceId,
            categoryFilter: target.categoryFilter,
            semanticCategory: target.semanticCategory,
            semanticField: target.semanticField || target.categoryFilter?.field || null,
            semanticValue: target.semanticValue || target.categoryFilter?.value || null,
            datasetIds: [],
            distanceKm: parseFloat(nuclear[2]),
            radiusMeters: toRadiusMeters(nuclear[2]),
            location: cleanText(nuclear[3])
          }],
          sharedLocation: cleanText(nuclear[3])
        };
      }
      if (target.ambiguous) {
        return {
          supported: false,
          message: `Multiple layers match: ${target.candidates.join(', ')}. Please clarify.`
        };
      }
      const id = resolveDatasetIdFromPhrase(nuclear[1]);
      if (!id) {
        return { supported: false, message: LAYER_NOT_AVAILABLE_MESSAGE };
      }
    }

    return { supported: false, message: 'Unsupported deterministic MAP operation' };
  }

  const sharedLocation = location || null;

  let anchorLocation = sharedLocation;
  for (const cmd of commands) {
    if (cmd.action === 'LOCATE' && cmd.location) {
      anchorLocation = cmd.location;
      break;
    }
  }

  for (const cmd of commands) {
    if (!cmd.location && anchorLocation) {
      cmd.location = anchorLocation;
    }
    if (cmd.distanceKm != null) {
      cmd.radiusMeters = toRadiusMeters(cmd.distanceKm);
    }
  }

  for (const cmd of commands) {
    if (cmd.action === 'CLEAR') continue;
    if (cmd.action === 'LOCATE') continue;
    if (LAYER_ONLY_ACTIONS.has(cmd.action)) continue;
    if (!hasQueryTarget(cmd)) {
      return { supported: false, message: LAYER_NOT_AVAILABLE_MESSAGE };
    }
    if ((cmd.action === 'WITHIN' || cmd.action === 'COUNT') && !cmd.radiusMeters) {
      return { supported: false, message: 'Unsupported deterministic MAP operation' };
    }
    if (cmd.action === 'NEAREST' && !cmd.limit) {
      return { supported: false, message: 'Unsupported deterministic MAP operation' };
    }
  }

  const expandedCommands = [];
  for (const cmd of commands) {
    if (cmd.datasetIds?.length > 1 && cmd.action === 'WITHIN') {
      for (const id of cmd.datasetIds) {
        expandedCommands.push({
          action: cmd.action,
          datasetIds: [id],
          distanceKm: cmd.distanceKm,
          radiusMeters: cmd.radiusMeters,
          location: cmd.location || sharedLocation,
          activeOnly: cmd.activeOnly
        });
      }
    } else if (cmd.datasetIds?.length > 1 && cmd.action === 'NEAREST') {
      for (const id of cmd.datasetIds) {
        expandedCommands.push({
          action: cmd.action,
          datasetIds: [id],
          limit: cmd.limit,
          location: cmd.location || sharedLocation,
          activeOnly: cmd.activeOnly
        });
      }
    } else {
      expandedCommands.push({
        ...cmd,
        location: cmd.location || sharedLocation
      });
    }
  }

  return {
    supported: true,
    commands: expandedCommands,
    sharedLocation
  };
}

export function commandToSpatialCommand(cmd) {
  const datasets = (cmd.datasetIds || []).map((id) => getDatasetById(id)).filter(Boolean);
  return {
    action: cmd.action,
    dataset: cmd.datasetIds?.[0] || cmd.conceptId || cmd.webmapCatalogId || null,
    datasetIds: cmd.datasetIds || [],
    datasets,
    webmapCatalogId: cmd.webmapCatalogId || null,
    webmapLayer: cmd.webmapLayer || null,
    layerSource: cmd.layerSource || (cmd.conceptId ? 'TRUSTED_EXTERNAL' : (cmd.webmapCatalogId ? 'WEBMAP' : 'VERIFIED')),
    conceptId: cmd.conceptId || null,
    sourceId: cmd.sourceId || null,
    categoryFilter: cmd.categoryFilter || null,
    semanticCategory: cmd.semanticCategory || null,
    semanticField: cmd.semanticField || cmd.categoryFilter?.field || null,
    semanticValue: cmd.semanticValue || cmd.categoryFilter?.value || null,
    limit: cmd.limit || null,
    distanceKm: cmd.distanceKm || (cmd.radiusMeters ? cmd.radiusMeters / 1000 : null),
    location: cmd.location || null,
    radiusMeters: cmd.radiusMeters || null,
    activeOnly: cmd.activeOnly || false,
    displayMode: cmd.action === 'COUNT' ? 'count' : 'points'
  };
}

export { LAYER_ONLY_ACTIONS };
