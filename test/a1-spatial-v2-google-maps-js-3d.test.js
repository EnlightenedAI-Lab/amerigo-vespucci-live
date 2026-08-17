import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('Google Maps JS 3D specialist files exist without the rejected proxy path', () => {
  assert.equal(fs.existsSync(path.join(V2, 'map', 'google-maps-js-3d.js')), true);
  assert.equal(fs.existsSync(path.join(V2, 'map', 'google-photorealistic-3d-proof.js')), true);
  assert.equal(fs.existsSync(path.join(V2, 'google-photorealistic-3d-proof.html')), true);
  assert.equal(fs.existsSync(path.join(V2, 'map', 'google-photorealistic-3d.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'spatial-v2', 'google-3dtiles.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'test', 'a1-spatial-v2-google-photorealistic-3d.test.js')), false);
  const imageryRoutes = fs.readFileSync(
    path.join(ROOT, 'src', 'spatial-v2', 'imagery-routes.js'),
    'utf8'
  );
  assert.doesNotMatch(imageryRoutes, /registerGoogle3dTilesRoutes|\/google\/3dtiles/);
});

test('Google Maps JS 3D uses Map3DElement and not ArcGIS SceneView', () => {
  const stage = read('map', 'google-maps-js-3d.js');
  const proof = read('map', 'google-photorealistic-3d-proof.js');
  const foundation = read('map', 'map-foundation.js');
  assert.match(stage, /importLibrary\(['"]maps3d['"]\)/);
  assert.match(stage, /Map3DElement/);
  assert.match(stage, /Marker3DElement/);
  assert.match(stage, /SATELLITE|HYBRID/);
  assert.match(stage, /center:\s*\{\s*lat: latitude,\s*lng: longitude,\s*altitude: 400\s*\}/);
  assert.match(stage, /suppressArcgisAmdDetection/);
  assert.match(stage, /restoreAmdDetection/);
  assert.match(stage, /\/api\/spatial\/config/);
  assert.match(stage, /googleMapsBrowserApiKey/);
  assert.match(stage, /visualContextOnly: true/);
  assert.match(stage, /analysis: 'PROHIBITED'/);
  assert.doesNotMatch(stage, /new SceneView\(/);
  assert.doesNotMatch(stage, /IntegratedMesh3DTilesLayer/);
  assert.doesNotMatch(stage, /GOOGLE_MAP_TILES_API_KEY/);
  assert.doesNotMatch(stage, /tile\.googleapis\.com/);
  assert.doesNotMatch(stage, /new MapView\(/);
  assert.doesNotMatch(stage, /Viewshed/);
  assert.doesNotMatch(stage, /LineOfSight/);
  assert.doesNotMatch(stage, /\.save\(/);
  assert.match(proof, /google-maps-js-3d\.js/);
  assert.match(proof, /initMapFoundation/);
  assert.match(proof, /visibility = 'hidden'/);
  assert.match(proof, /returnTo2d/);
  assert.doesNotMatch(proof, /google-photorealistic-3d\.js/);
  assert.doesNotMatch(proof, /new SceneView\(/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.equal((foundation.match(/new SceneView\(/g) || []).length, 0);
});

test('Google Maps JS 3D proof page is an isolated specialist stage', () => {
  const html = fs.readFileSync(path.join(V2, 'google-photorealistic-3d-proof.html'), 'utf8');
  const appShell = read('shell', 'AppShell.js');
  const commandHeader = read('shell', 'CommandHeader.js');
  const imageryPanel = read('shell', 'ImageryPanel.js');
  assert.match(html, /OPEN 3D/);
  assert.match(html, /RETURN TO 2D/);
  assert.match(html, /gmp-map-3d/);
  assert.match(html, /localhost:3000/);
  assert.doesNotMatch(html, /GOOGLE_MAP_TILES_API_KEY/);
  assert.doesNotMatch(html, /GOOGLE_MAPS_BROWSER_API_KEY/);
  assert.doesNotMatch(appShell, /google-maps-js-3d/);
  assert.doesNotMatch(appShell, /Map3DElement/);
  assert.doesNotMatch(commandHeader, /Map3DElement/);
  assert.doesNotMatch(imageryPanel, /Map3DElement/);
});

test('headed Google 3D proof foregrounds the exact CDP target and fails closed visually', () => {
  const validation = fs.readFileSync(
    path.join(ROOT, 'scripts', 'spatial-v2-google-photorealistic-3d-validate.mjs'),
    'utf8'
  );
  assert.match(validation, /message\.id !== 2/);
  assert.match(validation, /Page\.bringToFront/);
  assert.doesNotMatch(validation, /Target\.targetCreated/);
  assert.match(validation, /renderReachedSteady/);
  assert.match(validation, /navigationPixelsHaveContrast/);
});
