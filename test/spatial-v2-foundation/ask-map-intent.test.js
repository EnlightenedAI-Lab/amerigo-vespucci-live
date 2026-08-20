import test from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeAskMap,
  parseAskMapIntent
} from '../../public/spatial-v2/brain/ask-map-intent.js';
import {
  resolveHereContext,
  unambiguousAoiCenter
} from '../../public/spatial-v2/brain/here-context.js';
import { DEFAULT_PROOF_AOI } from '../../public/spatial-v2/imagery/eo/eo-aoi.js';

test('Show hydrants within 500 m of here is SHOW → HYDRANT → WITHIN 500 m → HERE', () => {
  const intent = parseAskMapIntent('Show hydrants within 500 m of here.');
  assert.equal(intent.supported, true);
  assert.equal(intent.verb, 'SHOW');
  assert.equal(intent.operation, 'WITHIN');
  assert.equal(intent.objectClass, 'hydrant');
  assert.equal(intent.radiusMeters, 500);
  assert.equal(intent.locationKind, 'HERE');
  assert.equal(intent.confirmationTitle, 'SHOW HYDRANTS WITHIN 500 M');
  assert.equal(intent.diagnostics.includes('promoted SHOW/MAP with radius to WITHIN'), true);
  assert.equal(intent.source.provider, 'Ville de Montréal');
});

test('SHOW without a radius fails closed instead of painting a layer', () => {
  const intent = parseAskMapIntent('Show hydrants');
  assert.equal(intent.supported, false);
  assert.equal(intent.code, 'SHOW_REQUIRES_WITHIN');
  assert.equal(looksLikeAskMap('Show hydrants'), true);
});

test('Show the nearest hydrant to here is SHOW → HYDRANT → NEAREST → HERE', () => {
  const intent = parseAskMapIntent('Show the nearest hydrant to here.');
  assert.equal(intent.supported, true);
  assert.equal(intent.verb, 'SHOW');
  assert.equal(intent.operation, 'NEAREST');
  assert.equal(intent.objectClass, 'hydrant');
  assert.equal(intent.radiusMeters, null);
  assert.equal(intent.locationKind, 'HERE');
  assert.equal(intent.confirmationTitle, 'SHOW NEAREST HYDRANT');
  assert.equal(looksLikeAskMap('Show the nearest hydrant to here.'), true);
});

test('NEAREST fails closed for unsupported targets', () => {
  const park = parseAskMapIntent('Show the nearest park to here.');
  assert.equal(park.supported, false);
  assert.equal(park.code, 'UNSUPPORTED_DATASET');
  assert.equal(park.operation, 'NEAREST');
  const named = parseAskMapIntent('Show the nearest hydrant to Place Ville Marie.');
  assert.equal(named.supported, false);
  assert.equal(named.code, 'LOCATION_NOT_HERE');
});

test('near without a distance fails closed', () => {
  const intent = parseAskMapIntent('Show hydrants near here');
  assert.equal(intent.supported, false);
  assert.equal(intent.code, 'NEAR_REQUIRES_DISTANCE');
});

test('unknown language is not treated as ASK MAP', () => {
  assert.equal(looksLikeAskMap('please do something unrelated'), false);
  assert.equal(parseAskMapIntent('please do something unrelated').looksLikeAskMap, false);
});

test('HERE prefers pin over default EO AOI and does not use map center', () => {
  const pin = resolveHereContext({
    pin: { longitude: -73.56832, latitude: 45.50169, source: 'drop-pin' },
    eoAoi: { bbox: DEFAULT_PROOF_AOI.bbox, source: DEFAULT_PROOF_AOI.label }
  });
  assert.equal(pin.ok, true);
  assert.equal(pin.kind, 'PIN');
  assert.equal(unambiguousAoiCenter({ bbox: DEFAULT_PROOF_AOI.bbox, source: DEFAULT_PROOF_AOI.label }), null);
  const missing = resolveHereContext({
    mapCenter: { longitude: -73.56, latitude: 45.50 },
    eoAoi: { bbox: DEFAULT_PROOF_AOI.bbox, source: 'DEFAULT AREA' }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'HERE_UNDEFINED');
});

test('operator-drawn EO AOI can supply HERE only when the center is unambiguous', () => {
  const here = resolveHereContext({
    eoAoi: {
      bbox: [-73.5695, 45.5012, -73.5671, 45.5026],
      source: 'DRAWN BOX'
    }
  });
  assert.equal(here.ok, true);
  assert.equal(here.kind, 'EO_AOI');
});
