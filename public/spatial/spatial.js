import { AppShell } from './shell/AppShell.js';
import {
  getMapViewCreateCount,
  getWebMapCreateCount
} from './spatial-arcgis-runtime.js';

const app = new AppShell(document.querySelector('#spatial-app'));
app.mount();

window.__iqaiSpatialV1Diagnostics = () => ({
  mapViewCreateCount: getMapViewCreateCount(),
  webMapCreateCount: getWebMapCreateCount(),
  mapContainers: document.querySelectorAll('[data-spatial-map-host]').length,
  layerListItems: document.querySelectorAll('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').length
});
