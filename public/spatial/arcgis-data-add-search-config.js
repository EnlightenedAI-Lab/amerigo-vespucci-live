/**
 * ArcGIS portal search source and sort configuration.
 */

/** ArcGIS Living Atlas of the World group on ArcGIS Online. */
export const LIVING_ATLAS_GROUP_ID = '702026e91f2a3054886bc9480b6836d';

export const ARCGIS_CONTENT_SOURCES = Object.freeze({
  ARCGIS_ONLINE: 'arcgis-online',
  LIVING_ATLAS: 'living-atlas'
});

export const SEARCH_SORT_OPTIONS = Object.freeze({
  RELEVANCE: 'relevance',
  MOST_VIEWED: 'most-viewed',
  LEAST_VIEWED: 'least-viewed',
  RECENTLY_UPDATED: 'recently-updated',
  OLDEST_UPDATED: 'oldest-updated'
});

export const SEARCH_SORT_LABELS = Object.freeze({
  [SEARCH_SORT_OPTIONS.RELEVANCE]: 'Relevance',
  [SEARCH_SORT_OPTIONS.MOST_VIEWED]: 'Most viewed',
  [SEARCH_SORT_OPTIONS.LEAST_VIEWED]: 'Least viewed',
  [SEARCH_SORT_OPTIONS.RECENTLY_UPDATED]: 'Recently updated',
  [SEARCH_SORT_OPTIONS.OLDEST_UPDATED]: 'Oldest updated'
});

/**
 * Map IQAI sort choice to ArcGIS PortalQueryParams semantics.
 * @param {string} sortKey
 */
export function resolvePortalSort(sortKey = SEARCH_SORT_OPTIONS.RELEVANCE) {
  switch (sortKey) {
    case SEARCH_SORT_OPTIONS.MOST_VIEWED:
      return { sortField: 'numViews', sortOrder: 'desc' };
    case SEARCH_SORT_OPTIONS.LEAST_VIEWED:
      return { sortField: 'numViews', sortOrder: 'asc' };
    case SEARCH_SORT_OPTIONS.RECENTLY_UPDATED:
      return { sortField: 'modified', sortOrder: 'desc' };
    case SEARCH_SORT_OPTIONS.OLDEST_UPDATED:
      return { sortField: 'modified', sortOrder: 'asc' };
    case SEARCH_SORT_OPTIONS.RELEVANCE:
    default:
      return { sortField: 'relevance', sortOrder: 'desc' };
  }
}

/**
 * @param {string} keyword
 * @param {string} source
 * @param {string[]} supportedTypes
 */
/** Esri Living Atlas curated publisher accounts on ArcGIS Online. */
export const LIVING_ATLAS_OWNER_FILTER = '(owner:Esri_LivingAtlas OR owner:esri_livefeeds OR owner:esri_livefeeds2)';

export function buildPortalSearchQuery(keyword, source, supportedTypes) {
  const escaped = String(keyword || '').replace(/"/g, '');
  const keywordPart = escaped;
  const typeFilter = supportedTypes.map((t) => `type:"${t}"`).join(' OR ');

  if (source === ARCGIS_CONTENT_SOURCES.LIVING_ATLAS) {
    return `${LIVING_ATLAS_OWNER_FILTER} AND (${typeFilter}) AND (${keywordPart})`;
  }
  return `(${typeFilter}) AND (${keywordPart})`;
}

/**
 * @param {import('@arcgis/core/portal/PortalItem').default} item
 */
export function isSupportedMapLayerItem(item) {
  const type = String(item?.type || '');
  return SUPPORTED_ITEM_TYPES_EXPORT.includes(type);
}

const SUPPORTED_ITEM_TYPES_EXPORT = [
  'Feature Service',
  'Map Service',
  'Image Service',
  'Vector Tile Service',
  'Tile Layer',
  'Scene Service',
  'GeoJson',
  'Feature Collection',
  'Map Image Layer',
  'WMS',
  'KML'
];

export function getContentSourceLabel(source) {
  if (source === ARCGIS_CONTENT_SOURCES.LIVING_ATLAS) return 'ArcGIS Living Atlas';
  return 'ArcGIS Online';
}
