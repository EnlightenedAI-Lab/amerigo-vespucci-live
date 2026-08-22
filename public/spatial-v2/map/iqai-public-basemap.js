/**
 * Portal-independent MAP / AERIAL sources.
 * MAP is public Esri vector streets (no login). AERIAL is Nearmap latest WMS
 * through the server-side proxy. Wayback 26334 / 28 MAY 2025 is preserved
 * for future HISTORY and is not the normal AERIAL surface.
 * No OAuth. No authored WebMap. No Portal item. Not HISTORY chrome.
 */
import { importArc } from './arcgis-sdk.js';
import { createNearmapCurrentTileLayer } from '../imagery/providers/nearmap-wms-ground-provider.js';

export const IQAI_MAP_BASEMAP_ID = 'iqai-public-esri-white-canvas';
export const IQAI_STREETS_BASEMAP_ID = 'iqai-public-esri-streets-vector';
export const IQAI_BLACK_BASEMAP_ID = 'iqai-public-esri-black-canvas';
export const IQAI_AERIAL_BASEMAP_ID = 'iqai-nearmap-current';
export const IQAI_WAYBACK_BASEMAP_ID = 'iqai-public-wayback-26334';
export const IQAI_MAP_BASEMAP_TITLE = 'White';
export const IQAI_STREETS_BASEMAP_TITLE = 'Esri Streets Vector';
export const IQAI_BLACK_BASEMAP_TITLE = 'Black';

/** Public Esri World Basemap v2 vector tiles. Not raster World Street Map. */
export const ESRI_STREETS_VECTOR_URL =
  'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer';
export const ESRI_WORLD_BASEMAP_STYLE_URL =
  `${ESRI_STREETS_VECTOR_URL}/resources/styles/root.json`;

/** World Street Map raster — kept only as the retired overzoom diagnosis. */
export const ESRI_STREETS_URL_TEMPLATE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{level}/{row}/{col}';

/** Proven Wayback family. IMAGE DATE is capture, not publication. HISTORY only. */
export const WAYBACK_TILE_TEMPLATE =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{releaseNum}/{level}/{row}/{col}';

export const AERIAL_PROOF_RELEASE = 26334;
export const AERIAL_PROOF_CAPTURE_DATE = '2025-05-28';
export const AERIAL_PROOF_IMAGE_DATE = '28 MAY 2025';
export const AERIAL_PROOF_LABEL = `IMAGE DATE ${AERIAL_PROOF_IMAGE_DATE}`;
export const AERIAL_CURRENT_LABEL = 'NEARMAP CURRENT';

/**
 * Raster World_Street_Map only caches real cartography through LOD 19.
 * Close neighbourhood scale (~1:1500) overzooms those rasters and pixelates.
 * Vector streets stay crisp past that scale.
 */
export const IQAI_MAP_MAX_ZOOM = 22;
export const IQAI_MAP_TILE_LODS = 23;
export const IQAI_AERIAL_MAX_ZOOM = 23;
export const IQAI_AERIAL_TILE_LODS = 24;

export const WAYBACK_AERIAL_URL_TEMPLATE = WAYBACK_TILE_TEMPLATE.replace(
  '{releaseNum}',
  String(AERIAL_PROOF_RELEASE)
);

async function createWebMercatorTileInfo(numLODs) {
  const TileInfo = await importArc('@arcgis/core/layers/support/TileInfo.js');
  return TileInfo.create({
    numLODs,
    size: 256
  });
}

const TONE = Object.freeze({
  light: Object.freeze({
    bg: '#ffffff',
    land: '#ffffff',
    park: '#f3f2ee',
    building: '#e8e6e0',
    water: '#cdd8e0',
    road: '#9a958c',
    text: '#1a1c1f',
    halo: '#ffffff'
  }),
  dark: Object.freeze({
    bg: '#0b0d10',
    land: '#12141a',
    park: '#161b20',
    building: '#2a3038',
    water: '#1a2430',
    road: '#8a93a0',
    text: '#e8eaed',
    halo: '#0b0d10'
  })
});

function absolutizeStyleUrls(style, styleUrl) {
  const base = new URL(styleUrl);
  function abs(value) {
    if (!value || typeof value !== 'string' || /^https?:\/\//i.test(value)) return value;
    const marked = value.replace('{fontstack}', '__FS__').replace('{range}', '__RG__');
    try {
      return new URL(marked, base).href
        .replace('__FS__', '{fontstack}')
        .replace('__RG__', '{range}');
    } catch {
      return value;
    }
  }
  if (style.sprite) style.sprite = abs(style.sprite);
  if (style.glyphs) style.glyphs = abs(style.glyphs);
  for (const source of Object.values(style.sources || {})) {
    if (source?.url) source.url = abs(source.url);
  }
  return style;
}

function rewriteColorValue(value, color) {
  if (typeof value === 'string' && (/^#/.test(value) || /^(rgb|hsl)/i.test(value))) return color;
  if (Array.isArray(value)) return value.map((item) => rewriteColorValue(item, color));
  return value;
}

function restyleWorldBasemap(style, tone) {
  const pal = TONE[tone] || TONE.light;
  const next = JSON.parse(JSON.stringify(style));
  const layers = Array.isArray(next.layers) ? next.layers : [];
  next.layers = [
    { id: 'iqai-canvas', type: 'background', paint: { 'background-color': pal.bg } },
    ...layers.flatMap((layer) => {
      if (layer.type === 'symbol') return [];
      const id = String(layer.id || '').toLowerCase();
      const paint = { ...(layer.paint || {}) };
      const water = /water|ocean|bathymetry|river|lake|stream|canal|marine/.test(id);
      const road = /road|rail|highway|freeway|motorway|path|transit|tunnel|bridge/.test(id);
      const building = /building|structure|footprint/.test(id);
      const park = /park|wood|forest|grass|landcover|green|cemetery|pitch/.test(id);
      for (const [key, value] of Object.entries(paint)) {
        if (!key.includes('color')) continue;
        let color = pal.land;
        if (key.includes('halo')) color = pal.halo;
        else if (water) color = pal.water;
        else if (building) color = pal.building;
        else if (park) color = pal.park;
        else if (road || layer.type === 'line') color = pal.road;
        paint[key] = rewriteColorValue(value, color);
      }
      return [{ ...layer, paint }];
    })
  ];
  return next;
}

async function createTonedWorldBasemap({ id, title, layerId, tone }) {
  const [Basemap, VectorTileLayer] = await Promise.all([
    importArc('@arcgis/core/Basemap.js'),
    importArc('@arcgis/core/layers/VectorTileLayer.js')
  ]);
  try {
    const res = await fetch(ESRI_WORLD_BASEMAP_STYLE_URL, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`style ${res.status}`);
    const raw = await res.json();
    const style = restyleWorldBasemap(absolutizeStyleUrls(raw, ESRI_WORLD_BASEMAP_STYLE_URL), tone);
    return new Basemap({
      id,
      title,
      baseLayers: [
        new VectorTileLayer({
          id: layerId,
          title,
          style
        })
      ]
    });
  } catch {
    return new Basemap({
      id,
      title,
      baseLayers: [
        new VectorTileLayer({
          id: layerId,
          title,
          url: ESRI_STREETS_VECTOR_URL,
          copyright: 'Esri, TomTom, Garmin, FAO, NOAA, USGS'
        })
      ]
    });
  }
}

export async function createIqaiWhiteBasemap() {
  return createTonedWorldBasemap({
    id: IQAI_MAP_BASEMAP_ID,
    title: IQAI_MAP_BASEMAP_TITLE,
    layerId: 'iqai-esri-white-canvas',
    tone: 'light'
  });
}

export async function createIqaiBlackBasemap() {
  return createTonedWorldBasemap({
    id: IQAI_BLACK_BASEMAP_ID,
    title: IQAI_BLACK_BASEMAP_TITLE,
    layerId: 'iqai-esri-black-canvas',
    tone: 'dark'
  });
}

export async function createIqaiMapBasemap() {
  return createIqaiWhiteBasemap();
}

export async function createIqaiStreetsBasemap() {
  const [Basemap, VectorTileLayer] = await Promise.all([
    importArc('@arcgis/core/Basemap.js'),
    importArc('@arcgis/core/layers/VectorTileLayer.js')
  ]);
  return new Basemap({
    id: IQAI_STREETS_BASEMAP_ID,
    title: IQAI_STREETS_BASEMAP_TITLE,
    baseLayers: [
      new VectorTileLayer({
        id: 'iqai-esri-streets-vector',
        title: IQAI_STREETS_BASEMAP_TITLE,
        url: ESRI_STREETS_VECTOR_URL,
        copyright: 'Esri, TomTom, Garmin, FAO, NOAA, USGS'
      })
    ]
  });
}

export async function createIqaiWaybackBasemap() {
  const [Basemap, WebTileLayer, tileInfo] = await Promise.all([
    importArc('@arcgis/core/Basemap.js'),
    importArc('@arcgis/core/layers/WebTileLayer.js'),
    createWebMercatorTileInfo(IQAI_AERIAL_TILE_LODS)
  ]);
  return new Basemap({
    id: IQAI_WAYBACK_BASEMAP_ID,
    title: 'Esri World Imagery Wayback',
    baseLayers: [
      new WebTileLayer({
        id: 'iqai-wayback-26334',
        title: `Wayback ${AERIAL_PROOF_RELEASE} · ${AERIAL_PROOF_IMAGE_DATE}`,
        urlTemplate: WAYBACK_AERIAL_URL_TEMPLATE,
        copyright: 'Esri World Imagery Wayback',
        tileInfo,
        resampling: true
      })
    ]
  });
}

export async function createIqaiAerialBasemap() {
  const Basemap = await importArc('@arcgis/core/Basemap.js');
  const layer = await createNearmapCurrentTileLayer({ visible: false });
  return new Basemap({
    id: IQAI_AERIAL_BASEMAP_ID,
    title: 'Nearmap Current',
    baseLayers: [layer]
  });
}
