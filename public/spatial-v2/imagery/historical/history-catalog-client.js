/**
 * Temporal Catalogue client for Spatial HISTORY.
 * Catalogue owns dates, ranking, and the imagery list. Does not paint pixels.
 */

const IMAGERY_BASE = '/temporal/imagery';
const UNKNOWN = 'UNKNOWN';

export function queryAoi(aoi) {
  const params = new URLSearchParams();
  const xmin = Number(aoi?.xmin);
  const ymin = Number(aoi?.ymin);
  const xmax = Number(aoi?.xmax);
  const ymax = Number(aoi?.ymax);
  if ([xmin, ymin, xmax, ymax].every(Number.isFinite)) {
    params.set('xmin', String(xmin));
    params.set('ymin', String(ymin));
    params.set('xmax', String(xmax));
    params.set('ymax', String(ymax));
  }
  if (Number.isFinite(Number(aoi?.longitude))) params.set('lon', String(aoi.longitude));
  if (Number.isFinite(Number(aoi?.latitude))) params.set('lat', String(aoi.latitude));
  return params;
}

function captureSort(value) {
  const text = String(value?.captureStart || value?.captureDate || '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

export function isPaintableTemplate(template) {
  const value = String(template || '').trim();
  if (!value || value === UNKNOWN) return false;
  return /\{z\}|\{level\}|\{x\}|\{col\}/.test(value);
}

export function paintableTemplateFromReceipt(receipt) {
  let template = String(receipt?.tileTemplate || '').trim();
  if (!template || template === UNKNOWN) return null;
  const release = receipt?.releaseNum ?? receipt?.sourceReleaseId ?? receipt?.sourceIdentity?.releaseNum;
  if (template.includes('{releaseNum}') && Number.isFinite(Number(release))) {
    template = template.replaceAll('{releaseNum}', String(release));
  }
  if (template.includes('{releaseNum}')) return null;
  return isPaintableTemplate(template) ? template : null;
}

export function templateFromObservation(observation) {
  const fromReceipt = paintableTemplateFromReceipt(observation);
  if (fromReceipt) return fromReceipt;
  const provider = String(observation?.provider || '');
  if (provider === 'ESRI_WAYBACK') {
    const releaseNum = observation.sourceReleaseId;
    if (!releaseNum || releaseNum === UNKNOWN) return null;
    return `/temporal/imagery/tiles/wayback/${encodeURIComponent(releaseNum)}/{z}/{y}/{x}`;
  }
  if (provider === 'NEARMAP') {
    const surveyId = observation.sourceId;
    if (!surveyId || surveyId === UNKNOWN) return null;
    return `/temporal/imagery/tiles/nearmap/${encodeURIComponent(surveyId)}/{z}/{x}/{y}.jpg`;
  }
  return null;
}

export async function fetchHistoryTimeline(aoi) {
  const response = await fetch(`${IMAGERY_BASE}/timeline?${queryAoi(aoi)}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'Timeline unavailable.');
  }
  const observations = [...(payload.observations || [])].sort((a, b) => (
    captureSort(a).localeCompare(captureSort(b))
  ));
  return { aoi: payload.aoi || aoi, observations };
}

export async function fetchHistoryBest(aoi, date) {
  const params = queryAoi(aoi);
  if (date) params.set('date', String(date));
  const response = await fetch(`${IMAGERY_BASE}/best?${params}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'Best observation unavailable.');
  }
  return payload.bestView?.observation || null;
}

export async function fetchHistorySearch(aoi, date) {
  const params = queryAoi(aoi);
  params.set('operation', 'VIEW');
  if (date) params.set('date', String(date));
  const response = await fetch(`${IMAGERY_BASE}/search?${params}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'Search unavailable.');
  }
  return payload.qualified || [];
}

export async function fetchHistoryReceipt(observationId, aoi) {
  const id = encodeURIComponent(String(observationId || ''));
  const response = await fetch(`${IMAGERY_BASE}/receipt/${id}?${queryAoi(aoi)}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || 'Receipt unavailable.');
  }
  return payload.activationReceipt || payload;
}

export function catalogueHref(aoi) {
  return `/temporal-catalog/?${queryAoi(aoi)}`;
}
