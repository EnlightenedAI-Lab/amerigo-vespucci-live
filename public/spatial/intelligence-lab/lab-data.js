/**
 * Intelligence Lab — compact panel index and metric accessors.
 */

export function cellIndex(weekIdx, catIdx, pdqIdx, nCat, nPdq) {
  return (weekIdx * nCat + catIdx) * nPdq + pdqIdx;
}

export class LabDataStore {
  /** @param {object} manifest */
  /** @param {object} panel */
  /** @param {object} f1Forecasts */
  /** @param {object} f1Advantage */
  constructor(manifest, panel, f1Forecasts, f1Advantage) {
    this.manifest = manifest;
    this.panel = panel;
    this.f1Forecasts = f1Forecasts;
    this.f1Advantage = f1Advantage;

    this.pdqIds = panel.pdqIds;
    this.categories = panel.categories;
    this.weeks = panel.weeks;
    this.nCat = this.categories.length;
    this.nPdq = this.pdqIds.length;

    this.pdqIndex = Object.fromEntries(this.pdqIds.map((id, i) => [id, i]));
    this.catIndex = Object.fromEntries(this.categories.map((c, i) => [c, i]));
    this.weekIndex = Object.fromEntries(this.weeks.map((w, i) => [w, i]));

    this.f1ByWeekPdq = new Map();
    for (const row of f1Forecasts.records) {
      this.f1ByWeekPdq.set(`${row.target_week}|${row.harmonized_pdq_id}`, row);
    }

    this.advByWeekPdq = new Map();
    for (const row of f1Advantage.records) {
      this.advByWeekPdq.set(`${row.target_week}|${row.harmonized_pdq_id}`, row);
    }

    this.f1ShadowByPdq = new Map();
    const shadow = manifest.f1?.latestShadow;
    if (shadow?.forecasts) {
      for (const f of shadow.forecasts) {
        this.f1ShadowByPdq.set(f.harmonized_pdq_id, f);
      }
    }
  }

  getObserved(week, category, pdqId) {
    const i = this._idx(week, category, pdqId);
    return i == null ? null : this.panel.reportCount[i];
  }

  getBaseline(week, category, pdqId, baselineKey = 'B2') {
    const i = this._idx(week, category, pdqId);
    if (i == null) return null;
    const arr = this.panel.baselines?.[baselineKey];
    return arr ? arr[i] : null;
  }

  getPrior4WeekMean(week, category, pdqId) {
    const weekIdx = this.weekIndex[week];
    if (weekIdx == null || weekIdx < 4) return null;
    let sum = 0;
    let n = 0;
    for (let w = weekIdx - 4; w < weekIdx; w += 1) {
      const v = this.getObserved(this.weeks[w], category, pdqId);
      if (v != null) {
        sum += v;
        n += 1;
      }
    }
    return n ? sum / n : null;
  }

  /** Consecutive weeks (including current) with observed > baseline. */
  getPersistenceStreak(week, category, pdqId, baselineKey = 'B2') {
    const weekIdx = this.weekIndex[week];
    if (weekIdx == null) return 0;
    let streak = 0;
    for (let w = weekIdx; w >= 0; w -= 1) {
      const wk = this.weeks[w];
      const obs = this.getObserved(wk, category, pdqId);
      const base = this.getBaseline(wk, category, pdqId, baselineKey);
      if (base == null) break;
      if (obs > base) streak += 1;
      else break;
    }
    return streak;
  }

  getComposition(week, pdqId) {
    return this.categories.map((cat) => ({
      category: cat,
      count: this.getObserved(week, cat, pdqId) ?? 0
    }));
  }

  getF1Forecast(week, pdqId) {
    return this.f1ByWeekPdq.get(`${week}|${pdqId}`) || null;
  }

  getF1ShadowForecast(pdqId) {
    return this.f1ShadowByPdq.get(pdqId) || null;
  }

  getModelAdvantage(week, pdqId) {
    return this.advByWeekPdq.get(`${week}|${pdqId}`) || null;
  }

  getCitywideObserved(week, category) {
    let sum = 0;
    for (const pdqId of this.pdqIds) {
      sum += this.getObserved(week, category, pdqId) ?? 0;
    }
    return sum;
  }

  getCitywideBaseline(week, category, baselineKey = 'B2') {
    let sum = 0;
    let any = false;
    for (const pdqId of this.pdqIds) {
      const v = this.getBaseline(week, category, pdqId, baselineKey);
      if (v != null) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  }

  getHistorySeries(pdqId, category, baselineKey = 'B2', maxWeeks = 52) {
    const endIdx = this.weekIndex[this.weeks[this.weeks.length - 1]];
    const startIdx = Math.max(0, endIdx - maxWeeks + 1);
    const series = [];
    for (let w = startIdx; w <= endIdx; w += 1) {
      const week = this.weeks[w];
      series.push({
        week,
        observed: this.getObserved(week, category, pdqId),
        baseline: this.getBaseline(week, category, pdqId, baselineKey),
        f1: this.getF1Forecast(week, pdqId)?.forecast_mean ?? null,
        b2: this.getModelAdvantage(week, pdqId)?.b2_forecast_mean ?? null
      });
    }
    return series;
  }

  _idx(week, category, pdqId) {
    const wi = this.weekIndex[week];
    const ci = this.catIndex[category];
    const pi = this.pdqIndex[pdqId];
    if (wi == null || ci == null || pi == null) return null;
    return cellIndex(wi, ci, pi, this.nCat, this.nPdq);
  }
}

export async function loadLabData() {
  const t0 = performance.now();
  const [manifest, panel, f1Forecasts, f1Advantage] = await Promise.all([
    fetch('/api/spatial/intelligence-lab/manifest').then((r) => r.json()),
    fetch('/api/spatial/intelligence-lab/panel').then((r) => r.json()),
    fetch('/api/spatial/intelligence-lab/f1-forecasts').then((r) => r.json()),
    fetch('/api/spatial/intelligence-lab/f1-model-advantage').then((r) => r.json())
  ]);
  const store = new LabDataStore(manifest, panel, f1Forecasts, f1Advantage);
  return {
    store,
    loadMs: Math.round(performance.now() - t0)
  };
}
