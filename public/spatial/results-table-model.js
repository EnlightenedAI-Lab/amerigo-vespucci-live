/**
 * Generic results-table data model from scoped IQAI map results.
 * Designed for future CSV export without rewriting row/column structure.
 */

export const RESULTS_TABLE_PAGE_SIZE = 50;

import { SCHEMA_NOISE_FIELDS } from './iqai-osm-presentation.js';
import { getCategorySymbol } from './source-presentation.js';
import {
  deriveResultCategoryCounts,
  buildResultScopedLegend,
  buildResultScopedLegendAsync,
  legendSymbolUrlFromSource,
  publishResultLegendDiagnostics
} from './result-legend-model.js';

export {
  deriveResultCategoryCounts,
  buildResultScopedLegend,
  buildResultScopedLegendAsync,
  legendSymbolUrlFromSource,
  publishResultLegendDiagnostics
};

const INTERNAL_PREFIX = '_';

const COLUMN_ALIASES = {
  name: ['name', 'name_en', 'name_fr', 'NAME', 'Name'],
  distance: ['distanceLabel', 'distance', 'distanceMeters', 'Distance'],
  address: ['address', 'addr_street', 'addr_full', 'street', 'addr_housenumber'],
  city: ['city', 'addr_city', 'addr_place'],
  category: ['amenity', 'category', 'type', 'facilityType', 'schoolType', 'iqaiType', 'conceptId'],
  phone: ['phone', 'contact:phone', 'tel'],
  operator: ['operator', 'brand'],
  opening_hours: ['opening_hours', 'opening_hours_en', 'opening_hours_fr'],
  source: ['sourceName', 'source', 'authority', 'sourceId']
};

const DEFAULT_VISIBLE_COLUMNS = new Set(['name', 'distance', 'address', 'category']);

const DEFAULT_COLUMN_ORDER = [
  'name',
  'distance',
  'address',
  'category',
  'phone'
];

export const DETERMINISTIC_RESULTS_LAYER_ID = 'iqai-deterministic-results';

function isScopedGraphicsResult(result) {
  return result?.sourceType === 'CURRENT_WEBMAP'
    || result?.renderMeta?.sourceType === 'WEBMAP_LAYER'
    || result?.sourceType === 'TRUSTED_EXTERNAL'
    || result?.renderMeta?.sourceType === 'TRUSTED_EXTERNAL';
}

function resolveResultLayerId() {
  return DETERMINISTIC_RESULTS_LAYER_ID;
}

function phoneColumnUseful(rows) {
  if (!rows.length) return false;
  let withPhone = 0;
  for (const row of rows) {
    const phone = row.values?.phone ?? row.values?.['contact:phone'];
    if (phone != null && String(phone).trim() !== '') withPhone += 1;
  }
  return withPhone / rows.length >= 0.08;
}

function pickFirst(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return value;
  }
  return null;
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isInternalKey(key) {
  return String(key).startsWith(INTERNAL_PREFIX);
}

function displayValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * @param {object} result
 * @param {object} feature
 * @param {number} curatedIndex 0-based index among rendered curated features
 * @param {{ scopedFallback: number }} counters
 */
export function computeMapFeatureIdentity(result, feature, curatedIndex, counters) {
  if (isScopedGraphicsResult(result)) {
    const raw = feature.rawAttributes || {};
    const mapObjectId = feature.objectId ?? raw.OBJECTID ?? raw.ObjectID ?? raw.FID ?? counters.scopedFallback;
    if (!feature.objectId && !raw.OBJECTID && !raw.ObjectID && !raw.FID) {
      counters.scopedFallback += 1;
    }
    return {
      layerId: resolveResultLayerId(),
      datasetId: result.datasetId,
      mapObjectId
    };
  }
  return {
    layerId: resolveResultLayerId(),
    datasetId: result.datasetId,
    mapObjectId: curatedIndex + 1
  };
}

function buildRowValues(feature, datasetResult) {
  const raw = feature.rawAttributes || {};
  const semanticField = datasetResult.renderMeta?.semanticField
    || datasetResult.provenance?.semanticField
    || null;
  const semanticValue = datasetResult.renderMeta?.semanticValue
    || feature.conceptId
    || (semanticField ? raw[semanticField] : null)
    || null;

  const values = {
    name: feature.name ?? raw.name ?? raw.name_en ?? raw.name_fr ?? null,
    address: feature.address ?? raw.addr_street ?? raw.address ?? null,
    city: raw.addr_city ?? raw.city ?? null,
    distance: feature.distanceLabel ?? null,
    distanceMeters: feature.distanceMeters ?? null,
    source: feature.sourceName ?? feature.authority ?? datasetResult.displayName ?? null,
    sourceId: datasetResult.conceptId ?? datasetResult.datasetId ?? null,
    semanticField,
    semanticValue,
    operator: raw.operator ?? null,
    opening_hours: raw.opening_hours ?? raw.opening_hours_en ?? raw.opening_hours_fr ?? null,
    category: semanticValue ?? raw.amenity ?? raw.category ?? raw.type
      ?? feature.facilityType ?? feature.schoolType ?? feature.iqaiType ?? null,
    objectId: feature.objectId ?? raw.OBJECTID ?? raw.ObjectID ?? null
  };

  for (const [key, value] of Object.entries(raw)) {
    if (values[key] == null && value != null && !isInternalKey(key)) {
      values[key] = value;
    }
  }

  for (const [key, value] of Object.entries(feature)) {
    if (isInternalKey(key)) continue;
    if (['rawAttributes', 'latitude', 'longitude'].includes(key)) continue;
    if (values[key] == null && value != null) values[key] = value;
  }

  return values;
}

function discoverColumns(rows, multiDataset) {
  const keySet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row.values)) {
      if (!isInternalKey(key)) keySet.add(key);
    }
  }

  const canonicalToActual = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (keySet.has(alias)) {
        canonicalToActual[canonical] = alias;
        keySet.delete(alias);
        break;
      }
    }
  }

  const columns = [];
  const advancedColumns = [];
  if (multiDataset) {
    columns.push({
      id: '_datasetLabel',
      label: 'Dataset',
      canonical: 'dataset',
      defaultVisible: true
    });
  }

  for (const canonical of DEFAULT_COLUMN_ORDER) {
    const actual = canonicalToActual[canonical];
    if (!actual) continue;
    let defaultVisible = DEFAULT_VISIBLE_COLUMNS.has(canonical);
    if (canonical === 'phone' && !phoneColumnUseful(rows)) {
      defaultVisible = false;
    }
    columns.push({
      id: actual,
      label: humanizeKey(canonical === 'category' ? 'Category' : canonical),
      canonical,
      defaultVisible
    });
  }

  for (const [canonical, actual] of Object.entries(canonicalToActual)) {
    if (DEFAULT_COLUMN_ORDER.includes(canonical)) continue;
    advancedColumns.push({
      id: actual,
      label: humanizeKey(canonical),
      canonical,
      defaultVisible: false
    });
    keySet.delete(actual);
  }

  for (const key of [...keySet].sort((a, b) => a.localeCompare(b))) {
    if (DEFAULT_COLUMN_ORDER.some((canonical) => COLUMN_ALIASES[canonical]?.includes(key))) continue;
    if (SCHEMA_NOISE_FIELDS.has(key)) continue;
    advancedColumns.push({
      id: key,
      label: humanizeKey(key),
      canonical: null,
      defaultVisible: false
    });
  }

  return { columns, advancedColumns };
}

export function hasFeatureResults(mapResult) {
  if (!mapResult?.supported) return false;
  if (mapResult.action === 'CATEGORY_COUNTS_WITHIN') return false;
  if (mapResult.summary?.displayMode === 'category_counts') return false;
  if (mapResult.action === 'LIST_LAYERS' || mapResult.action === 'LAYER_CONTROL') return false;
  const count = (mapResult.datasetResults || []).reduce((sum, dr) => sum + (dr.features?.length || 0), 0);
  if (count > 0) return true;
  return (mapResult.features?.length || 0) > 0;
}

/**
 * @param {object} mapResult
 * @returns {object | null}
 */
export function buildResultsTableModel(mapResult, options = {}) {
  if (!hasFeatureResults(mapResult)) return null;

  const datasetResults = mapResult.datasetResults || [];
  const multiDataset = datasetResults.filter((dr) => (dr.features?.length || 0) > 0).length > 1;
  const rows = [];
  const counters = { scopedFallback: 1 };

  if (datasetResults.length) {
    for (const datasetResult of datasetResults) {
      let curatedIndex = 0;
      for (const feature of datasetResult.features || []) {
        const identity = computeMapFeatureIdentity(datasetResult, feature, curatedIndex, counters);
        if (!isScopedGraphicsResult(datasetResult)) curatedIndex += 1;
        rows.push({
          rowId: `${identity.datasetId}::${identity.mapObjectId}`,
          layerId: identity.layerId,
          datasetId: identity.datasetId,
          mapObjectId: identity.mapObjectId,
          datasetLabel: datasetResult.displayName || datasetResult.authority || datasetResult.datasetId,
          values: buildRowValues(feature, datasetResult),
          _datasetLabel: datasetResult.displayName || datasetResult.authority || datasetResult.datasetId
        });
      }
    }
  } else {
    for (let index = 0; index < (mapResult.features || []).length; index += 1) {
      const feature = mapResult.features[index];
      const datasetResult = { datasetId: feature.datasetId, displayName: mapResult.summary?.dataset };
      rows.push({
        rowId: `${feature.datasetId || 'feature'}::${index + 1}`,
        layerId: `iqai-${String(feature.datasetId || 'result').toLowerCase()}`,
        datasetId: feature.datasetId,
        mapObjectId: index + 1,
        datasetLabel: mapResult.summary?.dataset || 'Results',
        values: buildRowValues(feature, datasetResult),
        _datasetLabel: mapResult.summary?.dataset || 'Results'
      });
    }
  }

  const { columns, advancedColumns } = discoverColumns(rows, multiDataset);
  const categorySummary = buildResultScopedLegend(mapResult, options.presentation || null)
    || deriveResultCategoryCounts(mapResult);
  return {
    rows,
    columns,
    advancedColumns,
    categorySummary,
    totalCount: rows.length,
    multiDataset,
    prompt: mapResult.prompt || '',
    matchedAddress: mapResult.origin?.matchedAddress || mapResult.matchedAddress || null
  };
}

export function getRowCellValue(row, columnId) {
  if (columnId === '_datasetLabel') return row._datasetLabel;
  if (columnId === '_select') {
    const checked = row.selected ? 'checked' : '';
    const value = row.categoryValue || row.values?.category || '';
    return `<input type="checkbox" class="results-table-cat-check" data-category="${value}" ${checked} aria-label="Show ${value} on map" />`;
  }
  if (columnId === '_symbol') {
    if (row.symbolUrl) {
      return `<img class="results-table-symbol" src="${row.symbolUrl}" alt="" />`;
    }
    return '—';
  }
  return displayValue(row.values?.[columnId]);
}

/**
 * @param {object} mapResult
 * @param {object | null} presentation
 * @param {{ visibleCategories?: Set<string> | string[], selectedCategories?: Set<string> | string[] }} [options]
 */
export function buildCategorySummaryTableModel(mapResult, presentation = null, options = {}) {
  if (mapResult?.action !== 'CATEGORY_COUNTS_WITHIN'
    && mapResult?.summary?.displayMode !== 'category_counts') {
    return null;
  }
  const xray = mapResult.xrayResult;
  if (!xray?.categories?.length) return null;

  const visibleSet = options.visibleCategories instanceof Set
    ? options.visibleCategories
    : (options.selectedCategories instanceof Set
      ? options.selectedCategories
      : new Set(options.visibleCategories || options.selectedCategories || []));

  const rows = xray.categories.map((entry) => ({
    rowId: `cat::${entry.value}`,
    categoryValue: entry.value,
    selected: visibleSet.has(entry.value),
    symbolUrl: presentation
      ? legendSymbolUrlFromSource(getCategorySymbol(presentation, xray.semanticField, entry.value))
      : null,
    values: {
      category: entry.value,
      count: entry.count,
      source: 'OpenStreetMap Amenities',
      semanticField: xray.semanticField || 'amenity'
    },
    _isCategorySummary: true
  }));

  return {
    mode: 'category_summary',
    rows,
    columns: [
      { id: '_select', label: '', defaultVisible: true },
      { id: '_symbol', label: 'Symbol', defaultVisible: true },
      { id: 'category', label: 'Category', defaultVisible: true },
      { id: 'count', label: 'Count', defaultVisible: true },
      { id: 'source', label: 'Source', defaultVisible: false },
      { id: 'semanticField', label: 'Semantic field', defaultVisible: false }
    ],
    totalCount: rows.length,
    representedFeatures: xray.totalFeaturesRepresented ?? null,
    xrayContext: xray,
    prompt: mapResult.prompt || '',
    matchedAddress: mapResult.origin?.matchedAddress || mapResult.matchedAddress || null
  };
}

/**
 * Build FEATURES mode table from operational remote-layer query results.
 * @param {import('@arcgis/core/Graphic').default[]} features
 * @param {object} xrayContext
 * @param {string} [sourceLabel]
 */
export function buildOperationalFeaturesTableModel(features, xrayContext, sourceLabel = 'OpenStreetMap Amenities') {
  if (!features?.length || !xrayContext) return null;
  const semanticField = xrayContext.semanticField || 'amenity';
  const layerId = 'iqai-xray-operational';
  const rows = [];

  for (const graphic of features) {
    const attrs = graphic.attributes || {};
    const categoryValue = attrs[semanticField] ?? attrs.amenity ?? '—';
  const objectId = attrs.OBJECTID ?? attrs.ObjectID ?? attrs.FID;
    rows.push({
      rowId: `op::${objectId}`,
      layerId,
      datasetId: `concept:AMENITY:${categoryValue}`,
      mapObjectId: objectId,
      values: {
        ...attrs,
        category: categoryValue,
        name: attrs.name ?? attrs.name_en ?? attrs.name_fr ?? null,
        source: sourceLabel
      }
    });
  }

  const { columns, advancedColumns } = discoverColumns(rows, false);
  return {
    mode: 'operational_features',
    rows,
    columns,
    advancedColumns,
    totalCount: rows.length,
    xrayContext,
    prompt: '',
    matchedAddress: null
  };
}

export function filterRows(rows, query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return rows;
  return rows.filter((row) => {
    const parts = [row._datasetLabel];
    for (const value of Object.values(row.values || {})) {
      if (value != null) parts.push(String(value));
    }
    return parts.join(' ').toLowerCase().includes(text);
  });
}

export function sortRows(rows, columnId, direction = 'asc') {
  if (!columnId) return rows;
  const factor = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = columnId === '_datasetLabel' ? a._datasetLabel : a.values?.[columnId];
    const bv = columnId === '_datasetLabel' ? b._datasetLabel : b.values?.[columnId];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor;
  });
}

export function paginateRows(rows, page, pageSize = RESULTS_TABLE_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    pageRows: rows.slice(start, start + pageSize)
  };
}

const LIVE_AIRCRAFT_COLUMNS = [
  { id: 'callsign', label: 'Callsign', defaultVisible: true },
  { id: 'registration', label: 'Registration', defaultVisible: true },
  { id: 'typeCode', label: 'Type', defaultVisible: true },
  { id: 'aircraftClassLabel', label: 'Class', defaultVisible: true },
  { id: 'altitude', label: 'Altitude', defaultVisible: true },
  { id: 'speed', label: 'Speed', defaultVisible: true },
  { id: 'headingDegrees', label: 'Heading', defaultVisible: true },
  { id: 'ageSeconds', label: 'Age', defaultVisible: true },
  { id: 'squawk', label: 'Squawk', defaultVisible: false },
  { id: 'sourceName', label: 'Source', defaultVisible: true }
];

/**
 * @param {object[]} objects
 * @param {(id: string, fallback?: number) => number} objectIdFn
 */
export function buildLiveAircraftTableModel(objects, objectIdFn) {
  if (!objects?.length) return null;
  const rows = objects.map((object) => {
    const liveObjectId = String(object.liveObjectId || '').trim();
    const mapObjectId = objectIdFn(liveObjectId, 1);
    return {
      rowId: `live-aircraft::${liveObjectId}`,
      layerId: 'live-aircraft',
      mapObjectId,
      values: {
        callsign: object.callsign || '—',
        registration: object.registration || '—',
        typeCode: object.typeCode || '—',
        aircraftClassLabel: object.aircraftClassLabel || object.aircraftClass || '—',
        altitude: object.altitude != null ? `${object.altitude} ft` : '—',
        speed: object.speed != null ? `${object.speed} kt` : '—',
        headingDegrees: object.headingDegrees != null ? Math.round(object.headingDegrees) : '—',
        ageSeconds: object.ageSeconds != null ? `${Math.round(object.ageSeconds)}s` : '—',
        squawk: object.squawk || '—',
        sourceName: object.sourceName || 'ADSB.lol',
        liveObjectId
      }
    };
  });

  return {
    mode: 'live_feed',
    feedTitle: 'Aircraft — Live',
    layerId: 'live-aircraft',
    rows,
    columns: LIVE_AIRCRAFT_COLUMNS,
    totalCount: rows.length,
    prompt: '',
    matchedAddress: null
  };
}

const LIVE_VESSELS_COLUMNS = [
  { id: 'displayName', label: 'Vessel', defaultVisible: true },
  { id: 'vesselClassLabel', label: 'Type', defaultVisible: true },
  { id: 'mmsi', label: 'MMSI', defaultVisible: true },
  { id: 'imo', label: 'IMO', defaultVisible: true },
  { id: 'navigationStatusLabel', label: 'Status', defaultVisible: true },
  { id: 'speed', label: 'Speed', defaultVisible: true },
  { id: 'courseOverGround', label: 'Course', defaultVisible: true },
  { id: 'destination', label: 'Destination', defaultVisible: true },
  { id: 'ageSeconds', label: 'Age', defaultVisible: true },
  { id: 'sourceName', label: 'Source', defaultVisible: true }
];

/**
 * @param {object[]} objects
 * @param {(id: string, fallback?: number) => number} objectIdFn
 */
export function buildLiveVesselsTableModel(objects, objectIdFn) {
  if (!objects?.length) return null;
  const rows = objects.map((object) => {
    const liveObjectId = String(object.liveObjectId || '').trim();
    const mapObjectId = objectIdFn(liveObjectId, 1);
    return {
      rowId: `live-vessels::${liveObjectId}`,
      layerId: 'live-vessels',
      mapObjectId,
      values: {
        displayName: object.displayName || '—',
        vesselClassLabel: object.vesselClassLabel || object.vesselClass || '—',
        mmsi: object.mmsi || object.sourceObjectId || '—',
        imo: object.imo || '—',
        navigationStatusLabel: object.navigationStatusLabel || object.status || '—',
        speed: object.speed != null ? `${object.speed} kn` : '—',
        courseOverGround: object.courseOverGround != null ? Math.round(object.courseOverGround) : '—',
        destination: object.destination || '—',
        ageSeconds: object.ageSeconds != null ? `${Math.round(object.ageSeconds)}s` : '—',
        sourceName: object.sourceName || 'AISStream.io',
        liveObjectId
      }
    };
  });

  return {
    mode: 'live_feed',
    feedTitle: 'Vessels — Live',
    layerId: 'live-vessels',
    rows,
    columns: LIVE_VESSELS_COLUMNS,
    totalCount: rows.length,
    prompt: '',
    matchedAddress: null
  };
}
