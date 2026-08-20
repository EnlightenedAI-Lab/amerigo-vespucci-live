/**
 * Direct XYZ compositor for HISTORY. Not MapView. Not Google.
 * Same-place locked extent. Display confirmation is painted tiles, not layer attach.
 */

const ORIGIN_SHIFT = 20037508.342789244;
const TILE_SIZE = 256;

let host = null;
let canvas = null;
let ctx = null;
let primary = null;
let compare = null;
let swipeEnabled = false;
let swipeRatio = 0.5;
let lockedCenter = null;
let lockedZoom = 17;
let lastPaint = {
  opaquePixelCount: 0,
  opaqueShare: 0,
  contrast: 0,
  width: 0,
  height: 0,
  paintedTiles: 0,
  failedTiles: 0,
  sampleUrls: []
};
let drawGeneration = 0;
let renderLock = Promise.resolve();
let resizeObserver = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lonLatToWorld(longitude, latitude) {
  const x = (Number(longitude) + 180) / 360;
  const sin = Math.sin((Number(latitude) * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return { x, y };
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

function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 8 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function sampleCanvas(imageData) {
  const pixels = imageData?.data;
  if (!pixels || !imageData.width) {
    return {
      opaquePixelCount: 0,
      opaqueShare: 0,
      contrast: 0,
      width: 0,
      height: 0,
      sampledPixelCount: 0
    };
  }
  let sampledPixelCount = 0;
  let opaquePixelCount = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    sampledPixelCount += 1;
    if (pixels[i + 3] <= 8) continue;
    const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    min = Math.min(min, lum);
    max = Math.max(max, lum);
    opaquePixelCount += 1;
  }
  return {
    width: imageData.width,
    height: imageData.height,
    sampledPixelCount,
    opaquePixelCount,
    opaqueShare: sampledPixelCount ? opaquePixelCount / sampledPixelCount : 0,
    contrast: opaquePixelCount ? Math.round(max - min) : 0
  };
}

function sizeCanvas() {
  if (!host || !canvas) return { width: 0, height: 0, dpr: 1, cssWidth: 0, cssHeight: 0 };
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssWidth = Math.max(64, Math.floor(host.clientWidth));
  const cssHeight = Math.max(64, Math.floor(host.clientHeight));
  const width = Math.floor(cssWidth * dpr);
  const height = Math.floor(cssHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  return { width, height, dpr, cssWidth, cssHeight };
}

async function paintLayer(template, size, generation, targetCtx = ctx) {
  if (!template || !targetCtx || !lockedCenter) return { painted: 0, failed: 0, urls: [] };
  const zoom = Math.round(Number(lockedZoom) || 17);
  const n = 2 ** zoom;
  const world = lonLatToWorld(lockedCenter.longitude, lockedCenter.latitude);
  const pixelScale = n * TILE_SIZE;
  const centerX = world.x * pixelScale;
  const centerY = world.y * pixelScale;
  const left = centerX - size.width / 2;
  const top = centerY - size.height / 2;
  const x0 = Math.max(0, Math.floor(left / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(top / TILE_SIZE));
  const x1 = Math.min(n - 1, Math.floor((left + size.width) / TILE_SIZE));
  const y1 = Math.min(n - 1, Math.floor((top + size.height) / TILE_SIZE));
  const jobs = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      jobs.push({ x, y, url: tileUrl(template, zoom, y, x) });
    }
  }
  const loaded = await Promise.all(jobs.map(async (job) => ({ ...job, img: await loadTile(job.url) })));
  if (generation !== drawGeneration) return { painted: 0, failed: 0, urls: [] };
  let painted = 0;
  let failed = 0;
  const urls = [];
  for (const job of loaded) {
    if (!job.img) {
      failed += 1;
      continue;
    }
    targetCtx.drawImage(
      job.img,
      Math.round(job.x * TILE_SIZE - left),
      Math.round(job.y * TILE_SIZE - top),
      TILE_SIZE,
      TILE_SIZE
    );
    painted += 1;
    if (urls.length < 4) urls.push(job.url);
  }
  return { painted, failed, urls };
}

async function paintNow() {
  if (!ctx || !lockedCenter) return lastPaint;
  const generation = drawGeneration + 1;
  drawGeneration = generation;
  const size = sizeCanvas();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = '#d9d3c7';
  ctx.fillRect(0, 0, size.width, size.height);
  let painted = { painted: 0, failed: 0, urls: [] };
  if (primary?.urlTemplate) {
    painted = await paintLayer(primary.urlTemplate, size, generation);
  }
  if (generation !== drawGeneration) return lastPaint;
  if (swipeEnabled && compare?.urlTemplate) {
    const split = Math.round(size.width * swipeRatio);
    const overlay = document.createElement('canvas');
    overlay.width = size.width;
    overlay.height = size.height;
    const overlayCtx = overlay.getContext('2d');
    await paintLayer(compare.urlTemplate, size, generation, overlayCtx);
    if (generation !== drawGeneration) return lastPaint;
    ctx.drawImage(
      overlay,
      split,
      0,
      size.width - split,
      size.height,
      split,
      0,
      size.width - split,
      size.height
    );
    ctx.fillStyle = 'rgba(29, 78, 216, 0.9)';
    ctx.fillRect(split - 1, 0, 2, size.height);
  }
  if (generation !== drawGeneration) return lastPaint;
  const sampled = sampleCanvas(ctx.getImageData(0, 0, size.width, size.height));
  lastPaint = {
    ...sampled,
    paintedTiles: painted.painted,
    failedTiles: painted.failed,
    sampleUrls: painted.urls
  };
  return lastPaint;
}

export async function renderHistoricalSurface() {
  const run = renderLock.then(paintNow, paintNow);
  renderLock = run.catch(() => lastPaint);
  return run;
}

export function getLockedViewpoint() {
  if (!lockedCenter) return null;
  return {
    longitude: lockedCenter.longitude,
    latitude: lockedCenter.latitude,
    zoom: lockedZoom,
    locked: true
  };
}

export async function initHistoricalSurface(container, viewpoint) {
  host = container;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('data-iqai-history-canvas', '');
    canvas.setAttribute('aria-label', 'Historical overhead');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  if (canvas.parentNode !== host) {
    host.innerHTML = '';
    host.appendChild(canvas);
  }
  ctx = canvas.getContext('2d', { alpha: false });
  lockedCenter = {
    longitude: Number(viewpoint.longitude),
    latitude: Number(viewpoint.latitude)
  };
  lockedZoom = Number(viewpoint.zoom) || 17;
  primary = null;
  compare = null;
  swipeEnabled = false;
  swipeRatio = 0.5;
  if (typeof ResizeObserver === 'function' && !resizeObserver) {
    resizeObserver = new ResizeObserver(() => { renderHistoricalSurface(); });
    resizeObserver.observe(host);
  }
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (host.clientWidth >= 64 && host.clientHeight >= 64) break;
    await sleep(40);
  }
  await renderHistoricalSurface();
  return getLockedViewpoint();
}

export async function showPrimaryObservation(observation) {
  primary = {
    urlTemplate: observation?.urlTemplate || null,
    observationId: observation?.observationId || null
  };
  swipeEnabled = false;
  await renderHistoricalSurface();
  return primary;
}

export async function setSwipeMode(enabled, leading, trailing, ratio = swipeRatio) {
  if (leading) {
    primary = { urlTemplate: leading.urlTemplate, observationId: leading.observationId };
  }
  if (trailing) {
    compare = { urlTemplate: trailing.urlTemplate, observationId: trailing.observationId };
  }
  swipeEnabled = enabled === true && Boolean(primary?.urlTemplate && compare?.urlTemplate);
  swipeRatio = Math.min(0.92, Math.max(0.08, Number(ratio) || 0.5));
  await renderHistoricalSurface();
}

export function setSwipeRatio(ratio) {
  swipeRatio = Math.min(0.92, Math.max(0.08, Number(ratio) || 0.5));
  renderHistoricalSurface();
  return swipeRatio;
}

export function getSwipeRatio() {
  return swipeRatio;
}

export function getLastPaint() {
  return lastPaint;
}

export function historicalSurfaceUsesGoogle() {
  const urls = [
    primary?.urlTemplate,
    compare?.urlTemplate,
    ...(lastPaint.sampleUrls || [])
  ].join(' ');
  return /google|googleapis|gstatic|maptiles\.googleapis/i.test(urls);
}

export function destroyHistoricalSurface() {
  primary = null;
  compare = null;
  swipeEnabled = false;
  if (resizeObserver && host) {
    try { resizeObserver.unobserve(host); } catch { /* already gone */ }
  }
  resizeObserver = null;
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export { sleep };
