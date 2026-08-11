/**
 * DEV-only Agent 1 runtime provenance — proves which repair build is executing.
 * Not analyst-facing production UI.
 */

export const A1_REPAIR_PASS = 'RP2';
export const A1_HARNESS_VERSION = 'A1-RP2-HARNESS-05';
export const A1_RESULT_STATE_VERSION = 'A1-RP2-RESULT-STATE-05';
export const A1_WEBMAP_QUERY_VERSION = 'A1-RP2-WEBMAP-QUERY-05';
export const A1_APP_SHELL_VERSION = 'A1-RP2-APP-SHELL-05';
export const A1_ACCOUNTING_VERSION = 'A1-RP2-ACCOUNTING-05';
export const A1_TRANSACTION_VERSION = 'A1-RP2-TRANSACTION-05';

const MAX_TRAIL = 40;

function ensureProvenanceRoot() {
  if (typeof window === 'undefined') return null;
  if (!window.__IQAI_A1_RUNTIME_PROVENANCE__) {
    window.__IQAI_A1_RUNTIME_PROVENANCE__ = {
      repairPass: A1_REPAIR_PASS,
      harnessVersion: A1_HARNESS_VERSION,
      resultStateVersion: A1_RESULT_STATE_VERSION,
      webmapQueryVersion: A1_WEBMAP_QUERY_VERSION,
      appShellVersion: A1_APP_SHELL_VERSION,
      accountingVersion: A1_ACCOUNTING_VERSION,
      transactionVersion: A1_TRANSACTION_VERSION,
      loadedAt: new Date().toISOString(),
      moduleUrl: import.meta?.url || null,
      serverModuleHashes: null,
      servingWorktree: null,
      commandTrail: [],
      queryObjectIdsTrail: [],
      authNativeTrail: []
    };
  }
  return window.__IQAI_A1_RUNTIME_PROVENANCE__;
}

export function initA1RuntimeProvenance() {
  const root = ensureProvenanceRoot();
  if (!root) return null;
  root.loadedAt = new Date().toISOString();
  root.moduleUrl = import.meta?.url || null;
  void refreshServerModuleHashes();
  return root;
}

export async function refreshServerModuleHashes() {
  const root = ensureProvenanceRoot();
  if (!root || typeof fetch === 'undefined') return root;
  try {
    const res = await fetch('/api/spatial/runtime-info', { cache: 'no-store' });
    if (!res.ok) return root;
    const info = await res.json();
    root.serverModuleHashes = info.a1ModuleHashes || null;
    root.servingWorktree = info.repoPath || null;
    root.spatialSourceFingerprint = info.spatialSourceFingerprint || null;
    root.gitHead = info.gitHead || null;
    root.gitBranch = info.gitBranch || null;
    root.serverPid = info.serverPid || null;
  } catch {
    // keep last known
  }
  return root;
}

function pushTrail(trailName, entry) {
  const root = ensureProvenanceRoot();
  if (!root) return;
  const trail = root[trailName] || [];
  trail.push({ at: new Date().toISOString(), ...entry });
  root[trailName] = trail.slice(-MAX_TRAIL);
}

export function recordCommandBoundary(event, detail = {}) {
  pushTrail('commandTrail', { event, ...detail });
}

export function recordQueryObjectIdsProvenance(detail = {}) {
  pushTrail('queryObjectIdsTrail', detail);
}

export function recordAuthNativeProvenance(detail = {}) {
  pushTrail('authNativeTrail', detail);
}

export function recordPrimaryResultPublication(detail = {}) {
  pushTrail('commandTrail', { event: 'applyPrimaryDatasetResultState', ...detail });
}

export function getA1ProvenanceSummary() {
  const root = ensureProvenanceRoot();
  if (!root) return null;
  return {
    repairPass: root.repairPass,
    harnessVersion: root.harnessVersion,
    resultStateVersion: root.resultStateVersion,
    webmapQueryVersion: root.webmapQueryVersion,
    appShellVersion: root.appShellVersion,
    accountingVersion: root.accountingVersion,
    transactionVersion: root.transactionVersion || A1_TRANSACTION_VERSION,
    servingWorktree: root.servingWorktree,
    spatialSourceFingerprint: root.spatialSourceFingerprint,
    gitHead: root.gitHead,
    gitBranch: root.gitBranch,
    serverModuleHashes: root.serverModuleHashes
  };
}

export function formatA1ProvenanceOverlayLines() {
  const summary = getA1ProvenanceSummary();
  if (!summary) return [];
  const hashes = summary.serverModuleHashes || {};
  return [
    `HARNESS VERSION: ${summary.harnessVersion}`,
    `RESULT STATE VERSION: ${summary.resultStateVersion}`,
    `WEBMAP QUERY VERSION: ${summary.webmapQueryVersion}`,
    `APP SHELL VERSION: ${summary.appShellVersion}`,
    `ACCOUNTING VERSION: ${summary.accountingVersion}`,
    `TRANSACTION VERSION: ${summary.transactionVersion || A1_TRANSACTION_VERSION}`,
    `REPAIR PASS: ${summary.repairPass}`,
    `SERVING WORKTREE: ${summary.servingWorktree || 'unknown'}`,
    `GIT: ${summary.gitHead || '?'} @ ${summary.gitBranch || '?'}`,
    `SPATIAL FP: ${summary.spatialSourceFingerprint || '?'}`,
  ].concat(
    Object.keys(hashes).length
      ? ['MODULE HASHES:', ...Object.entries(hashes).map(([key, value]) => `  ${key}: ${value}`)]
      : ['MODULE HASHES: pending']
  );
}

/**
 * Overlay display state must never combine RUNNING with finalized report copy text.
 * @param {{ state?: string, finalized?: boolean }} report
 */
export function resolveAcceptanceOverlayState(report) {
  if (report?.finalized) {
    if (report.state === 'RUNNING') {
      return report.failed > 0 ? 'BLOCKED' : 'PASS';
    }
    return report.state || 'BLOCKED';
  }
  return report?.state || 'RUNNING';
}

export function acceptanceOverlayMayShowFinalCopy(report) {
  return Boolean(report?.finalized) && resolveAcceptanceOverlayState(report) !== 'RUNNING';
}
