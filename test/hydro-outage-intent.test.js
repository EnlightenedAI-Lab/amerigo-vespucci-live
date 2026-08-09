import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchHydroOutageIntent } from '../src/spatial/hydro-outage-intent.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { HYDRO_GROUP_TITLE } from '../src/spatial/hydro-quebec-outages-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stmSource = readFileSync(join(root, 'public/spatial/stm-live-buses.js'), 'utf8');
const hydroSource = readFileSync(join(root, 'public/spatial/hydro-quebec-outages.js'), 'utf8');

test('STM and Hydro runtime layers default to hidden', () => {
  assert.match(stmSource, /visible:\s*false/);
  assert.match(hydroSource, /visible:\s*false/);
});

test('matchHydroOutageIntent recognizes show commands', () => {
  assert.deepEqual(matchHydroOutageIntent('Show Hydro outages'), {
    phrase: HYDRO_GROUP_TITLE,
    action: 'SHOW_LAYER'
  });
  assert.deepEqual(matchHydroOutageIntent('Show current power outages'), {
    phrase: HYDRO_GROUP_TITLE,
    action: 'SHOW_LAYER'
  });
});

test('matchHydroOutageIntent recognizes within command', () => {
  const intent = matchHydroOutageIntent('Show power outages within 10 km of 997 de la Commune');
  assert.equal(intent.phrase, HYDRO_GROUP_TITLE);
  assert.equal(intent.locationText, '997 de la Commune');
  assert.equal(intent.radiusKm, 10);
  assert.equal(intent.radiusMeters, 10000);
});

test('planCompoundPrompt maps Show Hydro outages to SHOW_LAYER', () => {
  const catalog = {
    layers: [{
      catalogId: 'hydro-quebec',
      layerId: 'hydro-quebec',
      title: HYDRO_GROUP_TITLE,
      type: 'group',
      parentGroup: null,
      queryable: false,
      visible: false
    }]
  };
  const plan = planCompoundPrompt('Show Hydro outages', { webmapLayerCatalog: catalog });
  assert.equal(plan.supported, true);
  assert.equal(plan.commands[0].action, 'SHOW_LAYER');
  assert.equal(plan.commands[0].webmapLayer.title, HYDRO_GROUP_TITLE);
});
