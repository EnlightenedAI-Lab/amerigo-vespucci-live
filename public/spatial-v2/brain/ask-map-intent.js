/**
 * Deterministic ASK MAP intent for Spatial V2.
 * Recovers SHOW / WITHIN / NEAREST / fail-closed rules. Does not import V1 painters.
 * SHOW with a radius is WITHIN. SHOW nearest is NEAREST. Missing radius, dataset, or HERE fails closed.
 */

import { failClosed } from '../foundation/contracts/validate.js';

export const ASK_MAP_OPERATIONS = Object.freeze({
  SHOW: 'SHOW',
  WITHIN: 'WITHIN',
  NEAREST: 'NEAREST'
});

export const ASK_MAP_OBJECT_CLASS = Object.freeze({
  HYDRANT: 'hydrant'
});

export const HYDRANT_SOURCE = Object.freeze({
  objectClass: 'hydrant',
  label: 'HYDRANT',
  provider: 'Ville de Montréal',
  dataset: "Bornes d'incendie",
  datasetId: 'cb4de65e-138b-4936-9d5c-2d9a0bc9b4ce',
  identityField: 'ID_BI',
  dataUrl: '/spatial-v2/data/woa/hydrants.geojson'
});

const HYDRANT_PHRASE = /^(?:(?:the|les|des)\s+)?(?:fire\s+)?hydrants?$|bornes?\s+d['’]?incendie|bornes?\s+incendie/i;
const HERE_PHRASE = /^(?:here|ici|this pin|the pin|this point|the selected point|this location|my location|this place)$/i;
const SHOW_VERB = /^(?:show|map|display|afficher|montrer)\b/i;

const WITHIN_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(.+?)\s+(?:within|inside)\s+(\d+(?:\.\d+)?)\s*(m|meters?|metres?|km|kilometres?|kilometers?)\s+(?:of|from|de|à)\s+(.+)$/i;
const WITHIN_IN_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(.+?)\s+in\s+(\d+(?:\.\d+)?)\s*(m|meters?|metres?|km|kilometres?|kilometers?)\s+(?:of|from)\s+(.+)$/i;
const FR_RADIUS_PATTERN = /^(?:afficher|montrer|show|map)\s+(.+?)\s+(?:dans un rayon de|à moins de)\s+(\d+(?:\.\d+)?)\s*(m|meters?|metres?|km|kilometres?|kilometers?)\s+(?:de|du|d'|à)\s*(.+)$/i;
const NEAREST_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(?:the\s+)?(nearest|closest)\s+(.+?)\s+(?:to|from|of|near)\s+(.+)$/i;
const NEAREST_ALT_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(.+?)\s+(?:nearest|closest)\s+(?:to|from|of)\s+(.+)$/i;
const SHOW_PATTERN = /^(?:show|map|display|afficher|montrer)\s+(.+)$/i;

export function normalizeAskMapText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function parseRadius(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const key = String(unit || '').toLowerCase();
  if (key === 'km' || key.startsWith('kilomet')) return Math.round(amount * 1000);
  if (key === 'm' || key.startsWith('meter') || key.startsWith('metre')) return Math.round(amount);
  return null;
}

function resolveObjectClass(phrase) {
  const cleaned = String(phrase || '').trim().replace(/^(?:the|les|des)\s+/i, '');
  if (HYDRANT_PHRASE.test(cleaned)) return ASK_MAP_OBJECT_CLASS.HYDRANT;
  return null;
}

function resolveLocationKind(phrase) {
  const cleaned = String(phrase || '').trim();
  if (!cleaned) return null;
  if (HERE_PHRASE.test(cleaned)) return 'HERE';
  return 'NAMED';
}

function confirmationTitle(objectClass, radiusMeters) {
  if (objectClass === ASK_MAP_OBJECT_CLASS.HYDRANT) {
    return `SHOW HYDRANTS WITHIN ${radiusMeters} M`;
  }
  return `SHOW ${String(objectClass || 'OBJECT').toUpperCase()} WITHIN ${radiusMeters} M`;
}

function nearestConfirmationTitle(objectClass) {
  if (objectClass === ASK_MAP_OBJECT_CLASS.HYDRANT) return 'SHOW NEAREST HYDRANT';
  return `SHOW NEAREST ${String(objectClass || 'OBJECT').toUpperCase()}`;
}

function closed(code, message, extra = {}) {
  return Object.freeze({
    supported: false,
    looksLikeAskMap: extra.looksLikeAskMap !== false,
    code,
    message,
    operation: extra.operation || null,
    objectClass: extra.objectClass || null,
    radiusMeters: extra.radiusMeters ?? null,
    locationKind: extra.locationKind || null,
    locationText: extra.locationText || null,
    diagnostics: Object.freeze([...(extra.diagnostics || [])]),
    confirmationTitle: extra.confirmationTitle || null,
    source: extra.source || null
  });
}

export function looksLikeAskMap(text) {
  const normalized = normalizeAskMapText(text);
  if (!normalized || !SHOW_VERB.test(normalized)) return false;
  if (/\b(?:within|inside|dans un rayon|à moins de)\b/i.test(normalized)) return true;
  if (/\b(?:nearest|closest)\b/i.test(normalized)) return true;
  if (/\bnear\b/i.test(normalized)) return true;
  const show = normalized.match(SHOW_PATTERN);
  if (!show) return false;
  return Boolean(resolveObjectClass(show[1]));
}

export function parseAskMapIntent(text) {
  const raw = String(text || '').trim();
  const normalized = normalizeAskMapText(raw);
  if (!normalized) {
    return closed('EMPTY_INPUT', 'Ask MAP requires an operator command.', { looksLikeAskMap: false });
  }

  const nearestMatch = normalized.match(NEAREST_PATTERN);
  const nearestAlt = !nearestMatch ? normalized.match(NEAREST_ALT_PATTERN) : null;
  if (nearestMatch || nearestAlt) {
    const objectClass = resolveObjectClass(nearestMatch ? nearestMatch[2] : nearestAlt[1]);
    const locationKind = resolveLocationKind(nearestMatch ? nearestMatch[3] : nearestAlt[2]);
    const locationText = nearestMatch ? nearestMatch[3] : nearestAlt[2];
    if (!objectClass) {
      return closed(
        'UNSUPPORTED_DATASET',
        'This ASK MAP wave only addresses Ville de Montréal hydrants. Unknown dataset remains fail-closed.',
        { operation: ASK_MAP_OPERATIONS.NEAREST, locationKind, locationText, looksLikeAskMap: true }
      );
    }
    if (locationKind == null) {
      return closed(
        'MISSING_LOCATION',
        'NEAREST requires HERE or another operator-defined location.',
        { operation: ASK_MAP_OPERATIONS.NEAREST, objectClass, looksLikeAskMap: true }
      );
    }
    if (locationKind !== 'HERE') {
      return closed(
        'LOCATION_NOT_HERE',
        'This ASK MAP wave resolves HERE from operator context. Named geocoding is fail-closed.',
        {
          operation: ASK_MAP_OPERATIONS.NEAREST,
          objectClass,
          locationKind,
          locationText,
          looksLikeAskMap: true
        }
      );
    }
    return Object.freeze({
      supported: true,
      looksLikeAskMap: true,
      code: 'ASK_MAP_NEAREST',
      message: nearestConfirmationTitle(objectClass),
      operation: ASK_MAP_OPERATIONS.NEAREST,
      verb: ASK_MAP_OPERATIONS.SHOW,
      objectClass,
      radiusMeters: null,
      locationKind: 'HERE',
      locationText: 'here',
      diagnostics: Object.freeze(['SHOW nearest hydrant is NEAREST']),
      confirmationTitle: nearestConfirmationTitle(objectClass),
      source: HYDRANT_SOURCE
    });
  }

  if (/\bnear\b/i.test(normalized) && !/\bwithin\b/i.test(normalized) && !/\binside\b/i.test(normalized)) {
    return closed(
      'NEAR_REQUIRES_DISTANCE',
      '"Near" requires a distance. Example: Show hydrants within 500 m of here.',
      { looksLikeAskMap: true }
    );
  }

  const diagnostics = [];
  const withinMatch = normalized.match(WITHIN_PATTERN)
    || normalized.match(WITHIN_IN_PATTERN)
    || normalized.match(FR_RADIUS_PATTERN);

  if (withinMatch) {
    const objectClass = resolveObjectClass(withinMatch[1]);
    const radiusMeters = parseRadius(withinMatch[2], withinMatch[3]);
    const locationKind = resolveLocationKind(withinMatch[4]);
    diagnostics.push('promoted SHOW/MAP with radius to WITHIN');
    if (!objectClass) {
      return closed(
        'UNSUPPORTED_DATASET',
        'This ASK MAP wave only addresses Ville de Montréal hydrants. Unknown dataset remains fail-closed.',
        { operation: ASK_MAP_OPERATIONS.WITHIN, radiusMeters, locationKind, locationText: withinMatch[4], diagnostics }
      );
    }
    if (radiusMeters == null) {
      return closed(
        'MISSING_RADIUS',
        'WITHIN requires a finite distance in metres or kilometres.',
        { operation: ASK_MAP_OPERATIONS.WITHIN, objectClass, locationKind, diagnostics }
      );
    }
    if (locationKind == null) {
      return closed(
        'MISSING_LOCATION',
        'WITHIN requires HERE or another operator-defined location.',
        { operation: ASK_MAP_OPERATIONS.WITHIN, objectClass, radiusMeters, diagnostics }
      );
    }
    if (locationKind !== 'HERE') {
      return closed(
        'LOCATION_NOT_HERE',
        'This ASK MAP wave resolves HERE from operator context. Named geocoding is fail-closed.',
        {
          operation: ASK_MAP_OPERATIONS.WITHIN,
          objectClass,
          radiusMeters,
          locationKind,
          locationText: withinMatch[4],
          diagnostics
        }
      );
    }
    return Object.freeze({
      supported: true,
      looksLikeAskMap: true,
      code: 'ASK_MAP_WITHIN',
      message: confirmationTitle(objectClass, radiusMeters),
      operation: ASK_MAP_OPERATIONS.WITHIN,
      verb: ASK_MAP_OPERATIONS.SHOW,
      objectClass,
      radiusMeters,
      locationKind: 'HERE',
      locationText: 'here',
      diagnostics: Object.freeze(diagnostics),
      confirmationTitle: confirmationTitle(objectClass, radiusMeters),
      source: HYDRANT_SOURCE
    });
  }

  const showMatch = normalized.match(SHOW_PATTERN);
  if (showMatch && resolveObjectClass(showMatch[1])) {
    return closed(
      'SHOW_REQUIRES_WITHIN',
      'SHOW with no radius is not WITHIN. Specify a distance, for example: Show hydrants within 500 m of here.',
      {
        looksLikeAskMap: true,
        operation: ASK_MAP_OPERATIONS.SHOW,
        objectClass: ASK_MAP_OBJECT_CLASS.HYDRANT
      }
    );
  }

  return closed(
    'UNSUPPORTED_OPERATION',
    'Unsupported deterministic MAP operation. Example: Show hydrants within 500 m of here.',
    { looksLikeAskMap: looksLikeAskMap(normalized) }
  );
}

export function assertAskMapExecutable(intent) {
  if (
    !intent?.supported
    || (intent.operation !== ASK_MAP_OPERATIONS.WITHIN && intent.operation !== ASK_MAP_OPERATIONS.NEAREST)
  ) {
    failClosed(intent?.code || 'UNSUPPORTED_OPERATION', intent?.message || 'ASK MAP intent is not executable.');
  }
  if (intent.objectClass !== ASK_MAP_OBJECT_CLASS.HYDRANT) {
    failClosed('UNSUPPORTED_DATASET', 'This ASK MAP wave only addresses Ville de Montréal hydrants.');
  }
  if (intent.operation === ASK_MAP_OPERATIONS.WITHIN) {
    if (!Number.isFinite(Number(intent.radiusMeters)) || Number(intent.radiusMeters) <= 0) {
      failClosed('MISSING_RADIUS', 'WITHIN requires a finite distance.');
    }
  }
  if (intent.locationKind !== 'HERE') {
    failClosed('MISSING_LOCATION', 'ASK MAP requires HERE from operator-defined context.');
  }
  return intent;
}
