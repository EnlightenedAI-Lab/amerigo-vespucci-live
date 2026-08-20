/**
 * Spatial host for Earth Observation.
 * Same MapView. Operator AOI only. Never defaults to a city-wide Montréal box.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPATIAL_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_EO_ROOT = path.resolve(SPATIAL_ROOT, '..', 'amerigo-vespucci-earth-observation-v1');
const DEFAULT_EO_ORIGIN = 'http://127.0.0.1:8871';

/** ~8 km on a side. City-scale views must be refused. */
export const MAX_AOI_SPAN_DEG = 0.08;
export const MIN_AOI_SPAN_DEG = 0.00035;

const COMMANDS = Object.freeze({
  'EO.NDVI': 'EO.NDVI',
  VEGETATION: 'EO.NDVI',
  'EO.SURFACE_TEMPERATURE': 'EO.SURFACE_TEMPERATURE',
  HEAT: 'EO.SURFACE_TEMPERATURE',
  'EO.SAR_CHANGE': 'EO.SAR_CHANGE',
  RADAR_CHANGE: 'EO.SAR_CHANGE'
});

let eoRuntime = null;

function eoRoot(env = process.env) {
  return path.resolve(String(env.EO_ROOT || DEFAULT_EO_ROOT));
}

function eoOrigin(env = process.env) {
  return String(env.EO_ORIGIN || DEFAULT_EO_ORIGIN).replace(/\/$/, '');
}

export function normalizeBbox(input) {
  const raw = Array.isArray(input) ? input : input?.bbox;
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const bbox = raw.map(Number);
  if (!bbox.every(Number.isFinite)) return null;
  const west = Math.min(bbox[0], bbox[2]);
  const south = Math.min(bbox[1], bbox[3]);
  const east = Math.max(bbox[0], bbox[2]);
  const north = Math.max(bbox[1], bbox[3]);
  if (east === west || north === south) return null;
  return [west, south, east, north];
}

export function validateOperatorAoi(input) {
  const bbox = normalizeBbox(input);
  if (!bbox) {
    return {
      ok: false,
      error: 'AOI is required. Draw a box, use the selection, or use the current view. Remote sensing does not run over all Montréal.'
    };
  }
  const spanX = bbox[2] - bbox[0];
  const spanY = bbox[3] - bbox[1];
  if (spanX < MIN_AOI_SPAN_DEG || spanY < MIN_AOI_SPAN_DEG) {
    return { ok: false, error: 'AOI is too small to analyze.' };
  }
  if (spanX > MAX_AOI_SPAN_DEG || spanY > MAX_AOI_SPAN_DEG) {
    return {
      ok: false,
      error: 'AOI is too large. Zoom in or draw a smaller box. Remote sensing does not run over all Montréal.'
    };
  }
  return { ok: true, bbox, aoi: { bbox, geometry: bboxPolygon(bbox) } };
}

export function bboxPolygon(bbox) {
  const [west, south, east, north] = bbox;
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]]
  };
}

function canonicalizeCommand(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  return COMMANDS[raw] || null;
}

async function loadEoRuntime(env = process.env) {
  if (eoRuntime) return eoRuntime;
  const root = eoRoot(env);
  const engineFile = path.join(root, 'src', 'earth-observation', 'engine.js');
  if (!fs.existsSync(engineFile)) {
    eoRuntime = { mode: 'proxy', origin: eoOrigin(env), root };
    return eoRuntime;
  }
  const engine = await import(pathToFileURL(engineFile).href);
  const brainContract = await import(pathToFileURL(path.join(root, 'src', 'earth-observation', 'brain-contract.js')).href).catch(() => ({}));
  const brainAsk = await import(pathToFileURL(path.join(root, 'src', 'earth-observation', 'brain-ask.js')).href).catch(() => ({}));
  const brainHandoff = await import(pathToFileURL(path.join(root, 'src', 'earth-observation', 'brain-handoff.js')).href).catch(() => ({}));
  const probe = await import(pathToFileURL(path.join(root, 'src', 'earth-observation', 'probe-receipt.js')).href).catch(() => ({}));
  eoRuntime = {
    mode: 'local',
    root,
    origin: eoOrigin(env),
    runCommand: engine.runCommand || engine.run,
    toBrainContract: brainContract.toBrainContract,
    askAboutEo: brainAsk.askAboutEo,
    buildBrainHandoff: brainHandoff.buildBrainHandoff,
    probeReceiptFromSample: probe.probeReceiptFromSample,
    rememberProbe: probe.rememberProbe,
    receiptById: brainContract.receiptById,
    currentReceipt: brainContract.currentReceipt
  };
  return eoRuntime;
}

async function proxyJson(origin, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({ status: 'FAILED', error: 'Earth Observation returned a non-JSON body.' }));
  return { status: response.status, payload };
}

function json(res, status, body) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export async function runEarthObservation({ command, aoi, compare = false } = {}, env = process.env) {
  const canonical = canonicalizeCommand(command);
  if (!canonical) {
    return { httpStatus: 400, body: { status: 'FAILED', error: `Unknown Earth Observation command ${command || ''}.` } };
  }
  const checked = validateOperatorAoi(aoi);
  if (!checked.ok) return { httpStatus: 400, body: { status: 'FAILED', error: checked.error, aoi: null } };
  const runtime = await loadEoRuntime(env);
  if (runtime.mode === 'local' && typeof runtime.runCommand === 'function') {
    const receipt = await runtime.runCommand({
      command: canonical,
      aoi: checked.aoi,
      compare: compare === true
    });
    return { httpStatus: 200, body: receipt };
  }
  try {
    const proxied = await proxyJson(runtime.origin, '/api/eo/run', {
      method: 'POST',
      body: { command: canonical, aoi: checked.aoi, compare: compare === true }
    });
    return { httpStatus: proxied.status, body: proxied.payload };
  } catch {
    return {
      httpStatus: 503,
      body: {
        status: 'UNAVAILABLE',
        error: 'Earth Observation engine is not available on this Spatial host.'
      }
    };
  }
}

export async function askEarthObservationBrain(input = {}, env = process.env) {
  const runtime = await loadEoRuntime(env);
  if (runtime.mode === 'local' && typeof runtime.askAboutEo === 'function') {
    try {
      const result = await runtime.askAboutEo(input);
      return { httpStatus: 200, body: result };
    } catch (error) {
      const receipt = input.eoReceiptId && runtime.receiptById
        ? runtime.receiptById(input.eoReceiptId)
        : runtime.currentReceipt?.();
      const eoResult = runtime.toBrainContract?.(receipt) || null;
      return {
        httpStatus: 200,
        body: {
          command: 'BRAIN.ASK_ABOUT_EO',
          status: 'PACKAGE_ONLY',
          answer: eoResult?.meaning || receipt?.explain?.what || 'BRAIN SERVICE UNAVAILABLE — structured package only.',
          eoResult,
          error: error.message || String(error)
        }
      };
    }
  }
  try {
    const proxied = await proxyJson(runtime.origin, '/api/eo/brain/ask', { method: 'POST', body: input });
    return { httpStatus: proxied.status, body: proxied.payload };
  } catch {
    return { httpStatus: 503, body: { status: 'FAILED', error: 'Earth Observation Brain is unavailable.' } };
  }
}

export async function probeEarthObservation(input = {}, env = process.env) {
  const lat = Number(input.lat ?? input.coordinate?.lat);
  const lon = Number(input.lon ?? input.coordinate?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { httpStatus: 400, body: { status: 'FAILED', error: 'lat and lon are required.' } };
  }
  const runtime = await loadEoRuntime(env);
  if (runtime.mode === 'local' && typeof runtime.probeReceiptFromSample === 'function') {
    const receipt = input.receiptId && runtime.receiptById
      ? runtime.receiptById(input.receiptId)
      : runtime.currentReceipt?.();
    const probe = runtime.probeReceiptFromSample(receipt, lat, lon);
    if (typeof runtime.rememberProbe === 'function') runtime.rememberProbe(probe);
    return { httpStatus: 200, body: probe };
  }
  try {
    const proxied = await proxyJson(runtime.origin, '/api/eo/probe', {
      method: 'POST',
      body: { lat, lon, receiptId: input.receiptId || null }
    });
    return { httpStatus: proxied.status, body: proxied.payload };
  } catch {
    return { httpStatus: 503, body: { status: 'FAILED', error: 'Earth Observation probe is unavailable.' } };
  }
}

export function registerEarthObservationBridge(app, options = {}) {
  const env = options.env || process.env;

  app.get('/api/eo/health', async (_req, res) => {
    const runtime = await loadEoRuntime(env);
    return json(res, 200, {
      ok: runtime.mode === 'local' || Boolean(runtime.origin),
      mode: runtime.mode,
      autoRun: false,
      defaultAoi: null,
      requiresOperatorAoi: true,
      maxAoiSpanDeg: MAX_AOI_SPAN_DEG,
      commands: ['EO.NDVI', 'EO.SURFACE_TEMPERATURE', 'EO.SAR_CHANGE']
    });
  });

  app.post('/api/eo/run', async (req, res) => {
    try {
      const result = await runEarthObservation(req.body || {}, env);
      return json(res, result.httpStatus, result.body);
    } catch (error) {
      return json(res, 500, { status: 'FAILED', error: error.message || String(error) });
    }
  });

  app.post('/api/eo/probe', async (req, res) => {
    const result = await probeEarthObservation(req.body || {}, env);
    return json(res, result.httpStatus, result.body);
  });

  app.post('/api/eo/brain/ask', async (req, res) => {
    const result = await askEarthObservationBrain(req.body || {}, env);
    return json(res, result.httpStatus, result.body);
  });

  app.post('/api/eo/brain-handoff', async (req, res) => {
    const runtime = await loadEoRuntime(env);
    if (runtime.mode === 'local' && typeof runtime.buildBrainHandoff === 'function') {
      const receipt = req.body?.eoReceiptId && runtime.receiptById
        ? runtime.receiptById(req.body.eoReceiptId)
        : runtime.currentReceipt?.();
      if (!receipt) return json(res, 404, { status: 'UNAVAILABLE', error: 'No current EO result.' });
      return json(res, 200, runtime.buildBrainHandoff({
        receipt,
        question: req.body?.question || null
      }));
    }
    try {
      const proxied = await proxyJson(runtime.origin, '/api/eo/brain-handoff', { method: 'POST', body: req.body || {} });
      return json(res, proxied.status, proxied.payload);
    } catch {
      return json(res, 503, { status: 'UNAVAILABLE', error: 'Earth Observation Brain handoff is unavailable.' });
    }
  });
}
