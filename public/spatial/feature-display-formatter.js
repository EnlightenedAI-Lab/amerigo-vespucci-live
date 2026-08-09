/**
 * Display-only formatting for Selected Feature panel (does not alter source attributes).
 */

const URL_PATTERN = /^https?:\/\//i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PRESERVED_ACRONYMS = new Set([
  'EMS', 'PDQ', 'STM', 'SIM', 'QC', 'URL', 'ID', 'IDS', 'SPVM', 'ODHF'
]);

const GENERIC_SOURCE_LABELS = new Set([
  'Police Stations',
  'Fire Stations',
  'Hospitals',
  'Schools',
  'Transit Stops'
]);

const SPATIAL_PRECISION_LABELS = {
  POLICE_STATIONS: 'Station point',
  FIRE_STATIONS: 'Station point',
  HOSPITALS: 'Facility point',
  SCHOOLS: 'School point',
  TRANSIT: 'Stop point'
};

const DATASET_CATEGORY_LABELS = {
  POLICE_STATIONS: 'Police station',
  FIRE_STATIONS: 'Fire station',
  HOSPITALS: 'Hospital',
  SCHOOLS: 'School',
  TRANSIT: 'Transit stop'
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

export function hasEncodingDamage(text) {
  return String(text || '').includes('\uFFFD');
}

export function formatPostalCode(postal) {
  const raw = String(postal || '').replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(raw)) {
    return `${raw.slice(0, 3)} ${raw.slice(3)}`;
  }
  return String(postal || '').trim();
}

export function formatTitleCase(text) {
  if (!text || text === '—') return '—';
  const str = String(text).trim();
  if (!str) return '—';
  if (URL_PATTERN.test(str) || EMAIL_PATTERN.test(str)) return str;

  return str.split(/(\s+)/).map((token) => {
    if (!token.trim()) return token;
    const word = token.trim();
    const upper = word.toUpperCase();
    if (PRESERVED_ACRONYMS.has(upper)) return upper;
    if (/^[A-Z]{2,3}$/.test(word)) return word;
    if (/^\d+[A-Za-z]?$/.test(word)) return word;
    return word
      .split('-')
      .map((part) => {
        if (!part) return part;
        const partUpper = part.toUpperCase();
        if (PRESERVED_ACRONYMS.has(partUpper)) return partUpper;
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join('-');
  }).join('');
}

export function parseAddressLines(address) {
  const raw = String(address || '').trim();
  if (!raw || raw === '—') return { street: '—', cityLine: '—' };

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { street: '—', cityLine: '—' };

  const working = [...parts];
  let postal = '';
  let province = '';

  if (working.length) {
    const last = working[working.length - 1].replace(/\s+/g, '');
    if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/i.test(last)) {
      postal = formatPostalCode(working.pop());
    }
  }
  if (working.length && /^(QC|ON|BC|AB|MB|SK|NB|NS|PE|NL|YT|NT|NU)$/i.test(working[working.length - 1])) {
    province = working.pop().toUpperCase();
  }

  let city = '';
  if (working.length > 1) {
    city = working.pop();
  } else if (working.length === 1 && !/\d/.test(working[0])) {
    city = working.pop();
  }

  const street = working.join(', ');
  const cityLine = [formatTitleCase(city), province, postal].filter(Boolean).join(', ');

  return {
    street: street ? formatTitleCase(street) : '—',
    cityLine: cityLine || (city ? formatTitleCase(city) : '—')
  };
}

export function formatDisplayText(text, kind = 'text') {
  if (text == null || text === '' || text === '—') return '—';
  const str = String(text).trim();
  if (!str) return '—';
  if (URL_PATTERN.test(str)) return str;
  if (EMAIL_PATTERN.test(str)) return str;
  if (kind === 'postal') return formatPostalCode(str);
  if (kind === 'title') return formatTitleCase(str);
  if (kind === 'type') return formatTitleCase(str);
  return formatTitleCase(str);
}

export function resolveDisplaySource(attributes, mapResult) {
  const authority = attributes?.authority?.trim();
  if (authority && authority !== '—') return formatDisplayText(authority, 'title');

  const datasetResult = mapResult?.datasetResults?.find(
    (result) => result.datasetId === attributes?.datasetId
  );
  if (datasetResult?.authority) return formatDisplayText(datasetResult.authority, 'title');

  const sourceName = attributes?.sourceName?.trim();
  if (sourceName && !GENERIC_SOURCE_LABELS.has(sourceName)) {
    return formatDisplayText(sourceName, 'title');
  }

  if (mapResult?.source?.authority) return formatDisplayText(mapResult.source.authority, 'title');
  if (sourceName) return formatDisplayText(sourceName, 'title');
  return '—';
}

export function resolveSpatialPrecisionLabel(attributes) {
  const datasetId = attributes?.datasetId;
  const raw = String(attributes?.spatialPrecision || '').trim();
  if (raw && raw !== 'Deterministic GIS') return formatDisplayText(raw, 'type');
  if (datasetId && SPATIAL_PRECISION_LABELS[datasetId]) {
    return SPATIAL_PRECISION_LABELS[datasetId];
  }
  return '—';
}

function formatUrlValue(label, url) {
  const linkLabel = linkLabelForField(label);
  return {
    html: true,
    value: `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="detail-link">${escapeHtml(linkLabel)}</a>`
  };
}

function linkLabelForField(label) {
  const normalized = String(label || '').trim();
  if (/^camera$/i.test(normalized)) return 'Open Camera';
  if (/image/i.test(normalized)) return 'Open Image';
  if (/website|source|url|link|feed|stream|live/i.test(normalized)) {
    return `Open ${formatTitleCase(normalized)}`;
  }
  return `Open ${formatTitleCase(normalized || 'Link')}`;
}

function metaRow(label, value, options = {}) {
  const valueClass = options.html
    ? 'detail-meta-value detail-item-value-wrap'
    : 'detail-meta-value';
  const inner = options.html ? value : escapeHtml(value ?? '—');
  return `
    <div class="detail-meta-item">
      <div class="detail-meta-label">${escapeHtml(label)}</div>
      <div class="${valueClass}">${inner}</div>
    </div>`;
}

function distanceBlock(distanceLabel) {
  const value = distanceLabel && distanceLabel !== '—' ? distanceLabel : '—';
  return `
    <div class="detail-feature-distance">
      <div class="detail-feature-distance-value">${escapeHtml(value)}</div>
      <div class="detail-feature-distance-label">from query location</div>
    </div>`;
}

function addressBlock(address) {
  const lines = parseAddressLines(address);
  if (lines.street === '—' && lines.cityLine === '—') {
    return '<div class="detail-feature-address"><div class="detail-feature-address-line">—</div></div>';
  }
  return `
    <div class="detail-feature-address">
      <div class="detail-feature-address-line">${escapeHtml(lines.street)}</div>
      <div class="detail-feature-address-line">${escapeHtml(lines.cityLine)}</div>
    </div>`;
}

/**
 * @param {object} attributes
 * @param {object} [mapResult]
 */
export function buildIqaiFeatureHtml(attributes, mapResult = null) {
  const datasetId = attributes?.datasetId;
  const category = DATASET_CATEGORY_LABELS[datasetId] || 'Feature';
  const source = resolveDisplaySource(attributes, mapResult);
  const precision = resolveSpatialPrecisionLabel(attributes);
  const distance = attributes?.distanceLabel || '—';

  let title = '—';
  let subtitle = category;

  if (datasetId === 'POLICE_STATIONS') {
    title = formatDisplayText(attributes.pdq || attributes.stationNumber || attributes.name, 'title');
    subtitle = category;
  } else if (datasetId === 'FIRE_STATIONS') {
    const station = attributes.stationNumber
      ? `Station ${attributes.stationNumber}`
      : attributes.name;
    title = formatDisplayText(station, 'title');
    subtitle = category;
  } else if (datasetId === 'HOSPITALS') {
    title = formatDisplayText(attributes.name, 'title');
    const facilityType = formatDisplayText(attributes.facilityType, 'type');
    subtitle = facilityType && facilityType !== '—'
      ? `${category} · ${facilityType}`
      : category;
  } else if (datasetId === 'SCHOOLS') {
    title = formatDisplayText(attributes.name, 'title');
    const schoolType = formatDisplayText(attributes.schoolType, 'type');
    subtitle = schoolType && schoolType !== '—' ? `${category} · ${schoolType}` : category;
  } else if (datasetId === 'TRANSIT') {
    title = formatDisplayText(attributes.name, 'title');
    const mode = formatDisplayText(attributes.transitMode, 'type');
    subtitle = mode && mode !== '—' ? `${category} · ${mode}` : category;
  } else {
    title = formatDisplayText(attributes.name, 'title');
  }

  const meta = [];
  if (datasetId === 'FIRE_STATIONS' && attributes.operationalStatus) {
    meta.push(metaRow('Operational status', formatDisplayText(attributes.operationalStatus, 'type')));
  }
  meta.push(metaRow('Source', source));
  meta.push(metaRow('Spatial precision', precision));

  return `
    <div class="detail-feature-card">
      <div class="detail-feature-title">${escapeHtml(title)}</div>
      <div class="detail-feature-subtitle">${escapeHtml(subtitle)}</div>
      ${addressBlock(attributes.address)}
      ${distanceBlock(distance)}
      <div class="detail-feature-meta">${meta.join('')}</div>
    </div>`;
}

/**
 * @param {object} graphic
 * @param {object} agolDetail from buildAgolFeatureDetail
 */
export function buildAgolFeatureHtml(graphic, agolDetail) {
  const layer = graphic?.layer || graphic?.sourceLayer;
  const layerTitle = formatDisplayText(agolDetail.layerTitle || layer?.title, 'title');
  const title = formatDisplayText(agolDetail.title, 'title');

  const primaryFields = [];
  const metaFields = [];

  for (const field of agolDetail.fields) {
    const label = field.label || '';
    const raw = field.html ? null : field.text;
    let valueHtml = null;
    let valueText = '—';

    if (field.html) {
      valueHtml = field.htmlValue;
    } else if (raw && URL_PATTERN.test(String(raw).trim())) {
      const formatted = formatUrlValue(label, String(raw).trim());
      valueHtml = formatted.value;
    } else {
      valueText = formatDisplayText(raw, /type|category|mode/i.test(label) ? 'type' : 'text');
    }

    const isAddress = /address|location|adresse/i.test(label);
    const row = valueHtml
      ? metaRow(label, valueHtml, { html: true })
      : metaRow(label, valueText, { wrap: isAddress });

    if (/distance|radius|distance/i.test(label)) {
      metaFields.unshift(row);
    } else if (isAddress) {
      primaryFields.push(row);
    } else {
      metaFields.push(row);
    }
  }

  return `
    <div class="detail-feature-card">
      <div class="detail-feature-title">${escapeHtml(title)}</div>
      <div class="detail-feature-subtitle">${escapeHtml(layerTitle)}</div>
      ${primaryFields.length ? `<div class="detail-feature-meta">${primaryFields.join('')}</div>` : ''}
      ${metaFields.length ? `<div class="detail-feature-meta">${metaFields.join('')}</div>` : ''}
    </div>`;
}
