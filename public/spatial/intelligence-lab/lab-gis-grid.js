/**
 * Client-side square density grid for filtered SPVM published locations.
 */

import { aggregateByCategory, dominantCategory } from './lab-spvm-filters.js';

const METERS_PER_DEG_LAT = 111320;

function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function cellId(ix, iy) {
  return `${ix}:${iy}`;
}

/**
 * @param {import('geojson').Feature[]} pointFeatures
 * @param {number} resolutionM
 */
export function buildGridFromPoints(pointFeatures, resolutionM = 500) {
  if (!pointFeatures?.length) return { cells: [], features: [] };

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const centerLat = pointFeatures.reduce((s, f) => s + f.geometry.coordinates[1], 0) / pointFeatures.length;

  const cellLat = resolutionM / METERS_PER_DEG_LAT;
  const cellLng = resolutionM / metersPerDegLng(centerLat);

  const buckets = new Map();

  for (const f of pointFeatures) {
    const [lng, lat] = f.geometry.coordinates;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    const ix = Math.floor(lng / cellLng);
    const iy = Math.floor(lat / cellLat);
    const id = cellId(ix, iy);
    if (!buckets.has(id)) {
      buckets.set(id, {
        id,
        ix,
        iy,
        records: [],
        count: 0,
        shiftCounts: { jour: 0, soir: 0, nuit: 0 }
      });
    }
    const cell = buckets.get(id);
    cell.records.push(f);
    cell.count += 1;
    const sh = f.properties.shift || 'jour';
    cell.shiftCounts[sh] = (cell.shiftCounts[sh] || 0) + 1;
  }

  const cells = [];
  const geoFeatures = [];

  for (const cell of buckets.values()) {
    const catCounts = aggregateByCategory(cell.records);
    const dom = dominantCategory(catCounts);
    const west = cell.ix * cellLng;
    const south = cell.iy * cellLat;
    const east = west + cellLng;
    const north = south + cellLat;

    const attrs = {
      gridId: cell.id,
      count: cell.count,
      dominantCategory: dom || '',
      categoryJson: JSON.stringify(catCounts),
      shiftJson: JSON.stringify(cell.shiftCounts),
      recordKeys: cell.records.map((r) => r.properties.recordKey).join('|')
    };

    cells.push({ ...cell, catCounts, dom, attrs, bounds: { west, south, east, north } });

    geoFeatures.push({
      type: 'Feature',
      properties: attrs,
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south]
        ]]
      }
    });
  }

  return { cells, features: geoFeatures, resolutionM, cellLat, cellLng };
}

export function recordsForGridCell(cell, allFeatures) {
  if (!cell?.records) return [];
  return cell.records;
}
