/**
 * SPVM crime explorer — single authoritative filter state and analytics.
 */

import {
  SPVM_ALL_CATEGORIES,
  SPVM_ALL_SHIFTS,
  englishLabelForCategory,
  shiftUiLabelForValue
} from './spvm-crime-taxonomy.js';

export function montrealTodayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function subtractCalendarDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function windowStartYmd(todayYmd, windowDays) {
  return subtractCalendarDaysYmd(todayYmd, Math.max(0, windowDays - 1));
}

export function createDefaultSpvmFilterState() {
  return {
    windowDays: 30,
    shifts: new Set(SPVM_ALL_SHIFTS),
    categories: new Set(SPVM_ALL_CATEGORIES),
    viewMode: 'INCIDENTS'
  };
}

export function cloneSpvmFilterState(state) {
  return {
    windowDays: state.windowDays,
    shifts: new Set(state.shifts),
    categories: new Set(state.categories),
    viewMode: state.viewMode
  };
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function ymdToEpochMs(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {{ fields?: Array<{ name: string, type: string }> } | null} [layer]
 */
function buildDateWindowClauses(startYmd, endYmd, layer = null) {
  const dateField = layer?.fields?.find((field) => field.name === 'date');
  if (dateField?.type === 'date') {
    return [
      `date >= ${ymdToEpochMs(startYmd)}`,
      `date <= ${ymdToEpochMs(endYmd)}`
    ];
  }
  return [`date >= '${startYmd}'`, `date <= '${endYmd}'`];
}

/**
 * @param {ReturnType<typeof createDefaultSpvmFilterState>} state
 * @param {string} [todayYmd]
 * @param {{ fields?: Array<{ name: string, type: string }> } | null} [layer]
 */
export function buildSpvmDefinitionExpression(state, todayYmd = montrealTodayYmd(), layer = null) {
  const start = windowStartYmd(todayYmd, state.windowDays);
  const parts = buildDateWindowClauses(start, todayYmd, layer);

  if (state.shifts.size > 0 && state.shifts.size < SPVM_ALL_SHIFTS.length) {
    const shiftList = [...state.shifts].map((shift) => `'${sqlEscape(shift)}'`).join(',');
    parts.push(`shift IN (${shiftList})`);
  }

  if (state.categories.size === 0) {
    parts.push('1=0');
  } else if (state.categories.size < SPVM_ALL_CATEGORIES.length) {
    const catList = [...state.categories].map((cat) => `'${sqlEscape(cat)}'`).join(',');
    parts.push(`category IN (${catList})`);
  }

  return parts.join(' AND ');
}

/**
 * @param {object} attrs
 * @param {ReturnType<typeof createDefaultSpvmFilterState>} state
 * @param {string} [todayYmd]
 */
export function featureMatchesSpvmFilter(attrs, state, todayYmd = montrealTodayYmd()) {
  if (!attrs) return false;
  const date = String(attrs.date || '');
  if (!date) return false;
  const start = windowStartYmd(todayYmd, state.windowDays);
  if (date < start || date > todayYmd) return false;
  if (state.shifts.size > 0 && !state.shifts.has(String(attrs.shift || ''))) return false;
  if (state.categories.size === 0) return false;
  if (!state.categories.has(String(attrs.category || ''))) return false;
  return true;
}

/**
 * @param {Array<{ attributes?: object }>} graphics
 * @param {ReturnType<typeof createDefaultSpvmFilterState>} state
 * @param {string} [todayYmd]
 */
export function filterSpvmGraphics(graphics, state, todayYmd = montrealTodayYmd()) {
  return graphics.filter((graphic) => featureMatchesSpvmFilter(graphic.attributes, state, todayYmd));
}

function formatShortDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * @param {Array<{ attributes?: object }>} graphics
 * @param {ReturnType<typeof createDefaultSpvmFilterState>} state
 * @param {string} [todayYmd]
 */
export function computeSpvmAnalytics(graphics, state, todayYmd = montrealTodayYmd()) {
  const filtered = filterSpvmGraphics(graphics, state, todayYmd);
  const categoryCounts = new Map();
  const shiftCounts = new Map();
  const pdqCounts = new Map();
  const timeline = new Map();

  for (const graphic of filtered) {
    const attrs = graphic.attributes || {};
    const category = String(attrs.category || '');
    const shift = String(attrs.shift || '');
    const pdq = String(attrs.pdq || '—');
    const date = String(attrs.date || '');

    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    shiftCounts.set(shift, (shiftCounts.get(shift) || 0) + 1);
    pdqCounts.set(pdq, (pdqCounts.get(pdq) || 0) + 1);
    if (date) timeline.set(date, (timeline.get(date) || 0) + 1);
  }

  const categoryRows = SPVM_ALL_CATEGORIES.map((french) => ({
    french,
    english: englishLabelForCategory(french),
    count: categoryCounts.get(french) || 0
  })).sort((a, b) => b.count - a.count || a.english.localeCompare(b.english));

  const topCategory = categoryRows.find((row) => row.count > 0) || null;

  const shiftRows = SPVM_ALL_SHIFTS.map((shift) => ({
    shift,
    label: shiftUiLabelForValue(shift),
    count: shiftCounts.get(shift) || 0
  }));

  const topPdqs = [...pdqCounts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 5)
    .map(([pdq, count]) => ({ pdq, count }));

  const timelineRows = [...timeline.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({
      date,
      label: formatShortDate(date),
      count
    }));

  const timelineMax = timelineRows.reduce((max, row) => Math.max(max, row.count), 0);

  return {
    total: filtered.length,
    categoryRows,
    topCategory,
    shiftRows,
    topPdqs,
    timelineRows,
    timelineMax,
    filteredGraphics: filtered,
    todayYmd,
    windowStart: windowStartYmd(todayYmd, state.windowDays)
  };
}
