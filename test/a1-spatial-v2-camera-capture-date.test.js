import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_ID, createDropPinFocusRef } from '../public/spatial-v2/foundation/contracts/index.js';
import {
  configureAuthoredCameraPersistence,
  listAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import {
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import {
  buildRelevantCameraWall,
  resetCameraWall
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import { destinationAlongHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { classifyMapillaryImage } from '../public/spatial-v2/camera/provider/mapillary-provider.js';
import {
  DATE_SEARCH_HONESTY,
  GOOGLE_DATE_LIMIT,
  buildCaptureCatalog,
  calendarMonth,
  nearestCapture
} from '../public/spatial-v2/camera/provider/capture-catalog.js';
import {
  attachRepresentationsForWall,
  configureProviderLookups,
  getSlotRepresentationSnapshot,
  resetProviderLookups,
  resetSlotRepresentations,
  selectSlotCaptureDate
} from '../public/spatial-v2/camera/provider/slot-representations.js';
import { renderCameraPlanPrintHtml } from '../public/spatial-v2/camera/engine/plan-print.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834 });

function isolate() {
  configureAuthoredCameraPersistence({ storage: null, enabled: false });
  resetAuthoredCameras({ persist: false });
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  resetSlotRepresentations({ emit: false });
  resetProviderLookups();
  clearHydrantRecords();
}

function restore() {
  isolate();
  configureAuthoredCameraPersistence({ storage: null, enabled: true });
}

function poseOf(camera) {
  return {
    cameraId: camera.cameraId,
    longitude: camera.longitude,
    latitude: camera.latitude,
    heading: camera.heading,
    pitch: camera.pitch,
    heightAboveGround: camera.heightAboveGround,
    horizontalFov: camera.horizontalFov
  };
}

function mapImage(id, capturedAt, offsetM = 12) {
  const point = destinationAlongHeading(COMMUNE, 90, offsetM);
  return classifyMapillaryImage({
    id,
    captured_at: capturedAt,
    is_pano: true,
    computed_geometry: { coordinates: [point.longitude, point.latitude] },
    computed_compass_angle: 180,
    thumb_1024_url: `https://example.test/${id}.jpg`
  }, { cameraCoordinate: COMMUNE });
}

test('catalog lists real capture days and snaps missing dates to nearest available', () => {
  const catalog = buildCaptureCatalog({
    mapillaryRanked: [
      mapImage('a', '2019-04-11T12:00:00.000Z', 10),
      mapImage('b', '2021-08-02T12:00:00.000Z', 14),
      mapImage('c', '2024-01-19T12:00:00.000Z', 18)
    ]
  });
  assert.deepEqual(catalog.years, ['2019', '2021', '2024']);
  assert.equal(catalog.searchable, true);
  assert.equal(catalog.honesty, DATE_SEARCH_HONESTY);
  const exact = nearestCapture(catalog, '2021-08-02');
  assert.equal(exact.exact, true);
  assert.equal(exact.item.providerId, 'b');
  const near = nearestCapture(catalog, '2020-12-31');
  assert.equal(near.exact, false);
  assert.equal(near.date, '2021-08-02');
  assert.match(near.label, /NEAREST AVAILABLE 2021-08-02/);
  const cal = calendarMonth(catalog, '2021-08');
  const lit = cal.cells.filter((cell) => cell.available).map((cell) => cell.date);
  assert.deepEqual(lit, ['2021-08-02']);
  assert.equal(cal.cells.some((cell) => cell.date === '2021-08-03' && cell.available), false);
});

test('Google-only catalog does not invent a date search', () => {
  const catalog = buildCaptureCatalog({
    google: {
      provider: 'GOOGLE_STREET360',
      providerId: 'pano-1',
      capturedAt: '2025-06'
    }
  });
  assert.equal(catalog.searchable, false);
  assert.equal(catalog.googleLimit, GOOGLE_DATE_LIMIT);
  assert.equal(catalog.dates[0].date, '2025-06-01');
});

test('per-slot date jump switches Mapillary capture and leaves CameraPose alone', async () => {
  isolate();
  const camera = placeAuthoredCamera({
    cameraId: 'camera-date-1',
    ...destinationAlongHeading(COMMUNE, 0, 40),
    heading: 180,
    pitch: -8,
    heightAboveGround: 4,
    horizontalFov: 70
  });
  const before = poseOf(camera);
  buildRelevantCameraWall(queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE, sourceView: VIEW_ID.MAP })
  }));
  const ranked = [
    mapImage('m-2019', '2019-04-11T12:00:00.000Z', 10),
    mapImage('m-2024', '2024-01-19T12:00:00.000Z', 16)
  ];
  configureProviderLookups({
    google: async () => ({ available: false, status: 'ZERO_RESULTS' }),
    mapillary: async () => ({
      status: 'OK',
      selected: ranked[1],
      ranked,
      count: 2
    }),
    googleKey: async () => null
  });
  await attachRepresentationsForWall();
  const slotId = getSlotRepresentationSnapshot().slots[0].slotId;
  const jumped = selectSlotCaptureDate(slotId, '2019-04-01');
  assert.equal(jumped.ok, true);
  assert.equal(jumped.date, '2019-04-11');
  assert.equal(jumped.exact, false);
  const pack = getSlotRepresentationSnapshot().slots[0];
  assert.equal(pack.selected, 'MAPILLARY');
  assert.equal(pack.representation.providerId, 'm-2019');
  assert.equal(pack.nearestDate, '2019-04-11');
  assert.deepEqual(poseOf(listAuthoredCameras()[0]), before);
  restore();
});

test('Google this-capture-only refuses a fake historical jump', async () => {
  isolate();
  placeAuthoredCamera({
    cameraId: 'camera-date-google',
    ...destinationAlongHeading(COMMUNE, 90, 42),
    heading: 270,
    pitch: -8,
    heightAboveGround: 4,
    horizontalFov: 70
  });
  buildRelevantCameraWall(queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE, sourceView: VIEW_ID.MAP })
  }));
  configureProviderLookups({
    google: async (item) => ({
      available: true,
      status: 'OK',
      panoId: `pano-${item.cameraId}`,
      captureCoordinate: { longitude: item.longitude, latitude: item.latitude },
      imageDate: '2025-06',
      heading: 12
    }),
    mapillary: async () => ({ status: 'OK', selected: null, ranked: [], count: 0 }),
    googleKey: async () => null
  });
  await attachRepresentationsForWall();
  const slotId = getSlotRepresentationSnapshot().slots[0].slotId;
  const refused = selectSlotCaptureDate(slotId, '2019-04-11');
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'GOOGLE_THIS_CAPTURE_ONLY');
  restore();
});

test('wall, overlay, and print keep date honesty and high-contrast camera glyphs', () => {
  const overlay = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.match(overlay, /CAMERA_FILL = '#f4f0ea'/);
  assert.match(overlay, /KEY = '#0b0d10'/);
  assert.match(overlay, /ACTIVE = '#00e5ff'/);
  assert.match(overlay, /BOUNDARY = '#ff9f1c'/);
  assert.match(renderCameraWallSurface(), /PRINT PLAN/);
  assert.match(renderCameraRelevanceSurface(), /PRINT PLAN/);
  assert.match(wall, /data-iqai-camera-date-input/);
  assert.match(wall, /DATE_SEARCH_HONESTY/);
  assert.match(wall, /if \(!enlarged\)/);
  assert.match(fs.readFileSync(path.join(V2, 'camera', 'provider', 'capture-catalog.js'), 'utf8'), /STREET PHOTO DATE · NOT CAMERA DATE · NOT LIVE FEED/);
  assert.match(css, /iqai-v2-camera-date__year/);
  const html = renderCameraPlanPrintHtml({
    generatedAt: '2026-08-21',
    planId: 'PLAN-1',
    pattern: 'POINT',
    honesty: 'NOT LOS',
    dateHonesty: DATE_SEARCH_HONESTY,
    cameras: [{
      ordinal: 'CAMERA 01',
      cameraId: 'cam-1',
      longitude: COMMUNE.longitude,
      latitude: COMMUNE.latitude,
      heading: 90,
      horizontalFov: 70,
      provider: 'MAPILLARY',
      captureDate: 'CAPTURED 2019-04-11',
      offset: '12 m'
    }]
  });
  assert.match(html, /STREET PHOTO DATE · NOT CAMERA DATE · NOT LIVE FEED/);
  assert.match(html, /CAMERA 01/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
});
