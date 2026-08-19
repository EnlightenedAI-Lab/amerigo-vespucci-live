/** BIS marker normalize — subset of Brain hydro-quebec-outages-normalize.js. */

export function parseHydroVersionTimestamp(version) {
  const text = String(version || '').trim().replace(/"/g, '');
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseVersionBody(text) {
  const trimmed = String(text || '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' || typeof parsed === 'number') return String(parsed).trim();
  } catch {
    // bisversion may be a bare quoted string
  }
  return trimmed.replace(/^"+|"+$/g, '');
}

function parseCoordinatePair(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const longitude = Number(raw[0]);
    const latitude = Number(raw[1]);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) return { longitude, latitude };
    return null;
  }
  const text = String(raw).trim();
  const match = text.match(/\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?/);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

const CREW_STATUS_LABELS = {
  A: 'Work assigned',
  R: 'Crew en route',
  L: 'Crew at work'
};

function mapCrewStatus(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return { crewStatusCode: '', crewStatusLabel: 'Unknown' };
  return { crewStatusCode: key, crewStatusLabel: CREW_STATUS_LABELS[key] || 'Unknown' };
}

const EQUIPMENT_CAUSES = new Set(['11', '12', '13', '14', '15', '58', '70', '72', '73', '74', '79']);
const WEATHER_CAUSES = new Set(['21', '22', '24', '25', '26']);
const ACCIDENT_CAUSES = new Set(['31', '32', '33', '34', '41', '42', '43', '44', '54', '55', '56', '57']);
const VEGETATION_CAUSES = new Set(['51']);
const ANIMAL_CAUSES = new Set(['52', '53']);

function mapCauseCategory(causeCode) {
  const code = String(causeCode || '').trim();
  if (!code) return { causeCode: '', causeCategory: 'Unknown' };
  if (EQUIPMENT_CAUSES.has(code)) return { causeCode: code, causeCategory: 'Equipment failure' };
  if (WEATHER_CAUSES.has(code)) return { causeCode: code, causeCategory: 'Weather' };
  if (ACCIDENT_CAUSES.has(code)) return { causeCode: code, causeCategory: 'Accident / incident' };
  if (VEGETATION_CAUSES.has(code)) return { causeCode: code, causeCategory: 'Vegetation damage' };
  if (ANIMAL_CAUSES.has(code)) return { causeCode: code, causeCategory: 'Animal damage' };
  return { causeCode: code, causeCategory: 'Unknown' };
}

export function normalizeHydroMarkersPayload(payload, meta = {}) {
  const rows = payload?.pannes || [];
  const outages = [];
  const seen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 9) continue;
    const coordinates = parseCoordinatePair(row[4]);
    if (!coordinates) continue;
    const customersAffected = Number(row[0]);
    const outageStart = String(row[1] || '').trim() || null;
    const estimatedRestoration = String(row[2] || '').trim() || null;
    const crew = mapCrewStatus(row[5]);
    const cause = mapCauseCategory(String(row[7] || row[6] || '').trim());
    const municipalityId = String(row[8] || '').trim();
    const messageId = String(row[9] || '').trim();
    const outageId = messageId
      ? `msg:${messageId}`
      : `geo:${municipalityId}|${coordinates.longitude.toFixed(6)}|${coordinates.latitude.toFixed(6)}|${outageStart || ''}`;
    if (seen.has(outageId)) continue;
    seen.add(outageId);
    outages.push({
      outageId,
      customersAffected: Number.isFinite(customersAffected) ? customersAffected : null,
      outageStart,
      estimatedRestoration,
      municipalityId,
      messageId,
      longitude: coordinates.longitude,
      latitude: coordinates.latitude,
      ...cause,
      ...crew,
      sourceVersion: meta.version || null,
      feedTimestamp: meta.feedTimestamp || null,
      receivedAt: meta.receivedAt || null,
      sourceName: 'Hydro-Québec Open Data',
      locationNote: 'Approximate location as published by Hydro-Québec BIS'
    });
  }
  return outages;
}
