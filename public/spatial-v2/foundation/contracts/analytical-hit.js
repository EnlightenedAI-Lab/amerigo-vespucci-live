/**
 * AnalyticalHit — SceneLayer building pick. Not FocusRef, not ObjectRef,
 * not Google 3D VISUAL, not an NRCan footprint identity.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import {
  createId,
  failClosed,
  isoNow,
  optionalFiniteNumber,
  optionalString,
  rejectUnknownKeys,
  requirePlainObject,
  requireString
} from './validate.js';

const KEYS = [
  'schemaId',
  'schemaVersion',
  'hitId',
  'screen',
  'mapPoint',
  'longitude',
  'latitude',
  'z',
  'layerTitle',
  'serviceUrl',
  'portalItemId',
  'webSceneItemId',
  'objectId',
  'buildingFID',
  'buildingShellFID',
  'attributes',
  'provenance',
  'createdAt'
];

const SCREEN_KEYS = ['x', 'y'];
const MAP_POINT_KEYS = ['x', 'y', 'z', 'spatialReferenceWkid'];

function optionalIdNumber(value, label) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    failClosed('INVALID_NUMBER', `${label} must be a finite number or null.`, { label, value });
  }
  return number;
}

function sanitizeAttributes(input) {
  if (input == null) return null;
  requirePlainObject(input, 'AnalyticalHit.attributes');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : null;
      continue;
    }
    if (typeof value === 'string') {
      const text = value.trim();
      out[key] = text || null;
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function createScreen(input) {
  requirePlainObject(input, 'AnalyticalHit.screen');
  rejectUnknownKeys(input, 'AnalyticalHit.screen', SCREEN_KEYS);
  const x = optionalFiniteNumber(input.x, 'screen.x');
  const y = optionalFiniteNumber(input.y, 'screen.y');
  if (x == null || y == null) {
    failClosed('INVALID_NUMBER', 'AnalyticalHit.screen x/y must be finite.');
  }
  return { x, y };
}

function createMapPoint(input) {
  if (input == null) return null;
  requirePlainObject(input, 'AnalyticalHit.mapPoint');
  rejectUnknownKeys(input, 'AnalyticalHit.mapPoint', MAP_POINT_KEYS);
  const x = optionalFiniteNumber(input.x, 'mapPoint.x');
  const y = optionalFiniteNumber(input.y, 'mapPoint.y');
  if (x == null || y == null) {
    failClosed('INVALID_NUMBER', 'AnalyticalHit.mapPoint x/y must be finite when present.');
  }
  return {
    x,
    y,
    z: optionalFiniteNumber(input.z, 'mapPoint.z'),
    spatialReferenceWkid: optionalIdNumber(input.spatialReferenceWkid, 'mapPoint.spatialReferenceWkid')
  };
}

export function createAnalyticalHit(input = {}, options = {}) {
  requirePlainObject(input, 'AnalyticalHit');
  rejectUnknownKeys(input, 'AnalyticalHit', KEYS);
  if (input.schemaId != null && input.schemaId !== SCHEMA_IDS.ANALYTICAL_HIT) {
    failClosed('UNSUPPORTED_SCHEMA', 'AnalyticalHit schema is unsupported.', { schemaId: input.schemaId });
  }
  const longitude = optionalFiniteNumber(input.longitude, 'longitude');
  const latitude = optionalFiniteNumber(input.latitude, 'latitude');
  if (longitude == null || latitude == null) {
    failClosed('INVALID_NUMBER', 'AnalyticalHit requires finite longitude and latitude.');
  }
  return {
    schemaId: SCHEMA_IDS.ANALYTICAL_HIT,
    schemaVersion: '1.0.0',
    hitId: input.hitId ? requireString(input.hitId, 'hitId') : createId('analytical-hit', options.idFactory),
    screen: createScreen(input.screen || { x: 0, y: 0 }),
    mapPoint: createMapPoint(input.mapPoint),
    longitude,
    latitude,
    z: optionalFiniteNumber(input.z, 'z'),
    layerTitle: optionalString(input.layerTitle, 'layerTitle'),
    serviceUrl: optionalString(input.serviceUrl, 'serviceUrl'),
    portalItemId: optionalString(input.portalItemId, 'portalItemId'),
    webSceneItemId: optionalString(input.webSceneItemId, 'webSceneItemId'),
    objectId: optionalIdNumber(input.objectId, 'objectId'),
    buildingFID: optionalString(input.buildingFID, 'buildingFID'),
    buildingShellFID: optionalString(input.buildingShellFID, 'buildingShellFID'),
    attributes: sanitizeAttributes(input.attributes),
    provenance: requireString(input.provenance, 'provenance'),
    createdAt: requireString(input.createdAt || isoNow(options.now), 'createdAt')
  };
}

export function validateAnalyticalHit(value) {
  return createAnalyticalHit(value);
}
