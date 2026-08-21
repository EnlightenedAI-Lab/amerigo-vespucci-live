/**
 * Per-camera street-capture date catalog.
 * Dates are provider photo times, not CameraPose times.
 * Google currently contributes at most one capture. Mapillary ranked list can be searched.
 */

export const DATE_SEARCH_HONESTY = 'STREET PHOTO DATE · NOT CAMERA DATE · NOT LIVE FEED';
export const GOOGLE_DATE_LIMIT = 'GOOGLE · THIS CAPTURE ONLY · HISTORICAL DATES NOT ENUMERATED';
export const NO_CAPTURES_LABEL = 'NO DATED STREET CAPTURES HERE';

export function captureDay(value) {
  const text = String(value || '');
  const day = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (day) return day[1];
  const month = text.match(/(\d{4}-\d{2})(?!-)/);
  return month ? `${month[1]}-01` : null;
}

export function captureYear(value) {
  const day = captureDay(value);
  return day ? day.slice(0, 4) : null;
}

function addEntry(byDay, representation, source) {
  if (!representation?.providerId) return;
  const date = captureDay(representation.capturedAt || representation.capturedAtIso);
  if (!date) return;
  const distance = Number(representation.distanceMeters);
  const next = Object.freeze({
    date,
    year: date.slice(0, 4),
    month: date.slice(0, 7),
    provider: representation.provider,
    providerId: String(representation.providerId),
    thumbUrl: representation.thumbUrl || representation.snapshotUrl || null,
    distanceMeters: Number.isFinite(distance) ? distance : null,
    source,
    representation
  });
  const prev = byDay.get(date);
  if (!prev) {
    byDay.set(date, next);
    return;
  }
  if (prev.source === 'GOOGLE' && source === 'MAPILLARY') {
    byDay.set(date, next);
    return;
  }
  if (prev.source === 'MAPILLARY' && source === 'GOOGLE') return;
  if ((next.distanceMeters ?? Infinity) < (prev.distanceMeters ?? Infinity)) {
    byDay.set(date, next);
  }
}

export function buildCaptureCatalog(input = {}) {
  const byDay = new Map();
  const ranked = Array.isArray(input.mapillaryRanked) ? input.mapillaryRanked : [];
  for (const item of ranked) addEntry(byDay, item, 'MAPILLARY');
  if (input.mapillary) addEntry(byDay, input.mapillary, 'MAPILLARY');
  if (input.google) addEntry(byDay, input.google, 'GOOGLE');
  const dates = Object.freeze([...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)));
  const years = Object.freeze([...new Set(dates.map((item) => item.year))]);
  const searchable = dates.some((item) => item.source === 'MAPILLARY');
  return Object.freeze({
    dates,
    years,
    count: dates.length,
    searchable,
    honesty: DATE_SEARCH_HONESTY,
    googleLimit: searchable ? null : (input.google?.providerId ? GOOGLE_DATE_LIMIT : NO_CAPTURES_LABEL)
  });
}

export function nearestCapture(catalog, requested) {
  const want = captureDay(requested);
  const dates = catalog?.dates || [];
  if (!want) {
    return Object.freeze({ ok: false, reason: 'DATE_REQUIRED', requested: null });
  }
  if (!dates.length) {
    return Object.freeze({
      ok: false,
      reason: 'NO_AVAILABLE_CAPTURES',
      requested: want,
      honesty: catalog?.googleLimit || NO_CAPTURES_LABEL
    });
  }
  const exact = dates.find((item) => item.date === want);
  if (exact) {
    return Object.freeze({
      ok: true,
      exact: true,
      requested: want,
      date: exact.date,
      item: exact,
      label: exact.date
    });
  }
  const wantMs = Date.parse(`${want}T00:00:00Z`);
  let best = dates[0];
  let bestDelta = Infinity;
  for (const item of dates) {
    const delta = Math.abs(Date.parse(`${item.date}T00:00:00Z`) - wantMs);
    if (delta < bestDelta) {
      best = item;
      bestDelta = delta;
    }
  }
  return Object.freeze({
    ok: true,
    exact: false,
    requested: want,
    date: best.date,
    item: best,
    label: `NEAREST AVAILABLE ${best.date}`
  });
}

export function capturesForYear(catalog, year) {
  const wanted = String(year || '');
  return Object.freeze((catalog?.dates || []).filter((item) => item.year === wanted));
}

export function calendarMonth(catalog, yearMonth) {
  const key = String(yearMonth || '').slice(0, 7);
  const match = key.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const available = new Set((catalog?.dates || []).filter((item) => item.month === key).map((item) => item.date));
  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(Object.freeze({ empty: true }));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${key}-${String(day).padStart(2, '0')}`;
    cells.push(Object.freeze({
      empty: false,
      day,
      date,
      available: available.has(date)
    }));
  }
  return Object.freeze({ year, month, yearMonth: key, cells: Object.freeze(cells) });
}
