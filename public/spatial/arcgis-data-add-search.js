/**
 * ArcGIS portal content search with source, sort, and map-extent options.
 */
import { importArc } from './spatial-arcgis-runtime.js';
import { getMapView } from './spatial-arcgis-runtime.js';
import { fetchMontrealOAuthConfig } from './montreal-arcgis-oauth.js';
import {
  ARCGIS_CONTENT_SOURCES,
  SEARCH_SORT_OPTIONS,
  buildPortalSearchQuery,
  getContentSourceLabel,
  resolvePortalSort,
  isSupportedMapLayerItem
} from './arcgis-data-add-search-config.js';

const SUPPORTED_ITEM_TYPES = [
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

/**
 * @param {string} query
 * @param {object} options
 */
export async function searchArcgisPortalContent(query, options = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    return { results: [], total: 0, query: '', error: 'Enter a search term.' };
  }

  const oauthConfig = await fetchMontrealOAuthConfig();
  const portalUrl = (options.portalUrl || oauthConfig.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '');
  const source = options.source || ARCGIS_CONTENT_SOURCES.ARCGIS_ONLINE;
  const sortKey = options.sort || SEARCH_SORT_OPTIONS.RELEVANCE;
  const mapAreaOnly = Boolean(options.mapAreaOnly);
  const sort = resolvePortalSort(sortKey);

  const [Portal, PortalQueryParams] = await Promise.all([
    importArc('@arcgis/core/portal/Portal.js'),
    importArc('@arcgis/core/portal/PortalQueryParams.js')
  ]);

  const portal = new Portal({ url: portalUrl });
  await portal.load();

  const searchQuery = buildPortalSearchQuery(trimmed, source, SUPPORTED_ITEM_TYPES);
  const params = new PortalQueryParams({
    query: searchQuery,
    sortField: sort.sortField,
    sortOrder: sort.sortOrder,
    num: options.limit || 20,
    start: options.start || 1
  });

  const extent = mapAreaOnly ? (options.extent || getMapView()?.extent) : null;
  if (extent) {
    params.extent = extent;
  }

  const response = await portal.queryItems(params);
  const results = (response.results || [])
    .filter((item) => isSupportedMapLayerItem(item))
    .map((item) => serializePortalSearchResult(item, extent, source));

  return {
    query: trimmed,
    portalUrl,
    source,
    sourceLabel: getContentSourceLabel(source),
    sort: sortKey,
    sortField: sort.sortField,
    sortOrder: sort.sortOrder,
    mapAreaOnly,
    total: response.total || results.length,
    nextStart: response.nextStart,
    results,
    extentRestricted: Boolean(extent)
  };
}

/**
 * @param {import('@arcgis/core/portal/PortalItem').default} item
 * @param {import('@arcgis/core/geometry/Extent').default | null} mapExtent
 * @param {string} source
 */
function serializePortalSearchResult(item, mapExtent, source) {
  const extent = item.extent || null;
  let geographicRelevance = 'unknown';
  if (extent && mapExtent) {
    geographicRelevance = extentsIntersect(extent, mapExtent) ? 'in-map-extent' : 'outside-map-extent';
  } else if (extent) {
    geographicRelevance = 'has-extent';
  }

  return {
    id: item.id,
    title: item.title || 'Untitled',
    owner: item.owner || null,
    type: item.type || null,
    snippet: item.snippet || '',
    description: item.description || item.snippet || '',
    modified: item.modified ? new Date(item.modified).toISOString() : null,
    access: item.access || null,
    url: item.url || null,
    thumbnail: item.thumbnailUrl || null,
    numViews: item.numViews ?? null,
    extent: extent ? {
      xmin: extent.xmin,
      ymin: extent.ymin,
      xmax: extent.xmax,
      ymax: extent.ymax,
      spatialReference: extent.spatialReference?.wkid || null
    } : null,
    geographicRelevance,
    tags: item.tags || [],
    typeKeywords: item.typeKeywords || [],
    contentSource: source,
    sourceLabel: getContentSourceLabel(source)
  };
}

function extentsIntersect(a, b) {
  if (!a || !b) return false;
  return !(a.xmax < b.xmin || a.xmin > b.xmax || a.ymax < b.ymin || a.ymin > b.ymax);
}

/**
 * @param {string} itemId
 */
export async function fetchPortalItemMetadata(itemId, options = {}) {
  const oauthConfig = await fetchMontrealOAuthConfig();
  const portalUrl = (options.portalUrl || oauthConfig.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '');
  const [Portal, PortalItem] = await Promise.all([
    importArc('@arcgis/core/portal/Portal.js'),
    importArc('@arcgis/core/portal/PortalItem.js')
  ]);
  const portal = new Portal({ url: portalUrl });
  await portal.load();
  const item = new PortalItem({ id: itemId, portal });
  await item.load();
  const source = options.source || ARCGIS_CONTENT_SOURCES.ARCGIS_ONLINE;
  return serializePortalSearchResult(item, getMapView()?.extent || null, source);
}

export {
  ARCGIS_CONTENT_SOURCES,
  SEARCH_SORT_OPTIONS
};
