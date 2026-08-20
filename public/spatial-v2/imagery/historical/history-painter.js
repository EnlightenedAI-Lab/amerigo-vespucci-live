/**
 * Minimal XYZ canvas painter for HISTORY.
 * Paints receipt.tileTemplate only. Not MapView. Not the lab UI.
 * Pan and zoom stay on the same selected template.
 */

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 22;
const TILE_CACHE_LIMIT = 512;
const WHEEL_STEP = 80;
const ZOOM_COOLDOWN_MS = 90;
const SETTLE_MS = 300;

let host = null;
let canvas = null;
let scratch = null;
let ctx = null;
let scratchCtx = null;
let center = null;
let zoomLevel = 17;
let urlTemplate = null;
let compareTemplate = null;
let swipeRatio = 0.5;
let drawGeneration = 0;
let resizeObserver = null;
let resizeTimer = 0;
let lastPaint = { paintedTiles: 0, failedTiles: 0, confirmed: false };
let dragging = false;
let dragOrigin = null;
let dragCenter = null;
let lastDrag = null;
let wheelDelta = 0;
let wheelPoint = { x: 0, y: 0 };
let wheelFrame = 0;
let lastZoomAt = 0;
let paintListener = null;
let settleListener = null;
let settleTimer = 0;
let draggingSwipe = false;
const tileCache = new Map();
const inFlight = new Map();
const listeners = [];

function lonLatToWorld(longitude, latitude) {
  const x = (Number(longitude) + 180) / 360;
  const sin = Math.sin((Number(latitude) * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return { x, y };
}

function worldToLonLat(x, y) {
  const longitude = x * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y);
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { longitude, latitude };
}

function clampZoom(value) {
  const zoom = Math.round(Number(value) || 17);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function pixelScaleAt(zoom) {
  return (2 ** zoom) * TILE_SIZE;
}

function tileUrl(template, level, row, col) {
  return String(template || '')
    .replaceAll('{level}', String(level))
    .replaceAll('{row}', String(row))
    .replaceAll('{col}', String(col))
    .replaceAll('{z}', String(level))
    .replaceAll('{y}', String(row))
    .replaceAll('{x}', String(col));
}

function rememberTile(url, img) {
  if (!img) return;
  if (tileCache.has(url)) tileCache.delete(url);
  tileCache.set(url, img);
  while (tileCache.size > TILE_CACHE_LIMIT) {
    const oldest = tileCache.keys().next().value;
    tileCache.delete(oldest);
  }
}

function loadTile(url) {
  const cached = tileCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(url);
  if (pending) return pending;
  const job = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ok = img.naturalWidth > 8 ? img : null;
      if (ok) rememberTile(url, ok);
      inFlight.delete(url);
      resolve(ok);
    };
    img.onerror = () => {
      inFlight.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  inFlight.set(url, job);
  return job;
}

function sizeCanvas() {
  if (!host || !canvas) return { width: 0, height: 0 };
  const width = Math.max(64, Math.floor(host.clientWidth));
  const height = Math.max(64, Math.floor(host.clientHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  if (scratch && (scratch.width !== width || scratch.height !== height)) {
    scratch.width = width;
    scratch.height = height;
  }
  return { width, height };
}

function screenToWorld(px, py, atZoom = zoomLevel, atCenter = center) {
  const size = sizeCanvas();
  const scale = pixelScaleAt(atZoom);
  const world = lonLatToWorld(atCenter.longitude, atCenter.latitude);
  return {
    x: (world.x * scale - size.width / 2 + px) / scale,
    y: (world.y * scale - size.height / 2 + py) / scale
  };
}

function viewportFor(template) {
  const size = sizeCanvas();
  const zoom = clampZoom(zoomLevel);
  const n = 2 ** zoom;
  const world = lonLatToWorld(center.longitude, center.latitude);
  const scale = n * TILE_SIZE;
  const left = world.x * scale - size.width / 2;
  const top = world.y * scale - size.height / 2;
  const x0 = Math.max(0, Math.floor(left / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(top / TILE_SIZE));
  const x1 = Math.min(n - 1, Math.floor((left + size.width) / TILE_SIZE));
  const y1 = Math.min(n - 1, Math.floor((top + size.height) / TILE_SIZE));
  const jobs = [];
  if (template) {
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        jobs.push({ x, y, url: tileUrl(template, zoom, y, x) });
      }
    }
  }
  return { size, left, top, jobs };
}

function viewport() {
  return viewportFor(urlTemplate);
}

function scheduleSettle() {
  if (!settleListener) return;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleListener?.(getHistoryPainterAoi());
  }, SETTLE_MS);
}

function drawTile(job, img, left, top) {
  if (!ctx || !img) return;
  ctx.drawImage(
    img,
    Math.round(job.x * TILE_SIZE - left),
    Math.round(job.y * TILE_SIZE - top),
    TILE_SIZE,
    TILE_SIZE
  );
}

function emitPaint(painted, failed) {
  lastPaint = {
    paintedTiles: painted,
    failedTiles: failed,
    confirmed: painted > 0
  };
  paintListener?.(getHistoryPainterPaint());
}

function blitCanvas(dx, dy, scale, originX, originY) {
  if (!ctx || !scratchCtx) return;
  const size = sizeCanvas();
  scratchCtx.clearRect(0, 0, size.width, size.height);
  scratchCtx.drawImage(canvas, 0, 0);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.save();
  if (scale && scale !== 1) {
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);
    ctx.translate(-originX, -originY);
  }
  ctx.drawImage(scratch, dx || 0, dy || 0);
  ctx.restore();
}

function drawLayer(template) {
  if (!template) return { painted: 0, total: 0 };
  const { left, top, jobs } = viewportFor(template);
  let painted = 0;
  for (const job of jobs) {
    const img = tileCache.get(job.url);
    if (!img) continue;
    drawTile(job, img, left, top);
    painted += 1;
  }
  return { painted, total: jobs.length };
}

function drawCached() {
  if (!ctx || !center) return lastPaint;
  const size = sizeCanvas();
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, size.width, size.height);
  if (!urlTemplate) {
    emitPaint(0, 0);
    return lastPaint;
  }
  const primary = drawLayer(urlTemplate);
  let painted = primary.painted;
  let total = primary.total;
  if (compareTemplate) {
    const splitX = size.width * swipeRatio;
    ctx.save();
    ctx.beginPath();
    ctx.rect(splitX, 0, size.width - splitX, size.height);
    ctx.clip();
    const secondary = drawLayer(compareTemplate);
    painted += secondary.painted;
    total += secondary.total;
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, size.height);
    ctx.stroke();
  }
  emitPaint(painted, Math.max(0, total - painted));
  return lastPaint;
}

async function fillMissing(generation) {
  if (!ctx || !center || !urlTemplate) return lastPaint;
  const jobs = [
    ...viewportFor(urlTemplate).jobs,
    ...(compareTemplate ? viewportFor(compareTemplate).jobs : [])
  ];
  let painted = 0;
  let failed = 0;
  await Promise.all(jobs.map(async (job) => {
    if (tileCache.get(job.url)) {
      painted += 1;
      return;
    }
    const img = await loadTile(job.url);
    if (generation !== drawGeneration) return;
    if (!img) {
      failed += 1;
      return;
    }
    painted += 1;
  }));
  if (generation !== drawGeneration) return lastPaint;
  drawCached();
  emitPaint(painted, failed);
  return lastPaint;
}

function paintNow() {
  if (!ctx || !center) return Promise.resolve(lastPaint);
  const generation = drawGeneration + 1;
  drawGeneration = generation;
  drawCached();
  return fillMissing(generation);
}

function panBy(dx, dy) {
  if (!center) return;
  const scale = pixelScaleAt(clampZoom(zoomLevel));
  const world = lonLatToWorld(center.longitude, center.latitude);
  center = worldToLonLat(
    world.x - dx / scale,
    world.y - dy / scale
  );
}

function zoomAt(px, py, delta) {
  if (!center) return false;
  const nextZoom = clampZoom(zoomLevel + delta);
  if (nextZoom === clampZoom(zoomLevel)) return false;
  const worldAtCursor = screenToWorld(px, py, zoomLevel, center);
  zoomLevel = nextZoom;
  const scale = pixelScaleAt(zoomLevel);
  const size = sizeCanvas();
  center = worldToLonLat(
    worldAtCursor.x - (px - size.width / 2) / scale,
    worldAtCursor.y - (py - size.height / 2) / scale
  );
  return true;
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function onPointerDown(event) {
  if (event.button !== 0 || !center) return;
  const point = eventPoint(event);
  if (compareTemplate) {
    const size = sizeCanvas();
    if (Math.abs(point.x - size.width * swipeRatio) <= 14) {
      draggingSwipe = true;
      try { canvas.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
      canvas.style.cursor = 'ew-resize';
      event.preventDefault();
      return;
    }
  }
  dragging = true;
  dragOrigin = { x: event.clientX, y: event.clientY };
  lastDrag = { x: event.clientX, y: event.clientY };
  dragCenter = { ...center };
  try { canvas.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
  canvas.style.cursor = 'grabbing';
  event.preventDefault();
}

function onPointerMove(event) {
  if (draggingSwipe) {
    const size = sizeCanvas();
    swipeRatio = Math.min(1, Math.max(0, eventPoint(event).x / Math.max(1, size.width)));
    drawCached();
    event.preventDefault();
    return;
  }
  if (!dragging || !dragOrigin || !dragCenter) return;
  const dx = event.clientX - lastDrag.x;
  const dy = event.clientY - lastDrag.y;
  lastDrag = { x: event.clientX, y: event.clientY };
  center = { ...dragCenter };
  panBy(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y);
  blitCanvas(dx, dy, 1, 0, 0);
  event.preventDefault();
}

function onPointerUp(event) {
  if (draggingSwipe) {
    draggingSwipe = false;
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    void paintNow();
    return;
  }
  if (!dragging) return;
  dragging = false;
  dragOrigin = null;
  dragCenter = null;
  lastDrag = null;
  canvas.style.cursor = 'grab';
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  void paintNow();
  scheduleSettle();
}

function applyWheel() {
  wheelFrame = 0;
  const now = performance.now();
  const step = wheelDelta <= -WHEEL_STEP ? 1 : wheelDelta >= WHEEL_STEP ? -1 : 0;
  wheelDelta = 0;
  if (!step) return;
  if (now - lastZoomAt < ZOOM_COOLDOWN_MS) return;
  lastZoomAt = now;
  const changed = zoomAt(wheelPoint.x, wheelPoint.y, step);
  if (!changed) return;
  blitCanvas(0, 0, step > 0 ? 2 : 0.5, wheelPoint.x, wheelPoint.y);
  drawCached();
  drawGeneration += 1;
  void fillMissing(drawGeneration);
  scheduleSettle();
}

function onWheel(event) {
  if (!center) return;
  event.preventDefault();
  wheelPoint = eventPoint(event);
  const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  wheelDelta += dy;
  if (!wheelFrame) wheelFrame = requestAnimationFrame(applyWheel);
}

function bindInteraction() {
  if (!canvas) return;
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  const down = (event) => onPointerDown(event);
  const move = (event) => onPointerMove(event);
  const up = (event) => onPointerUp(event);
  const wheel = (event) => onWheel(event);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  listeners.push(
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
    ['wheel', wheel]
  );
}

function unbindInteraction() {
  if (wheelFrame) {
    cancelAnimationFrame(wheelFrame);
    wheelFrame = 0;
  }
  if (!canvas) {
    listeners.length = 0;
    return;
  }
  for (const [name, handler] of listeners) {
    canvas.removeEventListener(name, handler);
  }
  listeners.length = 0;
}

export function setHistoryPainterListener(listener) {
  paintListener = typeof listener === 'function' ? listener : null;
}

export function setHistoryPainterSettleListener(listener) {
  settleListener = typeof listener === 'function' ? listener : null;
}

export function getHistoryPainterAoi() {
  if (!center) return null;
  const size = sizeCanvas();
  const nw = worldToLonLat(screenToWorld(0, 0).x, screenToWorld(0, 0).y);
  const ne = worldToLonLat(screenToWorld(size.width, 0).x, screenToWorld(size.width, 0).y);
  const se = worldToLonLat(screenToWorld(size.width, size.height).x, screenToWorld(size.width, size.height).y);
  const sw = worldToLonLat(screenToWorld(0, size.height).x, screenToWorld(0, size.height).y);
  const lons = [nw.longitude, ne.longitude, se.longitude, sw.longitude];
  const lats = [nw.latitude, ne.latitude, se.latitude, sw.latitude];
  return {
    longitude: center.longitude,
    latitude: center.latitude,
    zoom: clampZoom(zoomLevel),
    xmin: Math.min(...lons),
    ymin: Math.min(...lats),
    xmax: Math.max(...lons),
    ymax: Math.max(...lats)
  };
}

export function setHistorySwipeRatio(ratio) {
  swipeRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
  drawCached();
}

export function getHistoryPainterViewpoint() {
  if (!center) return null;
  return {
    longitude: center.longitude,
    latitude: center.latitude,
    zoom: zoomLevel,
    locked: false
  };
}

export function getHistoryPainterPaint() {
  return { ...lastPaint };
}

export async function initHistoryPainter(container, aoi) {
  host = container;
  host.innerHTML = '';
  canvas = document.createElement('canvas');
  canvas.setAttribute('data-iqai-history-canvas', '');
  canvas.setAttribute('aria-label', 'Historical overhead');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);
  ctx = canvas.getContext('2d', { alpha: false });
  scratch = document.createElement('canvas');
  scratchCtx = scratch.getContext('2d', { alpha: false });
  center = {
    longitude: Number(aoi.longitude),
    latitude: Number(aoi.latitude)
  };
  zoomLevel = clampZoom(aoi.zoom || 17);
  urlTemplate = null;
  tileCache.clear();
  inFlight.clear();
  bindInteraction();
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      sizeCanvas();
      drawCached();
      resizeTimer = setTimeout(() => {
        void paintNow();
        scheduleSettle();
      }, 80);
    });
    resizeObserver.observe(host);
  }
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (host.clientWidth >= 64 && host.clientHeight >= 64) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return paintNow();
}

export async function paintHistoryTemplate(template) {
  urlTemplate = template || null;
  compareTemplate = null;
  tileCache.clear();
  inFlight.clear();
  if (ctx) {
    const size = sizeCanvas();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, size.width, size.height);
  }
  return paintNow();
}

export async function paintHistoryCompare(primary, secondary, ratio = 0.5) {
  urlTemplate = primary || null;
  compareTemplate = secondary || null;
  swipeRatio = Math.min(1, Math.max(0, Number(ratio) || 0.5));
  return paintNow();
}

export function destroyHistoryPainter() {
  urlTemplate = null;
  compareTemplate = null;
  dragging = false;
  draggingSwipe = false;
  clearTimeout(resizeTimer);
  clearTimeout(settleTimer);
  unbindInteraction();
  if (resizeObserver && host) {
    try { resizeObserver.unobserve(host); } catch { /* already gone */ }
  }
  resizeObserver = null;
  tileCache.clear();
  inFlight.clear();
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (host) host.innerHTML = '';
  host = null;
  canvas = null;
  scratch = null;
  ctx = null;
  scratchCtx = null;
  center = null;
}
