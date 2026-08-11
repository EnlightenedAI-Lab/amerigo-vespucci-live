/**
 * Clean IQAI presentation for OSM / TRUSTED_EXTERNAL deterministic results.
 * Popup + selected-feature cards only — does not alter source records.
 */

const URL_PATTERN = /^https?:\/\//i;

const CATEGORY_LABELS = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
  pub: 'Pub',
  fast_food: 'Fast food',
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  place_of_worship: 'Place of worship',
  school: 'School',
  kindergarten: 'Kindergarten',
  bank: 'Bank',
  atm: 'ATM',
  toilets: 'Public toilet'
};

const CONTEXT_FIELDS = {
  restaurant: [
    { keys: ['cuisine'], label: 'Cuisine' },
    { keys: ['opening_hours', 'opening_hours_en', 'opening_hours_fr'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  hospital: [
    { keys: ['healthcare', 'healthcare:speciality', 'healthcare_speciality'], label: 'Healthcare speciality' },
    { keys: ['emergency'], label: 'Emergency' },
    { keys: ['opening_hours', 'opening_hours_en'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  clinic: [
    { keys: ['healthcare', 'healthcare:speciality'], label: 'Healthcare' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  place_of_worship: [
    { keys: ['denomination', 'religion'], label: 'Denomination' },
    { keys: ['opening_hours'], label: 'Hours' }
  ],
  bar: [
    { keys: ['opening_hours', 'opening_hours_en', 'opening_hours_fr'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  pub: [
    { keys: ['opening_hours', 'opening_hours_en'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  fast_food: [
    { keys: ['cuisine'], label: 'Cuisine' },
    { keys: ['opening_hours'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  parking: [
    { keys: ['parking', 'parking_type'], label: 'Parking type' },
    { keys: ['capacity'], label: 'Capacity' }
  ],
  pharmacy: [
    { keys: ['opening_hours'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  cafe: [
    { keys: ['cuisine'], label: 'Cuisine' },
    { keys: ['opening_hours'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ],
  default: [
    { keys: ['opening_hours', 'opening_hours_en', 'opening_hours_fr'], label: 'Hours' },
    { keys: ['phone', 'contact:phone'], label: 'Phone' }
  ]
};

export const IQAI_RESULT_POINT_SYMBOL = {
  style: 'circle',
  color: [255, 106, 0, 0.95],
  size: 10,
  outline: { color: [255, 255, 255, 1], width: 1.5 }
};

export const SCHEMA_NOISE_FIELDS = new Set([
  'semanticField',
  'semanticValue',
  'sourceTransform',
  'sourceType',
  'webmapIds',
  'osm_id',
  'objectId',
  'OBJECTID',
  'ObjectID',
  'FID',
  'distanceMeters',
  'sourceId',
  'conceptId',
  'datasetId',
  'iqaiType',
  'authority',
  'sourceName',
  'spatialPrecision',
  'receivedAt',
  'latitude',
  'longitude',
  'LONGITUDE',
  'LATITUDE'
]);

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pickAttr(attrs, keys) {
  for (const key of keys) {
    const value = attrs?.[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

export function formatAmenityCategory(value) {
  if (!value) return 'Amenity';
  const key = String(value).toLowerCase().replace(/\s+/g, '_');
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isOsmRuntimeFeature(attributes, layer = null) {
  if (layer?.id === 'iqai-deterministic-results') return true;
  if (layer?.id?.startsWith?.('iqai-concept')) return true;
  const datasetId = String(attributes?.datasetId || '');
  if (datasetId.startsWith('concept:')) return true;
  if (attributes?.amenity) return true;
  return false;
}

function streetLine(attrs) {
  const street = pickAttr(attrs, ['addr_street', 'address']) || '';
  const housenumber = pickAttr(attrs, ['addr_housenumber']);
  if (housenumber && street && !street.includes(housenumber)) {
    return `${housenumber} ${street}`.trim();
  }
  return street || '—';
}

function cityLine(attrs) {
  return pickAttr(attrs, ['addr_city', 'city', 'addr_place']) || '—';
}

function contextRows(attrs) {
  const amenity = pickAttr(attrs, ['amenity', 'category']) || 'default';
  const key = String(amenity).toLowerCase();
  const defs = CONTEXT_FIELDS[key] || CONTEXT_FIELDS.default;
  const rows = [];
  for (const def of defs) {
    const value = pickAttr(attrs, def.keys);
    if (!value) continue;
    if (def.label === 'Capacity' && (value === '0' || value === 'yes')) continue;
    rows.push({ label: def.label, value });
  }
  return rows;
}

function moreDetailRows(attrs) {
  const skip = new Set([
    ...SCHEMA_NOISE_FIELDS,
    'name', 'name_en', 'name_fr', 'amenity', 'category', 'distanceLabel',
    'addr_street', 'addr_city', 'addr_housenumber', 'address', 'city',
    'cuisine', 'opening_hours', 'opening_hours_en', 'opening_hours_fr',
    'phone', 'contact:phone', 'denomination', 'religion', 'healthcare',
    'healthcare:speciality', 'operator', 'brand'
  ]);
  const rows = [];
  for (const [key, value] of Object.entries(attrs || {})) {
    if (skip.has(key)) continue;
    if (value == null || String(value).trim() === '') continue;
    if (typeof value === 'object') continue;
    rows.push({ label: key.replace(/_/g, ' '), value: String(value) });
  }
  return rows.slice(0, 24);
}

/**
 * @param {object} attrs
 * @param {{ includeMoreDetails?: boolean }} [options]
 */
export function buildCleanOsmFeatureHtml(attrs, options = {}) {
  const title = pickAttr(attrs, ['name', 'name_en', 'name_fr']) || '—';
  const category = formatAmenityCategory(pickAttr(attrs, ['amenity', 'category', 'iqaiType']));
  const distance = pickAttr(attrs, ['distanceLabel']) || '—';
  const street = streetLine(attrs);
  const city = cityLine(attrs);
  const ctx = contextRows(attrs);
  const more = moreDetailRows(attrs);

  const ctxHtml = ctx.map((row) => (
    `<div class="detail-feature-meta-row"><span class="detail-feature-meta-label">${escapeHtml(row.label)}</span><span class="detail-feature-meta-value">${escapeHtml(row.value)}</span></div>`
  )).join('');

  const moreHtml = more.length
    ? `<details class="detail-feature-more"><summary>More details ›</summary><div class="detail-feature-more-body">${more.map((row) => (
      `<div class="detail-feature-meta-row"><span class="detail-feature-meta-label">${escapeHtml(row.label)}</span><span class="detail-feature-meta-value">${escapeHtml(row.value)}</span></div>`
    )).join('')}</div></details>`
    : '';

  return `
    <div class="detail-feature-card detail-feature-card--osm">
      <div class="detail-feature-title">${escapeHtml(title)}</div>
      <div class="detail-feature-subtitle">${escapeHtml(category)}</div>
      <div class="detail-feature-distance">${escapeHtml(distance)} away</div>
      <div class="detail-feature-address">
        <div class="detail-feature-address-line">${escapeHtml(street)}</div>
        <div class="detail-feature-address-line">${escapeHtml(city)}</div>
      </div>
      ${ctxHtml ? `<div class="detail-feature-meta">${ctxHtml}</div>` : ''}
      <div class="detail-feature-source">Source: OpenStreetMap</div>
      ${moreHtml}
    </div>`;
}

export function buildCleanOsmPopupHtml(attrs) {
  const title = pickAttr(attrs, ['name', 'name_en', 'name_fr']) || '—';
  const category = formatAmenityCategory(pickAttr(attrs, ['amenity', 'category', 'iqaiType']));
  const distance = pickAttr(attrs, ['distanceLabel']) || '—';
  const street = streetLine(attrs);
  const city = cityLine(attrs);
  const ctx = contextRows(attrs);
  const ctxHtml = ctx.map((row) => (
    `<div class="iqai-popup-row"><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</div>`
  )).join('');
  return `
    <div class="iqai-popup-body">
      <div class="iqai-popup-category">${escapeHtml(category)}</div>
      <div class="iqai-popup-distance">${escapeHtml(distance)} away</div>
      <div class="iqai-popup-address">${escapeHtml(street)}<br>${escapeHtml(city)}</div>
      ${ctxHtml}
      <div class="iqai-popup-source">Source: OpenStreetMap</div>
    </div>`;
}

export function buildCleanOsmPopupTemplate() {
  return {
    title: '{name}',
    outFields: ['*'],
    content: (feature) => {
      const attrs = feature?.graphic?.attributes || {};
      const div = document.createElement('div');
      div.className = 'iqai-clean-popup';
      div.innerHTML = buildCleanOsmPopupHtml(attrs);
      return div;
    }
  };
}

export function buildIqaiResultClusterReduction(title = 'Results') {
  return {
    type: 'cluster',
    clusterRadius: '72px',
    clusterMinSize: '28px',
    clusterMaxSize: '64px',
    symbol: {
      type: 'simple-marker',
      style: 'circle',
      color: [255, 106, 0, 0.92],
      size: 22,
      outline: { color: [255, 255, 255, 1], width: 2 }
    },
    labelingInfo: [{
      deconflictionStrategy: 'none',
      labelExpressionInfo: {
        expression: 'Text($feature.cluster_count, "#,###")'
      },
      symbol: {
        type: 'text',
        color: [255, 255, 255, 1],
        font: { size: 11, weight: 'bold', family: 'Arial' },
        haloColor: [0, 70, 140, 0.9],
        haloSize: 1.5
      },
      labelPlacement: 'center-center'
    }],
    popupTemplate: {
      title: title,
      content: 'This cluster represents {cluster_count} amenities. Zoom in to see individual locations.'
    }
  };
}
