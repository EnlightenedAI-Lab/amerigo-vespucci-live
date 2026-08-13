/**
 * Analyst-facing Point Intelligence result presentation.
 * Formats Agent 5 normalized fields only — no invented measurements or semantics.
 */
import {
  POINT_INTELLIGENCE_FAMILIES
} from './point-intelligence-config.js';
import {
  formatTemporalClassificationLabel
} from './point-intelligence-status.js';
import {
  isMultiFamilyPointIntelligenceResponse
} from './point-intelligence-multifamily.js';
import {
  buildLocationIntelligenceFocusModel,
  deriveCoverageState
} from './point-intelligence-lif-model.js';
import { getObservationId, getAuthoritativeAssetKey } from './point-intelligence-map-presentation.js';
import { renderInspectorHostHtml } from './point-intelligence-inspector-presentation.js';
import { renderStreetLevelContextHostHtml } from './street-level-context-presentation.js';
import { renderProofLegendHtml } from './point-intelligence-station-symbols.js';
import { isProofSourceFamily } from './point-intelligence-station-model.js';
import {
  formatTemporalStateSummary,
  getPointIntelligenceTemporalState
} from './point-intelligence-temporal-state.js';
import {
  buildLocationSynthesisModel,
  buildSingleFamilySynthesisModel,
  renderLocationSynthesisHtml
} from './point-intelligence-location-synthesis.js';

/**
 * @param {number | null | undefined} meters
 * @returns {string | null}
 */
export function formatClickDistance(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function formatClimateObservationDate(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function formatObservationTimestamp(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const dateOnly = formatClimateObservationDate(raw);
  if (dateOnly && !raw.includes('T') && !/\d{2}:\d{2}/.test(raw)) return dateOnly;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

/**
 * @param {number | null | undefined} value
 * @param {string} [unit]
 * @returns {string | null}
 */
export function formatMeasurement(value, unit = '') {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  const rounded = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
  return unit ? `${rounded} ${unit}` : rounded;
}

function formatDrainageArea(value) {
  if (!Number.isFinite(Number(value))) return null;
  const sqKm = Number(value) / 1_000_000;
  if (sqKm >= 1) return `${sqKm.toFixed(1)} km²`;
  return `${Number(value).toLocaleString('en-CA')} m²`;
}

function formatStationStatus(status) {
  if (!status) return null;
  const normalized = String(status).trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === 'active') return 'Active';
  if (lower === 'discontinued') return 'Discontinued';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

const NATIVE_COLLECTION_TO_FAMILY = Object.freeze({
  'hydrometric-stations': POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC,
  'hydrometric-measurements': POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT,
  'swob-realtime': POINT_INTELLIGENCE_FAMILIES.WEATHER,
  'citypageweather-realtime': POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT,
  'aqhi-observations-realtime': POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY,
  'climate-daily': POINT_INTELLIGENCE_FAMILIES.CLIMATE,
  'climate-hourly': POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY,
  hydrometric: POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC,
  climate: POINT_INTELLIGENCE_FAMILIES.CLIMATE,
  weather: POINT_INTELLIGENCE_FAMILIES.WEATHER,
  'weather-current': POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT,
  'climate-hourly': POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY,
  'air-quality': POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY,
  'hydrometric-measurement': POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT
});

const TOP_LEVEL_PROPERTY_KEYS = [
  'STATION_NAME', 'IDENTIFIER', 'STATION_NUMBER', 'STN_ID', 'CLIMATE_IDENTIFIER',
  'LOCAL_DATE', 'LOCAL_TIME', 'LOCAL_DATETIME', 'OBSERVATION_DATETIME',
  'TEMP', 'TEMPERATURE', 'MEAN_TEMP', 'MIN_TEMP', 'MAX_TEMP', 'TOTAL_PRECIP',
  'PRECIPITATION', 'AQHI', 'VALUE', 'WATER_LEVEL', 'DISCHARGE', 'WATERBODY',
  'DRAINAGE_AREA', 'STATUS', 'CITY', 'CONDITION', 'WIND_SPEED', 'WIND_DIR',
  'RELATIVE_HUMIDITY', 'PRESSURE', 'STATION_TYPE'
];

/**
 * @param {Record<string, unknown> | null | undefined} result
 * @returns {Record<string, unknown>}
 */
export function resolveResultProperties(result) {
  const props = { ...(result?.properties || {}) };
  if (!result) return props;
  for (const key of TOP_LEVEL_PROPERTY_KEYS) {
    if (result[key] != null && props[key] == null) props[key] = result[key];
  }
  return props;
}

/**
 * @param {Record<string, unknown> | null | undefined} result
 * @param {string | null | undefined} familyHint
 * @returns {string}
 */
export function resolvePresentationFamily(result, familyHint = null) {
  if (familyHint && PRESENTATION_BUILDERS[familyHint]) return familyHint;
  const candidates = [
    familyHint,
    result?.category,
    result?.informationFamily,
    result?.nativeCollectionId,
    result?.capabilityType
  ].filter(Boolean);
  for (const candidate of candidates) {
    const key = String(candidate);
    if (PRESENTATION_BUILDERS[key]) return key;
    if (NATIVE_COLLECTION_TO_FAMILY[key]) return NATIVE_COLLECTION_TO_FAMILY[key];
  }
  return String(result?.category || result?.nativeCollectionId || familyHint || 'unknown');
}

/**
 * @param {string | null | undefined} nativeRecordId
 * @param {string} [family]
 * @returns {string | null}
 */
export function stationLabelFromNativeRecordId(nativeRecordId, family = '') {
  if (!nativeRecordId) return null;
  const raw = String(nativeRecordId).trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)+$/.test(raw)) {
    return `Station ${raw.split('.')[0]}`;
  }
  if (family === 'hydrometric' || family === 'hydrometric-measurement') {
    return `Station ${raw}`;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} family
 * @returns {string}
 */
export function extractStationTitle(result, family) {
  const props = resolveResultProperties(result);
  const stationName = props.STATION_NAME
    || props.CITY
    || props.IDENTIFIER
    || props['stn_nam-value']
    || props.stn_nam
    || (typeof props.name === 'object' ? (props.name.en || props.name.fr) : props.name)
    || props.locationName;
  if (stationName) return String(stationName);
  if (family === 'hydrometric' || family === 'hydrometric-measurement') {
  const stationId = props.STATION_NUMBER || props.STN_ID || props.CLIMATE_IDENTIFIER;
    if (stationId) return `Station ${stationId}`;
  }
  return stationLabelFromNativeRecordId(result?.nativeRecordId, family) || 'Observation';
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} family
 * @returns {string | null}
 */
export function extractPrimaryMeasurementLine(result, family) {
  const props = resolveResultProperties(result);
  switch (family) {
    case POINT_INTELLIGENCE_FAMILIES.WEATHER:
    case POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT:
      return formatMeasurement(props.TEMP ?? props.TEMPERATURE, '°C');
    case POINT_INTELLIGENCE_FAMILIES.CLIMATE:
      return formatMeasurement(props.MEAN_TEMPERATURE ?? props.MEAN_TEMP, '°C')
        || formatMeasurement(props.MAX_TEMPERATURE ?? props.MAX_TEMP, '°C')
        || formatMeasurement(props.MIN_TEMPERATURE ?? props.MIN_TEMP, '°C');
    case POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY:
      return formatMeasurement(props.TEMP ?? props.TEMPERATURE, '°C');
    case POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY:
      return Number.isFinite(Number(props.AQHI)) ? `AQHI ${Number(props.AQHI)}` : null;
    case POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT:
      return formatMeasurement(props.WATER_LEVEL ?? props.VALUE, props.UNIT || 'm')
        || formatMeasurement(props.DISCHARGE, 'm³/s');
    default:
      return null;
  }
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} family
 * @returns {Record<string, unknown>}
 */
function normalizeResultForPresentation(result, family = null) {
  const resolvedFamily = resolvePresentationFamily(result, family);
  return {
    ...result,
    category: resolvedFamily,
    properties: resolveResultProperties(result)
  };
}

function observationTimestamp(result) {
  const props = resolveResultProperties(result);
  return props.LOCAL_DATETIME
    || props.OBSERVATION_DATETIME
    || props.LOCAL_DATE
    || result?.observationDate
    || result?.observedAt
    || null;
}

function compareResultsByUsefulness(a, b) {
  const distA = Number.isFinite(a?.clickDistanceMeters) ? a.clickDistanceMeters : Infinity;
  const distB = Number.isFinite(b?.clickDistanceMeters) ? b.clickDistanceMeters : Infinity;
  if (distA !== distB) return distA - distB;
  const timeA = new Date(observationTimestamp(a) || 0).getTime();
  const timeB = new Date(observationTimestamp(b) || 0).getTime();
  return timeB - timeA;
}

/**
 * @param {Array<Record<string, unknown>>} results
 * @param {string} family
 * @returns {Array<{ assetKey: string, title: string, results: Array<Record<string, unknown>>, latest: Record<string, unknown> }>}
 */
export function groupResultsByAuthoritativeStation(results, family) {
  const groups = new Map();
  for (const result of results || []) {
    const assetKey = getAuthoritativeAssetKey(result) || `obs:${getObservationId(result)}`;
    const existing = groups.get(assetKey);
    if (existing) {
      existing.results.push(result);
    } else {
      groups.set(assetKey, {
        assetKey,
        title: extractStationTitle(result, family),
        results: [result],
        latest: result
      });
    }
  }
  return [...groups.values()].map((group) => {
    const sorted = [...group.results].sort(compareResultsByUsefulness);
    return {
      ...group,
      results: sorted,
      latest: sorted[0]
    };
  }).sort((a, b) => compareResultsByUsefulness(a.latest, b.latest));
}

/**
 * @param {Record<string, unknown>} familyRow
 * @param {number} [radiusMeters]
 * @returns {{ station: string | null, measurement: string | null, observedAt: string | null, distance: string | null, temporalLabel: string | null, statusMessage: string | null }}
 */
export function buildFamilyEvidencePreview(familyRow, radiusMeters = null) {
  const family = familyRow.informationFamily;
  if (familyRow.coverageState === 'PROVIDER_ISSUE') {
    return {
      station: null,
      measurement: null,
      observedAt: null,
      distance: null,
      temporalLabel: null,
      statusMessage: 'Source temporarily unavailable'
    };
  }
  if (!familyRow.hasEvidence || !familyRow.results?.length) {
    const radiusLabel = Number.isFinite(radiusMeters)
      ? formatClickDistance(radiusMeters)
      : null;
    const noEvidence = radiusLabel
      ? `No local evidence within ${radiusLabel}`
      : familyRow.summaryLine || 'No local evidence';
    const checked = familyRow.queryState === 'NO_RESULTS' || familyRow.coverageState === 'NO_LOCAL_EVIDENCE'
      ? 'Source checked successfully'
      : null;
    return {
      station: null,
      measurement: null,
      observedAt: null,
      distance: null,
      temporalLabel: null,
      statusMessage: checked ? `${noEvidence} · ${checked}` : noEvidence
    };
  }

  const best = [...familyRow.results].sort(compareResultsByUsefulness)[0];
  const card = buildPointIntelligenceResultPresentation(best, family);
  const observedAt = formatObservationTimestamp(observationTimestamp(best));
  const distance = formatClickDistance(best?.clickDistanceMeters);
  const measurement = extractPrimaryMeasurementLine(best, family)
    || card.lines.find((line) => line
      && !/^Observed/i.test(line)
      && !/^Source:/i.test(line)
      && !/ away$/.test(line)
      && !/^(Near|Recent|Historical)/i.test(line))
    || null;
  return {
    station: card.title || extractStationTitle(best, family),
    measurement,
    observedAt: observedAt ? `Observed ${observedAt}` : null,
    distance: distance ? `${distance} away` : null,
    temporalLabel: card.honestyLabel || formatTemporalClassificationLabel(best?.temporalClassification),
    statusMessage: null
  };
}

function formatObservationLine(observation) {
  if (!observation || observation.value == null) return null;
  const label = ({
    air_temp: 'Temperature',
    avg_air_temp_pst1hr: 'Temperature (1 hr avg)',
    rel_hum: 'Humidity',
    stn_pres: 'Pressure',
    temperature: 'Temperature',
    TEMP: 'Temperature',
    aqhi: 'AQHI',
    LEVEL: 'Water level',
    DISCHARGE: 'Discharge'
  })[observation.property] || observation.property?.replace(/_/g, ' ') || 'Measurement';

  const unit = observation.unit === 'C' ? '°C'
    : observation.unit === 'AQHI' ? 'AQHI'
      : observation.unit ? observation.unit : '';
  const value = formatMeasurement(observation.value, unit);
  return value ? `${label}: ${value}` : null;
}

function basePresentation(result, family, title, honestyLabel, footnote = null) {
  const provider = result?.providerName || 'MSC GeoMet';
  const distance = formatClickDistance(result?.clickDistanceMeters);
  const lines = [];
  if (distance) lines.push(`${distance} away`);
  return {
    family,
    title,
    lines,
    honestyLabel,
    footnote: footnote || `Source: ${provider}`,
    nativeRecordId: result?.nativeRecordId || null,
    observationDate: null,
    temporalClassification: result?.temporalClassification || null
  };
}

function propsOf(result) {
  return resolveResultProperties(result);
}

export function buildHydrometricPresentation(result) {
  const props = propsOf(result);
  const title = String(
    props.STATION_NAME
    || stationLabelFromNativeRecordId(result?.nativeRecordId, 'hydrometric')
    || 'Hydrometric station'
  ).trim();
  const stationId = props.STATION_NUMBER || props.IDENTIFIER || null;
  const status = formatStationStatus(props.STATUS_EN || props.STATUS_FR);
  const contributor = props.CONTRIBUTOR_EN || props.CONTRIBUTOR_FR || null;
  const drainage = formatDrainageArea(props.DRAINAGE_AREA_GROSS);
  const card = basePresentation(
    result,
    'hydrometric',
    title,
    'Hydrometric station registry',
    'No water-level or flow observation is included in this currently verified capability.'
  );
  const lines = [];
  if (stationId) lines.push(`Station ${stationId}`);
  if (status) lines.push(`Status: ${status}`);
  if (contributor) lines.push(`Contributor: ${contributor}`);
  if (drainage) lines.push(`Drainage area: ${drainage}`);
  if (props.REAL_TIME === 1 || props.REAL_TIME === '1') {
    lines.push('Real-time capable station (registry metadata only)');
  }
  card.lines = [...lines, ...card.lines];
  card.nativeRecordId = result?.nativeRecordId || stationId || null;
  return card;
}

export function buildClimatePresentation(result) {
  const props = propsOf(result);
  const title = String(
    props.STATION_NAME
    || stationLabelFromNativeRecordId(result?.nativeRecordId, 'climate')
    || 'Climate station'
  ).trim();
  const observationDate = formatClimateObservationDate(
    props.LOCAL_DATE || result?.temporal?.LOCAL_DATE
  );
  const card = basePresentation(
    result,
    'climate',
    title,
    formatTemporalClassificationLabel(result?.temporalClassification) || 'Historical'
  );
  const measurements = [];
  const mean = formatMeasurement(props.MEAN_TEMPERATURE, '°C');
  const min = formatMeasurement(props.MIN_TEMPERATURE, '°C');
  const max = formatMeasurement(props.MAX_TEMPERATURE, '°C');
  const precip = formatMeasurement(props.TOTAL_PRECIPITATION, 'mm');
  const rain = formatMeasurement(props.TOTAL_RAIN, 'mm');
  const snow = formatMeasurement(props.TOTAL_SNOW, 'cm');
  if (mean) measurements.push(`Mean: ${mean}`);
  if (min && max) measurements.push(`Min: ${min} · Max: ${max}`);
  else if (min) measurements.push(`Min: ${min}`);
  else if (max) measurements.push(`Max: ${max}`);
  if (precip) measurements.push(`Precipitation: ${precip}`);
  if (rain) measurements.push(`Rain: ${rain}`);
  if (snow) measurements.push(`Snow: ${snow}`);
  const lines = [];
  if (observationDate) lines.push(observationDate);
  lines.push(...measurements);
  card.lines = [...lines, ...card.lines];
  card.nativeRecordId = result?.nativeRecordId || props.ID || props.CLIMATE_IDENTIFIER || null;
  card.observationDate = observationDate;
  return card;
}

export function buildWeatherPresentation(result) {
  const props = propsOf(result);
  const title = String(
    props['station-name-value']
    || props.station_name
    || props.STATION_NAME
    || 'Weather station'
  ).trim();
  const observedAt = formatObservationTimestamp(
    result?.observation?.observedAt || props['date_tm-value'] || result?.temporal?.['date_tm-value']
  );
  const card = basePresentation(
    result,
    'weather',
    title,
    formatTemporalClassificationLabel(result?.temporalClassification) || 'Near real-time'
  );
  const lines = [];
  if (observedAt) lines.push(`Observed ${observedAt}`);
  const observationLine = formatObservationLine(result?.observation);
  if (observationLine) lines.push(observationLine);
  const windSpeed = formatMeasurement(props['wind_spd_scal-value'], props['wind_spd_scal-value-uom'] || 'km/h');
  const windDir = props['wind_dir_10_min-value'] ?? props['wind_dir-value'];
  if (windSpeed && windDir != null) lines.push(`Wind: ${windSpeed} ${windDir}°`);
  else if (windSpeed) lines.push(`Wind: ${windSpeed}`);
  card.lines = [...lines, ...card.lines];
  card.observationDate = observedAt;
  return card;
}

export function buildWeatherCurrentPresentation(result) {
  const props = propsOf(result);
  const title = String(
    props.name?.en
    || props.name
    || props.city
    || 'Current weather location'
  ).trim();
  const observedAt = formatObservationTimestamp(
    result?.observation?.observedAt || props.lastUpdated || result?.temporal?.lastUpdated
  );
  const card = basePresentation(
    result,
    'weather-current',
    title,
    formatTemporalClassificationLabel(result?.temporalClassification) || 'Near real-time'
  );
  const lines = [];
  if (observedAt) lines.push(`Observed ${observedAt}`);
  const observationLine = formatObservationLine(result?.observation);
  if (observationLine) lines.push(observationLine);
  if (result?.spatialPrecision && result.spatialPrecision !== 'SOURCE_POINT') {
    lines.push(`Spatial precision: ${result.spatialPrecision.replace(/_/g, ' ').toLowerCase()}`);
  }
  card.lines = [...lines, ...card.lines];
  card.observationDate = observedAt;
  return card;
}

export function buildClimateHourlyPresentation(result) {
  const props = propsOf(result);
  const title = String(
    props.STATION_NAME
    || stationLabelFromNativeRecordId(result?.nativeRecordId, 'climate-hourly')
    || 'Climate station'
  ).trim();
  const observedAt = formatObservationTimestamp(
    props.LOCAL_DATE || result?.temporal?.LOCAL_DATE || result?.observation?.observedAt
  );
  const card = basePresentation(
    result,
    'climate-hourly',
    title,
    formatTemporalClassificationLabel(result?.temporalClassification) || 'Recent'
  );
  const lines = [];
  if (observedAt) lines.push(`Observed ${observedAt}`);
  const observationLine = formatObservationLine(result?.observation);
  if (observationLine) lines.push(observationLine);
  card.lines = [...lines, ...card.lines];
  card.observationDate = observedAt;
  return card;
}

export function buildAirQualityPresentation(result) {
  const props = propsOf(result);
  const title = String(
    props.location_name_en
    || props.location_name
    || props.station_name
    || 'Air quality station'
  ).trim();
  const observedAt = formatObservationTimestamp(
    result?.observation?.observedAt || props.observation_datetime || result?.temporal?.observation_datetime
  );
  const card = basePresentation(
    result,
    'air-quality',
    title,
    formatTemporalClassificationLabel(result?.temporalClassification) || 'Near real-time'
  );
  const lines = [];
  if (observedAt) lines.push(`Observed ${observedAt}`);
  const observationLine = formatObservationLine(result?.observation);
  if (observationLine) lines.push(observationLine);
  card.lines = [...lines, ...card.lines];
  card.observationDate = observedAt;
  return card;
}

export function buildHydrometricMeasurementPresentation(result) {
  const props = propsOf(result);
  const title = String(
    props.STATION_NAME
    || stationLabelFromNativeRecordId(result?.nativeRecordId, 'hydrometric-measurement')
    || 'Hydrometric station'
  ).trim();
  const waterbody = props.WATERBODY_EN || props.WATERBODY_FR || null;
  const stationId = props.STATION_NUMBER || props.IDENTIFIER || null;
  const observedAt = formatObservationTimestamp(
    result?.observation?.observedAt || props.DATETIME || props.DATETIME_LST || result?.temporal?.DATETIME
  );
  const card = basePresentation(
    result,
    'hydrometric-measurement',
    title,
    formatTemporalClassificationLabel(result?.temporalClassification) || 'Near real-time'
  );
  const lines = [];
  if (waterbody) lines.push(`Waterbody: ${waterbody}`);
  if (stationId) lines.push(`Station ${stationId}`);
  if (observedAt) lines.push(`Observed ${observedAt}`);
  const observationLine = formatObservationLine(result?.observation);
  if (observationLine) lines.push(observationLine);
  card.lines = [...lines, ...card.lines];
  card.nativeRecordId = result?.nativeRecordId || stationId || null;
  card.observationDate = observedAt;
  return card;
}

const PRESENTATION_BUILDERS = Object.freeze({
  [POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC]: buildHydrometricPresentation,
  [POINT_INTELLIGENCE_FAMILIES.CLIMATE]: buildClimatePresentation,
  [POINT_INTELLIGENCE_FAMILIES.WEATHER]: buildWeatherPresentation,
  [POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT]: buildWeatherCurrentPresentation,
  [POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY]: buildClimateHourlyPresentation,
  [POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY]: buildAirQualityPresentation,
  [POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT]: buildHydrometricMeasurementPresentation
});

export function buildPointIntelligenceResultPresentation(result, family = null) {
  const resolvedFamily = resolvePresentationFamily(result, family);
  const normalized = normalizeResultForPresentation(result, family);
  const builder = PRESENTATION_BUILDERS[resolvedFamily];
  if (builder) return builder(normalized);
  const observedAt = formatObservationTimestamp(observationTimestamp(normalized));
  return {
    family: resolvedFamily === 'unknown' ? 'unknown' : resolvedFamily,
    title: extractStationTitle(normalized, resolvedFamily),
    lines: [
      extractPrimaryMeasurementLine(normalized, resolvedFamily),
      observedAt ? `Observed ${observedAt}` : null,
      formatClickDistance(normalized?.clickDistanceMeters)
        ? `${formatClickDistance(normalized.clickDistanceMeters)} away`
        : null
    ].filter(Boolean),
    honestyLabel: formatTemporalClassificationLabel(normalized?.temporalClassification),
    footnote: normalized?.providerName ? `Source: ${normalized.providerName}` : null,
    nativeRecordId: normalized?.nativeRecordId || null,
    observationDate: observedAt,
    temporalClassification: normalized?.temporalClassification || null
  };
}

function familyDisplayLabel(family) {
  return ({
    hydrometric: 'HYDROMETRIC · STATION REGISTRY',
    climate: 'CLIMATE · DAILY',
    weather: 'WEATHER',
    'weather-current': 'CURRENT WEATHER',
    'climate-hourly': 'CLIMATE · HOURLY',
    'air-quality': 'AIR QUALITY',
    'hydrometric-measurement': 'HYDROMETRIC · MEASUREMENT'
  })[family] || family.toUpperCase();
}

export function renderPointIntelligenceResultCardHtml(result, family = null) {
  const card = buildPointIntelligenceResultPresentation(result, family);
  const observationId = getObservationId(result);
  const measurement = extractPrimaryMeasurementLine(result, card.family);
  const linesHtml = card.lines.map((line) => (
    `<div class="pi-result-card__line">${escapeHtml(line)}</div>`
  )).join('');

  return `
    <article class="pi-result-card lif-observation" role="button" tabindex="0"
      data-pi-observation-id="${escapeHtml(observationId)}"
      data-pi-family="${escapeHtml(card.family)}"
      ${card.nativeRecordId ? `data-pi-native-record-id="${escapeHtml(card.nativeRecordId)}"` : ''}>
      <div class="pi-result-card__family">${escapeHtml(familyDisplayLabel(card.family))}</div>
      <div class="pi-result-card__title">${escapeHtml(card.title)}</div>
      ${measurement ? `<div class="pi-result-card__measurement">${escapeHtml(measurement)}</div>` : ''}
      ${linesHtml}
      ${card.honestyLabel ? `<div class="pi-result-card__honesty">${escapeHtml(card.honestyLabel)}</div>` : ''}
      ${card.footnote ? `<div class="pi-result-card__footnote">${escapeHtml(card.footnote)}</div>` : ''}
      <div class="pi-result-card__actions">
        <button type="button" class="lif-inspect-btn" data-pi-inspect-evidence
          data-pi-observation-id="${escapeHtml(observationId)}"
          data-pi-family="${escapeHtml(card.family)}">Inspect evidence</button>
      </div>
    </article>`;
}

function renderFamilyPreviewHtml(familyRow, radiusMeters = null) {
  const preview = buildFamilyEvidencePreview(familyRow, radiusMeters);
  if (preview.statusMessage) {
    return `<div class="lif-family__preview lif-family__preview--status">${escapeHtml(preview.statusMessage)}</div>`;
  }
  const metaBits = [preview.observedAt, preview.distance, preview.temporalLabel].filter(Boolean);
  return `
    <div class="lif-family__preview">
      ${preview.station ? `<div class="lif-preview__station">${escapeHtml(preview.station)}</div>` : ''}
      ${preview.measurement ? `<div class="lif-preview__measurement">${escapeHtml(preview.measurement)}</div>` : ''}
      ${metaBits.length ? `<div class="lif-preview__meta">${escapeHtml(metaBits.join(' · '))}</div>` : ''}
    </div>`;
}

function renderStationGroupHtml(group, family) {
  const latest = group.latest;
  const latestCard = buildPointIntelligenceResultPresentation(latest, family);
  const measurement = extractPrimaryMeasurementLine(latest, family)
    || latestCard.lines.find((line) => !/away$|^Observed|^Source:/i.test(line))
    || null;
  const observedAt = formatObservationTimestamp(observationTimestamp(latest));
  const distance = formatClickDistance(latest?.clickDistanceMeters);
  const countLabel = `${group.results.length} observation${group.results.length === 1 ? '' : 's'}`;
  const observationsHtml = group.results.length > 1
    ? `
      <details class="lif-station-group__observations">
        <summary class="lif-station-group__toggle">View observations</summary>
        <div class="lif-station-group__list">
          ${group.results.map((result) => renderPointIntelligenceResultCardHtml(result, family)).join('')}
        </div>
      </details>`
    : renderPointIntelligenceResultCardHtml(latest, family);

  return `
    <section class="lif-station-group" data-pi-asset-key="${escapeHtml(group.assetKey)}">
      <header class="lif-station-group__header">
        <div class="lif-station-group__title">${escapeHtml(group.title)}</div>
        <div class="lif-station-group__count">${escapeHtml(countLabel)}</div>
      </header>
      ${group.results.length > 1 ? `
        <div class="lif-station-group__latest">
          <div class="lif-station-group__latest-label">Latest</div>
          ${measurement ? `<div class="lif-station-group__measurement">${escapeHtml(measurement)}</div>` : ''}
          <div class="lif-station-group__meta">
            ${[
              observedAt ? `Observed ${observedAt}` : null,
              distance ? `${distance} away` : null,
              latestCard.honestyLabel
            ].filter(Boolean).map((bit) => escapeHtml(bit)).join(' · ')}
          </div>
        </div>` : ''}
      ${observationsHtml}
    </section>`;
}

function formatUxBanner(presentation) {
  switch (presentation?.ux) {
    case 'LOADING': return 'POINT INTELLIGENCE LOADING';
    case 'READY': return 'POINT INTELLIGENCE READY';
    case 'PARTIAL': return 'PARTIAL DATA';
    case 'NO_DATA': return 'NO DATA AVAILABLE';
    case 'FAILURE': return 'SYSTEM FAILURE';
    default: return '';
  }
}

function renderCoverageIcon(state) {
  switch (state) {
    case 'EVIDENCE': return '◆';
    case 'NO_LOCAL_EVIDENCE': return '○';
    case 'NOT_APPLICABLE': return '—';
    case 'PROVIDER_ISSUE': return '!';
    default: return '·';
  }
}

function renderTemporalMixChips(temporalMix) {
  if (!temporalMix?.length) return '';
  return temporalMix.map((entry) => (
    `<span class="lif-chip lif-chip--temporal" data-temporal="${escapeHtml(entry.key)}">`
    + `${escapeHtml(entry.label)} <span class="lif-chip__count">${entry.count}</span>`
    + '</span>'
  )).join('');
}

function renderCoverageStrip(rows) {
  return rows.map((row) => (
    `<div class="lif-coverage-item lif-coverage-item--${row.coverageState.toLowerCase().replace(/_/g, '-')}" `
    + `data-pi-family="${escapeHtml(row.informationFamily)}" data-coverage="${escapeHtml(row.coverageState)}">`
    + `<span class="lif-coverage-item__icon" aria-hidden="true">${renderCoverageIcon(row.coverageState)}</span>`
    + `<span class="lif-coverage-item__label">${escapeHtml(row.label)}</span>`
    + `<span class="lif-coverage-item__state">${escapeHtml(row.operatorStatus || row.coverageLabel)}</span>`
    + '</div>'
  )).join('');
}

function renderLocationFacts(facts) {
  if (!facts?.length) return '';
  return `
    <section class="lif-facts" aria-label="Location facts">
      <h4 class="lif-section-title">Location facts</h4>
      <dl class="lif-facts__list">
        ${facts.map((fact, index) => `
          <div class="lif-fact${fact.focusable ? ' lif-fact--focusable' : ''}"
            data-fact-kind="${escapeHtml(fact.kind)}"
            ${fact.focusable ? `data-pi-fact-index="${index}" role="button" tabindex="0"` : ''}>
            <dt>${escapeHtml(fact.label)}</dt>
            <dd>${escapeHtml(fact.text)}</dd>
          </div>`).join('')}
      </dl>
    </section>`;
}

function renderFamilyObservations(familyRow) {
  if (!familyRow.hasEvidence || !familyRow.results?.length) {
    return `<div class="lif-family-empty">${escapeHtml(familyRow.summaryLine)}</div>`;
  }
  const groups = groupResultsByAuthoritativeStation(familyRow.results, familyRow.informationFamily);
  if (groups.length <= 1 && (groups[0]?.results?.length || 0) <= 1) {
    return familyRow.results.map((result) => (
      renderPointIntelligenceResultCardHtml(result, familyRow.informationFamily)
    )).join('');
  }
  return groups.map((group) => (
    renderStationGroupHtml(group, familyRow.informationFamily)
  )).join('');
}

function renderFamilyEvidenceCards(rows, radiusMeters) {
  return rows.map((row) => `
    <article class="lif-evidence-card" data-pi-family="${escapeHtml(row.informationFamily)}" data-coverage="${escapeHtml(row.coverageState)}">
      <div class="lif-evidence-card__label">${escapeHtml(row.label)}</div>
      ${renderFamilyPreviewHtml(row, radiusMeters)}
    </article>`).join('');
}

function renderDomainSection(domain, radiusMeters) {
  const familiesHtml = domain.families.map((row) => {
    const openAttr = row.hasEvidence ? ' open' : '';
    return `
      <details class="lif-family" data-pi-family="${escapeHtml(row.informationFamily)}" data-coverage="${escapeHtml(row.coverageState)}"${openAttr}>
        <summary class="lif-family__summary">
          <span class="lif-family__icon" aria-hidden="true">${renderCoverageIcon(row.coverageState)}</span>
          <span class="lif-family__label">${escapeHtml(row.label)}</span>
          ${renderFamilyPreviewHtml(row, radiusMeters)}
        </summary>
        <div class="lif-family__body">
          ${row.queryReceiptId ? `<div class="lif-family__receipt">
            <button type="button" class="lif-inspect-btn lif-inspect-btn--receipt" data-pi-inspect-receipt
              data-pi-family="${escapeHtml(row.informationFamily)}"
              data-pi-receipt-id="${escapeHtml(row.queryReceiptId)}">Query receipt</button>
          </div>` : ''}
          ${renderFamilyObservations(row)}
        </div>
      </details>`;
  }).join('');

  return `
    <section class="lif-domain" data-domain="${escapeHtml(domain.id)}">
      <h4 class="lif-domain__title">${escapeHtml(domain.label)}</h4>
      <div class="lif-domain__meta">${domain.evidenceCount} of ${domain.familyCount} with evidence</div>
      ${familiesHtml}
    </section>`;
}

function renderLocationIntelligenceFocus(response, point, presentation) {
  const model = buildLocationIntelligenceFocusModel(response, point);
  const { summary, coverage, facts, location } = model;
  const state = summary.bundleState;
  const severityClass = summary.healthyPartial || state === 'SUCCESS'
    ? 'lif--healthy'
    : summary.familiesWithProviderIssues > 0
      ? 'lif--warning'
      : '';

  const temporalHtml = renderTemporalMixChips(summary.temporalMix);
  const timeLens = formatTemporalStateSummary(getPointIntelligenceTemporalState());
  const timeLensHtml = `
    <div class="lif-time-lens" data-pi-time-lens-echo aria-label="Time Lens">
      <span class="lif-time-lens__headline">${escapeHtml(timeLens.headline)}</span>
      <span class="lif-time-lens__detail">${escapeHtml(timeLens.detail)}</span>
    </div>`;
  const radiusMeters = location.radiusMeters;
  const radiusLabel = Number.isFinite(radiusMeters)
    ? formatClickDistance(radiusMeters)
    : String(radiusMeters || '');
  const hasProofStations = (response?.results || []).some((result) => (
    isProofSourceFamily(result?.category || result?.nativeCollectionId)
  ));
  const synthesisModel = buildLocationSynthesisModel(response, point, { radiusMeters });
  const synthesisHtml = renderLocationSynthesisHtml(synthesisModel);

  return `
    <div class="lif ${severityClass}" data-state="${escapeHtml(state)}">
      <header class="lif-header">
        <h3 class="lif-header__title">Point Intelligence</h3>
        ${formatUxBanner(presentation) ? `<div class="lif-header__ux">${escapeHtml(formatUxBanner(presentation))}</div>` : ''}
        <div class="lif-anchor">
          ${location.label ? `<div class="lif-anchor__coords">${escapeHtml(location.label)}</div>` : ''}
          <div class="lif-anchor__context">${escapeHtml(
            response?.acquisition?.mode === 'AUTO'
              ? 'Evidence acquisition'
              : response?.acquisition?.mode === 'AREA'
                ? 'Area acquisition'
                : `${radiusLabel} radius`
          )}</div>
          <div class="slc-action-host" data-slc-action-host></div>
        </div>
        ${timeLensHtml}
      </header>

      <section class="lif-summary" aria-label="Bundle summary">
        <p class="lif-summary__headline">${escapeHtml(summary.evidenceSummary)}</p>
        ${presentation?.message && presentation.message !== summary.evidenceSummary
          ? `<p class="lif-summary__status">${escapeHtml(presentation.message)}</p>` : ''}
        ${renderAcquisitionSummaryHtml(response?.acquisition?.summary)}
        ${temporalHtml ? `<div class="lif-temporal-mix" aria-label="Temporal mix">${temporalHtml}</div>` : ''}
        <div class="lif-map-toolbar">
          <div class="lif-map-accounting" data-pi-map-accounting hidden></div>
          <div class="pi-station-legend-host" data-pi-station-legend>${hasProofStations ? renderProofLegendHtml() : ''}</div>
          <button type="button" class="lif-clear-focus" data-pi-clear-focus hidden>All evidence</button>
        </div>
        <div class="lif-non-spatial" data-pi-non-spatial-message hidden role="status"></div>
      </section>

      ${synthesisHtml}

      <section class="lif-evidence-preview" aria-label="Location evidence">
        <div class="lif-evidence-preview__grid">${renderFamilyEvidenceCards(coverage.rows, radiusMeters)}</div>
      </section>

      <section class="lif-coverage lif-coverage--compact" aria-label="Family coverage">
        <h4 class="lif-section-title">Coverage</h4>
        <div class="lif-coverage__strip">${renderCoverageStrip(coverage.rows)}</div>
      </section>

      ${renderLocationFacts(facts)}

      <section class="lif-domains lif-inspector-target" aria-label="Intelligence by domain">
        <h4 class="lif-section-title">Families</h4>
        ${coverage.domains.map((domain) => renderDomainSection(domain, radiusMeters)).join('')}
      </section>
      ${renderStreetLevelContextHostHtml()}
      ${renderInspectorHostHtml()}
    </div>`;
}

function renderMultiFamilySummary(response, point, presentation) {
  return renderLocationIntelligenceFocus(response, point, presentation);
}

export { buildLocationIntelligenceFocusModel, deriveCoverageState } from './point-intelligence-lif-model.js';
export {
  buildLocationSynthesisModel,
  collectSynthesisMeasurements,
  LOCATION_SYNTHESIS_RULES,
  renderLocationSynthesisHtml
} from './point-intelligence-location-synthesis.js';

export function buildPointIntelligenceSummaryHtml(payload = {}) {
  const { point, response, presentation } = payload;
  if (!response) {
    return '<p class="detail-muted">No Point Intelligence query yet.</p>';
  }

  if (response.queryState === 'QUERYING' || response.bundleState === 'QUERYING' || presentation?.ux === 'LOADING') {
    return `
      <div class="pi-summary" data-state="QUERYING">
        <header class="pi-summary__header">
          <h3 class="pi-summary__title">Point Intelligence</h3>
          <div class="pi-summary__status">POINT INTELLIGENCE LOADING</div>
        </header>
        <p class="detail-muted">Querying source intelligence…</p>
      </div>`;
  }

  if (isMultiFamilyPointIntelligenceResponse(response)) {
    return renderMultiFamilySummary(response, point, presentation);
  }

  const summary = response.summary || {};
  const state = response.queryState || presentation?.state || 'ERROR';
  const message = presentation?.message || state;
  const results = Array.isArray(response.results) ? response.results : [];
  const family = summary.informationFamily || response.request?.informationFamily || '—';
  const provider = summary.providerName || results[0]?.providerName || '—';
  const receipt = summary.queryReceiptId || response.queryReceiptId || '—';
  const resultCount = summary.resultCount ?? response.resultCount ?? results.length ?? 0;
  const lat = point?.latitude ?? point?.lat ?? summary.clickedCoordinates?.[1];
  const lon = point?.longitude ?? point?.lon ?? summary.clickedCoordinates?.[0];
  const coordsLabel = Number.isFinite(lat) && Number.isFinite(lon)
    ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
    : '—';

  const resultCards = results.map((result) => (
    renderPointIntelligenceResultCardHtml(result, family)
  )).join('');
  const synthesisHtml = renderLocationSynthesisHtml(
    buildSingleFamilySynthesisModel(response, family, results, { latitude: lat, longitude: lon })
  );

  return `
    <div class="pi-summary" data-state="${escapeHtml(state)}">
      <header class="pi-summary__header">
        <h3 class="pi-summary__title">Point Intelligence</h3>
        <div class="pi-summary__coords">${escapeHtml(coordsLabel)}</div>
        <div class="pi-summary__status">${escapeHtml(message)}</div>
      </header>
      ${synthesisHtml}
      ${resultCards ? `<div class="pi-summary__results">${resultCards}</div>` : ''}
      ${receipt && receipt !== '—' ? `<div class="pi-summary__receipt">
        <button type="button" class="lif-inspect-btn lif-inspect-btn--receipt" data-pi-inspect-receipt
          data-pi-family="${escapeHtml(String(family))}"
          data-pi-receipt-id="${escapeHtml(String(receipt))}">Query receipt</button>
      </div>` : ''}
    </div>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderAcquisitionSummaryHtml(summary) {
  if (!summary || !Number.isFinite(summary.stationCount)) return '';
  const freshness = summary.freshness || {};
  if (summary.kind === 'EVIDENCE') {
    return `
    <div class="pi-acquisition-summary" aria-label="Evidence acquisition">
      <div class="pi-acquisition-summary__title">EVIDENCE ACQUISITION</div>
      ${summary.originLabel ? `<div class="pi-acquisition-summary__line">ORIGIN ${escapeHtml(summary.originLabel)}</div>` : ''}
      <dl class="pi-acquisition-summary__grid pi-acquisition-summary__grid--evidence">
        <div><dt>PHYSICAL STATIONS</dt><dd>${summary.stationCount ?? 0}</dd></div>
        <div><dt>INFORMATION FAMILIES</dt><dd>${summary.familyCount ?? 0}</dd></div>
        <div><dt>WEATHER</dt><dd>${summary.weatherStationCount ?? 0}</dd></div>
        <div><dt>HYDROMETRIC</dt><dd>${summary.hydrometricStationCount ?? 0}</dd></div>
        <div><dt>AIR QUALITY</dt><dd>${summary.airQualityStationCount ?? 0}</dd></div>
        <div><dt>CLIMATE</dt><dd>${summary.climateStationCount ?? 0}</dd></div>
      </dl>
      ${summary.farthestEvidenceLabel ? `<div class="pi-acquisition-summary__line">FARTHEST EVIDENCE ${escapeHtml(summary.farthestEvidenceLabel)}</div>` : ''}
    </div>`;
  }
  return `
    <div class="pi-acquisition-summary" aria-label="Sensor acquisition">
      <div class="pi-acquisition-summary__title">SENSOR ACQUISITION</div>
      <div class="pi-acquisition-summary__line">${summary.stationCount} stations · ${summary.familyCount} sensor families</div>
      <dl class="pi-acquisition-summary__grid">
        <div><dt>INSIDE</dt><dd>${summary.insideCount ?? 0}</dd></div>
        <div><dt>SUPPORTING</dt><dd>${summary.supportingCount ?? 0}</dd></div>
        <div><dt>CURRENT</dt><dd>${freshness.CURRENT ?? 0}</dd></div>
        <div><dt>RECENT</dt><dd>${freshness.RECENT ?? 0}</dd></div>
        <div><dt>STALE</dt><dd>${freshness.STALE ?? 0}</dd></div>
      </dl>
    </div>`;
}
