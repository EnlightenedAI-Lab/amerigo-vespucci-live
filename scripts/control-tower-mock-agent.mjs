#!/usr/bin/env node
/**
 * Mock Cursor Agent for Control Tower bridge tests.
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const joined = process.argv.slice(2).join(' ');
const pathMatch = joined.match(/([A-Za-z]:\\[^\n\r]+?issue-\d+-prompt\.md)/)
  || joined.match(/(control-tower[\\/][^\n\r]+?issue-\d+-prompt\.md)/i);

let mission = joined;
if (pathMatch) {
  try {
    mission = readFileSync(pathMatch[1], 'utf8');
  } catch {
    // keep wrapper text
  }
}

function respond(text) {
  console.log(JSON.stringify({ result: text }));
  process.exit(0);
}

if (/bridge-proof\.txt/i.test(mission) && /(create|write)/i.test(mission)) {
  const target = resolve('control-tower/test/bridge-proof.txt');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'IQAI_CONTROL_TOWER_BRIDGE_V1_OK\n', 'utf8');
  respond('SAFE WRITE TEST PASS\n\ncreated: control-tower/test/bridge-proof.txt\n\nCOMPLETE');
}

if (/bridge-proof\.txt/i.test(mission) && /(remove|delete)/i.test(mission)) {
  const target = resolve('control-tower/test/bridge-proof.txt');
  if (existsSync(target)) unlinkSync(target);
  respond('Cleanup complete.\n\nCOMPLETE');
}

if (/NEEDS_CONTROL_TOWER/i.test(mission) && /without modifying code/i.test(mission)) {
  respond('NEEDS_CONTROL_TOWER\n\nNo code modifications were made.');
}

if (/git branch|HEAD commit|regression baseline/i.test(mission)) {
  respond([
    'branch:',
    'feature/iqai-spatial-v1-clean',
    '',
    'HEAD:',
    'a597276',
    '',
    'regression baseline:',
    '396 / 396 PASS',
    '',
    'COMPLETE'
  ].join('\n'));
}

if (/QUEUE_TEST_OK/i.test(mission)) {
  respond('QUEUE_TEST_OK\n\nCOMPLETE');
}

respond('MOCK AGENT: mission received.\n\nCOMPLETE');
