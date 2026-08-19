import { describeCoordinates, formatDecimalDegrees, formatDms, formatMgrs, formatUtm } from './public/js/coordinates.js';

const lat = 45.50169;
const lon = -73.56832;
const formats = describeCoordinates(lat, lon, { elevationMeters: 32, place: 'Place Ville Marie' });

const checks = [
  ['dd', Boolean(formatDecimalDegrees(lat, lon)?.includes('N') && formatDecimalDegrees(lat, lon)?.includes('W'))],
  ['dms', /45° 30′ 06\.\d{2}″ N/.test(formatDms(lat, lon))],
  ['utm', /^18T\s+\d+ E\s+\d+ N$/.test(formatUtm(lat, lon))],
  ['mgrs', /^18T [A-Z]{2} \d{5} \d{5}$/.test(formatMgrs(lat, lon))],
  ['epsg', formats.epsg.includes('4326') && formats.epsg.includes('32618')]
];

const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({ formats, checks: Object.fromEntries(checks), ok: failed.length === 0 }, null, 2));
if (failed.length) process.exitCode = 1;
