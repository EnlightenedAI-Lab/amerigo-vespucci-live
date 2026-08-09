import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultSpvmFilterState,
  buildSpvmDefinitionExpression,
  computeSpvmAnalytics,
  montrealTodayYmd,
  windowStartYmd
} from '../public/spatial/spvm-crime-filter.js';
import { matchSpvmCrimeIntent } from '../public/spatial/spvm-crime-intent.js';

test('SPVM default filter state uses 30D and all categories', () => {
  const state = createDefaultSpvmFilterState();
  assert.equal(state.windowDays, 30);
  assert.equal(state.viewMode, 'INCIDENTS');
  assert.equal(state.categories.size, 6);
  assert.equal(state.shifts.size, 3);
});

test('SPVM definition expression filters date window and category', () => {
  const today = '2026-08-05';
  const state = createDefaultSpvmFilterState();
  state.windowDays = 7;
  state.categories = new Set(['Méfait']);
  const expr = buildSpvmDefinitionExpression(state, today);
  assert.match(expr, /date >= '2026-07-30'/);
  assert.match(expr, /date <= '2026-08-05'/);
  assert.match(expr, /category IN \('Méfait'\)/);
});

test('SPVM definition expression uses epoch ms when ArcGIS date field type', () => {
  const today = '2026-08-08';
  const state = createDefaultSpvmFilterState();
  const layer = { fields: [{ name: 'date', type: 'date' }] };
  const expr = buildSpvmDefinitionExpression(state, today, layer);
  assert.match(expr, /date >= \d+/);
  assert.match(expr, /date <= \d+/);
  assert.doesNotMatch(expr, /date >= '/);
});

test('SPVM analytics respects shift and window filters', () => {
  const graphics = [
    { attributes: { category: 'Méfait', date: '2026-08-05', shift: 'jour', pdq: '12' } },
    { attributes: { category: 'Méfait', date: '2026-08-04', shift: 'nuit', pdq: '12' } },
    { attributes: { category: 'Introduction', date: '2026-08-05', shift: 'soir', pdq: '21' } }
  ];
  const state = createDefaultSpvmFilterState();
  state.windowDays = 7;
  state.shifts = new Set(['nuit']);
  const analytics = computeSpvmAnalytics(graphics, state, '2026-08-05');
  assert.equal(analytics.total, 1);
  assert.equal(analytics.shiftRows.find((row) => row.shift === 'nuit')?.count, 1);
});

test('SPVM language intent matches seven-day crimes', () => {
  const intent = matchSpvmCrimeIntent('Show crimes in the last 7 days');
  assert.equal(intent?.action, 'SPVM_EXPLORE');
  assert.equal(intent?.state?.windowDays, 7);
});

test('SPVM language intent matches vehicle theft category', () => {
  const intent = matchSpvmCrimeIntent('Show vehicle thefts in the last 30 days');
  assert.equal(intent?.action, 'SPVM_EXPLORE');
  assert.equal(intent?.state?.windowDays, 30);
  assert.deepEqual([...intent.state.categories], ['Vol de véhicule à moteur']);
});

test('SPVM window start is inclusive calendar days', () => {
  assert.equal(windowStartYmd('2026-08-05', 30), '2026-07-07');
  assert.equal(windowStartYmd('2026-08-05', 7), '2026-07-30');
});

test('montrealTodayYmd returns YYYY-MM-DD', () => {
  const ymd = montrealTodayYmd(new Date('2026-08-05T18:00:00Z'));
  assert.match(ymd, /^\d{4}-\d{2}-\d{2}$/);
});
