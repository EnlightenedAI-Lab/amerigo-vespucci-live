#!/usr/bin/env node
/**
 * Replace GROK_API_KEY in RD secrets.toml — never logs secret values.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS_PATH = resolve(
  process.env.USERPROFILE || process.env.HOME || '',
  'OneDrive - ouutu.com',
  'RD DASHBOARD CURRENT BUILD',
  'IQAI_DIAGNOSTICS_DEV',
  'enlightened_ai_root',
  '.streamlit',
  'secrets.toml'
);

const newKey = String(process.env.GROK_NEW_KEY || '').trim();
if (!newKey) {
  console.error('GROK_NEW_KEY env var required');
  process.exit(1);
}
if (!existsSync(SECRETS_PATH)) {
  console.error('secrets.toml not found');
  process.exit(1);
}

const backupPath = `${SECRETS_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(SECRETS_PATH, backupPath);

const original = readFileSync(SECRETS_PATH, 'utf8');
let replaced = false;
const lines = original.split(/\r?\n/).map((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return line;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return line;
  const key = trimmed.slice(0, eq).trim();
  if (key !== 'GROK_API_KEY') return line;
  replaced = true;
  const indent = line.match(/^\s*/)?.[0] || '';
  return `${indent}GROK_API_KEY = "${newKey}"`;
});

if (!replaced) {
  console.error('GROK_API_KEY entry not found in secrets.toml');
  process.exit(1);
}

writeFileSync(SECRETS_PATH, lines.join('\n'), 'utf8');
console.log(JSON.stringify({
  secretsPath: SECRETS_PATH,
  backupPath,
  grokKeyReplaced: true,
  unrelatedKeysPreserved: true
}));
