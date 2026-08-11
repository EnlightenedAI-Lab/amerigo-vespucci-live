#!/usr/bin/env node
/**
 * Agent 1 authoritative regression inventory and runner.
 * Documents focused sprint subsets vs the current full relevant union.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Current authoritative Agent 1 relevant regression union. */
export const AGENT1_REGRESSION_FILES = [
  'test/a1-gis-plan-contract.test.js',
  'test/a1-gis-plan-live.test.js',
  'test/a1-ai-map-ui.test.js',
  'test/a1-point-intelligence.test.js',
  'test/a1-point-intelligence-presentation.test.js',
  'test/a1-point-intelligence-location-synthesis.test.js',
  'test/a1-point-intelligence-multifamily.test.js',
  'test/a1-point-intelligence-bundle.test.js',
  'test/a1-location-intelligence-focus.test.js',
  'test/a1-location-intelligence-focus-phase2.test.js',
  'test/a1-location-intelligence-focus-phase3.test.js',
  'test/a1-location-intelligence-focus-phase4.test.js',
  'test/a1-location-intelligence-focus-phase5.test.js',
  'test/a1-arcgis-data-add.test.js',
  'test/a1-intelligence-layer.test.js',
  'test/a1-intelligence-layer-llm.test.js',
  'test/a1-intelligence-layer-temporal-gate.test.js',
  'test/a1-universal-ai-operating-layer.test.js',
  'test/a1-ai-map-capability-routing.test.js',
  'test/a1-place-poi-search.test.js',
  'test/a1-operator-acceptance-closeout.test.js',
  'test/a1-governed-intelligence-closeout.test.js',
  'test/a1-fidelity-strip.test.js',
  'test/a1-multi-ai-provider.test.js',
  'test/a1-rd-secret-discovery.test.js',
  'test/a1-spatial-latency-trace.test.js',
  'test/a1-taskgraph-orchestrator.test.js',
  'test/a1-progressive-intelligence-orchestrator.test.js',
  'test/a1-fast-deep-orchestration.test.js',
  'test/a1-cross-agent-spatial-analysis.test.js',
  'test/a1-compound-spatial-orchestration.test.js',
  'test/a1-esri-map-agent.test.js',
  'test/a1-street-level-context.test.js',
  'test/a1-preview-pi-proxy.test.js',
  'test/a1-runtime-provenance.test.js',
  'test/deterministic-acceptance.test.js',
  'test/deterministic-command-transaction.test.js',
  'test/deterministic-result-accounting.test.js',
  'test/deterministic-result-state.test.js',
  'test/canonical-result-state.test.js',
  'test/agent1-spatial-acceptance-runner.test.js',
  'test/spatial-language.test.js',
  'test/spatial-mapper.test.js',
  'test/spatial-conversation.test.js',
  'test/map-request-payload.test.js',
  'test/webmap-layer-catalog.test.js',
  'test/auth-native-visibility.test.js',
  'test/spatial-auth-native-diagnostic.test.js'
];

/** Historical focused subsets referenced in prior Control Tower reports. */
export const REGRESSION_INVENTORY_NOTES = [
  { reported: 31, note: 'Early deterministic transaction/accounting focused subset (superseded by broader union).' },
  { reported: 39, note: 'Deterministic acceptance harness unit tests only.' },
  { reported: 52, note: 'Mid RP2 focused repair subset before contract sprint.' },
  { reported: 70, note: 'Pre-live-LLM focused Agent 1 regression command (subset of current union).' },
  { reported: 76, note: 'Expanded mapper + language subset during GIS stabilization.' },
  { reported: 82, note: 'Sprint 1 contract layer (12 contract + 70 focused) — merged into current union.' },
  { reported: 84, note: 'Transient count during parallel auth-native test additions.' },
  { reported: 91, note: 'Transient count before de-duplicating overlapping mapper tests.' },
  { reported: 96, note: 'Broad spatial-v1 public suite slice — not Agent-1-only.' },
  { reported: 110, note: 'Full repository `node --test` including non-Agent-1 modules (hydro, vessels, preview, etc.).' }
];

function runNodeTest(files) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', ...files], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

function parseTestSummary(output) {
  const pass = Number((output.match(/ℹ pass (\d+)/) || [])[1] || 0);
  const fail = Number((output.match(/ℹ fail (\d+)/) || [])[1] || 0);
  const total = pass + fail;
  return { pass, fail, total };
}

async function main() {
  const missing = AGENT1_REGRESSION_FILES.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length) {
    console.error('Missing regression files:', missing.join(', '));
    process.exit(1);
  }

  const result = await runNodeTest(AGENT1_REGRESSION_FILES);
  const summary = parseTestSummary(`${result.stdout}\n${result.stderr}`);
  const artifactDir = path.join(ROOT, 'artifacts', 'agent1-regression');
  fs.mkdirSync(artifactDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    command: 'npm run spatial:regression',
    files: AGENT1_REGRESSION_FILES,
    inventoryNotes: REGRESSION_INVENTORY_NOTES,
    pass: summary.pass,
    fail: summary.fail,
    total: summary.total,
    exitCode: result.code
  };
  fs.writeFileSync(path.join(artifactDir, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, 'latest.txt'), [
    'AGENT 1 REGRESSION INVENTORY',
    `STATE: ${result.code === 0 ? 'PASS' : 'BLOCKED'}`,
    `FULL RELEVANT REGRESSION: ${summary.pass}/${summary.total}`,
    `FILES: ${AGENT1_REGRESSION_FILES.length}`,
    '',
    'Historical totals were focused subsets or full-repo runs:',
    ...REGRESSION_INVENTORY_NOTES.map((item) => `- ${item.reported}: ${item.note}`)
  ].join('\n'));

  console.log(payload);
  process.exit(result.code === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
