/**
 * Proven 1999 MRNF orthophoto for Spatial HISTORY.
 * One LOCAL GeoTIFF. Listed only when the viewport centre is inside the
 * official index footprint. Painted through the existing XYZ HISTORY canvas.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MRNF_1999_ID = 'qc.mrnf.imagerie-orthorectifiee:acquisitiondate:1999-04-30:0d3fb8f4b9b544cdad5793d3e38a7440';
export const MRNF_1999_ASSET = '0d3fb8f4b9b544cdad5793d3e38a7440';
export const MRNF_1999_CAPTURE = '1999-04-30';
export const MRNF_1999_TILE_TEMPLATE = `/temporal/imagery/tiles/mrnf/${MRNF_1999_ASSET}/{z}/{x}/{y}.png`;

const OBSERVATION_JSON = 'C:\\Users\\nicol\\OneDrive\\Documents\\iqai-data-master\\registry\\observations\\qc.mrnf.imagerie-orthorectifiee.0d3fb8f4b9b544cdad5793d3e38a7440.json';
const TIFF_PATH = 'C:\\Users\\nicol\\OneDrive\\Documents\\iqai-data-master\\data\\qc.mrnf.imagerie-orthorectifiee\\Q99802_151_100CM_F08.TIF';
const TIFF_BYTES = 64064674;
const TILE_SCRIPT = path.join(__dirname, 'history-mrnf-1999-tiles.py');

const FALLBACK_RING = [
  [-73.6166931460378, 45.466532162693206],
  [-73.5143868640606, 45.4665908893731],
  [-73.5144051776065, 45.53857834639391],
  [-73.6168419495058, 45.53851946695621],
  [-73.6166931460378, 45.466532162693206]
];

let ring = FALLBACK_RING;
let worker = null;
let workerPort = 0;
let workerWait = null;

function readRing() {
  try {
    const record = JSON.parse(fs.readFileSync(OBSERVATION_JSON, 'utf8'));
    const coords = record?.footprint?.coordinates?.[0]?.[0];
    if (Array.isArray(coords) && coords.length >= 4) {
      ring = coords.map((pair) => [Number(pair[0]), Number(pair[1])]);
    }
  } catch {
    ring = FALLBACK_RING;
  }
  return ring;
}

readRing();

function pointInRing(longitude, latitude, polygon = ring) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = Number(polygon[i][0]);
    const yi = Number(polygon[i][1]);
    const xj = Number(polygon[j][0]);
    const yj = Number(polygon[j][1]);
    const intersect = ((yi > latitude) !== (yj > latitude))
      && (longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function tiffAvailable(filePath = TIFF_PATH) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size === TIFF_BYTES;
  } catch {
    return false;
  }
}

export function aoiCenter(aoi = {}) {
  const longitude = Number(aoi.longitude ?? aoi.lon);
  const latitude = Number(aoi.latitude ?? aoi.lat);
  if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
    return { longitude, latitude };
  }
  const xmin = Number(aoi.xmin);
  const ymin = Number(aoi.ymin);
  const xmax = Number(aoi.xmax);
  const ymax = Number(aoi.ymax);
  if ([xmin, ymin, xmax, ymax].every(Number.isFinite)) {
    return { longitude: (xmin + xmax) / 2, latitude: (ymin + ymax) / 2 };
  }
  return null;
}

export function coversAoi(aoi) {
  const center = aoiCenter(aoi);
  if (!center) return false;
  return pointInRing(center.longitude, center.latitude);
}

export function isMrnf1999Id(value) {
  const id = decodeURIComponent(String(value || ''));
  return id === MRNF_1999_ID
    || id === MRNF_1999_ASSET
    || id.endsWith(MRNF_1999_ASSET)
    || id.includes('Q99802_151_100CM_F08');
}

export function mrnf1999Observation({ paintable = tiffAvailable() } = {}) {
  const template = paintable ? MRNF_1999_TILE_TEMPLATE : 'UNKNOWN';
  return {
    contractVersion: 'iqai-temporal-imagery-catalogue-v1',
    imageryObservationId: MRNF_1999_ID,
    provider: 'MRNF',
    providerProduct: 'Imagerie orthorectifiée du Québec',
    sourceId: MRNF_1999_ASSET,
    sourceReleaseId: 'Q99802_151_100CM_F08',
    sourceUrl: 'https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Imagerie/Orthophotographie/Generique/Ortho40k9206_1m_Pan/Mtm8/Geotiff/Q99802_151_100CM_F08.TIF',
    captureStart: MRNF_1999_CAPTURE,
    captureEnd: MRNF_1999_CAPTURE,
    datePrecision: 'DAY',
    publicationDate: 'UNKNOWN',
    coverageGeometry: {
      type: 'Polygon',
      coordinates: [ring]
    },
    coverageStatus: 'PARTIAL',
    resolutionM: 1,
    imageType: 'ORTHO',
    nadir: 'YES',
    georeferenced: 'YES',
    accessMethod: paintable ? 'REMOTE_TILES' : 'DOWNLOAD',
    accessState: paintable ? 'STREAMABLE' : 'DOWNLOADABLE',
    authClass: 'none',
    rights: {
      view: 'YES',
      compare: 'CONDITIONAL',
      cache: 'YES',
      analyze: 'CONDITIONAL',
      export: 'YES'
    },
    displayConfirmed: 'UNKNOWN',
    attribution: '© Gouvernement du Québec',
    license: 'CC-BY-4.0',
    quality: {
      grade: 'UNKNOWN',
      cloud: 'UNKNOWN',
      season: 'Printemps',
      notes: '1.0 m panchromatic analog GeoTIFF Q99802_151_100CM_F08. One downtown Montréal tile, not island-wide coverage.'
    },
    retrievedAt: '2026-08-20T18:04:25Z',
    sourceLastModified: 'UNKNOWN',
    operationFit: {
      view: 'YES',
      compare: 'CONDITIONAL',
      analyze: 'CONDITIONAL',
      export: 'YES'
    },
    automation: paintable ? 'AVAILABLE' : 'UNAVAILABLE',
    ingestState: paintable ? 'STREAMABLE' : 'DOWNLOADABLE',
    notes: paintable
      ? 'LOCAL 1999-04-30 MRNF orthophoto. HISTORY paints the registered GeoTIFF through Spatial XYZ tiles.'
      : 'LOCAL GeoTIFF is registered. HISTORY cannot paint it until display tiles are materialized.',
    coverageBbox: {
      xmin: Math.min(...ring.map((pair) => pair[0])),
      ymin: Math.min(...ring.map((pair) => pair[1])),
      xmax: Math.max(...ring.map((pair) => pair[0])),
      ymax: Math.max(...ring.map((pair) => pair[1]))
    },
    activationStatus: paintable ? 'ACCESSIBLE' : 'CATALOGUED',
    tileTemplate: template
  };
}

export function mrnf1999Receipt() {
  const observation = mrnf1999Observation();
  const paintable = observation.tileTemplate && observation.tileTemplate !== 'UNKNOWN';
  return {
    contract: 'iqai-temporal-activation-receipt-v1',
    imageryObservationId: observation.imageryObservationId,
    provider: observation.provider,
    providerProduct: observation.providerProduct,
    sourceId: observation.sourceId,
    sourceReleaseId: observation.sourceReleaseId,
    captureDate: observation.captureStart,
    publicationDate: observation.publicationDate,
    resolutionM: observation.resolutionM,
    coverageStatus: observation.coverageStatus,
    displayConfirmed: 'UNKNOWN',
    rights: observation.rights,
    attribution: observation.attribution,
    activationStatus: observation.activationStatus,
    activationType: paintable ? 'XYZ_TILES' : 'NONE',
    tileTemplate: observation.tileTemplate,
    pixelProof: null
  };
}

function alreadyListed(list) {
  return (list || []).some((item) => isMrnf1999Id(item?.imageryObservationId || item?.sourceId));
}

export function aoiFromQuery(query = {}) {
  return {
    xmin: query.xmin,
    ymin: query.ymin,
    xmax: query.xmax,
    ymax: query.ymax,
    longitude: query.longitude ?? query.lon,
    latitude: query.latitude ?? query.lat
  };
}

export function mergeMrnf1999Payload(pathname, query, payload) {
  const aoi = aoiFromQuery(query);
  if (!coversAoi(aoi)) return payload;
  const observation = mrnf1999Observation();
  if (!payload || typeof payload !== 'object') {
    if (pathname.includes('/timeline')) {
      return { ok: true, aoi, observations: [observation] };
    }
    if (pathname.includes('/search')) {
      return { ok: true, aoi, qualified: [observation], best: { observation } };
    }
    if (pathname.includes('/best')) {
      return {
        ok: true,
        aoi,
        requestedDate: query.date || 'UNKNOWN',
        bestView: { observation },
        bestAnalyze: { observation: null }
      };
    }
    return payload;
  }
  const next = { ...payload, ok: true };
  if (pathname.includes('/timeline')) {
    const list = Array.isArray(next.observations) ? next.observations : [];
    next.observations = alreadyListed(list) ? list : [...list, observation];
  }
  if (pathname.includes('/search')) {
    const list = Array.isArray(next.qualified) ? next.qualified : [];
    next.qualified = alreadyListed(list) ? list : [...list, observation];
  }
  const requested = String(query.date || '').slice(0, 10);
  if (pathname.includes('/best') && requested === MRNF_1999_CAPTURE) {
    next.bestView = { ...(next.bestView || {}), observation };
  }
  return next;
}

function startWorker() {
  if (workerPort) return Promise.resolve(workerPort);
  if (workerWait) return workerWait;
  if (!tiffAvailable()) {
    return Promise.reject(new Error('1999 MRNF GeoTIFF is not on disk.'));
  }
  workerWait = new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', ['-u', TILE_SCRIPT, '--tiff', TIFF_PATH, '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let ready = false;
    const timer = setTimeout(() => {
      if (ready) return;
      child.kill();
      reject(new Error('1999 MRNF tile worker did not start.'));
    }, 20000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const match = stdout.match(/READY (\d+)/);
      if (!match || ready) return;
      ready = true;
      clearTimeout(timer);
      worker = child;
      workerPort = Number(match[1]);
      resolve(workerPort);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(String(chunk));
    });
    child.on('exit', (code) => {
      worker = null;
      workerPort = 0;
      workerWait = null;
      if (ready) return;
      clearTimeout(timer);
      reject(new Error(`1999 MRNF tile worker exited ${code}`));
    });
  });
  return workerWait;
}

export async function renderMrnf1999Tile(z, x, y) {
  const port = await startWorker();
  const response = await fetch(`http://127.0.0.1:${port}/${z}/${x}/${y}.png`);
  if (!response.ok) {
    throw new Error(`MRNF tile HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function registerMrnf1999History(app) {
  app.get('/temporal/imagery/tiles/mrnf/:assetId/:z/:x/:y', async (req, res, next) => {
    if (!isMrnf1999Id(req.params.assetId)) return next();
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(String(req.params.y).replace(/\.png$/i, ''));
    if (![z, x, y].every(Number.isInteger)) {
      res.set('Cache-Control', 'no-store');
      return res.status(400).json({ ok: false, error: 'Invalid MRNF tile coordinates.' });
    }
    try {
      const png = await renderMrnf1999Tile(z, x, y);
      res.set('Cache-Control', 'private, max-age=120');
      res.type('image/png');
      return res.send(png);
    } catch (error) {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({
        ok: false,
        error: error.message || '1999 MRNF tile failed.'
      });
    }
  });

  app.get('/temporal/imagery/receipt/:id', (req, res, next) => {
    if (!isMrnf1999Id(req.params.id)) return next();
    res.set('Cache-Control', 'no-store');
    const receipt = mrnf1999Receipt();
    return res.json({
      ok: true,
      imageryObservationId: receipt.imageryObservationId,
      activationReceipt: receipt
    });
  });
}
