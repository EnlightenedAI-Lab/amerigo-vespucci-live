/**
 * Provenance metadata for user-added ArcGIS layers.
 */
export const USER_ADDED_CLASSIFICATION = 'USER_ADDED_ARCGIS';
export const USER_ADDED_LAYER_PREFIX = 'iqai-added-';
export const USER_ADDED_GROUP_TITLE = 'Added ArcGIS data';

/**
 * @param {object} input
 * @returns {object}
 */
export function buildUserAddedProvenance(input = {}) {
  return {
    classification: USER_ADDED_CLASSIFICATION,
    portalItemId: input.portalItemId || null,
    serviceUrl: input.serviceUrl || null,
    portalUrl: input.portalUrl || null,
    owner: input.owner || null,
    itemTitle: input.itemTitle || input.title || null,
    itemType: input.itemType || null,
    itemTypeKeywords: Array.isArray(input.itemTypeKeywords) ? input.itemTypeKeywords : [],
    description: input.description || input.snippet || null,
    modified: input.modified || null,
    access: input.access || null,
    attribution: input.attribution || input.copyrightText || null,
    addedAt: input.addedAt || new Date().toISOString(),
    sourceLabel: input.sourceLabel || 'ArcGIS Online / Portal',
    contentSource: input.contentSource || null
  };
}

/**
 * @param {object} provenance
 * @returns {string}
 */
export function formatUserAddedSourceSummary(provenance) {
  if (!provenance) return 'External ArcGIS layer';
  const parts = [];
  if (provenance.itemTitle) parts.push(provenance.itemTitle);
  if (provenance.owner) parts.push(`owner: ${provenance.owner}`);
  if (provenance.itemType) parts.push(provenance.itemType);
  if (provenance.access) parts.push(provenance.access);
  return parts.join(' · ') || provenance.sourceLabel || 'External ArcGIS layer';
}
