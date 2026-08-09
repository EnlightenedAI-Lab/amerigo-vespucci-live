import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCrewStatusDisplay,
  formatEstimatedRestorationDisplay,
  deriveHydroOutageTiming,
  buildHydroOutageFeatureHtml,
  parseHydroLocalTimestamp
} from '../public/spatial/hydro-outage-display.js';

test('formatCrewStatusDisplay maps Hydro codes to operational labels', () => {
  assert.equal(formatCrewStatusDisplay({ crewStatusCode: 'A' }), 'Work Assigned');
  assert.equal(formatCrewStatusDisplay({ crewStatusCode: 'R' }), 'Crew En Route');
  assert.equal(formatCrewStatusDisplay({ crewStatusCode: 'L' }), 'Crew At Work');
});

test('formatEstimatedRestorationDisplay returns Unknown when missing', () => {
  assert.equal(formatEstimatedRestorationDisplay({}), 'Unknown');
});

test('deriveHydroOutageTiming computes active duration', () => {
  const start = new Date();
  start.setHours(start.getHours() - 1);
  start.setMinutes(start.getMinutes() - 24);
  const pad = (n) => String(n).padStart(2, '0');
  const outageStart = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}:00`;
  const timing = deriveHydroOutageTiming({ outageStart });
  assert.ok(timing.outageActive);
  assert.match(timing.outageActive, /h|min/);
});

test('buildHydroOutageFeatureHtml highlights operational fields', () => {
  const html = buildHydroOutageFeatureHtml({
    iqaiType: 'hydro_quebec_outage',
    customersAffected: 1535,
    outageStart: '2026-08-08 10:50:42',
    estimatedRestoration: '2026-08-08 12:45:00',
    crewStatusCode: 'A',
    causeCategory: 'Weather',
    sourceName: 'Hydro-Québec Open Data',
    feedTimestamp: '2026-08-08T12:00:09.000Z'
  });
  assert.match(html, /HYDRO-QUÉBEC OUTAGE/);
  assert.match(html, /Customers affected/);
  assert.match(html, /Crew status/);
  assert.match(html, /Work Assigned/);
  assert.match(html, /Affected area/);
});

test('parseHydroLocalTimestamp parses Hydro datetime strings', () => {
  const date = parseHydroLocalTimestamp('2026-08-08 12:45:00');
  assert.ok(date instanceof Date);
  assert.equal(date.getFullYear(), 2026);
});
