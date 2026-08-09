/**
 * Demo Case Workspace — synthetic investigation support (never SPVM source data).
 */

import { escapeHtml } from './lab-hover.js';
import { categoryLabel } from './lab-labels.js';
import { englishLabelForCategory } from '../spvm-crime-taxonomy.js';
import { categoriesForRecentFilter } from './lab-spvm-filters.js';
import { relatedIntelligencePlaceholder, buildRelatedIntelligenceRequest } from './lab-related-intelligence.js';

export const DEMO_CASE_LABEL = 'DEMO CASE — SYNTHETIC DATA';
export const STORAGE_KEY = 'iqai-intelligence-lab-demo-case-v1';

/**
 * Deterministic golden-demo coordinates — inside PDQ 20 with dense published
 * vehicle-theft reports in the configured 2 km / 72 h search window (May 2026).
 */
export const GOLDEN_DEMO_CASE = {
  caseId: 'DEMO-2026-001',
  title: 'Vehicle theft near PDQ 20 (SYNTHETIC DEMO)',
  category: 'Vol de véhicule à moteur',
  reportedDate: '2026-05-25',
  occurrenceStart: '2026-05-25T22:00',
  occurrenceEnd: '2026-05-26T06:00',
  locationLabel: 'Rue Saint-Jacques / Atwater area, PDQ 20 — SYNTHETIC DEMO',
  latitude: '45.507666',
  longitude: '-73.571687',
  propertyType: 'Motor vehicle (SYNTHETIC)',
  makeModel: 'Honda Civic 2019 (SYNTHETIC)',
  colour: 'Silver (SYNTHETIC)',
  identifier: 'Plate ABC-123 (SYNTHETIC)',
  characteristics: 'Roof rack, minor scratch on rear bumper (SYNTHETIC)',
  notes: 'Synthetic demo case for IQAI Spatial investigation workspace. Not a real police file.',
  searchRadiusKm: '2',
  searchTimeWindowHours: '72',
  includeAdjacentCategories: true
};

const CASE_CATEGORIES = [
  { id: 'Vol de véhicule à moteur', label: 'Vehicle theft' },
  { id: 'Vol dans / sur véhicule à moteur', label: 'Theft from vehicle' },
  { id: 'Introduction', label: 'Break-ins' },
  { id: 'Méfait', label: 'Mischief' },
  { id: 'Vols qualifiés', label: 'Robberies' }
];

export function sampleCaseForm() {
  return { ...GOLDEN_DEMO_CASE };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pdqRings(feature) {
  if (!feature?.geometry) return [];
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates;
  return feature.geometry.coordinates.flatMap((poly) => poly);
}

/** Resolve harmonized PDQ id at a point, or null if outside analytical geography. */
export function findPdqAtPoint(geoFeatures, lng, lat) {
  for (const f of geoFeatures || []) {
    const rings = pdqRings(f);
    for (const ring of rings) {
      const loop = Array.isArray(ring[0]?.[0]) ? ring[0] : ring;
      if (pointInRing(lng, lat, loop)) {
        return f.properties?.harmonized_pdq_id || null;
      }
    }
  }
  return null;
}

/** True when latitude/longitude are present and numerically valid. */
export function hasResolvedCaseLocation(caseData) {
  const latRaw = caseData?.latitude;
  const lngRaw = caseData?.longitude;
  if (latRaw === '' || lngRaw === '' || latRaw == null || lngRaw == null) return false;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function validateCaseCoverage(caseData, geoFeatures) {
  if (!hasResolvedCaseLocation(caseData)) {
    return {
      insideCoverage: null,
      pdqId: null,
      warning: ''
    };
  }
  const lng = Number(caseData.longitude);
  const lat = Number(caseData.latitude);
  const pdqId = findPdqAtPoint(geoFeatures, lng, lat);
  return {
    insideCoverage: Boolean(pdqId),
    pdqId,
    warning: pdqId
      ? ''
      : 'This location is outside harmonized PDQ analytical geography. Nearby SPVM published-report search may return few or no results.'
  };
}

export function createEmptyCaseForm() {
  return {
    caseId: '',
    title: '',
    category: CASE_CATEGORIES[0].id,
    reportedDate: '',
    occurrenceStart: '',
    occurrenceEnd: '',
    locationLabel: '',
    latitude: '',
    longitude: '',
    propertyType: '',
    makeModel: '',
    colour: '',
    identifier: '',
    characteristics: '',
    notes: '',
    searchRadiusKm: '1.5',
    searchTimeWindowHours: '48',
    includeAdjacentCategories: true
  };
}

export function createCaseWorkspace(form) {
  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  return {
    synthetic: true,
    label: DEMO_CASE_LABEL,
    case: {
      ...form,
      latitude: lat,
      longitude: lng,
      searchRadiusKm: Number(form.searchRadiusKm) || 1.5,
      searchTimeWindowHours: Number(form.searchTimeWindowHours) || 48,
      createdAt: new Date().toISOString()
    },
    relatedReports: [],
    pinnedRecordKeys: [],
    notes: [],
    openQuestions: [],
    activeTab: 'summary',
    selectedRecordKey: null,
    selectedTimelineId: null
  };
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function hoursBetween(aMs, bMs) {
  return Math.abs(aMs - bMs) / 3600000;
}

function reportMs(feature) {
  const d = feature.properties?.date;
  if (!d) return null;
  return Date.parse(`${d}T12:00:00`);
}

function categoriesForCase(caseCategory, includeAdjacent) {
  if (!includeAdjacent) return new Set([caseCategory]);
  return categoriesForRecentFilter(caseCategory);
}

/**
 * Surface potentially relevant SPVM published reports — never "linked crimes".
 */
export function searchPotentiallyRelevantReports(caseData, features, helpers = {}) {
  const { pointInArrondissement, arrondissements = [] } = helpers;
  const lat = caseData.latitude;
  const lng = caseData.longitude;
  const radiusKm = caseData.searchRadiusKm || 1.5;
  const windowH = caseData.searchTimeWindowHours || 48;
  const occStart = parseMs(caseData.occurrenceStart) ?? parseMs(`${caseData.reportedDate}T00:00`);
  const occEnd = parseMs(caseData.occurrenceEnd) ?? parseMs(`${caseData.reportedDate}T23:59`);
  const cats = categoriesForCase(caseData.category, caseData.includeAdjacentCategories !== false);
  const casePdq = helpers.casePdqId || null;
  const caseArrond = helpers.caseArrondissementId || null;

  const results = [];
  for (const f of features || []) {
    const coords = f.geometry?.coordinates;
    if (!coords?.length) continue;
    const [flng, flat] = coords;
    const dist = haversineKm(lat, lng, flat, flng);
    if (dist > radiusKm) continue;

    const rMs = reportMs(f);
    if (rMs == null) continue;
    const windowStart = Math.min(occStart, occEnd) - windowH * 3600000;
    const windowEnd = Math.max(occStart, occEnd) + windowH * 3600000;
    if (rMs < windowStart || rMs > windowEnd) continue;

    const cat = f.properties.category;
    const sameCategory = cats.has(cat);
    if (!sameCategory && caseData.includeAdjacentCategories === false) continue;
    if (!sameCategory && !cats.has(cat)) continue;

    const reasons = [];
    if (sameCategory) reasons.push('Same category');
    else reasons.push('Adjacent category');
    reasons.push(`${dist.toFixed(1)} km from case location`);
    const hFromStart = hoursBetween(rMs, occStart);
    const hFromEnd = hoursBetween(rMs, occEnd);
    const hNear = Math.min(hFromStart, hFromEnd);
    reasons.push(`Within ${Math.round(hNear)} hours of case window`);

    const pdq = f.properties.pdq;
    if (casePdq && String(pdq) === String(casePdq)) reasons.push('Same PDQ');
    else if (pdq) reasons.push(`PDQ ${pdq}`);

    let arrondName = null;
    if (pointInArrondissement && arrondissements.length) {
      for (const a of arrondissements) {
        if (pointInArrondissement(a.id, flng, flat)) {
          arrondName = a.name;
          if (caseArrond && a.id === caseArrond) reasons.push('Same arrondissement');
          else reasons.push(`Arrondissement: ${a.name}`);
          break;
        }
      }
    }

    const score = (sameCategory ? 40 : 15)
      + Math.max(0, 30 - dist * 10)
      + Math.max(0, 20 - hNear);

    results.push({
      feature: f,
      recordKey: f.properties.recordKey,
      distanceKm: dist,
      hoursFromCaseWindow: hNear,
      sameCategory,
      pdq,
      arrondissement: arrondName,
      reasons,
      relevanceScore: score
    });
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

export function buildCaseTimeline(caseData, relatedReports) {
  const items = [];
  const occStart = caseData.occurrenceStart;
  const occEnd = caseData.occurrenceEnd;
  const reported = caseData.reportedDate;

  items.push({
    id: 'case-reported',
    kind: 'synthetic',
    phase: 'during',
    at: reported || occStart,
    label: 'Case reported (SYNTHETIC)',
    detail: `${caseData.title} — ${categoryLabel(caseData.category)}`
  });
  items.push({
    id: 'case-occurrence',
    kind: 'synthetic',
    phase: 'during',
    at: occStart,
    label: 'Approximate occurrence window (SYNTHETIC)',
    detail: `${occStart || '—'} → ${occEnd || '—'}`
  });

  for (const r of relatedReports) {
    const p = r.feature.properties;
    const rMs = reportMs(r.feature);
    let phase = 'during';
    const occS = parseMs(occStart);
    const occE = parseMs(occEnd);
    if (occS && rMs < occS) phase = 'before';
    if (occE && rMs > occE) phase = 'after';
    items.push({
      id: `spvm-${p.recordKey}`,
      kind: 'spvm',
      phase,
      at: p.date,
      label: `${englishLabelForCategory(p.category)} (SPVM published)`,
      detail: `${p.date} · PDQ ${p.pdq} · ${r.distanceKm.toFixed(1)} km`,
      recordKey: p.recordKey,
      reasons: r.reasons
    });
  }

  items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return items;
}

export function computeCaseMetrics(caseData, relatedReports) {
  const sameCat = relatedReports.filter((r) => r.sameCategory).length;
  const pdqs = new Set(relatedReports.map((r) => r.pdq).filter(Boolean));
  const arronds = new Set(relatedReports.map((r) => r.arrondissement).filter(Boolean));
  return {
    nearbyReports: relatedReports.length,
    sameCategoryReports: sameCat,
    pdqsInvolved: pdqs.size,
    arrondissementsInvolved: arronds.size
  };
}

export function saveWorkspace(workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

export function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function resetWorkspace() {
  localStorage.removeItem(STORAGE_KEY);
}

export function buildCaseExplainContext(workspace, { lastMetrics, focusPdqId, labState } = {}) {
  if (!workspace?.case) return null;
  const related = (workspace.relatedReports || []).slice(0, 25).map((r) => ({
    recordKey: r.recordKey,
    category: r.feature.properties.category,
    date: r.feature.properties.date,
    pdq: r.pdq,
    distanceKm: Number(r.distanceKm.toFixed(2)),
    reasons: r.reasons,
    pinned: workspace.pinnedRecordKeys.includes(r.recordKey)
  }));
  const pinned = related.filter((r) => r.pinned);
  const timeline = buildCaseTimeline(workspace.case, workspace.relatedReports || []).slice(0, 30);
  const metrics = computeCaseMetrics(workspace.case, workspace.relatedReports || []);
  const hist = focusPdqId && lastMetrics?.[focusPdqId] ? {
    pdqId: focusPdqId,
    observed: lastMetrics[focusPdqId].observed,
    baseline: lastMetrics[focusPdqId].baseline,
    deviation: lastMetrics[focusPdqId].deviation,
    persistence: lastMetrics[focusPdqId].persistence,
    week: labState?.week
  } : null;

  return {
    syntheticLabel: DEMO_CASE_LABEL,
    case: {
      caseId: workspace.case.caseId,
      title: workspace.case.title,
      category: workspace.case.category,
      categoryLabel: categoryLabel(workspace.case.category),
      reportedDate: workspace.case.reportedDate,
      occurrenceStart: workspace.case.occurrenceStart,
      occurrenceEnd: workspace.case.occurrenceEnd,
      locationLabel: workspace.case.locationLabel,
      latitude: workspace.case.latitude,
      longitude: workspace.case.longitude,
      propertyType: workspace.case.propertyType,
      makeModel: workspace.case.makeModel,
      colour: workspace.case.colour,
      identifier: workspace.case.identifier,
      characteristics: workspace.case.characteristics,
      notes: workspace.case.notes,
      searchRadiusKm: workspace.case.searchRadiusKm,
      searchTimeWindowHours: workspace.case.searchTimeWindowHours
    },
    metrics,
    potentiallyRelevantReports: related,
    pinnedReports: pinned,
    analystNotes: (workspace.notes || []).slice(-20),
    openQuestions: (workspace.openQuestions || []).slice(-15),
    timeline,
    historicalPdqContext: hist,
    relatedIntelligence: buildRelatedIntelligenceRequest({
      reportDate: workspace.case.reportedDate,
      timeWindow: 'case',
      category: workspace.case.category,
      areaType: 'case',
      pdqId: hist?.pdqId || null
    })
  };
}

export function renderCaseFormHtml(form = createEmptyCaseForm()) {
  const catOpts = CASE_CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.id)}"${form.category === c.id ? ' selected' : ''}>${escapeHtml(c.label)}</option>`
  ).join('');
  return `
    <div class="case-form-grid">
      <label>Case ID<input name="caseId" value="${escapeHtml(form.caseId)}" /></label>
      <label>Case title<input name="title" value="${escapeHtml(form.title)}" /></label>
      <label>Incident/category<select name="category">${catOpts}</select></label>
      <label>Reported date<input name="reportedDate" type="date" value="${escapeHtml(form.reportedDate)}" /></label>
      <label>Occurrence start<input name="occurrenceStart" type="datetime-local" value="${escapeHtml(form.occurrenceStart)}" /></label>
      <label>Occurrence end<input name="occurrenceEnd" type="datetime-local" value="${escapeHtml(form.occurrenceEnd)}" /></label>
      <label class="case-form-span2">Location/address<input name="locationLabel" value="${escapeHtml(form.locationLabel)}" /></label>
      <label>Latitude<input name="latitude" value="${escapeHtml(form.latitude)}" /></label>
      <label>Longitude<input name="longitude" value="${escapeHtml(form.longitude)}" /></label>
      <label>Property/item type<input name="propertyType" value="${escapeHtml(form.propertyType)}" /></label>
      <label>Make/model<input name="makeModel" value="${escapeHtml(form.makeModel)}" /></label>
      <label>Colour<input name="colour" value="${escapeHtml(form.colour)}" /></label>
      <label>Identifier/serial/plate<input name="identifier" value="${escapeHtml(form.identifier)}" /></label>
      <label class="case-form-span2">Distinguishing characteristics<input name="characteristics" value="${escapeHtml(form.characteristics)}" /></label>
      <label class="case-form-span2">Notes<textarea name="notes" rows="2">${escapeHtml(form.notes)}</textarea></label>
      <label>Search radius (km)<input name="searchRadiusKm" type="number" step="0.1" min="0.2" max="25" value="${escapeHtml(form.searchRadiusKm)}" /></label>
      <label>Search time window (hours)<input name="searchTimeWindowHours" type="number" min="1" max="720" value="${escapeHtml(form.searchTimeWindowHours)}" /></label>
      <label class="case-form-span2 case-form-check"><input type="checkbox" name="includeAdjacentCategories"${form.includeAdjacentCategories !== false ? ' checked' : ''} /> Include adjacent categories in search</label>
    </div>`;
}

function readForm(dialog) {
  const data = {};
  dialog.querySelectorAll('input, select, textarea').forEach((el) => {
    const name = el.name;
    if (!name) return;
    if (el.type === 'checkbox') data[name] = el.checked;
    else data[name] = el.value;
  });
  return data;
}

export function wireCaseFormDialog(dialog, { onSubmit, onCoveragePreview } = {}) {
  const coverageEl = dialog.querySelector('#case-coverage-warn');
  const previewCoverage = () => {
    if (!onCoveragePreview || !coverageEl) return;
    onCoveragePreview(readForm(dialog), coverageEl);
  };

  dialog.querySelector('#case-load-sample')?.addEventListener('click', () => {
    const body = dialog.querySelector('#case-form-body') || dialog.querySelector('.case-form-body');
    if (body) body.innerHTML = renderCaseFormHtml(sampleCaseForm());
    previewCoverage();
  });
  dialog.querySelector('#case-form-body')?.addEventListener('change', previewCoverage);
  dialog.querySelector('#case-form-submit')?.addEventListener('click', () => {
    const form = readForm(dialog);
    if (!form.caseId?.trim() || !form.title?.trim()) {
      alert('Case ID and title are required.');
      return;
    }
    if (!Number.isFinite(Number(form.latitude)) || !Number.isFinite(Number(form.longitude))) {
      alert('Valid latitude and longitude are required.');
      return;
    }
    previewCoverage();
    onSubmit?.(form);
    dialog.close();
  });
  dialog.querySelector('#case-form-cancel')?.addEventListener('click', () => dialog.close());
  previewCoverage();
}

export function renderCaseWorkspaceHtml(workspace) {
  const c = workspace.case;
  const m = computeCaseMetrics(c, workspace.relatedReports);
  const tab = workspace.activeTab || 'summary';
  const tabs = [
    ['summary', 'Summary'],
    ['details', 'Case details'],
    ['related', 'Related reports'],
    ['timeline', 'Timeline'],
    ['notes', 'Notes'],
    ['intelligence', 'Related intelligence']
  ];

  const tabBar = tabs.map(([id, label]) =>
    `<button type="button" class="case-tab${tab === id ? ' is-active' : ''}" data-case-tab="${id}">${label}</button>`
  ).join('');

  let body = '';
  if (tab === 'summary') {
    body = `
      <div class="case-metrics">
        <div class="case-metric"><span>Nearby reports</span><strong>${m.nearbyReports}</strong></div>
        <div class="case-metric"><span>Same-category</span><strong>${m.sameCategoryReports}</strong></div>
        <div class="case-metric"><span>PDQs involved</span><strong>${m.pdqsInvolved}</strong></div>
        <div class="case-metric"><span>Arrondissements</span><strong>${m.arrondissementsInvolved}</strong></div>
      </div>
      <p class="case-disclaimer">Potentially relevant SPVM published reports are surfaced by distance, time, and category match. They are <strong>not</strong> linked crimes, same offender, or same series.</p>
      <section class="case-open-questions">
        <h4>Open questions</h4>
        <ul>${(workspace.openQuestions || []).map((q) => `<li>${escapeHtml(q)}</li>`).join('') || '<li class="case-muted">No open questions yet.</li>'}</ul>
        <div class="case-add-row">
          <input id="case-question-input" placeholder="Add an open question…" />
          <button type="button" id="case-add-question">Add</button>
        </div>
      </section>`;
  } else if (tab === 'details') {
    body = `<dl class="case-details-dl">
      <dt>Case ID</dt><dd>${escapeHtml(c.caseId)}</dd>
      <dt>Title</dt><dd>${escapeHtml(c.title)}</dd>
      <dt>Category</dt><dd>${escapeHtml(categoryLabel(c.category))}</dd>
      <dt>Location</dt><dd>${escapeHtml(c.locationLabel)}</dd>
      <dt>Reported</dt><dd>${escapeHtml(c.reportedDate || '—')}</dd>
      <dt>Occurrence window</dt><dd>${escapeHtml(c.occurrenceStart || '—')} → ${escapeHtml(c.occurrenceEnd || '—')} (SYNTHETIC)</dd>
      <dt>Property</dt><dd>${escapeHtml(c.propertyType || '—')}</dd>
      <dt>Make/model</dt><dd>${escapeHtml(c.makeModel || '—')}</dd>
      <dt>Colour</dt><dd>${escapeHtml(c.colour || '—')}</dd>
      <dt>Identifier</dt><dd>${escapeHtml(c.identifier || '—')}</dd>
      <dt>Characteristics</dt><dd>${escapeHtml(c.characteristics || '—')}</dd>
      <dt>Notes</dt><dd>${escapeHtml(c.notes || '—')}</dd>
      <dt>Search</dt><dd>${c.searchRadiusKm} km · ${c.searchTimeWindowHours} h window</dd>
    </dl>`;
  } else if (tab === 'related') {
    body = `<div class="case-related-list">${renderRelatedReportsList(workspace)}</div>`;
  } else if (tab === 'timeline') {
    body = `<div class="case-timeline">${renderTimelineHtml(workspace)}</div>`;
  } else if (tab === 'notes') {
    body = `
      <ul class="case-notes-list">${(workspace.notes || []).map((n) => `<li>${escapeHtml(n.text)} <span class="case-muted">${escapeHtml(n.at)}</span></li>`).join('') || '<li class="case-muted">No analyst notes.</li>'}</ul>
      <div class="case-add-row">
        <input id="case-note-input" placeholder="Add analyst note (demo/local only)…" />
        <button type="button" id="case-add-note">Add note</button>
      </div>`;
  } else if (tab === 'intelligence') {
    body = `<div class="case-ri-seam">
      <p class="case-ri-status">Future intelligence connector</p>
      <p>${escapeHtml(relatedIntelligencePlaceholder(buildRelatedIntelligenceRequest({ reportDate: c.reportedDate, category: c.category })))}</p>
      <p class="case-muted">Future normalized objects: Observation · Claim · Evidence · Event<br/>Sources: official · news · social · video · marketplace</p>
    </div>`;
  }

  const coverageWarn = workspace.coverage?.warning
    ? `<p class="case-coverage-warn" role="status">${escapeHtml(workspace.coverage.warning)}</p>`
    : '';

  return `
    <div class="case-workspace-banner">
      <div>
        <div class="case-workspace-kicker">DEMO CASE · SYNTHETIC</div>
        <h3 class="case-workspace-title">${escapeHtml(c.title)}</h3>
        <div class="case-workspace-meta">${escapeHtml(c.caseId)} · ${escapeHtml(categoryLabel(c.category))}</div>
      </div>
      <div class="case-workspace-actions">
        <button type="button" class="btn-ghost" id="case-save-workspace">Save workspace</button>
        <button type="button" class="btn-ghost" id="case-reset-demo">Reset demo case</button>
        <button type="button" class="btn-ghost" id="case-close-workspace">Close</button>
      </div>
    </div>
    <div class="case-workspace-loc">${escapeHtml(c.locationLabel)}<br/>
      <span class="case-muted">${escapeHtml(c.occurrenceStart || '')} → ${escapeHtml(c.occurrenceEnd || '')} · ${c.searchRadiusKm} km radius</span>
    </div>
    ${coverageWarn}
    <nav class="case-tabs">${tabBar}</nav>
    <div class="case-tab-body">${body}</div>`;
}

function renderRelatedReportsList(workspace) {
  const list = workspace.relatedReports || [];
  if (!list.length) return '<p class="case-muted">No potentially relevant SPVM published reports match the search criteria.</p>';
  return list.map((r) => {
    const p = r.feature.properties;
    const pinned = workspace.pinnedRecordKeys.includes(r.recordKey);
    const sel = workspace.selectedRecordKey === r.recordKey ? ' is-selected' : '';
    return `<article class="case-related-card${sel}${pinned ? ' is-pinned' : ''}" data-record-key="${escapeHtml(r.recordKey)}">
      <div class="case-related-card__head">
        <strong>${escapeHtml(englishLabelForCategory(p.category))}</strong>
        <span>${escapeHtml(p.date)} · PDQ ${escapeHtml(p.pdq)}</span>
      </div>
      <p class="case-related-why"><strong>Why surfaced:</strong> ${escapeHtml(r.reasons.join(' · '))}</p>
      <div class="case-related-actions">
        <button type="button" class="case-pin-btn" data-pin="${escapeHtml(r.recordKey)}">${pinned ? 'Unpin' : 'Pin to case'}</button>
        <button type="button" class="case-select-btn" data-select="${escapeHtml(r.recordKey)}">Show on map</button>
      </div>
    </article>`;
  }).join('');
}

function renderTimelineHtml(workspace) {
  const items = buildCaseTimeline(workspace.case, workspace.relatedReports || []);
  return items.map((item) => {
    const cls = `case-tl-item case-tl--${item.kind} case-tl--${item.phase}${workspace.selectedTimelineId === item.id ? ' is-selected' : ''}`;
    return `<button type="button" class="${cls}" data-timeline-id="${escapeHtml(item.id)}" data-record-key="${escapeHtml(item.recordKey || '')}">
      <span class="case-tl-time">${escapeHtml(String(item.at).slice(0, 16))}</span>
      <span class="case-tl-label">${escapeHtml(item.label)}</span>
      <span class="case-tl-detail">${escapeHtml(item.detail)}</span>
    </button>`;
  }).join('');
}

export { CASE_CATEGORIES };
