/**
 * Modest aliases for Montreal 1 WebMap layer title resolution.
 * Actual layer title from LayerCatalog is primary authority.
 */

export const WEBMAP_LAYER_ALIAS_GROUPS = [
  { keys: ['fire', 'fire station', 'fire stations', 'pompier', 'pompiers', 'caserne', 'casernes'], titles: ['fire stations', 'fire station', 'fire'] },
  { keys: ['police', 'police station', 'police stations', 'spvm', 'poste de police'], titles: ['police stations', 'police station', 'police'] },
  { keys: ['school', 'schools', 'ecole', 'ecoles', 'écoles'], titles: ['schools', 'school', 'greater montreal schools'] },
  { keys: ['hospital', 'hospitals', 'hopital', 'hopitaux', 'hôpitaux'], titles: ['hospitals', 'hospital'] },
  { keys: ['transit', 'metro', 'subway', 'stm', 'bus', 'arret', 'arrets', 'arrêt', 'arrêts'], titles: ['transit', 'stm', 'metro', 'bus', 'stm arrets sig', 'stm arrets'] },
  { keys: ['school', 'schools', 'ecole', 'ecoles', 'écoles', 'etablissement scolaire'], titles: ['montreal poi'] },
  { keys: ['amenity', 'amenities'], titles: ['amenities', 'amenity', 'osm'] },
  { keys: ['camera', 'cameras', 'cams', 'caméra', 'caméras'], titles: ['cameras', 'camera'] },
  { keys: ['ems', 'ambulance', 'emergency medical', 'urgences', 'urgence'], titles: ['ems'] },
  { keys: ['road', 'roads', 'streets', 'rue', 'routes', 'route'], titles: ['roads', 'road'] },
  { keys: ['traffic'], titles: ['traffic'] }
];

/**
 * @param {string} title
 */
export function normalizeLayerKey(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @param {string} phrase
 */
export function normalizeLayerPhrase(phrase) {
  return normalizeLayerKey(phrase);
}

/**
 * Build searchable alias tokens for a catalog entry title.
 * @param {string} title
 */
export function aliasTokensForTitle(title) {
  const normalizedTitle = normalizeLayerKey(title);
  const tokens = new Set();
  if (normalizedTitle) tokens.add(normalizedTitle);

  for (const group of WEBMAP_LAYER_ALIAS_GROUPS) {
    const titleMatch = group.titles.some((t) => normalizedTitle === normalizeLayerKey(t)
      || normalizedTitle.includes(normalizeLayerKey(t)));
    if (titleMatch) {
      for (const key of group.keys) tokens.add(normalizeLayerKey(key));
    }
  }

  return tokens;
}
