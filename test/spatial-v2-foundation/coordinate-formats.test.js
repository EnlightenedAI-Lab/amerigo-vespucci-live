import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCoordinates,
  formatDecimalDegrees,
  formatDms,
  formatElevationMeters,
  formatMgrs,
  formatUtm,
  wgs84ToUtm
} from '../../public/spatial-v2/map/coordinate-formats.js';

test('WGS84 formats stay finite and omit missing elevation as null, not zero', () => {
  const lat = 45.5017;
  const lon = -73.5673;
  const dd = formatDecimalDegrees(lat, lon);
  const dms = formatDms(lat, lon);
  const utm = wgs84ToUtm(lat, lon);
  const utmText = formatUtm(lat, lon);
  const mgrs = formatMgrs(lat, lon);
  assert.match(dd, /45\.50170° N/);
  assert.match(dd, /73\.56730° W/);
  assert.match(dms, /45° 30′ 06\.12″ N/);
  assert.match(dms, /73° 34′ 02\.28″ W/);
  assert.equal(utm.zone, 18);
  assert.equal(utm.band, 'T');
  assert.equal(utm.hemisphere, 'N');
  assert.ok(Math.abs(utm.easting - 611929) < 2);
  assert.ok(Math.abs(utm.northing - 5039684) < 3);
  assert.match(utmText, /^18T {2}6119\d{2} E {2}5039\d{3} N$/);
  assert.match(mgrs, /^18T XR \d{5} \d{5}$/);
  assert.equal(formatElevationMeters(null), null);
  assert.equal(formatElevationMeters(undefined), null);
  assert.equal(formatElevationMeters(0), '0 m');
  const described = describeCoordinates(lat, lon);
  assert.equal(described.elevation, null);
  assert.equal(describeCoordinates(null, lon), null);
});
