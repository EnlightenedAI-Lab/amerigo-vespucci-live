/**
 * Viewport-friendly grid index for World Object Acquisition.
 * Does not render every polygon.
 */

import {
  bboxContains,
  bboxIntersects,
  distanceToFeatureMeters,
  featureArea,
  featureBBox,
  featureContainsPoint,
  isPointFeature
} from '../focus/objects.js';
import { labMeta } from './adapter.js';

const CELL = 0.0008;

function cellKey(col, row) {
  return `${col}:${row}`;
}

function cellsForBBox(bbox) {
  if (!bbox) return [];
  const minC = Math.floor(bbox[0] / CELL);
  const minR = Math.floor(bbox[1] / CELL);
  const maxC = Math.floor(bbox[2] / CELL);
  const maxR = Math.floor(bbox[3] / CELL);
  const keys = [];
  for (let col = minC; col <= maxC; col += 1) {
    for (let row = minR; row <= maxR; row += 1) {
      keys.push(cellKey(col, row));
    }
  }
  return keys;
}

function compareInside(a, b, objectClass) {
  if (objectClass === 'evaluation_unit') {
    const catA = String(a.source.CATEGORIE_UEF || '');
    const catB = String(b.source.CATEGORIE_UEF || '');
    const regA = /r[eé]gulier/i.test(catA);
    const regB = /r[eé]gulier/i.test(catB);
    if (regA !== regB) return regA ? -1 : 1;
    const terrainA = Number(a.source.SUPERFICIE_TERRAIN) || a.area;
    const terrainB = Number(b.source.SUPERFICIE_TERRAIN) || b.area;
    if (terrainA !== terrainB) return terrainB - terrainA;
  }
  if (objectClass === 'building') {
    if (a.area !== b.area) return b.area - a.area;
  }
  if (a.sourceId < b.sourceId) return -1;
  if (a.sourceId > b.sourceId) return 1;
  return 0;
}

export function indexCollection(collection, objectClass) {
  const items = [];
  const bySourceId = new Map();
  const grid = new Map();
  for (const feature of collection?.features || []) {
    const lab = labMeta(feature);
    const bbox = featureBBox(feature);
    if (!bbox || !lab.sourceId) continue;
    const item = {
      objectClass: lab.objectClass || objectClass,
      sourceId: String(lab.sourceId),
      feature,
      bbox,
      area: featureArea(feature),
      source: feature.properties?.source || {}
    };
    items.push(item);
    bySourceId.set(item.sourceId, item);
    for (const key of cellsForBBox(bbox)) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(item);
      else grid.set(key, [item]);
    }
  }

  function candidatesAt(lat, lng, pad = 0.00025) {
    const seen = new Set();
    const out = [];
    for (const key of cellsForBBox([lng - pad, lat - pad, lng + pad, lat + pad])) {
      for (const item of grid.get(key) || []) {
        if (seen.has(item.sourceId)) continue;
        seen.add(item.sourceId);
        if (bboxIntersects(item.bbox, [lng - pad, lat - pad, lng + pad, lat + pad])
          || bboxContains(item.bbox, lng, lat, pad)) {
          out.push(item);
        }
      }
    }
    return out;
  }

  return {
    objectClass,
    count: items.length,
    items,
    findBySourceId(sourceId) {
      return bySourceId.get(String(sourceId)) || null;
    },
    findAt(lat, lng, nearMeters = 12) {
      const pad = Math.max(0.0002, nearMeters / 111320);
      let inside = [];
      let near = null;
      for (const item of candidatesAt(lat, lng, pad)) {
        const insideMeters = isPointFeature(item.feature)
          ? nearMeters
          : Math.min(8, nearMeters * 0.65);
        if (isPointFeature(item.feature)) {
          const dist = distanceToFeatureMeters(lat, lng, item.feature);
          if (dist <= insideMeters) {
            inside.push({ ...item, dist });
            continue;
          }
          if (dist <= nearMeters && (!near || dist < near.dist)) {
            near = { ...item, dist };
          }
          continue;
        }
        if (featureContainsPoint(item.feature, lng, lat)) {
          inside.push(item);
          continue;
        }
        const dist = distanceToFeatureMeters(lat, lng, item.feature);
        if (dist <= nearMeters && (!near || dist < near.dist)) {
          near = { ...item, dist };
        }
      }
      if (inside.length) {
        if (isPointFeature(inside[0].feature)) {
          inside.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || compareInside(a, b, objectClass));
        } else {
          inside.sort((a, b) => compareInside(a, b, objectClass));
        }
        return {
          item: inside[0],
          relation: 'inside',
          range: inside[0].dist || 0,
          alternatives: inside.slice(1)
        };
      }
      if (near) return { item: near, relation: 'near', range: near.dist, alternatives: [] };
      return null;
    }
  };
}
