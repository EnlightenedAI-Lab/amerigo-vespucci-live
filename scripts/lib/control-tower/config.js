import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, 'control-tower/bridge.config.json');
const EXAMPLE_CONFIG_PATH = resolve(REPO_ROOT, 'control-tower/bridge.config.example.json');

/**
 * @param {string} [configPath]
 */
export function loadBridgeConfig(configPath = process.env.IQAI_CONTROL_TOWER_CONFIG || DEFAULT_CONFIG_PATH) {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    const err = new Error(`Bridge config not found: ${resolved}`);
    err.code = 'BRIDGE_CONFIG_MISSING';
    throw err;
  }
  const raw = JSON.parse(readFileSync(resolved, 'utf8'));
  const repoRoot = resolve(REPO_ROOT, raw.repoRoot || '.');
  return {
    ...raw,
    configPath: resolved,
    repoRoot,
    stateDir: resolve(REPO_ROOT, 'control-tower/state'),
    reportsDir: resolve(REPO_ROOT, 'control-tower/reports'),
    inboxDir: resolve(REPO_ROOT, 'control-tower/reports/inbox'),
    enabled: Boolean(raw.enabled),
    repository: String(raw.repository || '').trim(),
    authorAllowlist: Array.isArray(raw.authorAllowlist) ? raw.authorAllowlist.map(String) : [],
    marker: String(raw.marker || 'IQAI_CONTROL_TOWER_V1'),
    target: String(raw.target || 'AGENT_1'),
    pollIntervalMs: Number(raw.pollIntervalMs || 5000),
    agentCommand: String(raw.agentCommand || 'agent'),
    agentExtraArgs: Array.isArray(raw.agentExtraArgs) ? raw.agentExtraArgs.map(String) : ['--trust', '--force'],
    outputFormat: String(raw.outputFormat || 'json'),
    sessionLabel: String(raw.sessionLabel || 'IQAI CONTROL TOWER — AGENT 1'),
    maxCommentChars: Number(raw.maxCommentChars || 60000),
    commentChunkChars: Number(raw.commentChunkChars || 55000),
    dryRunAgentCommand: raw.dryRunAgentCommand ? String(raw.dryRunAgentCommand) : null
  };
}

export function loadExampleConfig() {
  return JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
}

export { REPO_ROOT, DEFAULT_CONFIG_PATH };
