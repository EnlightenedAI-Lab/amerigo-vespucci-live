export const MONTREAL_OPERATIONAL_WEBMAP_ID = '2ec27986ecfb4dd188d058cae620be0d';
export const MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID = MONTREAL_OPERATIONAL_WEBMAP_ID;
export const MONTREAL_OPERATIONAL_WEBMAP_NAME = 'Montreal 1';
export const MONTREAL_OPERATIONAL_DISPLAY_TITLE = 'IQAI Montréal';
export const MONTREAL_OPERATIONAL_CENTER = { longitude: -73.5673, latitude: 45.5017 };
export const MONTREAL_OPERATIONAL_SCALE = 144448;

export function isGreaterMontrealLongitudeLatitude(longitude, latitude) {
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -74.3
    && longitude <= -73.2
    && latitude >= 45.2
    && latitude <= 45.9;
}
