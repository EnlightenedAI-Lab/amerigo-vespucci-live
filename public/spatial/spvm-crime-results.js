/**
 * SPVM crime records table model for ResultsTable.
 */

import { SPVM_LAYER_ID } from './spvm-recent-crime-config.js';
import { englishLabelForCategory, shiftUiLabelForValue } from './spvm-crime-taxonomy.js';

const SPVM_COLUMNS = [
  { id: 'date', label: 'Date', defaultVisible: true },
  { id: 'shift', label: 'Shift', defaultVisible: true },
  { id: 'category', label: 'Category', defaultVisible: true },
  { id: 'pdq', label: 'PDQ', defaultVisible: true },
  { id: 'source', label: 'Source', defaultVisible: true },
  { id: 'recordId', label: 'Record id', defaultVisible: false },
  { id: 'latitude', label: 'Latitude', defaultVisible: false },
  { id: 'longitude', label: 'Longitude', defaultVisible: false }
];

/**
 * @param {Array<{ attributes?: object, geometry?: object }>} graphics
 */
export function buildSpvmCrimeTableModel(graphics) {
  if (!graphics?.length) {
    return {
      mode: 'spvm_crime',
      layerId: SPVM_LAYER_ID,
      rows: [],
      columns: SPVM_COLUMNS,
      totalCount: 0,
      prompt: '',
      matchedAddress: null
    };
  }

  const rows = graphics.map((graphic) => {
    const attrs = graphic.attributes || {};
    const recordId = String(attrs.id || attrs.OBJECTID || graphic.id || '');
    const geometry = graphic.geometry;
    let latitude = attrs.latitude;
    let longitude = attrs.longitude;
    if (geometry?.type === 'point') {
      latitude = geometry.y ?? latitude;
      longitude = geometry.x ?? longitude;
    }

    return {
      rowId: `spvm::${recordId}`,
      layerId: SPVM_LAYER_ID,
      mapObjectId: recordId,
      recordId,
      values: {
        date: attrs.date || '—',
        shift: shiftUiLabelForValue(attrs.shift) || attrs.shiftLabel || '—',
        category: englishLabelForCategory(attrs.category),
        pdq: attrs.pdq || '—',
        source: attrs.sourceName || 'Service de police de la Ville de Montréal',
        recordId,
        latitude: latitude != null ? String(latitude) : '—',
        longitude: longitude != null ? String(longitude) : '—'
      },
      _attrs: attrs
    };
  });

  rows.sort((a, b) => String(b.values.date).localeCompare(String(a.values.date)));

  return {
    mode: 'spvm_crime',
    layerId: SPVM_LAYER_ID,
    rows,
    columns: SPVM_COLUMNS,
    totalCount: rows.length,
    prompt: '',
    matchedAddress: null
  };
}

/**
 * @param {object} model
 * @param {object} attributes
 */
export function findSpvmRowForAttributes(model, attributes) {
  if (!model?.rows?.length || !attributes) return null;
  const recordId = String(
    attributes.id
    || attributes.OBJECTID
    || attributes.objectId
    || ''
  );
  if (!recordId) return null;
  return model.rows.find((row) =>
    String(row.recordId) === recordId
    || String(row.mapObjectId) === recordId
  ) || null;
}
