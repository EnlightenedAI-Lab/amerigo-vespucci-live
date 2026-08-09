import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB_DATA_DIR = path.join(__dirname, '..', '..', 'public', 'spatial', 'intelligence-lab', 'data');

const CACHE = {
  manifest: null,
  panel: null,
  f1Forecasts: null,
  f1Advantage: null
};

function labFile(name) {
  return path.join(LAB_DATA_DIR, name);
}

function readJsonCached(key, filename) {
  if (CACHE[key]) return CACHE[key];
  const filePath = labFile(filename);
  if (!fs.existsSync(filePath)) {
    const err = new Error(
      `Intelligence lab bundle missing (${filename}). Run: node scripts/build-intelligence-lab-bundle.mjs`
    );
    err.code = 'LAB_BUNDLE_MISSING';
    throw err;
  }
  CACHE[key] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return CACHE[key];
}

export function getIntelligenceLabManifest() {
  return readJsonCached('manifest', 'manifest.json');
}

export function getIntelligenceLabPanel() {
  return readJsonCached('panel', 'panel-compact.json');
}

export function getIntelligenceLabF1Forecasts() {
  return readJsonCached('f1Forecasts', 'f1-forecasts.json');
}

export function getIntelligenceLabF1Advantage() {
  return readJsonCached('f1Advantage', 'f1-model-advantage.json');
}

export function getIntelligenceLabGeographyPath() {
  const bundled = labFile('harmonized-pdq-v1.geojson');
  if (fs.existsSync(bundled)) return bundled;

  const spvmRoot =
    process.env.IQAI_SPVM_DATA_ROOT ||
    path.resolve(__dirname, '..', '..', '..', 'iqai-spvm-data');
  const source = path.join(spvmRoot, 'generated-data/geography/pdq/v1/harmonized-pdq-v1.geojson');
  if (fs.existsSync(source)) return source;

  const err = new Error('Harmonized PDQ geography not found for intelligence lab');
  err.code = 'LAB_GEOGRAPHY_MISSING';
  throw err;
}

export function getIntelligenceLabArrondissementsPath() {
  const bundled = labFile('arrondissements-v1.geojson');
  if (fs.existsSync(bundled)) return bundled;
  const err = new Error('Arrondissement geography not found. Run: node scripts/build-intelligence-lab-arrondissements.mjs');
  err.code = 'LAB_ARROND_MISSING';
  throw err;
}

function spvmDataRoot() {
  return process.env.IQAI_SPVM_DATA_ROOT
    || path.resolve(__dirname, '..', '..', '..', 'iqai-spvm-data');
}

function findHistoricalCsv() {
  const rawDir = path.join(spvmDataRoot(), 'generated-data', 'historical', 'raw');
  if (!fs.existsSync(rawDir)) return null;
  const files = fs.readdirSync(rawDir).filter((f) => f.startsWith('spvm_') && f.endsWith('.csv'));
  return files.length ? path.join(rawDir, files[0]) : null;
}

function weekEnd(weekStart) {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function pdqMembersForHarmonized(harmonizedId) {
  try {
    const geoPath = getIntelligenceLabGeographyPath();
    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    const feat = geo.features.find((f) => f.properties.harmonized_pdq_id === harmonizedId);
    const members = feat?.properties?.component_pdqs || feat?.properties?.source_pdq_values || [];
    return new Set(members.map(String));
  } catch {
    return new Set();
  }
}

/**
 * Lab-only read of historical SPVM CSV rows for a week + PDQ + category (max 5000).
 */
export async function queryHistoricalUnderlyingRecords({ week, category, pdqId, limit = 5000 }) {
  const csvPath = findHistoricalCsv();
  if (!csvPath) {
    const err = new Error('Historical SPVM CSV not found in iqai-spvm-data');
    err.code = 'HIST_CSV_MISSING';
    throw err;
  }

  const members = pdqMembersForHarmonized(pdqId);
  const weekEndDate = weekEnd(week);
  const rows = [];

  await new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8'), crlfDelay: Infinity });
    let header = null;
    let col = {};
    rl.on('line', (line) => {
      if (!header) {
        header = line.split(',');
        col = Object.fromEntries(header.map((h, i) => [h.replace(/"/g, '').trim(), i]));
        return;
      }
      if (rows.length >= limit) return;
      const parts = parseCsvLine(line);
      const cat = parts[col.CATEGORIE]?.replace(/^"|"$/g, '') || '';
      const date = parts[col.DATE]?.replace(/^"|"$/g, '') || '';
      const pdq = parts[col.PDQ]?.replace(/^"|"$/g, '') || '';
      if (cat !== category) return;
      if (date < week || date > weekEndDate) return;
      if (members.size && !members.has(String(pdq))) return;
      rows.push({
        CATEGORIE: cat,
        DATE: date,
        QUART: parts[col.QUART]?.replace(/^"|"$/g, '') || '',
        PDQ: pdq,
        X: parts[col.X] || null,
        Y: parts[col.Y] || null,
        LONGITUDE: parts[col.LONGITUDE] || null,
        LATITUDE: parts[col.LATITUDE] || null
      });
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });

  return { count: rows.length, capped: rows.length >= limit, records: rows, source: path.basename(csvPath) };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function verifyIntelligenceLabJoin() {
  const manifest = getIntelligenceLabManifest();
  const panel = getIntelligenceLabPanel();
  const geoIds = new Set(manifest.pdqIds);
  const panelIds = new Set(panel.pdqIds);
  const missingInPanel = [...geoIds].filter((id) => !panelIds.has(id));
  const missingInGeo = [...panelIds].filter((id) => !geoIds.has(id));
  return {
    ok: missingInPanel.length === 0 && missingInGeo.length === 0,
    geographyCount: geoIds.size,
    panelCount: panelIds.size,
    missingInPanel,
    missingInGeo,
    weekCount: panel.weeks.length,
    categoryCount: panel.categories.length
  };
}

import { runIntelligenceLabExplain } from './intelligence-lab-explain-service.js';

export function registerIntelligenceLabRoutes(app) {
  app.post('/api/spatial/intelligence-lab/explain', async (req, res) => {
    try {
      const { question, context, history } = req.body || {};
      const result = await runIntelligenceLabExplain({ question, context, history });
      res.json(result);
    } catch (error) {
      const status = error.code === 'INVALID_QUESTION' || error.code === 'INVALID_CONTEXT' ? 400 : 500;
      res.status(status).json({
        ok: false,
        error: error.message,
        code: error.code || 'EXPLAIN_ERROR'
      });
    }
  });

  app.get('/api/spatial/intelligence-lab/health', (_req, res) => {
    try {
      const join = verifyIntelligenceLabJoin();
      res.json({
        ok: join.ok,
        lab: 'intelligence-visual-lab-v1',
        isolated: true,
        montrealWebMap: 'not-used',
        join
      });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/manifest', (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(getIntelligenceLabManifest());
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/panel', (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(getIntelligenceLabPanel());
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/f1-forecasts', (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(getIntelligenceLabF1Forecasts());
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/f1-model-advantage', (_req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json(getIntelligenceLabF1Advantage());
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/geography', (_req, res) => {
    try {
      const geoPath = getIntelligenceLabGeographyPath();
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('application/geo+json');
      fs.createReadStream(geoPath).pipe(res);
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/arrondissements', (_req, res) => {
    try {
      const geoPath = getIntelligenceLabArrondissementsPath();
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('application/geo+json');
      fs.createReadStream(geoPath).pipe(res);
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/spatial/intelligence-lab/historical-records', async (req, res) => {
    try {
      const { week, category, pdq } = req.query;
      if (!week || !category || !pdq) {
        return res.status(400).json({ ok: false, error: 'week, category, and pdq required' });
      }
      const result = await queryHistoricalUnderlyingRecords({
        week: String(week),
        category: String(category),
        pdqId: String(pdq)
      });
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ ok: true, ...result, privacy: 'SPVM published locations are privacy-displaced in source data.' });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message, code: error.code });
    }
  });
}
