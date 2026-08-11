/**
 * PLACE_POI_SEARCH V1 — bounded natural-language intent parser.
 */

export const POI_LOCATION_ALIASES = Object.freeze({
  'old montréal': 'Old Montréal, Montréal, QC',
  'old montreal': 'Old Montréal, Montréal, QC',
  'vieux-montréal': 'Old Montréal, Montréal, QC',
  'vieux-montreal': 'Old Montréal, Montréal, QC'
});

export const DEFAULT_NEAR_RADIUS_METERS = 1500;
export const DEFAULT_NEAREST_SEARCH_RADIUS_METERS = 5000;

const POI_VERB = /^(?:map|show|find|display)\b/i;

const COUNT_WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
});

function parseCountToken(token = '') {
  const trimmed = String(token).trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return COUNT_WORDS[trimmed] ?? null;
}

/**
 * @param {string} placeText
 */
export function resolvePoiSpec(placeText = '') {
  const text = String(placeText).trim();
  const lower = text.toLowerCase();

  if (/\bstarbucks\b/i.test(lower)) {
    return { kind: 'brand', label: 'Starbucks', namePattern: 'Starbucks', category: 'coffee_shop' };
  }
  if (/\b(coffee shops?|cafés?|cafes?)\b/i.test(lower)) {
    return { kind: 'category', label: 'Coffee shops', amenity: 'cafe', category: 'cafe' };
  }
  if (/\bpharmacies?\b/i.test(lower)) {
    return { kind: 'category', label: 'Pharmacies', amenity: 'pharmacy', category: 'pharmacy' };
  }
  if (/\brestaurants?\b/i.test(lower)) {
    return { kind: 'category', label: 'Restaurants', amenity: 'restaurant', category: 'restaurant' };
  }
  if (/\bgas stations?\b/i.test(lower)) {
    return { kind: 'category', label: 'Gas stations', amenity: 'fuel', category: 'fuel' };
  }

  const cleaned = text.replace(/^(?:the|all)\s+/i, '').trim();
  return { kind: 'brand', label: cleaned, namePattern: cleaned, category: 'place' };
}

function parseDistanceMeters(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const u = String(unit || 'm').toLowerCase();
  if (u.startsWith('k')) return Math.round(amount * 1000);
  return Math.round(amount);
}

/**
 * @param {string} prompt
 */
export function parsePlacePoiIntent(prompt = '') {
  const raw = String(prompt).trim().replace(/[.?!]+$/g, '').trim();
  if (!raw || !POI_VERB.test(raw)) return null;

  let limit = null;
  let mode = 'NEAR';
  let radiusMeters = DEFAULT_NEAR_RADIUS_METERS;
  let placeText = null;
  let locationText = null;
  let usesHere = false;

  const nearestWithin = raw.match(
    /^(?:map|show|find|display)\s+(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:nearest|closest)\s+(.+?)\s+(?:to|near)\s+(.+)$/i
  );
  if (nearestWithin) {
    limit = parseCountToken(nearestWithin[1]);
    placeText = nearestWithin[2].trim();
    locationText = nearestWithin[3].trim();
    mode = 'NEAREST';
    radiusMeters = DEFAULT_NEAREST_SEARCH_RADIUS_METERS;
  }

  const withinDistance = raw.match(
    /^(?:map|show|find|display)\s+(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*(km|m|meters|metres)\s+(?:of|from)\s+(.+)$/i
  );
  if (!placeText && withinDistance) {
    placeText = withinDistance[1].trim();
    radiusMeters = parseDistanceMeters(withinDistance[2], withinDistance[3]) || DEFAULT_NEAR_RADIUS_METERS;
    locationText = withinDistance[4].trim();
    mode = 'WITHIN';
  }

  const nearPattern = raw.match(
    /^(?:map|show|find|display)\s+(?:the\s+)?(?:(\d+)\s+(?:nearest|closest)\s+)?(.+?)\s+(?:near|around|to)\s+(.+)$/i
  );
  if (!placeText && nearPattern) {
    if (nearPattern[1]) {
      limit = Number(nearPattern[1]);
      mode = 'NEAREST';
      radiusMeters = DEFAULT_NEAREST_SEARCH_RADIUS_METERS;
    }
    placeText = nearPattern[2].trim();
    locationText = nearPattern[3].trim();
  }

  if (!placeText || !locationText) return null;

  if (/^here$/i.test(locationText) || /^this location$/i.test(locationText)) {
    usesHere = true;
  } else {
    const alias = POI_LOCATION_ALIASES[locationText.toLowerCase()];
    if (alias) locationText = alias;
  }

  const poi = resolvePoiSpec(placeText);
  const layerTitle = mode === 'NEAREST' && limit
    ? `${limit} nearest ${poi.label} near ${locationText}`
    : `${poi.label} near ${locationText}`;

  return {
    sourceText: raw,
    poi,
    placeText,
    locationText,
    usesHere,
    mode,
    limit,
    radiusMeters,
    layerTitle
  };
}

export function isPlacePoiV1Enabled() {
  const flag = process.env.IQAI_PLACE_POI_V1_ENABLED;
  if (flag == null || flag === '') return true;
  return /^true$/i.test(flag);
}
