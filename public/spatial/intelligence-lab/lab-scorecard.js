/**
 * Intelligence Visual Lab — candidate scorecard (technical + human-review slots).
 */

export const SCORECARD = [
  {
    id: 'observed',
    label: 'LAB 01 Observed',
    classification: 'USE NOW',
    scores: { analytical: 5, demo: null, arcgis: 4, integrity: 5, usability: 5, performance: 5, complexity: 5 },
    notes: 'Direct weekly report_count; clearest OBSERVED semantics.'
  },
  {
    id: 'baseline',
    label: 'LAB 02 Baseline',
    classification: 'USE NOW',
    scores: { analytical: 5, demo: null, arcgis: 4, integrity: 5, usability: 4, performance: 5, complexity: 5 },
    notes: 'Explicit B0–B4 labels; never called “normal”.'
  },
  {
    id: 'deviation',
    label: 'LAB 03 Deviation',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 5, demo: null, arcgis: 4, integrity: 5, usability: 4, performance: 5, complexity: 4 },
    notes: 'Diverging renderer centered on zero; strongest spatial signal candidate.'
  },
  {
    id: 'change',
    label: 'LAB 04 Change',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 4, demo: null, arcgis: 4, integrity: 5, usability: 4, performance: 5, complexity: 4 },
    notes: 'Current week vs prior 4-week mean (transparent).'
  },
  {
    id: 'persistence',
    label: 'LAB 05 Persistence',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 4, demo: null, arcgis: 3, integrity: 5, usability: 3, performance: 5, complexity: 3 },
    notes: 'Lag-based streak; H1-informed wording only.'
  },
  {
    id: 'composition',
    label: 'LAB 06 Composition',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 4, demo: null, arcgis: 5, integrity: 5, usability: 3, performance: 4, complexity: 3 },
    notes: 'PieChartRenderer per PDQ; no composite risk score.'
  },
  {
    id: 'bivariate',
    label: 'LAB 07 Bivariate',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 5, demo: null, arcgis: 4, integrity: 5, usability: 3, performance: 5, complexity: 3 },
    notes: 'Size=observed, color=deviation; relationship ramp deferred.'
  },
  {
    id: 'forecast',
    label: 'LAB 08 Forecast',
    classification: 'PROTOTYPE ONLY',
    scores: { analytical: 4, demo: null, arcgis: 3, integrity: 5, usability: 3, performance: 5, complexity: 3 },
    notes: 'MVT only; EXPERIMENTAL/MARGINAL banner required.'
  },
  {
    id: 'forecastError',
    label: 'LAB 09 Forecast Error',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 5, demo: null, arcgis: 4, integrity: 5, usability: 4, performance: 5, complexity: 3 },
    notes: 'Model miss as spatial intelligence.'
  },
  {
    id: 'modelAdvantage',
    label: 'LAB 10 Model Advantage',
    classification: 'PROTOTYPE ONLY',
    scores: { analytical: 4, demo: null, arcgis: 4, integrity: 5, usability: 3, performance: 5, complexity: 3 },
    notes: 'Not an AI quality score; per PDQ-week B2 vs F1.'
  },
  {
    id: 'timeTravel',
    label: 'LAB 11 Time Travel',
    classification: 'PROMISING — REFINE',
    scores: { analytical: 4, demo: null, arcgis: 5, integrity: 5, usability: 4, performance: 4, complexity: 3 },
    notes: 'ArcGIS TimeSlider week stops; drives observed by default.'
  },
  {
    id: 'selection',
    label: 'LAB 12 Selection',
    classification: 'USE NOW',
    scores: { analytical: 4, demo: null, arcgis: 4, integrity: 5, usability: 5, performance: 5, complexity: 4 },
    notes: 'Click + shift multi-select; chart/table sync. Rectangle/lasso SKIPPED.'
  }
];

export function renderScorecardHtml(activeMode) {
  const rows = SCORECARD.map((row) => {
    const active = row.id === activeMode || (activeMode === 'timeTravel' && row.id === 'timeTravel');
    const cls = active ? ' style="background:#1a1a1a"' : '';
    const fmt = (v) => (v == null ? '—' : v);
    return `<tr${cls}>
      <td>${row.label}</td>
      <td class="classification">${row.classification}</td>
      <td>${fmt(row.scores.analytical)}</td>
      <td>${fmt(row.scores.demo)}</td>
      <td>${fmt(row.scores.arcgis)}</td>
      <td>${fmt(row.scores.integrity)}</td>
      <td>${fmt(row.scores.usability)}</td>
      <td>${fmt(row.scores.performance)}</td>
      <td>${fmt(row.scores.complexity)}</td>
    </tr>`;
  }).join('');

  return `<table>
    <thead><tr>
      <th>Candidate</th><th>Class</th><th>Anal</th><th>Demo*</th><th>ArcGIS</th><th>Sci</th><th>Use</th><th>Perf</th><th>Cx</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="font-size:0.65rem;color:#666;margin:0.35rem 0 0">*Demo impact = HUMAN REVIEW</p>`;
}
