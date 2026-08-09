import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractKmlFromKmzBuffer,
  parseHydroOutageAreasFromKml,
  linkHydroAreasToOutages,
  centroidKey
} from '../src/spatial/hydro-quebec-kmz-parse.js';
import { normalizeHydroMarkersPayload } from '../src/spatial/hydro-quebec-outages-normalize.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kmlFixture = readFileSync(join(root, 'test/fixtures/hydro-quebec-bispoly.kml'), 'utf8');
const markersFixture = JSON.parse(
  readFileSync(join(root, 'test/fixtures/hydro-quebec-bismarkers.json'), 'utf8')
);

function buildKmzFromKml(kml, entryName = 'doc.kml') {
  const nameBytes = Buffer.from(entryName, 'utf8');
  const compressed = zlib.deflateRawSync(Buffer.from(kml, 'utf8'));
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(compressed.length, 14);
  header.writeUInt32LE(Buffer.byteLength(kml, 'utf8'), 18);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return Buffer.concat([header, compressed]);
}

test('parseHydroOutageAreasFromKml extracts valid polygons and rejects invalid rings', () => {
  const areas = parseHydroOutageAreasFromKml(kmlFixture, {
    version: '20260808120009',
    feedTimestamp: '2026-08-08T12:00:09.000Z',
    receivedAt: '2026-08-08T12:01:00.000Z'
  });
  assert.equal(areas.length, 3);
  assert.equal(areas[0].geometry.type, 'Polygon');
  assert.ok(areas[0].geometry.coordinates[0].length >= 4);
  assert.equal(areas[0].spatialPrecision, 'Approximate outage area');
});

test('extractKmlFromKmzBuffer decompresses deflate KMZ entries', () => {
  const kmz = buildKmzFromKml(kmlFixture);
  const kml = extractKmlFromKmzBuffer(kmz);
  assert.match(kml, /<Placemark/i);
  const areas = parseHydroOutageAreasFromKml(kml);
  assert.equal(areas.length, 3);
});

test('linkHydroAreasToOutages matches marker centroids exactly', () => {
  const outages = normalizeHydroMarkersPayload(markersFixture, {
    version: '20260808120009',
    feedTimestamp: '2026-08-08T12:00:09.000Z',
    receivedAt: '2026-08-08T12:01:00.000Z'
  });
  const areas = parseHydroOutageAreasFromKml(kmlFixture);
  const linked = linkHydroAreasToOutages(areas, outages);
  const withOutage = linked.filter((area) => area.outageId);
  assert.equal(withOutage.length, 3);
  const msgOutage = outages.find((entry) => entry.messageId === 'hydro-msg-1119');
  const msgArea = linked.find((area) => area.outageId === msgOutage.outageId);
  assert.ok(msgArea);
  assert.equal(
    centroidKey(msgOutage.longitude, msgOutage.latitude),
    centroidKey(msgArea.centroidLongitude, msgArea.centroidLatitude)
  );
});
