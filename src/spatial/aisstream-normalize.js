import {
  AISSTREAM_SOURCE_ID,
  AISSTREAM_SOURCE_NAME,
  AISSTREAM_SOURCE_LICENSE,
  AISSTREAM_SOURCE_URL,
  AIS_POSITION_CURRENT_SECONDS,
  AIS_POSITION_STALE_SECONDS,
  AIS_INVALID_HEADING,
  isWithinMontrealBounds
} from './aisstream-config.js';
import { LIVE_SOURCE_CLASS } from './live-object-types.js';

const NAV_STATUS_LABELS = {
  0: 'Under way using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in fishing',
  8: 'Under way sailing',
  9: 'Reserved (HSC)',
  10: 'Reserved (WIG)',
  11: 'Reserved',
  12: 'Reserved',
  13: 'Reserved',
  14: 'AIS-SART',
  15: 'Not defined'
};

export function getAisStableId(object) {
  return String(object?.liveObjectId || object?.mmsi || '').trim()
    || (object?.sourceObjectId ? `ais:${object.sourceObjectId}` : '');
}

export function numberOrNull(value, invalid = [511, 360]) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (invalid.includes(number)) return null;
  return number;
}

export function resolveVesselHeading(trueHeading, courseOverGround, lastValid = null) {
  const heading = numberOrNull(trueHeading);
  if (heading != null && heading >= 0 && heading <= 360) {
    return { headingDegrees: heading, headingSource: 'trueHeading' };
  }
  const course = numberOrNull(courseOverGround);
  if (course != null && course >= 0 && course <= 360) {
    return { headingDegrees: course, headingSource: 'courseOverGround' };
  }
  if (Number.isFinite(lastValid)) {
    return { headingDegrees: lastValid, headingSource: 'lastValid' };
  }
  return { headingDegrees: null, headingSource: null };
}

export function classifyVesselShipType(shipTypeCode) {
  if (shipTypeCode == null || shipTypeCode === '') {
    return { vesselClass: 'UNKNOWN', vesselClassLabel: 'Unknown' };
  }
  const code = Number(shipTypeCode);
  if (!Number.isFinite(code)) {
    return { vesselClass: 'UNKNOWN', vesselClassLabel: 'Unknown' };
  }
  if (code >= 70 && code <= 79) {
    return { vesselClass: 'CARGO', vesselClassLabel: 'Cargo' };
  }
  if (code >= 80 && code <= 89) {
    return { vesselClass: 'TANKER', vesselClassLabel: 'Tanker' };
  }
  if (code >= 60 && code <= 69) {
    if (code === 60 || code === 61) {
      return { vesselClass: 'FERRY', vesselClassLabel: 'Ferry' };
    }
    return { vesselClass: 'PASSENGER', vesselClassLabel: 'Passenger' };
  }
  if (code === 52) {
    return { vesselClass: 'TUG', vesselClassLabel: 'Tug' };
  }
  if (code >= 30 && code <= 39) {
    if (code === 36 || code === 37) {
      return { vesselClass: 'PLEASURE', vesselClassLabel: 'Pleasure craft' };
    }
    return { vesselClass: 'FISHING', vesselClassLabel: 'Fishing' };
  }
  if (code === 51 || code === 58) {
    return { vesselClass: 'SEARCH_AND_RESCUE', vesselClassLabel: 'Search and rescue' };
  }
  if (code >= 40 && code <= 49) {
    return { vesselClass: 'HIGH_SPEED_CRAFT', vesselClassLabel: 'High speed craft' };
  }
  return { vesselClass: 'OTHER', vesselClassLabel: 'Other' };
}

export function formatNavigationStatus(value) {
  if (value == null || value === '') return null;
  const code = Number(value);
  if (Number.isFinite(code) && NAV_STATUS_LABELS[code]) return NAV_STATUS_LABELS[code];
  const text = String(value).trim();
  return text || null;
}

export function formatAisEta(eta) {
  if (!eta || typeof eta !== 'object') return null;
  const month = Number(eta.Month ?? eta.month);
  const day = Number(eta.Day ?? eta.day);
  const hour = Number(eta.Hour ?? eta.hour);
  const minute = Number(eta.Minute ?? eta.minute);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  const parts = [`${month}/${day}`];
  if (Number.isFinite(hour)) parts.push(`${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}`);
  return parts.join(' ');
}

/**
 * Merge AISStream position message into vessel state.
 * @param {object} message
 * @param {object} state
 */
export function mergeAisPositionMessage(message, state) {
  const meta = message?.MetaData || {};
  const ais = message?.Message || {};
  const report = ais.PositionReport
    || ais.ExtendedClassBPositionReport
    || ais.StandardClassBPositionReport;
  if (!report) return state;

  const mmsi = Number(meta.MMSI || report.UserID || state.mmsi);
  if (!mmsi) return state;

  const latitude = Number(meta.latitude ?? report.Latitude);
  const longitude = Number(meta.longitude ?? report.Longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return state;

  const observedAt = meta.time_utc ? new Date(meta.time_utc) : new Date();
  const heading = resolveVesselHeading(report.TrueHeading, report.Cog ?? report.CourseOverGround, state.lastValidHeading);

  return {
    ...state,
    mmsi,
    latitude,
    longitude,
    speed: numberOrNull(report.Sog ?? report.SpeedOverGround),
    courseOverGround: numberOrNull(report.Cog ?? report.CourseOverGround),
    trueHeading: numberOrNull(report.TrueHeading),
    headingDegrees: heading.headingDegrees,
    headingSource: heading.headingSource,
    lastValidHeading: heading.headingDegrees ?? state.lastValidHeading ?? null,
    rateOfTurn: numberOrNull(report.RateOfTurn, [128]),
    navigationStatus: report.NavigationalStatus ?? report.NavigationalStatusName ?? state.navigationStatus,
    navigationStatusLabel: formatNavigationStatus(report.NavigationalStatus ?? report.NavigationalStatusName),
    vesselName: meta.ShipName || state.vesselName || null,
    positionObservedAt: observedAt.toISOString(),
    lastPositionReceivedAt: observedAt.toISOString()
  };
}

/**
 * Merge AISStream static/voyage message into vessel state.
 * @param {object} message
 * @param {object} state
 */
export function mergeAisStaticMessage(message, state) {
  const meta = message?.MetaData || {};
  const ais = message?.Message || {};
  const staticData = ais.ShipStaticData || ais.StaticDataReport;
  if (!staticData) return state;

  const mmsi = Number(meta.MMSI || staticData.UserID || state.mmsi);
  if (!mmsi) return state;

  const shipTypeCode = staticData.Type ?? staticData.ShipType ?? state.shipTypeCode;
  const classification = classifyVesselShipType(shipTypeCode);

  return {
    ...state,
    mmsi,
    vesselName: staticData.Name || staticData.ReportA?.Name || meta.ShipName || state.vesselName || null,
    callsign: staticData.CallSign || staticData.Callsign || state.callsign || null,
    imo: staticData.ImoNumber || staticData.IMO || state.imo || null,
    shipTypeCode: shipTypeCode != null ? Number(shipTypeCode) : state.shipTypeCode,
    vesselClass: classification.vesselClass,
    vesselClassLabel: classification.vesselClassLabel,
    destination: staticData.Destination || state.destination || null,
    eta: formatAisEta(staticData.Eta) || state.eta || null,
    draught: numberOrNull(staticData.MaximumStaticDraught) ?? state.draught ?? null,
    dimensions: staticData.Dimension || state.dimensions || null,
    lastStaticReceivedAt: new Date().toISOString()
  };
}

/**
 * @param {object} state
 * @param {{ receivedAt?: string, nowMs?: number }} [meta]
 */
export function normalizeVesselState(state, meta = {}) {
  if (!state?.mmsi) return null;

  const latitude = Number(state.latitude);
  const longitude = Number(state.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (!isWithinMontrealBounds(latitude, longitude)) return null;

  const nowMs = meta.nowMs ?? Date.now();
  const receivedAt = meta.receivedAt || new Date(nowMs).toISOString();
  const observedAt = state.positionObservedAt || state.lastPositionReceivedAt || receivedAt;
  const observedMs = new Date(observedAt).getTime();
  const ageSeconds = Number.isFinite(observedMs)
    ? Math.max(0, Math.floor((nowMs - observedMs) / 1000))
    : null;

  if (ageSeconds != null && ageSeconds > AIS_POSITION_STALE_SECONDS) return null;

  const classification = state.vesselClass
    ? { vesselClass: state.vesselClass, vesselClassLabel: state.vesselClassLabel }
    : classifyVesselShipType(state.shipTypeCode);

  let freshness = 'CURRENT';
  if (ageSeconds != null && ageSeconds > AIS_POSITION_CURRENT_SECONDS) {
    freshness = 'STALE';
  }

  const mmsi = String(state.mmsi);
  const displayName = state.vesselName || state.callsign || mmsi;

  return {
    liveObjectId: `ais:${mmsi}`,
    sourceObjectId: mmsi,
    objectType: 'VESSEL',
    objectSubtype: classification.vesselClass,
    latitude,
    longitude,
    headingDegrees: state.headingDegrees ?? null,
    speed: state.speed ?? null,
    speedUnit: state.speed != null ? 'knots' : null,
    callsign: state.callsign || null,
    displayName,
    status: state.navigationStatusLabel || formatNavigationStatus(state.navigationStatus) || null,
    observedAt,
    receivedAt,
    ageSeconds,
    sourceId: AISSTREAM_SOURCE_ID,
    sourceName: AISSTREAM_SOURCE_NAME,
    sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
    sourceUrl: AISSTREAM_SOURCE_URL,
    sourceLicense: AISSTREAM_SOURCE_LICENSE,
    freshness,
    spatialPrecision: 'AIS reported position',
    mmsi,
    imo: state.imo ? String(state.imo) : null,
    shipTypeCode: state.shipTypeCode != null ? String(state.shipTypeCode) : null,
    vesselClass: classification.vesselClass,
    vesselClassLabel: classification.vesselClassLabel,
    courseOverGround: state.courseOverGround ?? null,
    trueHeading: state.trueHeading ?? null,
    rateOfTurn: state.rateOfTurn ?? null,
    navigationStatus: state.navigationStatus ?? null,
    navigationStatusLabel: state.navigationStatusLabel || formatNavigationStatus(state.navigationStatus),
    destination: state.destination || null,
    eta: state.eta || null,
    draught: state.draught ?? null,
    iqaiType: 'live_vessel'
  };
}

/**
 * @param {Map<number, object>|object[]} vesselStates
 * @param {{ receivedAt?: string, nowMs?: number }} [meta]
 */
export function normalizeVesselSnapshot(vesselStates, meta = {}) {
  const receivedAt = meta.receivedAt || new Date().toISOString();
  const items = vesselStates instanceof Map
    ? vesselStates.values()
    : (Array.isArray(vesselStates) ? vesselStates : []);

  const objects = [];
  const seen = new Set();
  for (const state of items) {
    const object = normalizeVesselState(state, { ...meta, receivedAt });
    if (!object || seen.has(object.liveObjectId)) continue;
    seen.add(object.liveObjectId);
    objects.push(object);
  }

  const feedTimestamp = objects.reduce((latest, object) => {
    const t = object.observedAt;
    if (!t) return latest;
    return !latest || t > latest ? t : latest;
  }, null);

  return {
    objects,
    feedTimestamp,
    receivedAt,
    vesselCount: objects.length
  };
}

/**
 * @param {object} message
 */
export function mergeAisStreamMessage(message, state = {}) {
  const ais = message?.Message || {};
  if (ais.PositionReport || ais.ExtendedClassBPositionReport || ais.StandardClassBPositionReport) {
    return mergeAisPositionMessage(message, state);
  }
  if (ais.ShipStaticData || ais.StaticDataReport) {
    return mergeAisStaticMessage(message, state);
  }
  return state;
}
