/**
 * Polished weekly history chart with outlook, legend, and tooltips.
 */

export class LabHistoryChart {
  constructor(container) {
    this.container = container;
    this.series = [];
    this.options = {};
    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
  }

  render(series, options = {}) {
    this.series = series || [];
    this.options = options;
    this.container.innerHTML = '';

    const legend = document.createElement('div');
    legend.className = 'chart-legend-bar';
    legend.innerHTML = `
      <div class="chart-legend-items">
        <span class="lg lg-observed">Reported</span>
        <span class="lg lg-baseline">Recent expected level</span>
        ${options.showOutlook ? '<span class="lg lg-outlook">Outlook (experimental)</span>' : ''}
      </div>
    `;
    this.container.appendChild(legend);

    if (options.showLegendInfo) {
      const info = document.createElement('div');
      info.className = 'chart-info-panel';
      info.innerHTML = `
        <p><strong>Reported</strong> — actual SPVM published weekly counts (sector aggregates).</p>
        <p><strong>Recent expected level</strong> — comparison from historical/recent pattern (${options.baselineLabel || 'previous 13-week average'}).</p>
        <p><strong>Outlook</strong> — experimental year-end estimate using historical same-week medians (B4 seasonal). Not a validated multi-step forecast.</p>
        <p>These are PDQ/week aggregates, not exact incident predictions.</p>
      `;
      this.container.appendChild(info);
    }

    if (!this.series.length) {
      const empty = document.createElement('p');
      empty.className = 'chart-empty';
      empty.textContent = 'Select a sector on the map to view weekly history.';
      this.container.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'chart-svg-wrap';
    this.container.appendChild(wrap);

    const w = Math.max(600, wrap.clientWidth || this.container.clientWidth || 900);
    const h = options.showOutlook ? 228 : 200;
    const pad = { l: 44, r: 16, t: options.suppressTitle ? 12 : 16, b: options.showOutlook ? 42 : 32 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const maxY = Math.max(1, ...this.series.flatMap((s) => [
      s.observed ?? 0,
      s.baseline ?? 0,
      s.outlook ?? 0,
      s.outlookHigh ?? 0,
      s.f1 ?? 0
    ]));

    const n = this.series.length;
    const xAt = (i) => pad.l + (i / Math.max(1, n - 1)) * plotW;
    const yAt = (v) => pad.t + plotH - (v / maxY) * plotH;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('class', 'history-chart__svg');

    for (let i = 0; i <= 4; i += 1) {
      const y = pad.t + (plotH / 4) * i;
      const val = Math.round(maxY - (maxY / 4) * i);
      svg.appendChild(el('line', { x1: pad.l, x2: pad.l + plotW, y1: y, y2: y, class: 'chart-grid' }));
      const t = el('text', { x: pad.l - 6, y: y + 4, class: 'chart-axis', 'text-anchor': 'end' });
      t.textContent = String(val);
      svg.appendChild(t);
    }

    if (options.showOutlook && options.lastObservedWeek) {
      const idx = this.series.findIndex((s) => s.week === options.lastObservedWeek);
      if (idx >= 0) {
        const x = xAt(idx);
        svg.appendChild(el('line', { x1: x, x2: x, y1: pad.t, y2: pad.t + plotH, class: 'chart-observed-end' }));
        const lbl = el('text', { x: x - 4, y: pad.t + plotH - 4, class: 'chart-observed-label', 'text-anchor': 'end' });
        lbl.textContent = 'OBSERVED DATA ENDS';
        svg.appendChild(lbl);
      }
    }

    if (options.showOutlook && options.forecastStartWeek) {
      const idx = this.series.findIndex((s) => s.week === options.forecastStartWeek);
      if (idx >= 0) {
        const x = xAt(idx);
        svg.appendChild(el('line', { x1: x, x2: x, y1: pad.t, y2: pad.t + plotH, class: 'chart-forecast-start' }));
        const lbl = el('text', { x: x + 4, y: pad.t + 12, class: 'chart-forecast-label' });
        lbl.textContent = 'OUTLOOK START';
        svg.appendChild(lbl);
      }
    }

    if (options.showOutlook) {
      const band = bandPath(this.series, xAt, yAt, 'outlookLow', 'outlookHigh');
      if (band) svg.appendChild(el('path', { d: band, class: 'chart-outlook-band' }));
      svg.appendChild(pathLine(this.series, xAt, yAt, 'outlook', 'chart-line chart-line--outlook'));
    }

    svg.appendChild(pathLine(this.series, xAt, yAt, 'baseline', 'chart-line chart-line--baseline'));
    svg.appendChild(pathLine(this.series, xAt, yAt, 'observed', 'chart-line chart-line--observed'));

    if (options.showOutlook) {
      drawOutlookXAxisLabels(svg, this.series, xAt, pad, plotH);
    }

    const selWeek = options.selectedWeek;
    const selIdx = this.series.findIndex((s) => s.week === selWeek);
    if (selIdx >= 0) {
      const vx = xAt(selIdx);
      svg.appendChild(el('line', { x1: vx, x2: vx, y1: pad.t, y2: pad.t + plotH, class: 'chart-week-marker' }));
    }

    const hoverG = el('g', { class: 'chart-hover' });
    hoverG.style.display = 'none';
    hoverG.append(
      el('line', { class: 'chart-hover-line', y1: pad.t, y2: pad.t + plotH }),
      el('circle', { r: 4, class: 'chart-hover-dot' }),
      el('text', { class: 'chart-tooltip', 'text-anchor': 'middle' })
    );
    svg.appendChild(hoverG);

    const title = el('text', { x: pad.l, y: 12, class: 'chart-title' });
    if (!options.suppressTitle) {
      title.textContent = options.title || 'Weekly history';
      svg.appendChild(title);
    }

    const overlay = el('rect', { x: pad.l, y: pad.t, width: plotW, height: plotH, fill: 'transparent' });
    overlay.addEventListener('mousemove', this._onMove);
    overlay.addEventListener('mouseleave', this._onLeave);
    svg.appendChild(overlay);

    wrap.appendChild(svg);
    this._svg = svg;
    this._pad = pad;
    this._plotW = plotW;
    this._plotH = plotH;
    this._maxY = maxY;
    this._hoverG = hoverG;
  }

  _onMove(evt) {
    const rel = Math.max(0, Math.min(1, evt.offsetX / this._plotW));
    const idx = Math.round(rel * (this.series.length - 1));
    const pt = this.series[idx];
    const px = this._pad.l + (idx / Math.max(1, this.series.length - 1)) * this._plotW;
    const yObs = pt.observed != null
      ? this._pad.t + this._plotH - (pt.observed / this._maxY) * this._plotH
      : this._pad.t + this._plotH / 2;

    this._hoverG.style.display = '';
    this._hoverG.children[0].setAttribute('x1', px);
    this._hoverG.children[0].setAttribute('x2', px);
    this._hoverG.children[1].setAttribute('cx', px);
    this._hoverG.children[1].setAttribute('cy', yObs);
    this._hoverG.children[2].setAttribute('x', px);
    this._hoverG.children[2].setAttribute('y', this._pad.t - 4);
    const weekLabel = formatWeekLabel(pt.week);
    let tooltip = '';
    if (pt.phase === 'outlook') {
      tooltip = `${weekLabel}\nPlanning outlook: ${pt.outlook ?? '—'}`;
      if (pt.outlookLow != null && pt.outlookHigh != null) {
        tooltip += `\nHistorical range: ${Math.round(pt.outlookLow)}–${Math.round(pt.outlookHigh)}`;
      }
    } else {
      tooltip = `${weekLabel}\nReported: ${pt.observed ?? '—'}`;
      if (pt.baseline != null) tooltip += `\nExpected: ${Number(pt.baseline).toFixed(1)}`;
    }
    this._hoverG.children[2].textContent = tooltip.replace(/\n/g, ' · ');
  }

  _onLeave() {
    if (this._hoverG) this._hoverG.style.display = 'none';
  }
}

function pathLine(series, xAt, yAt, key, className) {
  let d = '';
  series.forEach((pt, i) => {
    const v = pt[key];
    if (v == null) return;
    d += `${d ? 'L' : 'M'}${xAt(i)},${yAt(v)}`;
  });
  return el('path', { d, class: className, fill: 'none' });
}

function bandPath(series, xAt, yAt, lowKey, highKey) {
  const top = [];
  const bot = [];
  series.forEach((pt, i) => {
    if (pt[lowKey] == null || pt[highKey] == null) return;
    top.push([xAt(i), yAt(pt[highKey])]);
    bot.push([xAt(i), yAt(pt[lowKey])]);
  });
  if (!top.length) return '';
  let d = `M${top[0][0]},${top[0][1]}`;
  top.slice(1).forEach(([x, y]) => { d += `L${x},${y}`; });
  bot.reverse().forEach(([x, y]) => { d += `L${x},${y}`; });
  return `${d}Z`;
}

function el(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function drawOutlookXAxisLabels(svg, series, xAt, pad, plotH) {
  const targets = [
    { prefix: '2027-01', text: 'Jan 2027' },
    { prefix: '2027-07', text: 'Jul 2027' },
    { prefix: '2027-12', text: 'Dec 2027' }
  ];
  const labels = [];
  for (const target of targets) {
    const idx = series.findIndex((s) => s.week.startsWith(target.prefix));
    if (idx >= 0) labels.push({ idx, text: target.text });
  }
  if (!labels.some((l) => l.text === 'Dec 2027') && series.length) {
    const lastIdx = series.length - 1;
    if (series[lastIdx].week.startsWith('2027-12')) {
      labels.push({ idx: lastIdx, text: 'Dec 2027' });
    }
  }
  const used = new Set();
  for (const { idx, text } of labels) {
    if (used.has(idx)) continue;
    used.add(idx);
    const x = xAt(idx);
    svg.appendChild(el('line', {
      x1: x, x2: x, y1: pad.t + plotH, y2: pad.t + plotH + 5, class: 'chart-axis-tick'
    }));
    const t = el('text', {
      x,
      y: pad.t + plotH + 18,
      class: 'chart-axis chart-axis--x',
      'text-anchor': 'middle'
    });
    t.textContent = text;
    svg.appendChild(t);
  }
}

function formatWeekLabel(weekStart) {
  const d = new Date(`${weekStart}T12:00:00`);
  return `Week of ${d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
