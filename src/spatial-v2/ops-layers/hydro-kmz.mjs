import zlib from 'node:zlib';

/**
 * Extract the first .kml entry from a KMZ buffer (ZIP with deflate).
 * Proven Brain adapter: IQAI-Spatial-Brain-Lab/src/spatial/hydro-quebec-kmz-parse.js
 * @param {Buffer | Uint8Array} buffer
 */
export function extractKmlFromKmzBuffer(buffer) {
  const buf = Buffer.from(buffer);
  for (let i = 0; i < buf.length - 30; i += 1) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x03 || buf[i + 3] !== 0x04) {
      continue;
    }
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const offset = i + 30 + nameLen + extraLen;
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    if (!name.toLowerCase().endsWith('.kml')) continue;
    const data = buf.slice(offset, offset + compSize);
    if (method === 0) return data.toString('utf8');
    if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
    throw new Error(`Unsupported KMZ compression method ${method}`);
  }
  throw new Error('No KML entry found in KMZ');
}

function parseCoordinateRing(text) {
  const ring = [];
  const pairs = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (const pair of pairs) {
    const [lonRaw, latRaw] = pair.split(',');
    const longitude = Number(lonRaw);
    const latitude = Number(latRaw);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    ring.push([longitude, latitude]);
  }
  if (ring.length < 4) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function parseCentroidFromExtendedData(block) {
  const match = String(block || '').match(/<Data name="centroid">\s*<value>([^<]+)<\/value>/i);
  if (!match) return null;
  const parts = match[1].split(',');
  const longitude = Number(parts[0]);
  const latitude = Number(parts[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

export function centroidKey(longitude, latitude) {
  return `${Number(longitude).toFixed(8)},${Number(latitude).toFixed(8)}`;
}

/**
 * @param {string} kml
 * @param {{ version?: string, feedTimestamp?: string, receivedAt?: string, sourceName?: string }} [meta]
 */
export function parseHydroOutageAreasFromKml(kml, meta = {}) {
  const areas = [];
  const blocks = String(kml || '').split(/<Placemark\b/i).slice(1);
  let index = 0;

  for (const block of blocks) {
    const placemarkXml = `<Placemark${block}`;
    const idMatch = placemarkXml.match(/\bid="([^"]+)"/i);
    const placemarkId = idMatch?.[1] || `placemark-${index + 1}`;
    const centroid = parseCentroidFromExtendedData(placemarkXml);
    const coordMatch = placemarkXml.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    const ring = coordMatch ? parseCoordinateRing(coordMatch[1]) : null;
    if (!ring) continue;

    const areaId = centroid
      ? `centroid:${centroidKey(centroid.longitude, centroid.latitude)}`
      : `placemark:${placemarkId}`;

    areas.push({
      areaId,
      placemarkId,
      centroidLongitude: centroid?.longitude ?? null,
      centroidLatitude: centroid?.latitude ?? null,
      geometry: {
        type: 'Polygon',
        coordinates: [ring]
      },
      outageId: null,
      sourceVersion: meta.version || null,
      feedTimestamp: meta.feedTimestamp || null,
      receivedAt: meta.receivedAt || null,
      sourceName: meta.sourceName || 'Hydro-Québec Open Data',
      spatialPrecision: 'Approximate outage area'
    });
    index += 1;
  }

  return areas;
}

/**
 * Link polygon areas to marker outages using Hydro's shared centroid field.
 * @param {object[]} areas
 * @param {object[]} outages
 */
export function linkHydroAreasToOutages(areas, outages) {
  const outageByCentroid = new Map();
  for (const outage of outages || []) {
    if (outage.longitude == null || outage.latitude == null) continue;
    outageByCentroid.set(centroidKey(outage.longitude, outage.latitude), outage.outageId);
  }
  for (const area of areas || []) {
    if (area.centroidLongitude == null || area.centroidLatitude == null) continue;
    const key = centroidKey(area.centroidLongitude, area.centroidLatitude);
    const outageId = outageByCentroid.get(key);
    if (outageId) area.outageId = outageId;
  }
  return areas;
}
