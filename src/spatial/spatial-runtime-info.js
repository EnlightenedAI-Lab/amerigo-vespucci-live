import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveProgressiveIntelligenceV1Enabled } from './orchestrator/progressive-intelligence-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SPATIAL_PUBLIC_ROOT = path.join(REPO_ROOT, 'public', 'spatial');

const A1_MODULE_PATHS = [
  'a1-runtime-provenance.js',
  'a1-gis-plan-provenance.js',
  'a1-gis-plan-runtime.js',
  'canonical-result-state.js',
  'deterministic-command-transaction.js',
  'deterministic-result-state.js',
  'spatial-deterministic-acceptance.js',
  'webmap-layer-query.js',
  'shell/AppShell.js',
  'deterministic-result-accounting.js',
  'spatial-renderer-telemetry.js'
];

/** @type {import('./spatial-runtime-info.js').SpatialRuntimeSnapshot | null} */
let snapshot = null;

/** @type {Record<string, unknown>} */
let clientRuntimeState = {
  rendererMode: 'IDLE',
  displayLayerId: null,
  displayLayerTitle: null,
  usesLayerViewFilter: false,
  runtimeFallbackActive: false,
  authoritativeWebMapLayerActive: false,
  iqaiDeterministicResultsActive: false,
  reportedAt: null
};

/**
 * Fingerprint scope: every file under public/spatial/** (sorted paths + contents).
 * Excludes node_modules, .env, and build artifacts outside this tree.
 */
function listSpatialPublicFiles(dir = SPATIAL_PUBLIC_ROOT, base = SPATIAL_PUBLIC_ROOT) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSpatialPublicFiles(full, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

export function computeSpatialSourceFingerprint() {
  const hash = crypto.createHash('sha256');
  const files = listSpatialPublicFiles();
  hash.update('public/spatial/**\0');
  for (const rel of files) {
    const content = fs.readFileSync(path.join(SPATIAL_PUBLIC_ROOT, rel));
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 7);
}

export function computeA1ModuleHashes() {
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const rel of A1_MODULE_PATHS) {
    const full = path.join(SPATIAL_PUBLIC_ROOT, rel);
    if (!fs.existsSync(full)) {
      hashes[rel] = 'missing';
      continue;
    }
    const content = fs.readFileSync(full);
    hashes[rel] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  }
  return hashes;
}

function readGitInfo() {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const porcelain = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    return { head, branch, dirty: porcelain.length > 0 };
  } catch {
    return { head: 'unknown', branch: 'unknown', dirty: false };
  }
}

function formatRuntimeBuildId(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `B${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Initialize once at server startup.
 * @param {{ agent?: string, worktreeRole?: string, pid?: number }} [options]
 */
export function initSpatialRuntimeInfo(options = {}) {
  const serverStartedAt = new Date();
  const git = readGitInfo();
  const spatialSourceFingerprint = computeSpatialSourceFingerprint();
  snapshot = {
    agent: options.agent || 'A1',
    worktreeRole: options.worktreeRole || 'spatial-v1',
    gitHead: git.head,
    gitBranch: git.branch,
    gitDirty: git.dirty,
    serverStartedAt: serverStartedAt.toISOString(),
    runtimeBuildId: formatRuntimeBuildId(serverStartedAt),
    spatialSourceFingerprint,
    spatialFingerprintScope: 'public/spatial/**',
    repoPath: REPO_ROOT,
    processCwdAtStart: process.cwd(),
    serverPid: options.pid ?? process.pid,
    preview: options.preview === true
  };
  return snapshot;
}

export function getSpatialRuntimeSnapshot() {
  if (!snapshot) initSpatialRuntimeInfo({ preview: true });
  return snapshot;
}

/**
 * @param {Record<string, unknown>} partial
 */
export function updateClientRuntimeState(partial) {
  clientRuntimeState = {
    ...clientRuntimeState,
    ...partial,
    reportedAt: new Date().toISOString()
  };
  return clientRuntimeState;
}

export function getRuntimeInfoResponse() {
  const base = getSpatialRuntimeSnapshot();
  return {
    agent: base.agent,
    worktreeRole: base.worktreeRole,
    gitHead: base.gitHead,
    gitBranch: base.gitBranch,
    gitDirty: base.gitDirty,
    serverStartedAt: base.serverStartedAt,
    runtimeBuildId: base.runtimeBuildId,
    spatialSourceFingerprint: base.spatialSourceFingerprint,
    spatialFingerprintScope: base.spatialFingerprintScope,
    repoPath: base.repoPath,
    processCwdAtStart: base.processCwdAtStart,
    serverPid: base.serverPid,
    a1RepairPass: 'RP2-AUTO-ACCEPT',
    a1ModuleHashes: computeA1ModuleHashes(),
    rendererMode: clientRuntimeState.rendererMode || 'IDLE',
    displayLayerId: clientRuntimeState.displayLayerId ?? null,
    displayLayerTitle: clientRuntimeState.displayLayerTitle ?? null,
    usesLayerViewFilter: Boolean(clientRuntimeState.usesLayerViewFilter),
    runtimeFallbackActive: Boolean(clientRuntimeState.runtimeFallbackActive),
    authoritativeWebMapLayerActive: Boolean(clientRuntimeState.authoritativeWebMapLayerActive),
    iqaiDeterministicResultsActive: Boolean(clientRuntimeState.iqaiDeterministicResultsActive),
    clientReportedAt: clientRuntimeState.reportedAt,
    fallbackReason: clientRuntimeState.fallbackReason ?? null,
    authNativeShortReason: clientRuntimeState.authNativeShortReason ?? null,
    authNativeDiagnostic: clientRuntimeState.authNativeDiagnostic ?? null,
    usesObjectIdFilter: Boolean(clientRuntimeState.usesObjectIdFilter),
    taskGraphV1Enabled: /^true$/i.test(process.env.IQAI_TASKGRAPH_V1_ENABLED || ''),
    progressiveIntelligenceV1Enabled: resolveProgressiveIntelligenceV1Enabled(),
    interactiveIntelligenceDeadlineMs: Number(process.env.IQAI_INTERACTIVE_INTELLIGENCE_DEADLINE_MS || 30_000),
    esriAgenticV1Enabled: /^true$/i.test(process.env.IQAI_ESRI_AGENTIC_V1_ENABLED || ''),
    placePoiV1Enabled: process.env.IQAI_PLACE_POI_V1_ENABLED == null
      || process.env.IQAI_PLACE_POI_V1_ENABLED === ''
      || /^true$/i.test(process.env.IQAI_PLACE_POI_V1_ENABLED)
  };
}

export function buildSpatialIndexHtml() {
  const info = getSpatialRuntimeSnapshot();
  const v = info.spatialSourceFingerprint;
  const indexPath = path.join(SPATIAL_PUBLIC_ROOT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace(
    'src="/spatial/spatial.js"',
    `src="/spatial/spatial.js?v=${v}"`
  );
  html = html.replace(
    'href="/spatial/spatial.css"',
    `href="/spatial/spatial.css?v=${v}"`
  );
  html = html.replace(
    'href="/spatial/iqai-spatial-shell.css"',
    `href="/spatial/iqai-spatial-shell.css?v=${v}"`
  );
  html = html.replace(
    'href="/spatial/iqai-results-workspace.css"',
    `href="/spatial/iqai-results-workspace.css?v=${v}"`
  );
  return html;
}
