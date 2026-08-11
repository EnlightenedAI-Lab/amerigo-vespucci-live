/**
 * Natural-language ArcGIS discovery → search → validated direct-add.
 * Reuses existing portal search and addArcgisDataFromInput — no fabricated IDs.
 */
import { searchArcgisData, addArcgisPortalItem } from './arcgis-data-add-service.js';
import { fetchPortalItemMetadata } from './arcgis-data-add-search.js';
import { ARCGIS_CONTENT_SOURCES } from './arcgis-data-add-search-config.js';
import { expandArcgisDiscoveryQueries } from './arcgis-discovery-query-expansion.js';
import { rankArcgisDiscoveryResults } from './arcgis-discovery-qualification.js';

/**
 * @param {string} prompt
 */
export function extractArcgisDiscoverySearchQuery(prompt = '') {
  return String(prompt)
    .replace(/^(?:find|map|show|add)\s+(?:an?\s+)?(?:authoritative\s+)?(?:arcgis\s+)?/i, '')
    .replace(/\b(?:layer|layers)\s+(?:showing|for|of)\s+/i, '')
    .replace(/\s+(?:and\s+)?add\s+it\s+to\s+the\s+map\.?$/i, '')
    .replace(/\s+to\s+the\s+map\.?$/i, '')
    .trim();
}

/**
 * @param {string} prompt
 */
export function resolveArcgisDiscoverySources(prompt = '') {
  const preferLivingAtlas = /\bliving atlas\b/i.test(prompt);
  if (preferLivingAtlas) {
    return [ARCGIS_CONTENT_SOURCES.LIVING_ATLAS, ARCGIS_CONTENT_SOURCES.ARCGIS_ONLINE];
  }
  return [ARCGIS_CONTENT_SOURCES.ARCGIS_ONLINE, ARCGIS_CONTENT_SOURCES.LIVING_ATLAS];
}

/**
 * @param {object[]} items
 * @param {object} options
 */
async function enrichArcgisDiscoveryCandidates(items = [], options = {}) {
  if (!options.authorityRequired) return items;
  const enriched = [];
  for (const item of items) {
    if (!item?.id) {
      enriched.push(item);
      continue;
    }
    try {
      const meta = await fetchPortalItemMetadata(item.id, { source: item.contentSource });
      enriched.push({ ...item, ...meta });
    } catch {
      enriched.push(item);
    }
  }
  return enriched;
}

/**
 * @param {string} prompt
 * @param {object} [options]
 */
export async function runArcgisDiscoveryFromPrompt(prompt, options = {}) {
  const query = extractArcgisDiscoverySearchQuery(prompt) || String(prompt).trim();
  if (!query) {
    return {
      ok: false,
      message: 'Enter an ArcGIS layer search term.',
      searchQuery: '',
      results: []
    };
  }

  const authorityRequired = /\bauthoritative\b/i.test(prompt);
  const queries = expandArcgisDiscoveryQueries(query, { authoritative: authorityRequired });
  const sources = resolveArcgisDiscoverySources(prompt);
  const searchAttempts = [];
  const mergedById = new Map();
  const collectTarget = authorityRequired ? 80 : 12;

  for (const source of sources) {
    for (const attemptQuery of queries) {
      const searchResponse = await searchArcgisData(attemptQuery, {
        source,
        limit: options.limit || 20
      });
      searchAttempts.push({
        query: attemptQuery,
        source,
        total: searchResponse.total || 0,
        resultCount: searchResponse.results?.length || 0
      });
      for (const item of searchResponse.results || []) {
        if (!mergedById.has(item.id)) mergedById.set(item.id, item);
      }
      const ownerScoped = /^owner:/i.test(attemptQuery);
      if (!ownerScoped && mergedById.size >= collectTarget) break;
    }
    if (mergedById.size >= collectTarget) break;
  }

  const ranked = rankArcgisDiscoveryResults(
    await enrichArcgisDiscoveryCandidates([...mergedById.values()], { authorityRequired }),
    query,
    { requireAuthoritative: authorityRequired }
  );
  if (!ranked.length) {
    return {
      ok: false,
      message: authorityRequired
        ? `No authoritative ArcGIS publisher found for "${query}". Municipal, provincial, federal, or Esri-curated sources are required.`
        : `No qualifying ArcGIS layers found for "${query}".`,
      searchQuery: query,
      searchAttempts,
      results: []
    };
  }

  const candidate = ranked[0];
  const added = await addArcgisPortalItem(candidate.id, {
    contentSource: candidate.contentSource,
    sourceLabel: candidate.sourceLabel,
    onCatalogUpdated: options.onCatalogUpdated
  });

  return {
    ok: added.status === 'ADDED' || added.status === 'ALREADY_ADDED',
    message: added.message,
    searchQuery: query,
    searchAttempts,
    candidate,
    qualification: {
      score: candidate.qualificationScore,
      reason: candidate.qualificationReason,
      authorityLabel: candidate.authorityLabel,
      authorityBasis: candidate.authorityBasis,
      authorityWeight: candidate.authorityWeight ?? null
    },
    addReceipt: {
      itemId: candidate.id,
      title: candidate.title,
      owner: candidate.owner,
      type: candidate.type,
      serviceUrl: candidate.url || null
    },
    added,
    results: ranked
  };
}
