/**
 * Thin HISTORY host. Viewport is the AOI. Catalogue ranks and lists.
 * Painter stays where the operator put the camera. No lab UI. No held engine.
 */

import { formatImageDate, IMAGE_DATE_UNKNOWN } from '../imagery/command/image-date.js';
import { IMAGE_SURFACE_FAILURE } from '../imagery/command/image-surface-mode.js';
import {
  catalogueHref,
  fetchHistoryBest,
  fetchHistoryReceipt,
  fetchHistorySearch,
  fetchHistoryTimeline,
  paintableTemplateFromReceipt,
  templateFromObservation
} from '../imagery/historical/history-catalog-client.js';
import {
  destroyHistoryPainter,
  getHistoryPainterAoi,
  getHistoryPainterPaint,
  getHistoryPainterViewpoint,
  initHistoryPainter,
  paintHistoryCompare,
  paintHistoryTemplate,
  setHistoryPainterListener,
  setHistoryPainterSettleListener,
  setHistorySwipeRatio
} from '../imagery/historical/history-painter.js';
import { formatDecimalDegrees } from '../map/coordinate-formats.js';
import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import { getMapView } from '../map/map-foundation.js';

function observationIdOf(item) {
  return item?.imageryObservationId || item?.observationId || item?.id || null;
}

function captureKey(item) {
  const text = String(item?.captureStart || item?.captureDate || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}/.test(text)) return text.slice(0, 4);
  return '';
}

function operatorSource(item) {
  const provider = String(item?.provider || '');
  const product = String(item?.providerProduct || '');
  const blob = `${provider} ${product}`;
  if (/NEARMAP/i.test(blob)) return 'Nearmap';
  if (/WAYBACK|VIVID|VPP_|World Imagery/i.test(blob) || provider === 'ESRI_WAYBACK') return 'Esri Wayback';
  if (provider === 'CMM' || /CMM/i.test(blob)) return 'CMM';
  if (/GOOGLE/i.test(blob)) return 'Google';
  if (/MRNF/i.test(blob)) return 'MRNF Québec';
  if (/montreal|phototh/i.test(blob)) return 'Montréal archives';
  return product && product !== 'UNKNOWN' ? product : (provider || 'SOURCE UNKNOWN');
}

function mosaicLine(item) {
  const product = String(item?.providerProduct || '').trim();
  const operator = operatorSource(item);
  if (!product || product === 'UNKNOWN' || product === operator) return '';
  if (product === 'Nearmap Vertical' || product === 'Esri World Imagery Wayback') return '';
  return product;
}

function resolutionLabel(receipt) {
  const meters = Number(receipt?.resolutionM);
  if (!Number.isFinite(meters) || meters <= 0) return 'RESOLUTION UNKNOWN';
  if (meters < 1) return `${Math.round(meters * 100)} CM`;
  return `${Number.isInteger(meters) ? meters : meters.toFixed(1)} M`;
}

function aoiKey(value) {
  if (!value) return '';
  return [value.xmin, value.ymin, value.xmax, value.ymax, value.zoom]
    .map((item) => Number(item).toFixed(6))
    .join(',');
}

function captureLabel(receipt) {
  return formatImageDate({
    captureDate: receipt?.captureDate,
    capturePrecision: 'DAY'
  });
}

function provenanceLine(receipt) {
  if (!receipt) return '';
  const operator = operatorSource(receipt);
  const resolution = resolutionLabel(receipt);
  const mosaic = mosaicLine(receipt);
  const attribution = String(receipt.attribution || '').trim();
  const parts = [operator, resolution];
  if (mosaic) parts.push(mosaic);
  if (attribution && attribution !== 'UNKNOWN' && attribution.toLowerCase() !== operator.toLowerCase()) {
    parts.push(attribution);
  }
  return parts.filter(Boolean).join(' · ');
}

function placeLine(view) {
  const longitude = Number(view?.longitude);
  const latitude = Number(view?.latitude);
  const coords = formatDecimalDegrees(latitude, longitude, 5);
  const address = getActiveSpatialFocus()?.resolvedAddress;
  if (address && coords) return `${address} · ${coords}`;
  return address || coords || '';
}

function aoiFromMapView() {
  const view = getMapView();
  const longitude = Number(view?.center?.longitude);
  const latitude = Number(view?.center?.latitude);
  const zoom = Number(view?.zoom);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const aoi = {
    longitude,
    latitude,
    zoom: Number.isFinite(zoom) && zoom >= 3 && zoom <= 22 ? Math.round(zoom) : 17
  };
  try {
    const width = Number(view.width);
    const height = Number(view.height);
    if (width > 0 && height > 0 && typeof view.toMap === 'function') {
      const sw = view.toMap({ x: 0, y: height });
      const ne = view.toMap({ x: width, y: 0 });
      const west = Number(sw?.longitude);
      const south = Number(sw?.latitude);
      const east = Number(ne?.longitude);
      const north = Number(ne?.latitude);
      if ([west, south, east, north].every(Number.isFinite)) {
        aoi.xmin = Math.min(west, east);
        aoi.ymin = Math.min(south, north);
        aoi.xmax = Math.max(west, east);
        aoi.ymax = Math.max(south, north);
      }
    }
  } catch {
    /* center-only AOI is enough to browse */
  }
  return aoi;
}

function pickFromGroup(group, preferredId, ranked) {
  if (!group?.items?.length) return null;
  if (preferredId) {
    const kept = group.items.find((item) => observationIdOf(item) === preferredId);
    if (kept) return kept;
  }
  for (const rankedItem of ranked || []) {
    const match = group.items.find((item) => observationIdOf(item) === observationIdOf(rankedItem));
    if (match) return match;
  }
  return group.items[0];
}

function escapeText(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function observationDate(item) {
  return formatImageDate({
    captureDate: item?.captureStart || item?.captureDate,
    capturePrecision: 'DAY'
  });
}

function observationSource(item) {
  const resolution = Number.isFinite(Number(item?.resolutionM)) ? resolutionLabel(item) : '';
  return [operatorSource(item), resolution].filter(Boolean).join(' · ');
}

function nowPlayingLine(receiptPayload, comparePayload, compareEnabled) {
  if (!receiptPayload) return 'HISTORY';
  const date = captureLabel(receiptPayload);
  if (compareEnabled && comparePayload) {
    return `HISTORY · A ${date}  |  B ${captureLabel(comparePayload)}`;
  }
  return `HISTORY · ${operatorSource(receiptPayload)} · ${date} · ${resolutionLabel(receiptPayload)}`;
}

function fillCaption(node, receiptPayload, visible, view) {
  if (!node) return;
  if (!visible || !receiptPayload) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  const dateEl = node.querySelector('[data-iqai-history-caption-date]');
  const sourceEl = node.querySelector('[data-iqai-history-caption-source]');
  const placeEl = node.querySelector('[data-iqai-history-caption-place]');
  if (dateEl) dateEl.textContent = captureLabel(receiptPayload);
  if (sourceEl) sourceEl.textContent = provenanceLine(receiptPayload);
  if (placeEl) placeEl.textContent = placeLine(view);
}

export function bindHistoryHost(root, options = {}) {
  const onUseOnView = options.onUseOnView;
  const stage = root?.querySelector('[data-iqai-history-stage]');
  const bar = root?.querySelector('[data-iqai-history-bar]');
  const canvasHost = root?.querySelector('[data-iqai-history-canvas-host]');
  const captionA = root?.querySelector('[data-iqai-history-caption="a"]');
  const captionB = root?.querySelector('[data-iqai-history-caption="b"]');
  const library = root?.querySelector('[data-iqai-history-library]');
  const libraryList = root?.querySelector('[data-iqai-history-library-list]');
  const libraryPlace = root?.querySelector('[data-iqai-history-library-place]');
  if (!stage || !canvasHost) return null;

  let aoi = null;
  let catalogList = [];
  let ranked = [];
  let groups = [];
  let dateIndex = -1;
  let altIndex = 0;
  let libraryOpen = false;
  let libraryPainted = '';
  let receipt = null;
  let compareReceipt = null;
  let status = '';
  let displayConfirmed = false;
  let catalogueOnly = false;
  let compareOn = false;
  let swipeRatio = 0.5;
  let open = false;
  let enterDone = false;
  let discoverGen = 0;
  let paintGen = 0;

  setHistoryPainterListener((paint) => {
    if (!open || catalogueOnly) return;
    displayConfirmed = paint?.confirmed === true;
    if (displayConfirmed) status = '';
    else if (status === IMAGE_SURFACE_FAILURE.LOOKING) {
      /* keep looking until tiles arrive */
    } else if (status === IMAGE_SURFACE_FAILURE.SELECTED_NOT_DISPLAYED || !status) {
      status = IMAGE_SURFACE_FAILURE.SELECTED_NOT_DISPLAYED;
    }
    paintBar();
  });

  setHistoryPainterSettleListener(() => {
    if (!open || !enterDone) return;
    void rediscover({
      keepDate: captureKey(currentObservation()),
      keepId: observationIdOf(currentObservation())
    });
  });

  function currentGroup() {
    return dateIndex >= 0 ? groups[dateIndex] || null : null;
  }

  function currentObservation() {
    const group = currentGroup();
    return group?.items?.[altIndex] || group?.items?.[0] || null;
  }

  function compareObservation() {
    if (!compareOn || groups.length < 2 || dateIndex < 0) return null;
    const other = dateIndex > 0 ? groups[dateIndex - 1] : groups[dateIndex + 1];
    return other?.items?.[0] || null;
  }

  function groundId() {
    return observationIdOf(receipt);
  }

  function bestPaintableId() {
    for (const item of ranked) {
      const match = catalogList.find((entry) => observationIdOf(entry) === observationIdOf(item));
      if (match && templateFromObservation(match)) return observationIdOf(match);
    }
    const first = catalogList.find((item) => templateFromObservation(item));
    return observationIdOf(first);
  }

  function libraryModel() {
    const currentId = groundId();
    const bestId = bestPaintableId();
    const paintable = catalogList.filter((item) => templateFromObservation(item));
    const held = catalogList.filter((item) => !templateFromObservation(item));
    const byDate = new Map();
    for (const item of paintable) {
      const date = captureKey(item) || observationIdOf(item) || IMAGE_DATE_UNKNOWN;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(item);
    }
    const rankIndex = new Map(ranked.map((item, index) => [observationIdOf(item), index]));
    function sortItems(items) {
      return [...items].sort((a, b) => {
        const idA = observationIdOf(a);
        const idB = observationIdOf(b);
        if (idA === bestId) return -1;
        if (idB === bestId) return 1;
        if (idA === currentId) return -1;
        if (idB === currentId) return 1;
        return (rankIndex.get(idA) ?? 9999) - (rankIndex.get(idB) ?? 9999);
      });
    }
    const dates = [...byDate.keys()].sort((a, b) => String(b).localeCompare(String(a)));
    const bestDate = captureKey(paintable.find((item) => observationIdOf(item) === bestId));
    const orderedDates = bestDate
      ? [bestDate, ...dates.filter((date) => date !== bestDate)]
      : dates;
    const groups = orderedDates.map((date) => ({
      date,
      best: date === bestDate,
      items: sortItems(byDate.get(date) || []).map((item) => {
        const id = observationIdOf(item);
        return {
          id,
          item,
          paintable: true,
          onGround: Boolean(id) && id === currentId,
          best: Boolean(id) && id === bestId
        };
      })
    }));
    return {
      groups,
      held: held.map((item) => ({
        id: observationIdOf(item),
        item,
        paintable: false,
        onGround: false,
        best: false
      }))
    };
  }

  function librarySignature(model) {
    const rows = model.groups.flatMap((group) => group.items).concat(model.held);
    return rows.map((row) => [row.id, row.onGround ? 1 : 0, row.best ? 1 : 0, row.paintable ? 1 : 0].join(':')).join('|');
  }

  function rowHtml(row) {
    const source = escapeText(observationSource(row.item));
    const mosaic = escapeText(mosaicLine(row.item));
    const id = escapeText(row.id);
    const mosaicLineHtml = mosaic ? `<p class="iqai-v2-history-library__mosaic">${mosaic}</p>` : '';
    if (!row.paintable) {
      return `<article class="iqai-v2-history-library__row is-catalogue-only" data-iqai-history-library-id="${id}">
        <p>${escapeText(observationDate(row.item))}</p>
        <p>${source}</p>
        ${mosaicLineHtml}
        <p>CATALOGUE ONLY</p>
      </article>`;
    }
    const classes = [
      'iqai-v2-history-library__row',
      row.onGround ? 'is-ground' : '',
      row.best ? 'is-best' : ''
    ].filter(Boolean).join(' ');
    const status = row.onGround
      ? `<p>${row.best ? 'ON GROUND · BEST FOR THIS VIEW' : 'ON GROUND'}</p>`
      : (row.best ? '<p>BEST FOR THIS VIEW</p>' : '');
    const button = row.onGround
      ? ''
      : `<button type="button" data-iqai-history-show-in-map="${id}">USE ON THIS VIEW</button>`;
    return `<article class="${classes}" data-iqai-history-library-id="${id}">
      <p>${source}</p>
      ${mosaicLineHtml}
      ${status}
      ${button}
    </article>`;
  }

  function paintLibrary(view) {
    if (!library) return;
    library.hidden = !libraryOpen;
    if (libraryPlace) libraryPlace.textContent = placeLine(view) || 'THIS VIEW';
    if (!libraryList) return;
    if (!libraryOpen) {
      libraryList.innerHTML = '';
      libraryPainted = '';
      return;
    }
    const model = libraryModel();
    const signature = `${groundId() || ''}|${librarySignature(model)}`;
    if (signature === libraryPainted) return;
    const scroll = libraryList.scrollTop;
    const groupsHtml = model.groups.map((group) => {
      const label = escapeText(observationDate(group.items[0]?.item) || group.date);
      const best = group.best ? ' is-best-date' : '';
      return `<section class="iqai-v2-history-library__group${best}" data-iqai-history-library-date="${escapeText(group.date)}">
        <header>${label}</header>
        ${group.items.map((row) => rowHtml(row)).join('')}
      </section>`;
    }).join('');
    const heldHtml = model.held.length
      ? `<section class="iqai-v2-history-library__group is-held">
        <header>LISTED · NOT ON THIS VIEW</header>
        ${model.held.map((row) => rowHtml(row)).join('')}
      </section>`
      : '';
    libraryList.innerHTML = groupsHtml + heldHtml;
    libraryList.scrollTop = scroll;
    libraryPainted = signature;
  }

  function paintBar() {
    if (!bar) return;
    bar.hidden = !open;
    const now = bar.querySelector('[data-iqai-history-now]');
    const date = bar.querySelector('[data-iqai-history-date]');
    const source = bar.querySelector('[data-iqai-history-source]');
    const resolution = bar.querySelector('[data-iqai-history-resolution]');
    const state = bar.querySelector('[data-iqai-history-status]');
    const prev = bar.querySelector('[data-iqai-history-step="-1"]');
    const next = bar.querySelector('[data-iqai-history-step="1"]');
    const compare = bar.querySelector('[data-iqai-history-compare]');
    const libraryToggles = root.querySelectorAll('[data-iqai-library-toggle]');
    const removeButtons = root.querySelectorAll('[data-iqai-history-remove]');
    const catalog = root.querySelector('[data-iqai-history-catalogue]');
    const swipe = bar.querySelector('[data-iqai-history-swipe]');
    const swipeInput = bar.querySelector('[data-iqai-history-swipe-input]');
    if (now) now.textContent = nowPlayingLine(receipt, compareReceipt, compareOn);
    if (date) {
      const currentDate = receipt ? captureLabel(receipt) : IMAGE_DATE_UNKNOWN;
      date.textContent = compareOn && compareReceipt
        ? `A ${currentDate}  |  B ${captureLabel(compareReceipt)}`
        : currentDate;
    }
    if (source) {
      source.textContent = receipt ? operatorSource(receipt) : '';
      source.disabled = true;
    }
    if (resolution) resolution.textContent = receipt ? resolutionLabel(receipt) : '';
    if (state) {
      state.hidden = !status;
      state.textContent = status;
    }
    if (prev) prev.disabled = dateIndex <= 0;
    if (next) next.disabled = dateIndex < 0 || dateIndex >= groups.length - 1;
    if (compare) {
      compare.disabled = groups.length < 2;
      compare.setAttribute('aria-pressed', compareOn ? 'true' : 'false');
    }
    if (libraryToggles.length) {
      for (const button of libraryToggles) {
        button.setAttribute('aria-pressed', libraryOpen ? 'true' : 'false');
      }
    }
    for (const button of removeButtons) {
      if (button.closest('[data-iqai-history-library]')) button.hidden = !open;
    }
    if (swipe) swipe.hidden = !compareOn;
    if (swipeInput) swipeInput.value = String(Math.round(swipeRatio * 100));
    if (catalog && aoi) catalog.href = catalogueHref(aoi);
    const view = getHistoryPainterViewpoint() || aoi;
    fillCaption(captionA, receipt, open, view);
    fillCaption(captionB, compareReceipt, open && compareOn, view);
    paintLibrary(view);
  }

  async function showCurrent() {
    const gen = paintGen + 1;
    paintGen = gen;
    const current = currentObservation();
    if (!current) {
      receipt = null;
      compareReceipt = null;
      status = IMAGE_SURFACE_FAILURE.NONE;
      displayConfirmed = false;
      catalogueOnly = false;
      await paintHistoryTemplate(null);
      paintBar();
      return snapshot();
    }
    const id = observationIdOf(current);
    let receiptPayload = null;
    try {
      receiptPayload = id ? await fetchHistoryReceipt(id, aoi) : null;
    } catch {
      receiptPayload = null;
    }
    if (gen !== paintGen) return snapshot();
    receipt = receiptPayload;
    const template = paintableTemplateFromReceipt(receipt) || templateFromObservation(current);
    catalogueOnly = !template;
    if (!template) {
      status = 'CATALOGUE ONLY';
      displayConfirmed = false;
      await paintHistoryTemplate(null);
      paintBar();
      return snapshot();
    }
    const other = compareObservation();
    let compareTemplate = null;
    compareReceipt = null;
    if (other) {
      const otherId = observationIdOf(other);
      try {
        compareReceipt = otherId ? await fetchHistoryReceipt(otherId, aoi) : null;
      } catch {
        compareReceipt = null;
      }
      compareTemplate = paintableTemplateFromReceipt(compareReceipt) || templateFromObservation(other);
    }
    if (gen !== paintGen) return snapshot();
    status = IMAGE_SURFACE_FAILURE.LOOKING;
    paintBar();
    const paint = compareTemplate
      ? await paintHistoryCompare(template, compareTemplate, swipeRatio)
      : await paintHistoryTemplate(template);
    if (gen !== paintGen) return snapshot();
    displayConfirmed = paint?.confirmed === true;
    status = displayConfirmed ? '' : IMAGE_SURFACE_FAILURE.SELECTED_NOT_DISPLAYED;
    paintBar();
    return snapshot();
  }

  function readPlace() {
    const focus = getActiveSpatialFocus();
    const view = getMapView();
    const longitude = Number(focus?.longitude ?? view?.center?.longitude);
    const latitude = Number(focus?.latitude ?? view?.center?.latitude);
    const zoom = Number(view?.zoom);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return {
      longitude,
      latitude,
      zoom: Number.isFinite(zoom) && zoom >= 14 && zoom <= 20 ? Math.round(zoom) : 17
    };
  }

  async function rediscover({ keepDate, keepId, listOnly } = {}) {
    const nextAoi = getHistoryPainterAoi() || aoi;
    if (!nextAoi) return snapshot();
    if (aoiKey(nextAoi) === aoiKey(aoi) && groups.length && keepDate) {
      const still = groups.some((group) => group.date === keepDate);
      if (still) return snapshot();
    }
    aoi = nextAoi;
    const gen = discoverGen + 1;
    discoverGen = gen;
    status = IMAGE_SURFACE_FAILURE.LOOKING;
    paintBar();
    let timeline = [];
    try {
      const found = await fetchHistoryTimeline(aoi);
      timeline = found.observations || [];
    } catch {
      if (gen !== discoverGen) return snapshot();
      groups = [];
      dateIndex = -1;
      altIndex = 0;
      status = IMAGE_SURFACE_FAILURE.NETWORK;
      catalogList = [];
      ranked = [];
      paintBar();
      return snapshot();
    }
    if (gen !== discoverGen) return snapshot();
    const paintable = timeline.filter((item) => templateFromObservation(item));
    const nextGroups = [];
    const seen = new Map();
    for (const item of paintable) {
      const date = captureKey(item) || observationIdOf(item);
      if (!seen.has(date)) {
        seen.set(date, nextGroups.length);
        nextGroups.push({ date, items: [] });
      }
      nextGroups[seen.get(date)].items.push(item);
    }
    groups = nextGroups;
    catalogList = timeline;
    ranked = await fetchHistorySearch(aoi).catch(() => []);
    const best = await fetchHistoryBest(aoi, keepDate).catch(() => null);
    if (gen !== discoverGen) return snapshot();
    if (keepId) {
      for (let index = 0; index < groups.length; index += 1) {
        const alt = groups[index].items.findIndex((item) => observationIdOf(item) === keepId);
        if (alt < 0) continue;
        dateIndex = index;
        altIndex = alt;
        if (observationIdOf(receipt) === keepId) {
          paintBar();
          return snapshot();
        }
        return showCurrent();
      }
    }
    let nextDate = keepDate;
    if (nextDate && !groups.some((group) => group.date === nextDate)) {
      nextDate = captureKey(best);
    }
    if (!nextDate || !groups.some((group) => group.date === nextDate)) {
      const bestPaintable = (ranked.length ? ranked : paintable).find((item) => templateFromObservation(item));
      nextDate = captureKey(bestPaintable) || groups[groups.length - 1]?.date || '';
    }
    dateIndex = groups.findIndex((group) => group.date === nextDate);
    if (dateIndex < 0) dateIndex = groups.length ? groups.length - 1 : -1;
    const group = currentGroup();
    const picked = pickFromGroup(group, keepId, ranked);
    altIndex = Math.max(0, group?.items?.findIndex((item) => observationIdOf(item) === observationIdOf(picked)) || 0);
    if (compareOn && groups.length < 2) compareOn = false;
    if (listOnly || !open) {
      paintBar();
      return snapshot();
    }
    return showCurrent();
  }

  async function enter(place, options = {}) {
    const source = place || aoiFromMapView() || readPlace();
    if (!source || !Number.isFinite(Number(source.longitude)) || !Number.isFinite(Number(source.latitude))) {
      throw new Error(IMAGE_SURFACE_FAILURE.SOURCE_UNAVAILABLE);
    }
    const zoom = Number(source.zoom);
    aoi = {
      longitude: Number(source.longitude),
      latitude: Number(source.latitude),
      zoom: Number.isFinite(zoom) && zoom >= 14 && zoom <= 20 ? Math.round(zoom) : 17
    };
    open = true;
    enterDone = false;
    compareOn = false;
    libraryOpen = options.libraryOpen === true;
    swipeRatio = 0.5;
    stage.hidden = false;
    status = IMAGE_SURFACE_FAILURE.LOOKING;
    paintBar();
    destroyHistoryPainter();
    await initHistoryPainter(canvasHost, aoi);
    aoi = getHistoryPainterAoi() || aoi;
    await rediscover({
      keepId: options.keepId || null,
      keepDate: options.keepDate || captureKey(catalogList.find((item) => observationIdOf(item) === options.keepId))
    });
    enterDone = true;
    return snapshot();
  }

  async function step(delta) {
    if (!open || !groups.length) return snapshot();
    dateIndex = Math.max(0, Math.min(groups.length - 1, dateIndex + Number(delta || 0)));
    const ranked = await fetchHistorySearch(aoi, currentGroup()?.date).catch(() => []);
    const picked = pickFromGroup(currentGroup(), null, ranked);
    altIndex = Math.max(0, currentGroup()?.items?.findIndex((item) => observationIdOf(item) === observationIdOf(picked)) || 0);
    return showCurrent();
  }

  async function browse(place) {
    const source = aoiFromMapView() || place || readPlace();
    if (!source || !Number.isFinite(Number(source.longitude)) || !Number.isFinite(Number(source.latitude))) {
      throw new Error(IMAGE_SURFACE_FAILURE.SOURCE_UNAVAILABLE);
    }
    const zoom = Number(source.zoom);
    aoi = {
      ...source,
      longitude: Number(source.longitude),
      latitude: Number(source.latitude),
      zoom: Number.isFinite(zoom) && zoom >= 3 && zoom <= 22 ? Math.round(zoom) : 17
    };
    libraryOpen = true;
    await rediscover({ listOnly: true });
    return snapshot();
  }

  async function showInMap(observationId) {
    const id = String(observationId || '');
    if (!id) return snapshot();
    if (!open) {
      if (typeof onUseOnView === 'function') await onUseOnView(id);
      return snapshot();
    }
    for (let index = 0; index < groups.length; index += 1) {
      const alt = groups[index].items.findIndex((item) => observationIdOf(item) === id);
      if (alt < 0) continue;
      dateIndex = index;
      altIndex = alt;
      return showCurrent();
    }
    return snapshot();
  }

  function toggleLibrary(next = !libraryOpen) {
    libraryOpen = Boolean(next);
    paintBar();
    return snapshot();
  }

  async function cycleSource() {
    const items = currentGroup()?.items || [];
    if (!open || items.length <= 1) return snapshot();
    altIndex = (altIndex + 1) % items.length;
    return showCurrent();
  }

  async function toggleCompare() {
    if (!open || groups.length < 2) return snapshot();
    compareOn = !compareOn;
    return showCurrent();
  }

  function setSwipe(ratio) {
    swipeRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
    setHistorySwipeRatio(swipeRatio);
    paintBar();
    return snapshot();
  }

  function leave() {
    enterDone = false;
    open = false;
    groups = [];
    dateIndex = -1;
    altIndex = 0;
    receipt = null;
    compareReceipt = null;
    status = '';
    displayConfirmed = false;
    catalogueOnly = false;
    compareOn = false;
    libraryOpen = false;
    libraryPainted = '';
    catalogList = [];
    ranked = [];
    destroyHistoryPainter();
    fillCaption(captionA, null, false);
    fillCaption(captionB, null, false);
    if (library) library.hidden = true;
    if (bar) bar.hidden = true;
    stage.hidden = true;
    return snapshot();
  }

  function snapshot() {
    const current = currentObservation();
    return {
      open,
      aoi,
      viewpoint: getHistoryPainterViewpoint(),
      timeline: groups.flatMap((group) => group.items),
      dates: groups.map((group) => group.date),
      index: dateIndex,
      altIndex,
      receipt,
      compareReceipt,
      compareOn,
      swipeRatio,
      displayConfirmed,
      catalogueOnly,
      status,
      paint: getHistoryPainterPaint(),
      date: receipt
        ? formatImageDate({ captureDate: receipt.captureDate, capturePrecision: 'DAY' })
        : IMAGE_DATE_UNKNOWN,
      libraryOpen,
      observationId: observationIdOf(current)
    };
  }

  root.addEventListener('click', (event) => {
    const libraryClose = event.target.closest('[data-iqai-history-library-close]');
    if (libraryClose && root.contains(libraryClose)) {
      toggleLibrary(false);
      return;
    }
    const showButton = event.target.closest('[data-iqai-history-show-in-map]');
    if (showButton && root.contains(showButton)) {
      void showInMap(showButton.getAttribute('data-iqai-history-show-in-map'));
      return;
    }
    if (!open) return;
    const stepButton = event.target.closest('[data-iqai-history-step]');
    if (stepButton && root.contains(stepButton)) {
      void step(Number(stepButton.getAttribute('data-iqai-history-step')));
      return;
    }
    const sourceButton = event.target.closest('[data-iqai-history-source]');
    if (sourceButton && root.contains(sourceButton)) {
      return;
    }
    const compareButton = event.target.closest('[data-iqai-history-compare]');
    if (compareButton && root.contains(compareButton) && compareButton.matches('button')) {
      void toggleCompare();
    }
  });

  root.addEventListener('input', (event) => {
    if (!open) return;
    const swipeInput = event.target.closest('[data-iqai-history-swipe-input]');
    if (swipeInput && root.contains(swipeInput)) {
      setSwipe(Number(swipeInput.value) / 100);
    }
  });

  return Object.freeze({
    enter,
    browse,
    leave,
    step,
    showInMap,
    toggleLibrary,
    paint: paintBar,
    snapshot,
    readPlace
  });
}
