export const SPVM_LAYER_ID = 'spvm-recent-crime';
export const SPVM_LAYER_TITLE = 'SPVM — Recent Crime';
export const PUBLIC_SAFETY_GROUP_TITLE = 'Public Safety';

export const SPVM_LOCAL_GEOJSON_URL = '/api/spatial/spvm/crime-90d';
export const SPVM_LOCAL_STATUS_URL = '/api/spatial/spvm/status';

/** Explicit field schema — keep `date` as string so ISO YMD SQL matches JS filters. */
export const SPVM_LAYER_FIELDS = Object.freeze([
  { name: 'category', type: 'string', alias: 'Category' },
  { name: 'date', type: 'string', alias: 'Date' },
  { name: 'shift', type: 'string', alias: 'Shift' },
  { name: 'shiftLabel', type: 'string', alias: 'Shift label' },
  { name: 'pdq', type: 'string', alias: 'PDQ' },
  { name: 'sourceName', type: 'string', alias: 'Source' },
  { name: 'dataset', type: 'string', alias: 'Dataset' },
  { name: 'spatialPrecision', type: 'string', alias: 'Spatial precision' },
  { name: 'temporalPrecision', type: 'string', alias: 'Temporal precision' }
]);
