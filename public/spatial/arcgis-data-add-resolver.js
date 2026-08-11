/**
 * Deterministic ArcGIS input resolution — URLs, item IDs, REST services.
 */
import { importArc } from './spatial-arcgis-runtime.js';

const ITEM_ID_RE = /^[0-9a-f]{32}$/i;
const ITEM_PAGE_RE = /\/home\/item\.html\?id=([0-9a-f]{32})/i;
const FEATURE_SERVER_RE = /(\/FeatureServer\/?(\d+)?)\/?$/i;
const MAP_SERVER_RE = /(\/MapServer\/?(\d+)?)\/?$/i;
const IMAGE_SERVER_RE = /(\/ImageServer)\/?$/i;
const VECTOR_TILE_RE = /(\/VectorTileServer)\/?$/i;
const SCENE_SERVER_RE = /(\/SceneServer\/?(\d+)?)\/?$/i;

/**
 * @param {string} raw
 */
export function parseArcgisUserInput(raw) {
  const value = String(raw || '').trim();
  if (!value) return { kind: 'empty', value };

  if (ITEM_ID_RE.test(value)) {
    return { kind: 'item-id', value, itemId: value.toLowerCase() };
  }

  const itemPageMatch = value.match(ITEM_PAGE_RE);
  if (itemPageMatch) {
    return { kind: 'item-url', value, itemId: itemPageMatch[1].toLowerCase() };
  }

  try {
    const url = new URL(value);
    const path = url.pathname + url.search;
    if (FEATURE_SERVER_RE.test(path)) {
      const match = path.match(FEATURE_SERVER_RE);
      return {
        kind: 'feature-service',
        value,
        serviceUrl: value.replace(/\/$/, ''),
        layerIndex: match?.[2] != null ? Number(match[2]) : null
      };
    }
    if (MAP_SERVER_RE.test(path)) {
      const match = path.match(MAP_SERVER_RE);
      return {
        kind: 'map-service',
        value,
        serviceUrl: value.replace(/\/$/, ''),
        layerIndex: match?.[2] != null ? Number(match[2]) : null
      };
    }
    if (IMAGE_SERVER_RE.test(path)) {
      return { kind: 'image-service', value, serviceUrl: value.replace(/\/$/, '') };
    }
    if (VECTOR_TILE_RE.test(path)) {
      return { kind: 'vector-tile-service', value, serviceUrl: value.replace(/\/$/, '') };
    }
    if (SCENE_SERVER_RE.test(path)) {
      const match = path.match(SCENE_SERVER_RE);
      return {
        kind: 'scene-service',
        value,
        serviceUrl: value.replace(/\/$/, ''),
        layerIndex: match?.[2] != null ? Number(match[2]) : null
      };
    }
    if (/\/sharing\/rest\/content\/items\/([0-9a-f]{32})/i.test(path)) {
      const id = path.match(/\/sharing\/rest\/content\/items\/([0-9a-f]{32})/i)?.[1];
      return { kind: 'item-rest', value, itemId: id?.toLowerCase() || null };
    }
    return { kind: 'unsupported-url', value };
  } catch {
    return { kind: 'invalid', value };
  }
}

/**
 * @param {string} url
 */
export async function fetchServiceMetadata(url) {
  const endpoint = `${String(url).replace(/\/$/, '')}?f=json`;
  const res = await fetch(endpoint, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const message = body.error?.message || `Service metadata unavailable (${res.status})`;
    throw new Error(message);
  }
  return body;
}

/**
 * @param {object} parsed
 * @param {object} options
 */
export async function createLayerFromParsedInput(parsed, options = {}) {
  const portalUrl = options.portalUrl || 'https://www.arcgis.com';

  if (parsed.kind === 'item-id' || parsed.kind === 'item-url' || parsed.kind === 'item-rest') {
    return createLayerFromPortalItem(parsed.itemId, { portalUrl });
  }

  if (parsed.kind === 'feature-service') {
    const FeatureLayer = await importArc('@arcgis/core/layers/FeatureLayer.js');
    const url = parsed.layerIndex != null
      ? parsed.serviceUrl.replace(/\/\d+$/, '') + `/${parsed.layerIndex}`
      : parsed.serviceUrl;
    return {
      layer: new FeatureLayer({
        url,
        title: options.title || inferTitleFromUrl(url),
        listMode: 'show',
        popupEnabled: true
      }),
      provenance: {
        serviceUrl: url,
        itemType: 'Feature Service'
      }
    };
  }

  if (parsed.kind === 'map-service') {
    const MapImageLayer = await importArc('@arcgis/core/layers/MapImageLayer.js');
    const layerProps = {
      url: parsed.serviceUrl.replace(/\/\d+$/, ''),
      title: options.title || inferTitleFromUrl(parsed.serviceUrl),
      listMode: 'show',
      popupEnabled: true
    };
    if (parsed.layerIndex != null) {
      layerProps.sublayers = [{ id: parsed.layerIndex, visible: true }];
    }
    return {
      layer: new MapImageLayer(layerProps),
      provenance: {
        serviceUrl: parsed.serviceUrl,
        itemType: 'Map Service'
      }
    };
  }

  if (parsed.kind === 'image-service') {
    const ImageryLayer = await importArc('@arcgis/core/layers/ImageryLayer.js');
    return {
      layer: new ImageryLayer({
        url: parsed.serviceUrl,
        title: options.title || inferTitleFromUrl(parsed.serviceUrl),
        listMode: 'show'
      }),
      provenance: {
        serviceUrl: parsed.serviceUrl,
        itemType: 'Image Service'
      }
    };
  }

  if (parsed.kind === 'vector-tile-service') {
    const VectorTileLayer = await importArc('@arcgis/core/layers/VectorTileLayer.js');
    return {
      layer: new VectorTileLayer({
        url: parsed.serviceUrl,
        title: options.title || inferTitleFromUrl(parsed.serviceUrl),
        listMode: 'show'
      }),
      provenance: {
        serviceUrl: parsed.serviceUrl,
        itemType: 'Vector Tile Service'
      }
    };
  }

  if (parsed.kind === 'scene-service') {
    throw new Error('Scene layers are not supported in this 2D map view.');
  }

  if (parsed.kind === 'unsupported-url') {
    throw new Error('URL is not a supported ArcGIS item or service endpoint.');
  }

  if (parsed.kind === 'invalid') {
    throw new Error('Enter a valid ArcGIS item ID, item URL, or service URL.');
  }

  throw new Error('Nothing to add — enter an ArcGIS item ID or service URL.');
}

/**
 * @param {string} itemId
 * @param {object} options
 */
export async function createLayerFromPortalItem(itemId, options = {}) {
  const portalUrl = (options.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '');
  const [Portal, PortalItem, Layer] = await Promise.all([
    importArc('@arcgis/core/portal/Portal.js'),
    importArc('@arcgis/core/portal/PortalItem.js'),
    importArc('@arcgis/core/layers/Layer.js')
  ]);

  const portal = new Portal({ url: portalUrl });
  await portal.load();
  const portalItem = new PortalItem({ id: itemId, portal });
  await portalItem.load();

  const layer = await Layer.fromPortalItem({ portalItem });
  if (!layer) {
    throw new Error(`Portal item "${portalItem.title || itemId}" cannot be rendered as a map layer.`);
  }

  layer.title = portalItem.title || layer.title || 'ArcGIS layer';
  layer.listMode = 'show';
  if ('popupEnabled' in layer) layer.popupEnabled = true;

  return {
    layer,
    provenance: {
      portalItemId: portalItem.id,
      portalUrl,
      owner: portalItem.owner || null,
      itemTitle: portalItem.title || null,
      itemType: portalItem.type || null,
      itemTypeKeywords: portalItem.typeKeywords || [],
      description: portalItem.snippet || portalItem.description || null,
      modified: portalItem.modified ? new Date(portalItem.modified).toISOString() : null,
      access: portalItem.access || null,
      serviceUrl: portalItem.url || layer.url || null,
      attribution: portalItem.licenseInfo || null
    }
  };
}

function inferTitleFromUrl(url) {
  const parts = String(url || '').split('/').filter(Boolean);
  const idx = parts.findIndex((part) => /server$/i.test(part));
  if (idx > 0) return decodeURIComponent(parts[idx - 1]).replace(/_/g, ' ');
  return parts[parts.length - 1] || 'ArcGIS layer';
}

/**
 * @param {import('@arcgis/core/layers/Layer').default} layer
 */
export function getLayerStableIdentity(layer, provenance = {}) {
  if (provenance.portalItemId) return `item:${provenance.portalItemId}`;
  const url = provenance.serviceUrl || layer?.url || layer?.parsedUrl?.path || null;
  if (url) return `url:${String(url).replace(/\/$/, '').toLowerCase()}`;
  return `layer:${layer?.id || layer?.title || 'unknown'}`;
}
