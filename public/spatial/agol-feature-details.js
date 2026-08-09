/** Known IQAI runtime datasets with specialized Detail templates. */
import { formatDisplayText } from './feature-display-formatter.js';

export const IQAI_DATASET_IDS = new Set([
  'POLICE_STATIONS',
  'FIRE_STATIONS',
  'HOSPITALS'
]);

const INTERNAL_FIELD_NAMES = new Set([
  'OBJECTID',
  'ObjectID',
  'FID',
  'OID',
  'GLOBALID',
  'GlobalID',
  'Shape',
  'SHAPE',
  'SHAPE_Length',
  'SHAPE_Area',
  'geometry',
  'iqaiType',
  'spatialPrecision',
  'distanceMeters'
]);

const URL_PATTERN = /^https?:\/\//i;

export function isKnownIqaiDataset(attributes) {
  return attributes?.datasetId && IQAI_DATASET_IDS.has(attributes.datasetId);
}

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

function isInternalField(fieldName) {
  if (!fieldName) return true;
  if (INTERNAL_FIELD_NAMES.has(fieldName)) return true;
  if (/^shape/i.test(fieldName)) return true;
  return false;
}

function linkLabelForField(label) {
  const normalized = String(label || '').trim();
  if (!normalized) return 'Open link';
  if (/^camera$/i.test(normalized)) return 'Open Camera';
  if (/image/i.test(normalized)) return 'Open Image';
  if (/website|source|url|link|feed|stream|live/i.test(normalized)) {
    return `Open ${normalized}`;
  }
  return `Open ${normalized}`;
}

export function formatAgolFieldValue(label, value) {
  if (value == null || value === '') return { text: '—', html: false };
  const str = String(value).trim();
  if (!str) return { text: '—', html: false };
  if (URL_PATTERN.test(str)) {
    const linkLabel = linkLabelForField(label);
    return {
      text: linkLabel,
      html: true,
      htmlValue: `<a href="${escapeAttr(str)}" target="_blank" rel="noopener noreferrer" class="detail-link">${escapeHtml(linkLabel)}</a>`
    };
  }
  return { text: formatDisplayText(str, /type|category|mode/i.test(label) ? 'type' : 'text'), html: false };
}

export function resolvePopupTitle(popupTemplate, attributes) {
  if (!popupTemplate?.title) return null;
  return String(popupTemplate.title).replace(/\{([^}]+)\}/g, (_, key) => {
    const fieldName = key.trim();
    const value = attributes?.[fieldName];
    if (value == null || value === '') return '—';
    return String(value);
  });
}

function collectFieldInfos(popupTemplate) {
  if (!popupTemplate) return [];
  const infos = [];
  const seen = new Set();

  const addInfo = (info) => {
    if (!info?.fieldName || seen.has(info.fieldName)) return;
    if (info.visible === false) return;
    seen.add(info.fieldName);
    infos.push(info);
  };

  if (popupTemplate.fieldInfos?.length) {
    for (const info of popupTemplate.fieldInfos) addInfo(info);
  }

  const content = popupTemplate.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'fields' && block.fieldInfos?.length) {
        for (const info of block.fieldInfos) addInfo(info);
      }
      if (block?.fieldInfos?.length) {
        for (const info of block.fieldInfos) addInfo(info);
      }
    }
  } else if (content?.fieldInfos?.length) {
    for (const info of content.fieldInfos) addInfo(info);
  }

  return infos;
}

function collectActionLinks(popupTemplate, attributes) {
  const links = [];
  const actions = popupTemplate?.actions;
  if (!Array.isArray(actions)) return links;

  for (const action of actions) {
    const rawUrl = action?.url || action?.href;
    if (!rawUrl) continue;
    const url = String(rawUrl).replace(/\{([^}]+)\}/g, (_, key) => {
      const value = attributes?.[key.trim()];
      return value != null ? String(value) : '';
    }).trim();
    if (!URL_PATTERN.test(url)) continue;
    const label = action.title || action.id || 'Open link';
    links.push({ label, url });
  }
  return links;
}

/**
 * @param {object} layer
 */
export function hasAuthoredArcgisPopup(layer) {
  const popupTemplate = layer?.popupTemplate;
  if (!popupTemplate) return false;
  if (popupTemplate.title) return true;
  if (popupTemplate.outFields?.length) return true;
  if (popupTemplate.fieldInfos?.length) return true;
  const content = popupTemplate.content;
  if (typeof content === 'string' && content.trim()) return true;
  if (Array.isArray(content) && content.length) return true;
  if (content && typeof content === 'object') return true;
  return false;
}

/**
 * @param {object} graphic
 * @param {object | null} [mapResult]
 */
export function buildAgolSupplementaryDetail(graphic, mapResult = null) {
  const layer = graphic?.layer || graphic?.sourceLayer;
  const attributes = graphic?.attributes || {};
  const layerTitle = layer?.title || layer?.id || '—';
  const title = resolvePopupTitle(layer?.popupTemplate, attributes) || layerTitle;

  return {
    layerTitle,
    title,
    iqaiSource: attributes.authority
      || mapResult?.summary?.authority
      || mapResult?.source?.authority
      || 'Montreal 1',
    iqaiProvenance: attributes.sourceName
      || mapResult?.summary?.dataset
      || layerTitle,
    objectId: attributes.OBJECTID ?? attributes.ObjectID ?? attributes.FID ?? null,
    distanceLabel: attributes.distanceLabel || null
  };
}

/**
 * @param {object} detail
 */
export function buildAgolSupplementaryHtml(detail) {
  const rows = [
    { label: 'Layer', value: detail.layerTitle },
    { label: 'ArcGIS presentation', value: 'Native popup available' },
    { label: 'IQAI source', value: detail.iqaiSource },
    { label: 'IQAI provenance', value: detail.iqaiProvenance }
  ];

  if (detail.objectId != null && detail.objectId !== '') {
    rows.push({ label: 'Object ID', value: String(detail.objectId) });
  }
  if (detail.distanceLabel) {
    rows.push({ label: 'Distance', value: detail.distanceLabel });
  }

  const meta = rows.map((row) => `
    <div class="detail-meta-row">
      <span class="detail-meta-label">${escapeHtml(row.label)}</span>
      <span class="detail-meta-value">${escapeHtml(row.value)}</span>
    </div>`).join('');

  return `
    <div class="detail-feature-card">
      <div class="detail-feature-title">${escapeHtml(detail.title)}</div>
      <div class="detail-feature-subtitle">SELECTED FEATURE</div>
      <div class="detail-feature-meta">${meta}</div>
    </div>`;
}

/**
 * Build Detail panel field rows from an ArcGIS-selected Graphic.
 * @param {object} graphic
 * @returns {{ layerTitle: string, title: string, fields: Array<{ label: string, text: string, html?: boolean, htmlValue?: string }> }}
 */
export function buildAgolFeatureDetail(graphic) {
  const layer = graphic?.layer || graphic?.sourceLayer;
  const attributes = graphic?.attributes || {};
  const popupTemplate = layer?.popupTemplate;
  const layerTitle = layer?.title || layer?.id || '—';
  const title = resolvePopupTitle(popupTemplate, attributes) || layerTitle;

  const fields = [];
  const fieldInfos = collectFieldInfos(popupTemplate);

  if (fieldInfos.length) {
    for (const info of fieldInfos) {
      if (isInternalField(info.fieldName)) continue;
      const label = info.label || info.fieldName;
      let value = attributes[info.fieldName];
      if (info.format?.dateFormat && value) {
        try {
          value = new Date(value).toLocaleString();
        } catch {
          // keep raw value
        }
      }
      const formatted = formatAgolFieldValue(label, value);
      fields.push({
        label,
        text: formatted.text,
        html: formatted.html,
        htmlValue: formatted.htmlValue,
        wrap: /address|description|name|url/i.test(label)
      });
    }
  } else {
    const keys = Object.keys(attributes).sort();
    for (const key of keys) {
      if (isInternalField(key)) continue;
      const value = attributes[key];
      if (value == null || value === '') continue;
      const label = key.replace(/_/g, ' ');
      const formatted = formatAgolFieldValue(label, value);
      fields.push({
        label,
        text: formatted.text,
        html: formatted.html,
        htmlValue: formatted.htmlValue,
        wrap: true
      });
    }
  }

  for (const actionLink of collectActionLinks(popupTemplate, attributes)) {
    fields.push({
      label: actionLink.label,
      text: linkLabelForField(actionLink.label),
      html: true,
      htmlValue: `<a href="${escapeAttr(actionLink.url)}" target="_blank" rel="noopener noreferrer" class="detail-link">${escapeHtml(linkLabelForField(actionLink.label))}</a>`
    });
  }

  return { layerTitle, title, fields };
}

export function describePopupTemplate(popupTemplate) {
  const infos = collectFieldInfos(popupTemplate);
  return {
    title: popupTemplate?.title || null,
    fieldAliases: infos.map((info) => ({
      fieldName: info.fieldName,
      label: info.label || info.fieldName
    })),
    urlLikeFields: infos
      .filter((info) => {
        const label = String(info.label || info.fieldName || '');
        return /url|link|camera|image|website|feed|stream/i.test(info.fieldName)
          || /url|link|camera|image|website|feed|stream/i.test(label);
      })
      .map((info) => info.fieldName)
  };
}
