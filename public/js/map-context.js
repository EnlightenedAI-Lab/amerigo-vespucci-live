/** Shared read-only map data for tracker + ArcGIS Ocean View controls. */
let mapData = null;

export function setMapData(data) {
  mapData = data;
}

export function getMapData() {
  return mapData;
}
