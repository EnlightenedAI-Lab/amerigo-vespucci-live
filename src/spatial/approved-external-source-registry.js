export const TRUST_TIER_TRUSTED_EXTERNAL = 'TRUSTED_EXTERNAL';

export const SOURCE_IDS = {
  OSM_NA_AMENITIES: 'OSM_NA_AMENITIES'
};

/** @type {object[]} */
export const APPROVED_EXTERNAL_SOURCES = [
  {
    id: SOURCE_IDS.OSM_NA_AMENITIES,
    title: 'OpenStreetMap Amenities for North America',
    sourceClass: 'FEATURE_SERVER',
    trustTier: TRUST_TIER_TRUSTED_EXTERNAL,
    provider: 'Esri OSM North America / OpenStreetMap contributors',
    serviceUrl: 'https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services/OSM_NA_Amenities/FeatureServer',
    layerId: 0,
    serviceItemId: 'd3e9c2f8cdcd41f38e64b54c3a9a1c74',
    geometryType: 'esriGeometryPoint',
    spatialReference: 3857,
    queryable: true,
    headless: true,
    semanticField: 'amenity',
    categoryField: 'amenity',
    fields: [
      'OBJECTID',
      'osm_id',
      'amenity',
      'name',
      'name_en',
      'name_fr',
      'addr_housenumber',
      'addr_street',
      'addr_city',
      'addr_postcode',
      'addr_province',
      'addr_state',
      'addr_country',
      'wheelchair',
      'fee',
      'opening_hours',
      'operator',
      'website'
    ],
    jurisdiction: {
      mode: 'SPATIAL_AOI_REQUIRED',
      provinceWideRequiresBoundary: 'QC_BOUNDARY_VERIFIED',
      unreliableAttributeFields: ['addr_province', 'addr_state', 'addr_country']
    },
    attribution: '© OpenStreetMap contributors',
    licence: 'ODbL',
    capabilities: {
      DISTINCT_VALUES: true,
      CATEGORY_FILTER: true,
      WITHIN: true,
      NEAREST: true,
      COUNT: true,
      CATEGORY_COUNTS_WITHIN: true,
      spatialQuery: true,
      countOnly: true,
      pagination: true,
      maxRecordCount: 2000
    },
    maxRecordCount: 2000,
    provenance: {
      catalogueUrl: 'https://www.arcgis.com/home/item.html?id=d3e9c2f8cdcd41f38e64b54c3a9a1c74',
      authorityLabel: 'TRUSTED_EXTERNAL / OSM_NA_Amenities'
    }
  }
];

export function getApprovedExternalSource(id) {
  return APPROVED_EXTERNAL_SOURCES.find((entry) => entry.id === id) || null;
}

export function listApprovedExternalSources() {
  return APPROVED_EXTERNAL_SOURCES.map((entry) => ({
    id: entry.id,
    title: entry.title,
    trustTier: entry.trustTier,
    headless: entry.headless,
    categoryField: entry.categoryField
  }));
}
