import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import { OCEAN_VIEW_WEBMAP_ID } from '../src/ocean-view-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function read(...parts) {
  return fs.readFileSync(path.join(PUBLIC, ...parts), 'utf8');
}

function readSrc(...parts) {
  return fs.readFileSync(path.join(ROOT, 'src', ...parts), 'utf8');
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('light theme is the default', () => {
  const html = read('index.html');
  assert.match(html, /data-theme="light"/);
  const css = read('css', 'styles.css');
  assert.match(css, /:root,/);
  assert.match(css, /--bg:\s*#f4f8fb/);
});

test('dark theme can be selected', () => {
  const themeJs = read('js', 'theme.js');
  assert.match(themeJs, /toggleTheme/);
  assert.match(themeJs, /data-theme/);
  assert.match(themeJs, /localStorage/);
  assert.match(themeJs, /'dark'/);
  const html = read('index.html');
  assert.match(html, /id="btn-theme"/);
  const css = read('css', 'styles.css');
  assert.match(css, /\[data-theme="dark"\]/);
});

test('panel can be collapsed', () => {
  const html = read('index.html');
  assert.match(html, /id="sidebar"/);
  assert.match(html, /id="btn-panel-collapse"/);
  assert.match(html, /id="btn-panel-expand"/);
  const panelJs = read('js', 'panel.js');
  assert.match(panelJs, /setPanelCollapsed/);
  assert.match(panelJs, /collapsed/);
  const css = read('css', 'styles.css');
  assert.match(css, /\.sidebar\.collapsed/);
});

test('sidebar is resizable on desktop', () => {
  const html = read('index.html');
  assert.match(html, /id="sidebar-resizer"/);
  const panelJs = read('js', 'panel.js');
  assert.match(panelJs, /mousedown/);
  assert.match(panelJs, /--sidebar-width/);
});

test('ArcGIS Ocean View inline mode exists with required controls', () => {
  const html = read('index.html');
  assert.match(html, /id="ocean-view"/);
  assert.match(html, /ArcGIS Ocean View/);
  assert.match(html, /id="btn-mode-tracker"/);
  assert.match(html, /id="btn-mode-ocean"/);
  assert.match(html, /Tracker View/);
  assert.match(html, /<arcgis-map/);
  assert.match(html, /id="ocean-layer-toggles"/);
  assert.match(html, /id="ocean-layer-vessel"/);
  assert.match(html, /id="ocean-layer-currents"/);
  assert.match(html, /id="btn-ocean-fullscreen"/);
  assert.match(html, /id="ocean-btn-external"/);
  const css = read('css', 'styles.css');
  assert.match(css, /\.map-mode-tabs/);
  assert.match(css, /\.arcgis-ocean-map/);
});

test('ocean view JS uses arcgis-map component CDN loader not native module import', () => {
  const js = read('js', 'ocean-view.js');
  assert.match(js, /setMapMode/);
  assert.match(js, /loadArcgisCdn/);
  assert.match(js, /arcgis-ocean-map/);
  assert.match(js, /wireOceanLayerToggles/);
  assert.match(js, /getVesselCoordinates/);
  assert.match(js, /view\.goTo\(extent/);
  assert.doesNotMatch(js, /new Extent/);
  assert.doesNotMatch(js, /getMapData/);
  assert.match(js, /\/api\/ocean-view/);
  assert.doesNotMatch(js, /import\s*\(\s*[`'"]https:\/\/js\.arcgis\.com/);
  assert.doesNotMatch(js, /new WebMap/);
  assert.doesNotMatch(js, /mapviewer/i);
  assert.doesNotMatch(js, /DATADOCKED|AISSTREAM|OPEN_METEO|ARCGIS_TOKEN/i);
  const html = read('index.html');
  assert.match(html, /id="arcgis-ocean-map"/);
  assert.doesNotMatch(html, /ocean-iframe/);
  assert.doesNotMatch(html, /id="ocean-modal"/);
});

test('fallback link appears when embedding is unavailable', () => {
  const html = read('index.html');
  assert.match(html, /id="ocean-embed-fallback"/);
  assert.match(html, /id="ocean-fallback-link"/);
  assert.match(html, /Open ArcGIS Ocean View in new tab/);
  const js = read('js', 'ocean-view.js');
  assert.match(js, /showEmbedFallback/);
});

test('no credentials in frontend source files', () => {
  const files = [
    read('index.html'),
    read('js', 'app.js'),
    read('js', 'theme.js'),
    read('js', 'panel.js'),
    read('js', 'ocean-view.js'),
    read('js', 'info-cards.js')
  ].join('\n');
  const forbidden = [/ARCGIS_TOKEN/i, /DATADOCKED_API_KEY/i, /AISSTREAM_API_KEY/i, /OPEN_METEO_API_KEY/i, /ARCGIS_PASSWORD/i];
  for (const pattern of forbidden) {
    assert.doesNotMatch(files, pattern);
  }
});

test('ocean view API response contains no credentials', async () => {
  const config = createPreviewConfig();
  const state = createPreviewState();
  const app = createServer(state, config, null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await request(port, '/api/ocean-view');
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body, /token/i);
    assert.doesNotMatch(res.body, /password/i);
    assert.match(res.body, /arcgis-map-component/);
    assert.match(res.body, new RegExp(OCEAN_VIEW_WEBMAP_ID));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('info cards are grouped by category', () => {
  const html = read('index.html');
  const groups = ['Current Vessel', 'Weather', 'Sea State', 'Ocean Current', 'Voyage', 'Forecast'];
  for (const g of groups) {
    assert.match(html, new RegExp(g));
  }
  const infoJs = read('js', 'info-cards.js');
  assert.match(infoJs, /renderVesselInfo/);
  assert.match(infoJs, /renderWeatherInfo/);
  assert.match(infoJs, /renderSeaStateInfo/);
  assert.match(infoJs, /renderVoyageInfo/);
});

test('light basemap is used by default in app.js', () => {
  const js = read('js', 'app.js');
  assert.match(js, /light_all/);
  assert.match(js, /dark_all/);
});

test('mobile bottom sheet is present', () => {
  const html = read('index.html');
  assert.match(html, /id="mobile-sheet"/);
  assert.match(html, /mobile-tab/);
});

test('classic index does not load optional spatial layers UI', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /btn-spatial-layers/);
  assert.doesNotMatch(html, /spatial-layers-root/);
  assert.doesNotMatch(html, /spatial\/layers-panel\.js/);
});

test('ocean view config module has no provider client imports', () => {
  const src = readSrc('ocean-view-config.js');
  const forbidden = /from\s+['"][^'"]*\/(aisstream|datadocked|openmeteo|arcgis)['"]/i;
  assert.doesNotMatch(src, forbidden);
});
