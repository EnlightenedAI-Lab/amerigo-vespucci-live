/**
 * Minimal MapAdapter contract used by IQAI Spatial V2.
 * Implementations: ArcGISAdapter (browser), Leaflet bridge defers to existing app.js groups.
 *
 * @typedef {object} MapAdapter
 * @property {(layerConfig: object) => Promise<object>} addLayer
 * @property {(layerId: string) => Promise<void>} removeLayer
 * @property {(layerId: string, visible: boolean) => void} setVisible
 * @property {(layerId: string, opacity: number) => void} setOpacity
 * @property {(layerId: string, validTime: string) => Promise<void>} setTime
 * @property {(screenPoint: {x:number,y:number}) => Promise<object|null>} identify
 * @property {(geometry: object) => Promise<void>} fitGeometry
 * @property {(mapPoint: {x:number,y:number}) => {longitude:number,latitude:number}} toMapCoordinates
 * @property {(lon: number, lat: number) => {x:number,y:number}} fromMapCoordinates
 * @property {(graphic: object) => Promise<void>} upsertGraphic
 * @property {(graphicId: string) => Promise<void>} removeGraphic
 */

export const MAP_ADAPTER_METHODS = Object.freeze([
  'addLayer', 'removeLayer', 'setVisible', 'setOpacity', 'setTime',
  'identify', 'fitGeometry', 'toMapCoordinates', 'fromMapCoordinates',
  'upsertGraphic', 'removeGraphic'
]);

export function validateMapAdapter(adapter) {
  const missing = MAP_ADAPTER_METHODS.filter((m) => typeof adapter?.[m] !== 'function');
  return { valid: missing.length === 0, missing };
}
