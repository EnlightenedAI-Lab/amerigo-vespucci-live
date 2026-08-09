/**
 * Shared broad OSM amenity discovery intent — routes to CATEGORY_COUNTS_WITHIN.
 */

import { SOURCE_IDS } from './approved-external-source-registry.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toRadiusMeters(kmText) {
  const km = parseFloat(kmText);
  if (!Number.isFinite(km) || km <= 0) return null;
  return Math.round(km * 1000);
}

/**
 * @param {string} normalized
 */
export function matchAmenitiesXrayIntent(normalized) {
  const text = String(normalized || '').trim();
  if (!text) return null;

  const directPatterns = [
    /^what amenities (?:exist|are) within (\d+(?:\.\d+)?)\s*km (?:of|from) (.+)$/i,
    /^what is in the amenities layer within (\d+(?:\.\d+)?)\s*km (?:of|from) (.+)$/i,
    /^what kinds? of amenities(?: are)? within (\d+(?:\.\d+)?)\s*km (?:of|from) (.+)$/i
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        radiusKm: parseFloat(match[1]),
        radiusMeters: toRadiusMeters(match[1]),
        locationText: cleanText(match[2])
      };
    }
  }

  const nearWithin = text.match(
    /^what(?: kinds? of)? amenities (?:are )?(?:near|around) (.+?) within (\d+(?:\.\d+)?)\s*km$/i
  );
  if (nearWithin) {
    return {
      radiusKm: parseFloat(nearWithin[2]),
      radiusMeters: toRadiusMeters(nearWithin[2]),
      locationText: cleanText(nearWithin[1])
    };
  }

  return null;
}

/**
 * @param {{ radiusKm: number, radiusMeters: number, locationText: string }} match
 */
export function buildAmenitiesXrayPlan(match) {
  if (!match?.radiusMeters || !match.locationText) return null;
  return {
    supported: true,
    commands: [{
      action: 'CATEGORY_COUNTS_WITHIN',
      layerSource: 'TRUSTED_EXTERNAL',
      sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
      semanticField: 'amenity',
      radiusMeters: match.radiusMeters,
      distanceKm: match.radiusKm,
      location: match.locationText,
      displayMode: 'category_counts'
    }],
    sharedLocation: match.locationText
  };
}

/**
 * @param {{ radiusKm: number, radiusMeters: number, locationText: string }} match
 */
export function buildAmenitiesXrayRequest(match) {
  if (!match?.radiusMeters || !match.locationText) return null;
  return {
    supported: true,
    request: {
      action: 'CATEGORY_COUNTS_WITHIN',
      layerSource: 'TRUSTED_EXTERNAL',
      sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
      semanticField: 'amenity',
      locationText: match.locationText,
      radiusMeters: match.radiusMeters,
      displayMode: 'category_counts'
    }
  };
}
