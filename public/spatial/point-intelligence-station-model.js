/**
 * Point Intelligence visual proof 1 — hydrometric + SWOB station collapse.
 * Presentation model only. Does not alter canonical bundle evidence.
 */
import { getObservationId } from './point-intelligence-map-presentation.js';
import { AOI_CLASS, formatAoiDistanceLabel } from './point-intelligence-aoi-geometry.js';

export const PI_PROOF_VISUAL_FAMILIES = Object.freeze({
  HYDROMETRIC: 'hydrometric',
  WEATHER: 'weather'
});

export const PI_PROOF_SOURCE_FAMILIES = Object.freeze([
  'hydrometric',
  'hydrometric-measurement',
  'weather'
]);

export const FRESHNESS_CLASS = Object.freeze({
  CURRENT: 'CURRENT',
  RECENT: 'RECENT',
  STALE: 'STALE',
  REGISTRY: 'REGISTRY'
});

/** Family-specific age thresholds for NEAR_REAL_TIME observations (seconds). */
export const FRESHNESS_POLICY = Object.freeze({
  hydrometric: { currentSeconds: 30 * 60, recentSeconds: 3 * 60 * 60 },
  weather: { currentSeconds: 15 * 60, recentSeconds: 60 * 60 }
});

export function isProofSourceFamily(family) {
  return PI_PROOF_SOURCE_FAMILIES.includes(String(family || ''));
}

export function visualFamilyForSource(family) {
  if (family === 'hydrometric' || family === 'hydrometric-measurement') {
    return PI_PROOF_VISUAL_FAMILIES.HYDROMETRIC;
  }
  if (family === 'weather') return PI_PROOF_VISUAL_FAMILIES.WEATHER;
  return null;
}

function propsOf(result) {
  return result?.properties && typeof result.properties === 'object' ? result.properties : {};
}

function parseTime(value) {
  if (value == null || value === '') return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function observationTimestampMs(result) {
  return parseTime(
    result?.observation?.observedAt
    || result?.temporal?.DATETIME
    || result?.temporal?.['date_tm-value']
    || result?.temporal?.lastUpdated
    || result?.properties?.DATETIME
    || result?.properties?.['date_tm-value']
  );
}

export function hydrometricStationId(result) {
  const props = propsOf(result);
  const id = props.STATION_NUMBER || props.IDENTIFIER || props.station_id || null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

export function swobStationId(result) {
  const props = propsOf(result);
  const id = props['tc_id-value']
    || props.tc_id
    || props['stn_id-value']
    || props.stn_id
    || props['clim_id-value']
    || props.clim_id
    || null;
  if (id != null && String(id).trim()) return String(id).trim();
  const name = props['stn_nam-value'] || props.stn_nam || props.STATION_NAME;
  const coords = result?.geometry?.coordinates;
  if (name && Array.isArray(coords) && coords.length >= 2) {
    return `${String(name).trim()}:${Number(coords[0]).toFixed(4)},${Number(coords[1]).toFixed(4)}`;
  }
  return null;
}

export function proofStationAssetKey(result) {
  const family = result?.category || result?.nativeCollectionId;
  const visual = visualFamilyForSource(family);
  if (visual === PI_PROOF_VISUAL_FAMILIES.HYDROMETRIC) {
    const id = hydrometricStationId(result);
    return id ? `hydro:${id}` : null;
  }
  if (visual === PI_PROOF_VISUAL_FAMILIES.WEATHER) {
    const id = swobStationId(result);
    return id ? `swob:${id}` : null;
  }
  return null;
}

function pointCoords(result) {
  const coords = result?.geometry?.type === 'Point' ? result.geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { longitude: lon, latitude: lat };
}

function stationDisplayName(result, stationId) {
  const props = propsOf(result);
  return props.STATION_NAME
    || props['stn_nam-value']
    || props.stn_nam
    || (typeof props.name === 'object' ? (props.name.en || props.name.fr) : props.name)
    || stationId
    || null;
}

function classifyFreshness(visualFamily, ageSeconds, hasLiveMeasurement) {
  if (!hasLiveMeasurement) return FRESHNESS_CLASS.REGISTRY;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return FRESHNESS_CLASS.STALE;
  const policy = FRESHNESS_POLICY[visualFamily];
  if (!policy) return FRESHNESS_CLASS.STALE;
  if (ageSeconds <= policy.currentSeconds) return FRESHNESS_CLASS.CURRENT;
  if (ageSeconds <= policy.recentSeconds) return FRESHNESS_CLASS.RECENT;
  return FRESHNESS_CLASS.STALE;
}

function numericObservation(result, property) {
  const obs = result?.observation;
  if (obs?.property === property && obs.value != null && Number.isFinite(Number(obs.value))) {
    return { value: Number(obs.value), unit: obs.unit || null, observedAt: obs.observedAt || null };
  }
  const props = propsOf(result);
  if (props[property] != null && Number.isFinite(Number(props[property]))) {
    return {
      value: Number(props[property]),
      unit: property === 'LEVEL' ? 'm' : property === 'DISCHARGE' ? 'm3/s' : null,
      observedAt: result?.observation?.observedAt || result?.temporal?.DATETIME || null
    };
  }
  return null;
}

/**
 * Trend only when ≥2 chronological observations of the same property exist.
 * @returns {object | null}
 */
export function computeDeterministicTrend(series = []) {
  const clean = series
    .filter((row) => Number.isFinite(row?.t) && Number.isFinite(row?.v))
    .sort((a, b) => a.t - b.t);
  if (clean.length < 2) return null;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const windowHours = (last.t - first.t) / 3600000;
  if (!(windowHours > 0.05)) return null;
  const delta = last.v - first.v;
  return {
    property: first.property || last.property || null,
    unit: first.unit || last.unit || null,
    startValue: first.v,
    endValue: last.v,
    startTime: new Date(first.t).toISOString(),
    endTime: new Date(last.t).toISOString(),
    windowHours,
    delta,
    perHour: delta / windowHours
  };
}

function hydroPrimary(groupResults) {
  const measurements = groupResults.filter((r) => r.category === 'hydrometric-measurement'
    || r.nativeCollectionId === 'hydrometric-realtime');
  const ranked = [...measurements].sort((a, b) => (
    (observationTimestampMs(b) || 0) - (observationTimestampMs(a) || 0)
  ));
  for (const result of ranked) {
    const level = numericObservation(result, 'LEVEL');
    if (level) {
      return {
        result,
        property: 'LEVEL',
        label: 'WATER LEVEL',
        value: level.value,
        unit: level.unit === 'm' ? 'm' : (level.unit || 'm'),
        observedAt: level.observedAt
      };
    }
  }
  for (const result of ranked) {
    const discharge = numericObservation(result, 'DISCHARGE');
    if (discharge) {
      return {
        result,
        property: 'DISCHARGE',
        label: 'DISCHARGE',
        value: discharge.value,
        unit: discharge.unit === 'm3/s' ? 'm³/s' : (discharge.unit || 'm³/s'),
        observedAt: discharge.observedAt
      };
    }
  }
  return null;
}

function weatherPrimary(groupResults) {
  const ranked = [...groupResults].sort((a, b) => (
    (observationTimestampMs(b) || 0) - (observationTimestampMs(a) || 0)
  ));
  for (const result of ranked) {
    const obs = result.observation;
    if (obs?.value != null && Number.isFinite(Number(obs.value)) && /temp/i.test(String(obs.property || ''))) {
      const unit = obs.unit === 'C' || obs.unit === '°C' ? '°C' : (obs.unit || '°C');
      return {
        result,
        property: obs.property,
        label: 'TEMPERATURE',
        value: Number(obs.value),
        unit,
        observedAt: obs.observedAt
      };
    }
    const props = propsOf(result);
    const temp = props.air_temp ?? props['air_temp-value'] ?? props.TEMP;
    if (temp != null && Number.isFinite(Number(temp))) {
      return {
        result,
        property: 'air_temp',
        label: 'TEMPERATURE',
        value: Number(temp),
        unit: '°C',
        observedAt: result.observation?.observedAt || result.temporal?.['date_tm-value']
      };
    }
  }
  return ranked[0] ? {
    result: ranked[0],
    property: null,
    label: null,
    value: null,
    unit: null,
    observedAt: ranked[0].observation?.observedAt || ranked[0].temporal?.['date_tm-value']
  } : null;
}

function windHover(result) {
  const props = propsOf(result);
  const speed = props['wind_spd_scal-value'];
  const dir = props['wind_dir_10_min-value'] ?? props['wind_dir-value'];
  const unit = props['wind_spd_scal-value-uom'] || 'km/h';
  const hasSpeed = Number.isFinite(Number(speed));
  const hasDir = dir != null && dir !== '' && Number.isFinite(Number(dir));
  if (!hasSpeed && !hasDir) return null;
  return {
    speed: hasSpeed ? Number(speed) : null,
    directionDeg: hasDir ? Number(dir) : null,
    unit: hasSpeed ? unit : null
  };
}

/**
 * Collapse hydrometric registry+measurement and SWOB weather into one station record each.
 * @param {object[]} results
 * @param {{ retrievedAt?: string, nowMs?: number }} [options]
 */
export function buildProofStationRecords(results = [], options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const retrievedAt = options.retrievedAt || new Date(nowMs).toISOString();
  /** @type {Map<string, object[]>} */
  const groups = new Map();

  for (const result of results) {
    if (!isProofSourceFamily(result?.category || result?.nativeCollectionId)) continue;
    const assetKey = proofStationAssetKey(result);
    if (!assetKey) continue;
    if (!pointCoords(result) && !groups.has(assetKey)) continue;
    if (!groups.has(assetKey)) groups.set(assetKey, []);
    groups.get(assetKey).push(result);
  }

  const records = [];
  for (const [assetKey, groupResults] of groups) {
    const visualFamily = visualFamilyForSource(groupResults[0].category);
    const coords = groupResults.map(pointCoords).find(Boolean);
    if (!coords) continue;

    const stationId = visualFamily === 'hydrometric'
      ? hydrometricStationId(groupResults[0])
      : swobStationId(groupResults[0]);
    const named = groupResults.find((r) => stationDisplayName(r, stationId));
    const primary = visualFamily === 'hydrometric'
      ? hydroPrimary(groupResults)
      : weatherPrimary(groupResults);

    const liveResult = primary?.result
      || groupResults.find((r) => r.category === 'hydrometric-measurement' || r.category === 'weather')
      || groupResults[0];
    const observedMs = parseTime(primary?.observedAt) || observationTimestampMs(liveResult);
    const hasLiveMeasurement = primary?.value != null;
    const ageSeconds = hasLiveMeasurement && Number.isFinite(observedMs)
      ? Math.max(0, (nowMs - observedMs) / 1000)
      : null;
    const freshnessClass = !hasLiveMeasurement
      ? (visualFamily === 'hydrometric' ? FRESHNESS_CLASS.REGISTRY : FRESHNESS_CLASS.STALE)
      : classifyFreshness(visualFamily, ageSeconds, true);

    const trendSeries = visualFamily === 'hydrometric'
      ? groupResults
        .map((result) => {
          const level = numericObservation(result, 'LEVEL');
          const t = parseTime(level?.observedAt) || observationTimestampMs(result);
          if (!level || !Number.isFinite(t)) return null;
          return { t, v: level.value, unit: level.unit, property: 'LEVEL' };
        })
        .filter(Boolean)
      : [];
    const trend = computeDeterministicTrend(trendSeries);

    const representativeId = getObservationId(liveResult);
    const observationIds = groupResults.map(getObservationId);
    const provenance = liveResult.provenance || {};

    records.push({
      assetKey,
      stationId,
      stationName: stationDisplayName(named || liveResult, stationId),
      family: visualFamily,
      subtype: visualFamily === 'hydrometric'
        ? (hasLiveMeasurement ? 'hydrometric-measurement' : 'hydrometric-registry')
        : 'swob',
      longitude: coords.longitude,
      latitude: coords.latitude,
      primaryValue: primary?.value ?? null,
      primaryUnit: primary?.unit ?? null,
      primaryLabel: primary?.label ?? null,
      observationTime: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
      retrievedTime: liveResult.retrievedAt || retrievedAt,
      ageSeconds,
      freshnessClass,
      rendererKey: liveResult.aoiClassification === 'INSIDE_AOI'
        ? `${visualFamily}-${freshnessClass}-inside`
        : liveResult.aoiClassification === 'SUPPORTING_EXTERNAL'
          ? `${visualFamily}-${freshnessClass}-external`
          : `${visualFamily}-${freshnessClass}`,
      trendValue: trend ? trend.perHour : null,
      trendDelta: trend ? trend.delta : null,
      trendUnit: trend?.unit || null,
      trendWindowHours: trend ? trend.windowHours : null,
      trend: trend || null,
      qualityState: null,
      qualityLabel: null,
      wind: visualFamily === 'weather' ? windHover(liveResult) : null,
      provider: liveResult.providerName || provenance.provider || 'MSC GeoMet',
      dataset: liveResult.nativeCollectionId || provenance.dataset || null,
      sourceUrl: provenance.source || provenance.sourceUrl || null,
      distanceMeters: liveResult.clickDistanceMeters ?? null,
      aoiClassification: liveResult.aoiClassification || null,
      aoiBoundaryDistanceMeters: liveResult.aoiBoundaryDistanceMeters ?? null,
      aoiNearestBoundary: liveResult.aoiNearestBoundary || null,
      lifRecordKey: representativeId,
      observationId: representativeId,
      observationIds,
      sourceFamilies: [...new Set(groupResults.map((r) => r.category).filter(Boolean))]
    });
  }

  records.sort((a, b) => (a.distanceMeters ?? 1e12) - (b.distanceMeters ?? 1e12));
  return records;
}

export function formatAgeLabel(ageSeconds) {
  if (!Number.isFinite(ageSeconds)) return null;
  if (ageSeconds < 60) return `${Math.max(1, Math.round(ageSeconds))} s ago`;
  if (ageSeconds < 3600) return `${Math.round(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) {
    const hours = ageSeconds / 3600;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} h ago`;
  }
  return `${Math.round(ageSeconds / 86400)} d ago`;
}

export function formatProofHoverModel(record) {
  if (!record) return null;
  const lines = [];
  const title = record.stationId || record.stationName || 'Station';
  const familyLabel = record.family === 'hydrometric' ? 'HYDROMETRIC' : 'SWOB WEATHER';
  if (record.primaryValue != null && record.primaryUnit && record.primaryLabel) {
    const value = Number.isInteger(record.primaryValue)
      ? String(record.primaryValue)
      : Number(record.primaryValue).toFixed(Math.abs(record.primaryValue) >= 10 ? 1 : 2);
    lines.push(`${record.primaryLabel} ${value} ${record.primaryUnit}`);
  }
  const age = formatAgeLabel(record.ageSeconds);
  if (age) lines.push(`UPDATED ${age}`);
  if (record.family === 'weather' && record.wind) {
    const bits = [];
    if (record.wind.directionDeg != null) bits.push(`${Math.round(record.wind.directionDeg)}°`);
    if (record.wind.speed != null) bits.push(`${record.wind.speed} ${record.wind.unit || 'km/h'}`);
    if (bits.length) lines.push(`WIND ${bits.join(' · ')}`);
  }
  if (record.trend && record.trendUnit) {
    const sign = record.trend.perHour > 0 ? '+' : '';
    const window = record.trend.windowHours >= 1
      ? `${record.trend.windowHours.toFixed(record.trend.windowHours >= 10 ? 0 : 1)} h`
      : `${Math.round(record.trend.windowHours * 60)} min`;
    lines.push(`TREND ${sign}${record.trend.perHour.toFixed(2)} ${record.trendUnit} / ${window}`);
  }
  if (record.aoiClassification === AOI_CLASS.INSIDE_AOI) {
    lines.push('INSIDE ACQUISITION AREA');
  } else if (record.aoiClassification === AOI_CLASS.SUPPORTING_EXTERNAL) {
    const distance = formatAoiDistanceLabel(record.aoiBoundaryDistanceMeters);
    if (distance) lines.push(`${distance} OUTSIDE AOI`);
    lines.push('SUPPORTING OBSERVATION');
  }
  return {
    title,
    familyLabel,
    freshnessClass: record.freshnessClass,
    lines
  };
}
