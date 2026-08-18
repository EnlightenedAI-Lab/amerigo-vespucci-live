import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCESS_STATE,
  CAPTURE_PRECISION,
  DATE_KIND,
  IMAGERY_POOL,
  MATCH_KIND,
  captureClock,
  formatKnownResolution,
  isCaptureClassObservation,
  rankBestForDate,
  sortHistoryObservations
} from '../public/spatial-v2/imagery/imagery-contract.js';
import {
  CAPTURE_DATE_UNKNOWN,
  formatBestImageActionLabel,
  formatCaptureLine,
  formatImageryStageReceipt,
  formatReleaseLine
} from '../public/spatial-v2/imagery/imagery-capture-receipt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('LATEST is a current mosaic pool and never Wayback', () => {
  const engine = read('imagery', 'time-engine.js');
  const app = read('shell', 'AppShell.js');
  assert.match(engine, /export async function applyLatestCurrentImagery/);
  assert.match(engine, /IMAGERY_POOL\.LATEST/);
  assert.match(engine, /GROUND_MODE\.NEARMAP/);
  assert.match(engine, /GROUND_MODE\.GOOGLE_SATELLITE/);
  assert.match(engine, /GROUND_MODE\.ESRI_WORLD_IMAGERY/);
  assert.match(engine, /let requestedDate = null/);
  assert.doesNotMatch(engine, /requestedDate = new Date\(\)\.toISOString/);
  assert.doesNotMatch(app, /requestedDate = new Date\(\)\.toISOString/);
  assert.match(app, /applyLatestCurrentImagery/);
  assert.match(app, /IMAGERY_POOL\.BEST_FOR_DATE/);
  const latestFn = engine.slice(engine.indexOf('export async function applyLatestCurrentImagery'));
  const latestBody = latestFn.slice(0, latestFn.indexOf('export async function discoverImageryTime'));
  assert.doesNotMatch(latestBody, /esri-wayback/);
  assert.doesNotMatch(latestBody, /esriWaybackProvider/);
  assert.doesNotMatch(latestBody, /WAYBACK/);
});

test('Wayback release stays release; capture clock does not invent a day', () => {
  const releaseOnly = {
    providerId: 'esri-wayback',
    releaseDate: '2026-08-05',
    acquisitionDate: null,
    matchDate: null,
    dateKindUsed: DATE_KIND.RELEASE
  };
  assert.equal(isCaptureClassObservation(releaseOnly), false);
  assert.equal(captureClock(releaseOnly).precision, CAPTURE_PRECISION.UNKNOWN);
  assert.equal(formatCaptureLine(releaseOnly, { includeResolution: false }), CAPTURE_DATE_UNKNOWN);
  assert.equal(formatReleaseLine(releaseOnly), 'RELEASED 2026-08-05');

  const captured = {
    providerId: 'esri-wayback',
    acquisitionDate: '2021-05-24',
    releaseDate: '2023-03-15',
    gsdMeters: 0.2
  };
  assert.equal(formatCaptureLine(captured), 'CAPTURED 2021-05-24 · 20 CM');
  assert.equal(formatReleaseLine(captured), 'RELEASED 2023-03-15');

  const monthOnly = { vintageLabel: '2021-05', acquisitionDate: null, releaseDate: '2023-03-15' };
  assert.equal(captureClock(monthOnly).precision, CAPTURE_PRECISION.MONTH);
  assert.equal(formatCaptureLine(monthOnly, { includeResolution: false }), 'CAPTURED 2021-05');
  assert.notEqual(formatCaptureLine(monthOnly, { includeResolution: false }), 'CAPTURED 2021-05-01');

  const yearOnly = { vintageYear: 2022, acquisitionDate: null };
  assert.equal(captureClock(yearOnly).precision, CAPTURE_PRECISION.YEAR);
  assert.equal(formatCaptureLine(yearOnly, { includeResolution: false }), 'VINTAGE 2022');
  assert.doesNotMatch(formatCaptureLine(yearOnly), /2022-01-01/);
  assert.equal(formatKnownResolution(null), null);
  assert.equal(formatKnownResolution(0.2), '20 CM');
  assert.equal(formatKnownResolution(0.07), '7 CM');
});

test('BEST IMAGE FOR DATE ignores release-only Wayback and current mosaics', () => {
  const requested = '2021-05-24';
  const waybackRelease = {
    id: 'wayback:release',
    providerId: 'esri-wayback',
    releaseDate: '2021-05-25',
    acquisitionDate: null,
    accessState: ACCESS_STATE.STREAMABLE
  };
  const waybackCapture = {
    id: 'wayback:capture',
    providerId: 'esri-wayback',
    releaseDate: '2023-03-15',
    acquisitionDate: '2021-04-01',
    accessState: ACCESS_STATE.STREAMABLE
  };
  const nearmapSurvey = {
    id: 'nearmap:survey',
    providerId: 'nearmap',
    acquisitionDate: '2021-05-20',
    accessState: ACCESS_STATE.STREAMABLE,
    gsdMeters: 0.07
  };
  const current = {
    id: 'esri-current',
    providerId: 'esri-world-imagery',
    dateKindUsed: DATE_KIND.SERVICE_CURRENT,
    acquisitionDate: null
  };
  const none = rankBestForDate([waybackRelease, current], requested);
  assert.equal(none.match, MATCH_KIND.NONE);
  assert.equal(none.record, null);

  const ranked = rankBestForDate([waybackRelease, waybackCapture, nearmapSurvey, current], requested);
  assert.equal(ranked.record?.id, 'nearmap:survey');
  assert.notEqual(ranked.record?.id, 'wayback:release');

  const history = sortHistoryObservations([waybackRelease, nearmapSurvey]);
  assert.equal(history[0].id, 'nearmap:survey');
  assert.equal(history[1].id, 'wayback:release');
});

test('map-stage receipt names provider and capture truth', () => {
  const nearmapCurrent = formatImageryStageReceipt({
    providerId: 'nearmap-wms-latest',
    dateKindUsed: DATE_KIND.SERVICE_CURRENT
  }, { currentMode: 'NEARMAP' });
  assert.deepEqual(nearmapCurrent.lines, ['NEARMAP · CURRENT', CAPTURE_DATE_UNKNOWN]);

  const wayback = formatImageryStageReceipt({
    providerId: 'esri-wayback',
    acquisitionDate: '2021-05-24',
    releaseDate: '2023-03-15'
  }, { currentMode: 'ESRI_WORLD_IMAGERY' });
  assert.equal(wayback.provider, 'ESRI WAYBACK');
  assert.equal(wayback.capture, 'CAPTURED 2021-05-24');
  assert.equal(wayback.release, 'RELEASED 2023-03-15');

  const esri = formatImageryStageReceipt({
    providerId: 'esri-world-imagery',
    dateKindUsed: DATE_KIND.SERVICE_CURRENT
  }, { currentMode: 'ESRI_WORLD_IMAGERY' });
  assert.equal(esri.provider, 'ESRI WORLD IMAGERY · CURRENT');
  assert.equal(esri.capture, CAPTURE_DATE_UNKNOWN);
  assert.equal(esri.release, null);

  assert.equal(formatBestImageActionLabel(null), 'SHOW BEST IMAGE');
  assert.equal(formatBestImageActionLabel('2021-05-24'), 'BEST IMAGE NEAR 2021-05-24');
});

test('operator chrome keeps LATEST HISTORY ALL IMAGERY and four clocks', () => {
  const operator = read('shell', 'OperatorImageryExperience.js');
  const stage = read('shell', 'MapStage.js');
  const app = read('shell', 'AppShell.js');
  assert.match(operator, /LATEST/);
  assert.match(operator, /HISTORY/);
  assert.match(operator, /ALL IMAGERY/);
  assert.match(operator, /REQUESTED DATE/);
  assert.match(operator, /CAPTURE DATE/);
  assert.match(operator, /RELEASE DATE/);
  assert.match(operator, /RETRIEVED DATE/);
  assert.match(operator, /formatCaptureLine/);
  assert.match(stage, /data-iqai-imagery-receipt/);
  assert.match(app, /paintImageryStageReceipt/);
  assert.match(app, /imageryView === IMAGERY_VIEW\.LATEST/);
  assert.match(app, /void applyLatestCurrentImagery\(\)/);
  assert.match(app, /pluginId === 'imagery'/);
  assert.doesNotMatch(operator, /showHistory \|\| showAll \|\| selected/);
  assert.match(operator, /operatorSafeLimitation/);
  assert.match(operator, /A historical imagery source is not configured/);
  assert.equal(IMAGERY_POOL.LATEST, 'LATEST');
  assert.equal(IMAGERY_POOL.HISTORY, 'HISTORY');
  assert.equal(IMAGERY_POOL.BEST_FOR_DATE, 'BEST_FOR_DATE');
});
