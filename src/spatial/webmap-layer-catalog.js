import { normalizeForMatch } from './spatial-language-pack.js';
import { resolveDatasetIdFromPhrase } from './spatial-compound-planner.js';
import { resolveSemanticCategoryFromText } from './semantic-category-registry.js';
import { resolveDynamicSemanticFromVocabulary } from './dynamic-semantic-resolver.js';
import {
  aliasTokensForTitle,
  normalizeLayerPhrase,
  normalizeLayerKey
} from './webmap-layer-aliases.js';

export const WEBMAP_LAYER_CLASSIFICATION = 'CURRENT_WEBMAP';

const COMPACT_GEOMETRY_TO_ESRI = {
  p: 'esriGeometryPoint',
  l: 'esriGeometryPolyline',
  x: 'esriGeometryPolygon',
  g: 'esriGeometryMultipoint'
};

const COMPACT_TYPE_TO_LAYER = {
  f: 'feature',
  g: 'group',
  t: 'tile',
  i: 'imagery',
  u: 'unknown'
};

/**
 * @param {string | null | undefined} geometryType
 */
function compactGeometryType(geometryType) {
  const geometry = String(geometryType || '').toLowerCase();
  if (!geometry) return null;
  if (geometry === 'point' || geometry === 'esrigeometrypoint') return 'p';
  if (geometry === 'polyline' || geometry === 'line' || geometry === 'esrigeometrypolyline') return 'l';
  if (geometry === 'polygon' || geometry === 'esrigeometrypolygon') return 'x';
  if (geometry === 'multipoint' || geometry === 'esrigeometrymultipoint') return 'g';
  return geometryType;
}

/**
 * @param {string | null | undefined} compactGeometry
 */
function expandCompactGeometryType(compactGeometry) {
  if (!compactGeometry) return null;
  return COMPACT_GEOMETRY_TO_ESRI[compactGeometry] || compactGeometry;
}

/**
 * @param {string | null | undefined} layerType
 */
function compactLayerType(layerType) {
  const type = String(layerType || '').toLowerCase();
  if (!type || type === 'feature') return null;
  if (type === 'group') return 'g';
  if (type === 'tile') return 't';
  if (type === 'imagery') return 'i';
  if (type === 'unknown') return 'u';
  return layerType;
}

/**
 * @param {string | null | undefined} compactType
 */
function expandCompactLayerType(compactType) {
  if (!compactType) return 'feature';
  return COMPACT_TYPE_TO_LAYER[compactType] || compactType;
}

export const LAYER_NOT_AVAILABLE_MESSAGE =
  'Layer not available in the current map or verified library.';

/**
 * @param {object} catalog
 */
export function getCatalogLayers(catalog) {
  return Array.isArray(catalog?.layers) ? catalog.layers : [];
}

/**
 * @param {object} catalog
 * @param {string | null} filter
 */
export function filterCatalogLayers(catalog, filter = null) {
  const layers = getCatalogLayers(catalog);
  if (!filter) return layers;
  if (filter === 'point') {
    return layers.filter((layer) => {
      const geometry = String(layer.geometryType || '').toLowerCase();
      return geometry === 'point' || geometry === 'esrigeometrypoint';
    });
  }
  return layers;
}

/**
 * Score phrase match against a catalog entry.
 * @param {string} phrase
 * @param {object} entry
 */
function scoreLayerMatch(phrase, entry) {
  const normalizedPhrase = normalizeLayerPhrase(phrase);
  if (!normalizedPhrase) return 0;

  const titleKey = normalizeLayerKey(entry.title);
  if (!titleKey) return 0;

  if (normalizedPhrase === titleKey) return 100;
  if (titleKey === normalizedPhrase) return 100;

  const tokens = aliasTokensForTitle(entry.title);
  if (tokens.has(normalizedPhrase)) return 90;

  let best = 0;
  for (const token of tokens) {
    if (normalizedPhrase === token) best = Math.max(best, 85);
    if (normalizedPhrase.includes(token) && token.length >= 3) {
      best = Math.max(best, 60 + token.length);
    }
    if (token.includes(normalizedPhrase) && normalizedPhrase.length >= 3) {
      best = Math.max(best, 55 + normalizedPhrase.length);
    }
  }

  if (titleKey.includes(normalizedPhrase) && normalizedPhrase.length >= 3) {
    best = Math.max(best, 50 + normalizedPhrase.length);
  }

  return best;
}

/**
 * Resolve WebMap layer entries from a phrase.
 * @param {string} phrase
 * @param {object | null} catalog
 */
export function resolveWebMapLayersFromPhrase(phrase, catalog) {
  const layers = getCatalogLayers(catalog);
  if (!layers.length) return { matches: [], score: 0 };

  const scored = layers
    .map((entry) => ({ entry, score: scoreLayerMatch(phrase, entry) }))
    .filter((item) => item.score >= 50)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { matches: [], score: 0 };

  const topScore = scored[0].score;
  const matches = scored.filter((item) => item.score === topScore).map((item) => item.entry);
  return { matches, score: topScore };
}

/**
 * Resolve layer by catalog id.
 * @param {string} catalogId
 * @param {object | null} catalog
 */
export function getCatalogLayerById(catalogId, catalog) {
  if (!catalogId) return null;
  return getCatalogLayers(catalog).find((entry) => entry.catalogId === catalogId) || null;
}

const TRANSIT_STOP_PHRASES = new Set([
  'transit', 'stm', 'metro', 'subway', 'bus', 'arret', 'arrets', 'stop', 'stops'
]);

const SCHOOL_PHRASES = new Set([
  'school', 'schools', 'ecole', 'ecoles', 'etablissement scolaire', 'etablissements scolaires'
]);

function isTransitStopPhrase(phraseKey) {
  if (!phraseKey) return false;
  if (TRANSIT_STOP_PHRASES.has(phraseKey)) return true;
  return ['transit', 'stm', 'metro', 'subway', 'bus', 'arret', 'stop']
    .some((token) => phraseKey.includes(token));
}

function isSchoolPhrase(phraseKey) {
  if (!phraseKey) return false;
  if (SCHOOL_PHRASES.has(phraseKey)) return true;
  return ['school', 'ecole', 'etablissement scolaire']
    .some((token) => phraseKey.includes(token));
}

/**
 * Prefer STM stop layers over route/line layers for transit stop queries.
 * @param {object[]} matches
 */
function disambiguateTransitStopLayer(matches) {
  const stops = matches.filter((entry) => /arret/i.test(entry.title || ''));
  if (!stops.length) return null;
  if (stops.length === 1) return stops[0];
  const sigStop = stops.find((entry) => /sig/i.test(entry.title || ''));
  return sigStop || stops[0];
}

/**
 * Schools are not a dedicated WebMap layer — query Montreal POI schools category.
 * @param {object | null} catalog
 */
function resolveSchoolsFromMontrealPoi(catalog) {
  const poi = getCatalogLayers(catalog).find((entry) => normalizeLayerKey(entry.title) === 'montreal poi');
  if (!poi) return null;
  return {
    layerSource: 'WEBMAP',
    webmapLayer: poi,
    webmapCatalogId: poi.catalogId,
    displayNameOverride: 'Schools',
    attributeWhere: "Catégorie = 'Établissement scolaire'"
  };
}

function buildWebMapTarget(entry, extras = {}) {
  return {
    layerSource: 'WEBMAP',
    webmapLayer: entry,
    webmapCatalogId: entry.catalogId,
    ...extras
  };
}

/**
 * Priority: WebMap LayerCatalog then verified dataset registry.
 * @param {string} phrase
 * @param {object | null} catalog
 * @param {{ vocabularyContext?: object[] }} [options]
 */
export function resolveTargetFromPhrase(phrase, catalog, options = {}) {
  const phraseKey = normalizeLayerPhrase(phrase);
  const webmap = resolveWebMapLayersFromPhrase(phrase, catalog);
  if (webmap.matches.length > 1) {
    if (isTransitStopPhrase(phraseKey)) {
      const stopLayer = disambiguateTransitStopLayer(webmap.matches);
      if (stopLayer) {
        return buildWebMapTarget(stopLayer, { displayNameOverride: 'Transit Stops' });
      }
    }
    const narrowed = webmap.matches.filter((entry) => {
      const titleKey = normalizeLayerKey(entry.title);
      return titleKey.includes(phraseKey) || phraseKey.includes(titleKey)
        || aliasTokensForTitle(entry.title).has(phraseKey);
    });
    if (narrowed.length === 1) {
      return buildWebMapTarget(narrowed[0]);
    }
    return {
      ambiguous: true,
      candidates: webmap.matches.map((entry) => entry.title).filter(Boolean)
    };
  }
  if (webmap.matches.length === 1) {
    const layer = webmap.matches[0];
    if (isSchoolPhrase(phraseKey) && normalizeLayerKey(layer.title) === 'montreal poi') {
      return buildWebMapTarget(layer, {
        displayNameOverride: 'Schools',
        attributeWhere: "Catégorie = 'Établissement scolaire'"
      });
    }
    const extras = isTransitStopPhrase(phraseKey) && /arret/i.test(layer.title || '')
      ? { displayNameOverride: 'Transit Stops' }
      : {};
    return buildWebMapTarget(layer, extras);
  }

  if (isSchoolPhrase(phraseKey)) {
    const schoolsTarget = resolveSchoolsFromMontrealPoi(catalog);
    if (schoolsTarget) return schoolsTarget;
  }

  const datasetId = resolveDatasetIdFromPhrase(phrase);
  if (datasetId) {
    return {
      layerSource: 'VERIFIED',
      datasetIds: [datasetId]
    };
  }

  const semanticCategory = resolveSemanticCategoryFromText(phrase);
  if (semanticCategory) {
    return {
      layerSource: 'TRUSTED_EXTERNAL',
      conceptId: semanticCategory.conceptId,
      sourceId: semanticCategory.sourceId,
      categoryFilter: semanticCategory.filter,
      semanticCategory,
      semanticField: semanticCategory.filter?.field || null,
      semanticValue: semanticCategory.filter?.value || null
    };
  }

  if (options.vocabularyContext?.length) {
    const dynamic = resolveDynamicSemanticFromVocabulary(phrase, options.vocabularyContext);
    if (dynamic?.ambiguous) {
      return {
        ambiguous: true,
        candidates: dynamic.candidates
      };
    }
    if (dynamic?.conceptId) {
      return {
        layerSource: 'TRUSTED_EXTERNAL',
        conceptId: dynamic.conceptId,
        sourceId: dynamic.sourceId,
        categoryFilter: dynamic.filter,
        semanticCategory: dynamic,
        semanticField: dynamic.semanticField,
        semanticValue: dynamic.semanticValue
      };
    }
  }

  return {
    notFound: true,
    label: String(phrase || '').trim() || 'unknown layer'
  };
}

/**
 * @param {object | null} catalog
 */
export function summarizeLayerCatalog(catalog) {
  const layers = getCatalogLayers(catalog);
  const featureLayers = layers.filter((layer) => layer.type === 'feature');
  const queryable = featureLayers.filter((layer) => layer.queryable);
  const groupLayers = layers.filter((layer) => layer.type === 'group');
  const nestedGroupLayers = groupLayers.filter((layer) => layer.parentGroup);

  return {
    operationalLayersDiscovered: layers.length,
    featureLayers: featureLayers.length,
    queryableLayers: queryable.length,
    nestedGroupLayers: nestedGroupLayers.length,
    webmapTitle: catalog?.webmapTitle || null
  };
}

/**
 * Build authority label for ledger / provenance.
 * @param {object} entry
 * @param {string} [webmapTitle]
 */
export function webmapLayerAuthority(entry, webmapTitle = 'Montreal 1') {
  const parent = entry.parentGroup ? `${entry.parentGroup} / ` : '';
  return `${webmapTitle} / ${parent}${entry.title || entry.catalogId}`;
}

/**
 * Expand compact POST catalog into planner-facing layer entries.
 * @param {object | null} catalog
 */
export function normalizeMapRequestCatalog(catalog) {
  if (!catalog?.layers?.length) return catalog;
  if (!catalog.compact) return catalog;

  const layers = catalog.layers.map((layer) => {
    const catalogId = layer.catalogId || layer.c;
    const title = layer.title || layer.t || catalogId;
    const entry = {
      catalogId,
      title,
      type: expandCompactLayerType(layer.type || layer.y),
      queryable: layer.queryable ?? layer.q ?? (expandCompactLayerType(layer.type || layer.y) === 'feature'),
      visible: Boolean(layer.visible ?? layer.v)
    };
    const layerId = layer.layerId || layer.l;
    if (layerId && layerId !== catalogId) entry.layerId = layerId;
    const parentGroup = layer.parentGroup || layer.g;
    if (parentGroup) entry.parentGroup = parentGroup;
    const geometryType = expandCompactGeometryType(layer.geometryType || layer.m);
    if (geometryType) entry.geometryType = geometryType;
    entry.classification = layer.classification || WEBMAP_LAYER_CLASSIFICATION;
    return entry;
  });

  return {
    webmapTitle: catalog.webmapTitle || null,
    webmapItemId: catalog.webmapItemId || null,
    classification: catalog.classification || WEBMAP_LAYER_CLASSIFICATION,
    compact: true,
    layers,
    summary: catalog.summary || summarizeLayerCatalog({ layers })
  };
}

/**
 * Compact catalog for POST /api/spatial/map — planning metadata only.
 * Full fields/popup/schema stay client-side; url omitted (client enriches queries).
 * @param {object | null} catalog
 */
export function buildCompactWebMapLayerCatalog(catalog) {
  if (!catalog?.layers?.length) return null;

  const layers = catalog.layers.map((layer) => {
    const catalogId = layer.catalogId;
    const entry = {
      c: catalogId,
      t: layer.title || catalogId
    };
    const compactType = compactLayerType(layer.type);
    if (compactType) entry.y = compactType;
    if (layer.layerId && layer.layerId !== catalogId) entry.l = layer.layerId;
    if (layer.parentGroup) entry.g = layer.parentGroup;
    const compactGeometry = compactGeometryType(layer.geometryType);
    if (compactGeometry) entry.m = compactGeometry;
    if (layer.visible) entry.v = 1;
    return entry;
  });

  return {
    compact: true,
    layers
  };
}
