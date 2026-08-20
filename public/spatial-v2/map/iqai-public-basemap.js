/**
 * Portal-independent MAP / AERIAL sources.
 * MAP is public Esri vector streets (no login). AERIAL is Nearmap latest WMS
 * through the server-side proxy. Wayback 26334 / 28 MAY 2025 is preserved
 * for future HISTORY and is not the normal AERIAL surface.
 * No OAuth. No authored WebMap. No Portal item. Not HISTORY chrome.
 */
import { importArc } from './arcgis-sdk.js';
import { createNearmapCurrentTileLayer } from '../imagery/providers/nearmap-wms-ground-provider.js';

export const IQAI_MAP_BASEMAP_ID = 'iqai-public-esri-streets-vector';
export const IQAI_AERIAL_BASEMAP_ID = 'iqai-nearmap-current';
export const IQAI_WAYBACK_BASEMAP_ID = 'iqai-public-wayback-26334';
export const IQAI_MAP_BASEMAP_TITLE = 'Esri Streets Vector';

/** Public Esri World Basemap v2 vector tiles. Not raster World Street Map. */
export const ESRI_STREETS_VECTOR_URL =
  'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer';

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

export async function createIqaiMapBasemap() {
  const [Basemap, VectorTileLayer] = await Promise.all([
    importArc('@arcgis/core/Basemap.js'),
    importArc('@arcgis/core/layers/VectorTileLayer.js')
  ]);
  return new Basemap({
    id: IQAI_MAP_BASEMAP_ID,
    title: IQAI_MAP_BASEMAP_TITLE,
    baseLayers: [
      new VectorTileLayer({
        id: 'iqai-esri-streets-vector',
        title: IQAI_MAP_BASEMAP_TITLE,
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
