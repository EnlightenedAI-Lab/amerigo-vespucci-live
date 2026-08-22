import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_SURFACE,
  canonicalizeImageSurface
} from '../public/spatial-v2/imagery/command/image-surface-mode.js';
import { DEFAULT_PROOF_AOI, validateAoi } from '../public/spatial-v2/imagery/eo/eo-aoi.js';
import {
  captureFromReceipt,
  followUpQuestions,
  formatProbeReadout,
  overlayCaptionText,
  presentBrainResult
} from '../public/spatial-v2/imagery/eo/eo-brain-view.js';
import {
  MAX_AOI_SPAN_DEG,
  validateOperatorAoi
} from '../src/spatial-v2/earth-observation-bridge.js';
import { renderAppShell } from '../public/spatial-v2/shell/AppShell.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('REMOTE SENSING is a top-level command, not a ground mode and not a layer', () => {
  const html = renderAppShell();
  const command = read('shell', 'ImageryCommandSurface.js');
  const host = read('hosts', 'view-host.js');
  const header = read('shell', 'CommandHeader.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  assert.match(html, /data-iqai-remote-sensing-toggle/);
  assert.match(html, />REMOTE SENSING</);
  assert.match(host, /data-iqai-remote-sensing-toggle/);
  assert.match(host, /data-iqai-eo-draw/);
  assert.match(host, /USE SELECTION/);
  assert.match(host, /USE CURRENT VIEW/);
  assert.match(host, /ANALYZE NDVI/);
  assert.match(host, /data-iqai-eo-legend-panel/);
  assert.match(host, /data-iqai-eo-legend-ramp/);
  assert.match(host, /data-iqai-eo-capture/);
  assert.match(host, /data-iqai-eo-probe-panel/);
  assert.match(host, /Click the heatmap/);
  assert.match(host, /data-iqai-eo-compare-panel/);
  assert.match(host, /WHAT THAT MEANS/);
  assert.match(host, />FOLLOW-UP</);
  assert.match(host, />DETAILS</);
  assert.match(header, /data-iqai-remote-sensing-toggle/);
  assert.match(header, /data-iqai-main-screen/);
  assert.match(header, />MAIN SCREEN</);
  assert.match(header, /data-iqai-clear-screen/);
  assert.match(header, />CLEAR SCREEN</);
  assert.match(command, /bindRemoteSensingHost/);
  assert.match(command, /returnToMainMap/);
  assert.match(command, /clearMapDrawings/);
  assert.match(command, /remoteSensing\?\.close/);
  assert.match(command, /remoteSensing\?\.clear/);
  assert.match(session, /bindImageryCommandSurface/);
  assert.match(session, /api\.returnToMainScreen/);
  assert.match(session, /api\.clearScreen/);
  assert.equal(IMAGE_SURFACE.MAP, 'MAP');
  assert.equal(IMAGE_SURFACE.AERIAL, 'AERIAL');
  assert.equal(IMAGE_SURFACE.HISTORY, 'HISTORY');
  assert.equal(canonicalizeImageSurface('REMOTE SENSING'), 'MAP');
  assert.equal(Object.prototype.hasOwnProperty.call(IMAGE_SURFACE, 'REMOTE_SENSING'), false);
  assert.doesNotMatch(read('imagery', 'command', 'image-surface-mode.js'), /REMOTE SENSING/);
  assert.doesNotMatch(read('shell', 'LayersDrawer.js'), /REMOTE SENSING/);
});

test('REMOTE SENSING keeps the MapView and never iframes the EO page', () => {
  const host = read('shell', 'RemoteSensingHost.js');
  const overlay = read('imagery', 'eo', 'eo-overlay-layer.js');
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'spatial-v2', 'earth-observation-bridge.js'), 'utf8');
  assert.match(host, /getMapView/);
  assert.match(host, /DEFAULT_PROOF_AOI/);
  assert.match(host, /paintDrawPreviewScreen/);
  assert.doesNotMatch(host, /new MapView\(/);
  assert.doesNotMatch(overlay, /new MapView\(/);
  assert.match(overlay, /iqai-v2-eo-raster/);
  assert.match(overlay, /toScreen/);
  assert.match(overlay, /paintProbePin/);
  assert.match(overlay, /paintCompareBox/);
  assert.match(overlay, /paintOverlayCaption/);
  assert.doesNotMatch(overlay, /getRuntimePlane/);
  assert.doesNotMatch(host, /8871\/earth-observation/);
  assert.doesNotMatch(host, /<iframe/);
  assert.doesNotMatch(bridge, /DEFAULT_AOI/);
  assert.match(bridge, /requiresOperatorAoi: true/);
  assert.equal((read('map', 'map-foundation.js').match(/new MapView\(/g) || []).length, 1);
});

test('EO analysis refuses a missing or city-scale AOI and does not default to Montréal', () => {
  const missing = validateOperatorAoi(null);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /AOI is required/i);
  const city = validateOperatorAoi({ bbox: [-73.98, 45.40, -73.47, 45.70] });
  assert.equal(city.ok, false);
  assert.match(city.error, /too large/i);
  const downtown = validateOperatorAoi({ bbox: [-73.575, 45.498, -73.555, 45.512] });
  assert.equal(downtown.ok, true);
  assert.deepEqual(downtown.bbox, [-73.575, 45.498, -73.555, 45.512]);
  const clientCity = validateAoi([-73.98, 45.40, -73.47, 45.70]);
  assert.equal(clientCity.ok, false);
  const clientOk = validateAoi([-73.57, 45.50, -73.56, 45.51]);
  assert.equal(clientOk.ok, true);
  const proof = validateAoi(DEFAULT_PROOF_AOI.bbox);
  assert.equal(proof.ok, true);
  assert.deepEqual(proof.bbox, [-73.575, 45.498, -73.548, 45.515]);
  assert.ok(MAX_AOI_SPAN_DEG <= 0.08);
});

test('Brain follow-ups are generated from the EO receipt and do not re-read the overlay', () => {
  const overlay = read('imagery', 'eo', 'eo-overlay-layer.js');
  const host = read('shell', 'RemoteSensingHost.js');
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'spatial-v2', 'earth-observation-bridge.js'), 'utf8');
  const heat = followUpQuestions({
    command: 'EO.SURFACE_TEMPERATURE',
    measurement: { comparison: { differenceCelsius: 1.5 } }
  });
  assert.ok(heat.includes('WHERE IS IT HOTTEST?'));
  assert.ok(heat.includes('COMPARE WITH ANOTHER AREA'));
  assert.ok(heat.includes('HAS THIS CHANGED OVER TIME?'));
  assert.ok(heat.includes('WHAT SHOULD I INSPECT NEXT?'));
  assert.ok(heat.length >= 3 && heat.length <= 5);
  const view = presentBrainResult({
    question: 'WHERE IS IT HOTTEST?',
    answer: 'The hottest measured cells are at the high end of this AOI. This is land surface temperature.',
    limitations: ['This is land-surface temperature, not air temperature.']
  }, {
    command: 'EO.SURFACE_TEMPERATURE',
    explain: { what: 'Landsat surface temperature was measured over the selected area.' },
    scenes: [{ captureStart: '2024-07-14T15:22:11Z' }]
  });
  assert.equal(view.question, 'WHERE IS IT HOTTEST?');
  assert.match(view.answer, /hottest measured cells/i);
  assert.match(view.meaning, /Landsat surface temperature/i);
  assert.match(view.limit, /not air temperature/i);
  assert.equal(captureFromReceipt({ scenes: [{ captureStart: '2024-07-14T15:22:11Z' }] }), '2024-07-14');
  const readout = formatProbeReadout({
    status: 'VALID',
    analysis: { kind: 'lst', value: 48.2, label: 'LST 48.2 °C' },
    coordinate: { lat: 45.506, lon: -73.561 }
  }, { measurement: { mean: 42.3 } });
  assert.match(readout.label, /48\.2/);
  assert.match(readout.versus, /warmer than AOI mean/);
  assert.match(overlayCaptionText({
    command: 'EO.SURFACE_TEMPERATURE',
    scenes: [{ platform: 'Landsat-9', sensor: 'TIRS', captureStart: '2026-06-29T15:37:46Z' }]
  }), /Landsat-9/);
  assert.match(host, /startDrawing\(\{ compare: true \}\)/);
  assert.match(host, /runTimeCompare/);
  assert.match(host, /paintProbePin/);
  assert.match(bridge, /rememberProbe/);
  assert.match(host, /presentBrainResult/);
  assert.match(host, /data-iqai-eo-followup/);
  assert.match(host, /askEoBrain/);
  assert.match(host, /eoReceiptId: receipt.receiptId/);
  assert.doesNotMatch(read('imagery', 'eo', 'eo-brain-view.js'), /dataUrl|heatmap/);
  assert.doesNotMatch(overlay, /askEoBrain/);
});
