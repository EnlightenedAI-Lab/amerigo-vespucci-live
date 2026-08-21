import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAisSpatialStreamEnabled } from '../src/spatial/aisstream-config.js';
import {
  IMAGE_SURFACE,
  IMAGE_SURFACE_FAILURE,
  assertPixelSeparation,
  canonicalizeImageSurface,
  projectImageSurface
} from '../public/spatial-v2/imagery/command/image-surface-mode.js';
import { formatImageDate, imageDateFromObservation } from '../public/spatial-v2/imagery/command/image-date.js';
import {
  COVERAGE_STATUS,
  DISPLAY_TRUTH,
  EXPORT_STATUS,
  buildTimelineModel,
  calendarModel,
  displayEvidenceConfirmed,
  exportPermission,
  isDisplayConfirmed,
  sourceDetails,
  toHistoricalObservation,
  usefulCaptures,
  yearGaps
} from '../public/spatial-v2/imagery/historical/historical-contract.js';
import { HISTORICAL_PROVIDER_REGISTRY } from '../public/spatial-v2/imagery/historical/historical-providers.js';
import { renderAppShell } from '../public/spatial-v2/shell/AppShell.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function obs(partial) {
  return toHistoricalObservation({
    id: partial.id,
    providerId: 'esri-wayback',
    productName: `Archive ${partial.releaseDate}`,
    releaseDate: partial.releaseDate,
    acquisitionDate: partial.captureDate || null,
    dateKindUsed: partial.captureDate ? 'acquisitionDate' : 'releaseDate',
    gsdMeters: partial.gsdMeters ?? null,
    rights: { display: 'permitted', export: 'unknown', cache: 'unknown', analysis: 'unknown', attributionRequired: true },
    sourceIdentity: {
      kind: 'wayback-release',
      releaseNum: partial.releaseNum || 1,
      itemURL: 'https://wayback.maptiles.arcgis.com/tile/1/{level}/{row}/{col}'
    },
    assets: [{ kind: 'webtile', urlTemplate: 'https://wayback.maptiles.arcgis.com/tile/1/{level}/{row}/{col}' }]
  }, {
    coverageStatus: partial.coverage || COVERAGE_STATUS.COVERED,
    displayConfirmed: partial.displayConfirmed === true,
    displayState: partial.displayConfirmed ? DISPLAY_TRUTH.DISPLAY_CONFIRMED : DISPLAY_TRUTH.SELECTED,
    attribution: 'Esri World Imagery Wayback',
    exportStatus: EXPORT_STATUS.EXPORT_RIGHTS_REVIEW_REQUIRED
  });
}

test('MAP / AERIAL / HISTORY is one exclusive active state and never mixes pixel families', () => {
  const map = projectImageSurface(IMAGE_SURFACE.MAP);
  const aerial = projectImageSurface(IMAGE_SURFACE.AERIAL);
  const history = projectImageSurface(IMAGE_SURFACE.HISTORY);
  assert.equal(map.mode, 'MAP');
  assert.equal(aerial.mode, 'AERIAL');
  assert.equal(history.mode, 'HISTORY');
  assert.equal(canonicalizeImageSurface('history'), 'HISTORY');
  assert.equal(map.historyChromeVisible, false);
  assert.equal(aerial.historyChromeVisible, false);
  assert.equal(history.historyChromeVisible, true);
  assert.equal(history.mapViewVisible, false);
  assert.equal(history.street360Allowed, false);
  assert.equal(assertPixelSeparation(map), true);
  assert.equal(assertPixelSeparation(aerial), true);
  assert.equal(assertPixelSeparation(history), true);
  assert.equal(map.googlePixelsAllowed && map.historicalPixelsAllowed, false);
  assert.equal(history.googlePixelsAllowed && history.historicalPixelsAllowed, false);
});

test('IMAGE DATE uses capture, keeps publication separate, and does not invent a day', () => {
  const day = obs({ id: 'd', releaseDate: '2025-06-01', captureDate: '2025-05-28' });
  const year = toHistoricalObservation({
    id: 'y',
    providerId: 'esri-wayback',
    vintageYear: 2015,
    vintageLabel: '2015',
    releaseDate: '2016-01-01',
    acquisitionDate: null
  }, { coverageStatus: COVERAGE_STATUS.COVERED });
  assert.equal(formatImageDate(day), '28 MAY 2025');
  assert.equal(imageDateFromObservation(day).publicationDate, '2025-06-01');
  assert.notEqual(formatImageDate(day), imageDateFromObservation(day).publicationDate);
  assert.equal(formatImageDate(year), '2015');
  assert.doesNotMatch(formatImageDate(year), /01 JAN 2015/);
  assert.equal(formatImageDate(obs({ id: 'u', releaseDate: '2020-01-01' })), 'DATE UNKNOWN');
});

test('timeline keeps unique captures and honest empty years; calendar shares selected date', () => {
  const list = [
    obs({ id: 'a', releaseDate: '2020-01-01', captureDate: '2019-08-12', releaseNum: 10 }),
    obs({ id: 'b', releaseDate: '2020-06-01', captureDate: '2019-08-12', releaseNum: 11, displayConfirmed: true }),
    obs({ id: 'c', releaseDate: '2022-01-01', captureDate: '2021-09-03', releaseNum: 20 })
  ];
  const useful = usefulCaptures(list);
  assert.equal(useful.length, 2);
  assert.equal(useful[0].observationId, 'b');
  assert.deepEqual(yearGaps(useful, 2019, 2021), [2020]);
  const timeline = buildTimelineModel(list, 'b');
  assert.equal(timeline.ticks.find((tick) => tick.selected)?.observationId, 'b');
  const cal = calendarModel(list, 2019);
  assert.equal(cal.months[0].captures[0].observationId, 'b');
});

test('SELECTED is not DISPLAY CONFIRMED; playback evidence rejects blank frames', () => {
  const selected = obs({ id: 's', releaseDate: '2021-01-01', captureDate: '2020-06-01' });
  assert.equal(selected.displayState, DISPLAY_TRUTH.SELECTED);
  assert.equal(isDisplayConfirmed(selected), false);
  assert.equal(displayEvidenceConfirmed({
    paintedTiles: 0,
    opaquePixelCount: 10,
    opaqueShare: 0.01,
    contrast: 2
  }), false);
  assert.equal(displayEvidenceConfirmed({
    paintedTiles: 4,
    opaquePixelCount: 400,
    opaqueShare: 0.4,
    contrast: 40
  }), true);
});

test('rights-aware capture blocks Google and unqualified Wayback export', () => {
  const google = exportPermission({ rights: { export: 'prohibited' } }, 'AERIAL');
  const wayback = exportPermission(obs({ id: 'w', releaseDate: '2021-01-01', captureDate: '2020-01-01' }), 'HISTORY');
  assert.equal(google.permitted, false);
  assert.match(google.detail, /EXPORT NOT PERMITTED FOR THIS SOURCE/);
  assert.equal(wayback.permitted, false);
  assert.equal(wayback.status, EXPORT_STATUS.EXPORT_RIGHTS_REVIEW_REQUIRED);
});

test('failure states and source details stay client-readable', () => {
  assert.equal(IMAGE_SURFACE_FAILURE.LOOKING, 'LOOKING FOR HISTORICAL IMAGERY…');
  assert.equal(IMAGE_SURFACE_FAILURE.NONE, 'NO HISTORICAL IMAGES FOR THIS VIEW');
  assert.equal(IMAGE_SURFACE_FAILURE.ONLY_CURRENT, 'ONLY CURRENT AERIAL AVAILABLE');
  assert.equal(IMAGE_SURFACE_FAILURE.SELECTED_NOT_DISPLAYED, 'SELECTED — NOT YET DISPLAYED');
  assert.equal(IMAGE_SURFACE_FAILURE.EXPORT_NOT_PERMITTED, 'EXPORT NOT PERMITTED');
  const details = sourceDetails(obs({ id: 's', releaseDate: '2024-02-01', captureDate: '2023-07-09' }));
  assert.equal(details.imageDate, '9 JUL 2023');
  assert.equal(details.publicationDate, '2024-02-01');
  assert.doesNotMatch(JSON.stringify(details), /SRC_DATE|WebTileLayer|WMTS/);
});

test('provider registry leaves Québec and Nearmap as empty extension points', () => {
  assert.ok(HISTORICAL_PROVIDER_REGISTRY['esri-wayback']);
  assert.equal(HISTORICAL_PROVIDER_REGISTRY['mrnf-quebec'], null);
  assert.equal(HISTORICAL_PROVIDER_REGISTRY['cmm-orthophoto'], null);
  assert.equal(HISTORICAL_PROVIDER_REGISTRY['nearmap-archive'], null);
  const chrome = read('shell', 'ImageryCommandSurface.js');
  assert.match(chrome, /NEARMAP CURRENT/);
  assert.doesNotMatch(chrome, /IMAGE DATE 28 MAY 2025/);
  assert.doesNotMatch(chrome, /CURRENT AERIAL · DATE NOT PROVIDED/);
  assert.doesNotMatch(chrome, /Montréal 2015|CMM entitlement|MRNF/);
  assert.doesNotMatch(chrome, /DISCOVER IMAGERY/);
  assert.doesNotMatch(chrome, /WebTileLayer|WMTS|Wayback config/);
});

test('live shell mounts compact MAP / AERIAL / HISTORY without copying lab chrome', () => {
  const html = renderAppShell();
  const host = read('hosts', 'view-host.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  const surface = read('imagery', 'historical', 'historical-surface.js');
  const engine = read('imagery', 'historical', 'historical-engine.js');
  assert.match(html, /data-iqai-image-surface="MAP"/);
  assert.match(html, /data-iqai-image-surface="AERIAL"/);
  assert.match(html, /data-iqai-image-surface="HISTORY"/);
  assert.match(html, /data-iqai-history-stage/);
  assert.match(html, />PREVIOUS</);
  assert.match(html, />PLAY</);
  assert.match(html, />NEXT</);
  assert.match(html, />COMPARE</);
  assert.match(html, /SOURCE DETAILS/);
  assert.match(host, /data-iqai-history-stage/);
  assert.match(session, /bindImageryCommandSurface/);
  assert.match(session, /paintIqaiGroundSurfaces/);
  assert.match(session, /api\.imageryCommand/);
  assert.match(engine, /discoverHistoricalImagery/);
  assert.match(engine, /IMAGE_SURFACE_FAILURE\.LOOKING/);
  assert.match(read('imagery', 'command', 'image-surface-mode.js'), /LOOKING FOR HISTORICAL IMAGERY/);
  assert.doesNotMatch(engine, /DISCOVER IMAGERY/);
  assert.doesNotMatch(surface, /new MapView\(/);
  assert.doesNotMatch(surface, /maps\.googleapis\.com|mt\d\.google\.com|khms\d*\.google/);
  assert.doesNotMatch(html, /historical-imagery-lab/);
  assert.equal((read('map', 'map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.match(read('iqai-spatial-v2.css'), /imagery-command__history\[hidden\]/);
  assert.match(read('iqai-spatial-v2.css'), /display: none !important/);
  assert.match(engine, /pause: false/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /restoreViewpoint\(getMapView\(\), preserved\)/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /pendingMode/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /groundMatches/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /setIqaiGroundSurface\('map'\)/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /Promise\.race/);
  assert.match(read('imagery', 'command', 'image-surface-mode.js'), /HISTORY_SURFACE_HELD = false/);
  assert.doesNotMatch(read('shell', 'ImageryCommandSurface.js'), /discoverHistoricalImagery/);
  assert.match(read('shell', 'HistoryHost.js'), /fetchHistoryTimeline/);
  assert.match(read('imagery', 'historical', 'history-painter.js'), /paintHistoryTemplate/);
  assert.match(read('imagery', 'historical', 'history-catalog-client.js'), /xmin/);
  assert.match(read('imagery', 'historical', 'history-painter.js'), /setHistoryPainterMarks/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /openWorldviewImagery/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /paneImageryOpen/);
  assert.match(read('imagery', 'historical', 'history-painter.js'), /paintHistoryCompare/);
  assert.match(read('shell', 'HistoryHost.js'), /setHistoryPainterSettleListener/);
  assert.match(host, /data-iqai-history-compare/);
  assert.match(host, /data-iqai-history-library/);
  assert.match(host, /data-iqai-library-toggle/);
  assert.match(host, /REMOVE FROM VIEW/);
  assert.match(host, /RESEARCH CATALOGUE/);
  assert.match(host, /data-iqai-history-caption="a"/);
  assert.match(host, /data-iqai-history-now/);
  assert.match(read('shell', 'HistoryHost.js'), /data-iqai-history-caption-date/);
  assert.match(read('shell', 'HistoryHost.js'), /USE ON THIS VIEW/);
  assert.match(read('shell', 'HistoryHost.js'), /BEST FOR THIS VIEW/);
  assert.match(read('shell', 'HistoryHost.js'), /LISTED · NOT ON THIS VIEW/);
  assert.match(read('shell', 'HistoryHost.js'), /operatorSource/);
  assert.match(read('shell', 'HistoryHost.js'), /observationIdOf\(receipt\) === keepId/);
  assert.match(read('shell', 'HistoryHost.js'), /showInMap/);
  assert.match(read('shell', 'HistoryHost.js'), /listOnly/);
  assert.match(read('shell', 'HistoryHost.js'), /onUseOnView/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /liveMode/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /pendingKeepId/);
  assert.doesNotMatch(read('shell', 'HistoryHost.js'), /SHOW IN MAP/);
  assert.match(read('shell', 'ImageryCommandSurface.js'), /snapshot\(\)\?\.viewpoint/);
  assert.doesNotMatch(html, /historical-imagery-lab/);
});

test('Google / non-Google separation and camera clocks remain unmerged', () => {
  const command = read('shell', 'ImageryCommandSurface.js');
  const engine = read('imagery', 'historical', 'historical-engine.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  assert.match(command, /googleNonGoogleSeparated/);
  assert.match(engine, /googlePixelsPresent/);
  assert.match(session, /dataset.iqaiImageSurface === 'HISTORY'/);
  assert.doesNotMatch(command, /setActiveSpatialFocus/);
  assert.doesNotMatch(engine, /Street360|SensorPose|view-camera/);
  assert.match(read('shell', 'ViewCameraControl.js'), /EXPERIMENTAL|STREET360|view-camera/);
});

test('regressions: one MapView, AIS autostart off, camera and layers files untouched by HISTORY compositor', () => {
  assert.equal((read('map', 'map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.equal(isAisSpatialStreamEnabled({}), false);
  assert.match(read('shell', 'ViewCameraControl.js'), /data-iqai-view-camera/);
  assert.match(read('ops-layers', 'controller.js'), /applyScene/);
  assert.match(read('shell', 'PlaceCameraControl.js'), /PLACE CAMERA|place-camera/);
  const surface = read('imagery', 'historical', 'historical-surface.js');
  assert.doesNotMatch(surface, /analyze-3d/);
});
