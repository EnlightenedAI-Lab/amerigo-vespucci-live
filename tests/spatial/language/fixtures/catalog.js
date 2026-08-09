/** Fixture WebMap layer catalog — no live ArcGIS required. */
export const FIXTURE_CATALOG = {
  webmapTitle: 'Montreal 1',
  layers: [
    { catalogId: 'cameras-layer', layerId: 'cameras-layer', title: 'Cameras', type: 'feature', geometryType: 'point', queryable: true, visible: false, parentGroup: 'Public Safety' },
    { catalogId: 'ems-layer', layerId: 'ems-layer', title: 'EMS', type: 'feature', geometryType: 'point', queryable: true, visible: false, parentGroup: null },
    { catalogId: 'roads-layer', layerId: 'roads-layer', title: 'Roads', type: 'feature', geometryType: 'polyline', queryable: false, visible: true, parentGroup: null },
    { catalogId: 'traffic-layer', layerId: 'traffic-layer', title: 'Traffic', type: 'feature', geometryType: 'point', queryable: true, visible: true, parentGroup: null },
    { catalogId: 'addresses-layer', layerId: 'addresses-layer', title: 'Addresses', type: 'feature', geometryType: 'point', queryable: true, visible: false, parentGroup: null },
    { catalogId: 'imagery-layer', layerId: 'imagery-layer', title: 'Imagery', type: 'imagery', geometryType: null, queryable: false, visible: true, parentGroup: null },
    { catalogId: 'wms-layer', layerId: 'wms-layer', title: 'WMS Overlay', type: 'wms', geometryType: null, queryable: false, visible: false, parentGroup: 'Basemap' },
    { catalogId: 'group-public', layerId: 'group-public', title: 'Public Safety', type: 'group', geometryType: null, queryable: false, visible: true, parentGroup: null }
  ]
};

export const FIXTURE_LOCATIONS = [
  '997 de la Commune',
  '6939 Décarie Boulevard',
  '1000 Rue de la Gauchetière',
  '1 Place Ville Marie'
];

export const FIXTURE_LAYER_TITLES = ['Cameras', 'EMS', 'Traffic', 'Roads', 'Addresses'];
