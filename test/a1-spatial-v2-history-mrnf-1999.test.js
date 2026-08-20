import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MRNF_1999_CAPTURE,
  MRNF_1999_ID,
  MRNF_1999_TILE_TEMPLATE,
  coversAoi,
  mergeMrnf1999Payload,
  tiffAvailable
} from '../src/spatial-v2/history-mrnf-1999.js';

test('1999 MRNF lists only when the viewport centre is inside the official footprint', () => {
  assert.equal(coversAoi({ longitude: -73.5674, latitude: 45.5019 }), true);
  assert.equal(coversAoi({ xmin: -73.57, ymin: 45.50, xmax: -73.56, ymax: 45.51 }), true);
  assert.equal(coversAoi({ longitude: -73.6308, latitude: 45.4766 }), false);
  assert.equal(coversAoi({ longitude: -71.2080, latitude: 46.8139 }), false);
});

test('1999 MRNF merges into the existing HISTORY timeline for a covering view', () => {
  const downtown = { lon: '-73.5673', lat: '45.5017', xmin: '-73.58', ymin: '45.49', xmax: '-73.55', ymax: '45.51' };
  const merged = mergeMrnf1999Payload('/imagery/timeline', downtown, {
    ok: true,
    observations: [{ imageryObservationId: 'esri:wayback:1', provider: 'ESRI_WAYBACK', captureStart: '2023-05-11' }]
  });
  const row = merged.observations.find((item) => item.imageryObservationId === MRNF_1999_ID);
  assert.ok(row);
  assert.equal(row.captureStart, MRNF_1999_CAPTURE);
  assert.equal(row.provider, 'MRNF');
  assert.equal(row.tileTemplate, tiffAvailable() ? MRNF_1999_TILE_TEMPLATE : 'UNKNOWN');

  const outside = mergeMrnf1999Payload('/imagery/timeline', { lon: '-71.2080', lat: '46.8139' }, {
    ok: true,
    observations: []
  });
  assert.equal(outside.observations.some((item) => item.imageryObservationId === MRNF_1999_ID), false);
});
