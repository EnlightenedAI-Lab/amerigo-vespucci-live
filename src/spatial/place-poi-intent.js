/**
 * Dynamic place search — bounded natural-language intent parser.
 */

export const POI_LOCATION_ALIASES = Object.freeze({
  'old montréal': 'Old Montréal, Montréal, QC',
  'old montreal': 'Old Montréal, Montréal, QC',
  'vieux-montréal': 'Old Montréal, Montréal, QC',
  'vieux-montreal': 'Old Montréal, Montréal, QC',
  'montreal airport': 'Montréal–Trudeau International Airport, Montréal, QC',
  'montréal airport': 'Montréal–Trudeau International Airport, Montréal, QC',
  'yul': 'Montréal–Trudeau International Airport, Montréal, QC',
  'trudeau airport': 'Montréal–Trudeau International Airport, Montréal, QC',
  'bell centre': 'Bell Centre, Montréal, QC',
  'bell center': 'Bell Centre, Montréal, QC',
  'centre bell': 'Bell Centre, Montréal, QC',
  'place ville marie': 'Place Ville Marie, Montréal, QC',
  'mcgill university': 'McGill University, Montréal, QC',
  'mcgill': 'McGill University, Montréal, QC'
});

export const DEFAULT_NEAR_RADIUS_METERS = 1500;
export const DEFAULT_NEAREST_SEARCH_RADIUS_METERS = 5000;
export const DYNAMIC_PLACE_ROUTE = 'DYNAMIC_PLACE_SEARCH';

const AUTHORITATIVE_GIS_SUBJECT = /\b(fire stations?|police stations?|hospitals?|schools?|toilets?|bathrooms?|washrooms?|restrooms?|public toilets?|\bwc\b|casernes?|pompiers?|postes? de (?:police|quartier)|pdq)\b/i;

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

export function isAuthoritativeGisSubject(text = '') {
  return AUTHORITATIVE_GIS_SUBJECT.test(String(text || ''));
}

/**
 * @param {string} placeText
 */
export function resolvePoiSpec(placeText = '') {
  const text = String(placeText).trim();
  const lower = text.toLowerCase();

  if (/\bstarbucks\b/i.test(lower)) {
    return { kind: 'brand', label: 'Starbucks', namePattern: 'Starbucks', searchText: 'Starbucks', category: 'coffee_shop' };
  }
  if (/\bcostco\b/i.test(lower)) {
    return { kind: 'brand', label: 'Costco', namePattern: 'Costco', searchText: 'Costco', category: 'warehouse_club' };
  }
  if (/\b(coffee shops?|cafés?|cafes?)\b/i.test(lower)) {
    return { kind: 'category', label: 'Coffee shops', amenity: 'cafe', searchText: 'coffee shop', category: 'cafe' };
  }
  if (/\bpharmacies?\b/i.test(lower)) {
    return { kind: 'category', label: 'Pharmacies', amenity: 'pharmacy', searchText: 'pharmacy', category: 'pharmacy' };
  }
  if (/\brestaurants?\b/i.test(lower)) {
    return { kind: 'category', label: 'Restaurants', amenity: 'restaurant', searchText: 'restaurant', category: 'restaurant' };
  }
  if (/\bgas stations?\b/i.test(lower)) {
    return { kind: 'category', label: 'Gas stations', amenity: 'fuel', searchText: 'gas station', category: 'fuel' };
  }
  if (/\bhotels?\b/i.test(lower)) {
    return { kind: 'category', label: 'Hotels', amenity: 'hotel', searchText: 'hotel', category: 'hotel' };
  }
  if (/\b(grocery stores?|groceries|supermarkets?)\b/i.test(lower)) {
    return { kind: 'category', label: 'Grocery stores', amenity: 'supermarket', searchText: 'grocery', category: 'grocery' };
  }
  if (/\bhardware stores?\b/i.test(lower)) {
    return { kind: 'category', label: 'Hardware stores', searchText: 'hardware store', namePattern: 'hardware', category: 'hardware' };
  }

  const cleaned = text.replace(/^(?:the|all)\s+/i, '').trim();
  return { kind: 'brand', label: cleaned, namePattern: cleaned, searchText: cleaned, category: 'place' };
}

function parseDistanceMeters(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const u = String(unit || 'm').toLowerCase();
  if (u.startsWith('k')) return Math.round(amount * 1000);
  return Math.round(amount);
}

export function formatDynamicPlaceLayerTitle(label, radiusMeters, mode = 'WITHIN') {
  const safeLabel = String(label || 'Places').trim();
  if (mode === 'NEAREST') return `AI MAP · ${safeLabel} · nearest`;
  const meters = Number(radiusMeters);
  if (!Number.isFinite(meters) || meters <= 0) return `AI MAP · ${safeLabel}`;
  if (meters >= 1000 && meters % 1000 === 0) return `AI MAP · ${safeLabel} · ${meters / 1000} km`;
  if (meters >= 1000) return `AI MAP · ${safeLabel} · ${Number((meters / 1000).toFixed(1))} km`;
  return `AI MAP · ${safeLabel} · ${Math.round(meters)} m`;
}

export function normalizePlacePrompt(prompt = '') {
  let result = String(prompt || '').trim().replace(/[.?!]+$/g, '').trim();
  result = result.replace(
    /\b(show|map|display|find|locate)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:from|of|around|near)\s+(.+)$/i,
    (_, verb, dataset, meters, location) => {
      const km = parseFloat(meters) / 1000;
      return `${verb} ${dataset.trim()} within ${km} km of ${location.trim()}`;
    }
  );
  result = result.replace(
    /\bwithin\s+(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+(?:of|from)\s+/gi,
    (_, meters) => `within ${parseFloat(meters) / 1000} km of `
  );
  return result.replace(/\s+/g, ' ').trim();
}

function resolveLocationText(locationText) {
  const trimmed = String(locationText || '').trim();
  const alias = POI_LOCATION_ALIASES[trimmed.toLowerCase()];
  return alias || trimmed;
}

/**
 * @param {string} prompt
 */
export function parsePlacePoiIntent(prompt = '') {
  const raw = normalizePlacePrompt(prompt);
  if (!raw) return null;

  let limit = null;
  let mode = 'NEAR';
  let radiusMeters = DEFAULT_NEAR_RADIUS_METERS;
  let placeText = null;
  let locationText = null;
  let usesHere = false;

  const nearestCounted = raw.match(
    /^(?:(?:map|show|find|display)\s+)?(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:nearest|closest)\s+(.+?)\s+(?:to|near|of)\s+(.+)$/i
  );
  if (nearestCounted) {
    limit = parseCountToken(nearestCounted[1]);
    placeText = nearestCounted[2].trim();
    locationText = nearestCounted[3].trim();
    mode = 'NEAREST';
    radiusMeters = DEFAULT_NEAREST_SEARCH_RADIUS_METERS;
  }

  const nearestBare = raw.match(
    /^(?:(?:map|show|find|display)\s+)?(?:the\s+)?(?:nearest|closest)\s+(.+?)\s+(?:to|near|of)\s+(.+)$/i
  );
  if (!placeText && nearestBare) {
    placeText = nearestBare[1].trim();
    locationText = nearestBare[2].trim();
    mode = 'NEAREST';
    limit = 1;
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
  if (isAuthoritativeGisSubject(placeText) || isAuthoritativeGisSubject(raw)) return null;

  if (/^here$/i.test(locationText) || /^this location$/i.test(locationText)) {
    usesHere = true;
  } else {
    locationText = resolveLocationText(locationText);
  }

  const poi = resolvePoiSpec(placeText);
  const layerTitle = formatDynamicPlaceLayerTitle(poi.label, radiusMeters, mode);

  return {
    sourceText: String(prompt || '').trim(),
    normalizedText: raw,
    route: DYNAMIC_PLACE_ROUTE,
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
