#!/usr/bin/env node
/**
 * Start Agent 5 Point Intelligence HTTP broker with PostgreSQL registry for acceptance.
 * Does not modify Agent 5 — uses createPointIntelligenceApp(repo) injection seam.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PI_ROOT = resolve(REPO_ROOT, '..', 'amerigo-vespucci-point-intelligence');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(REPO_ROOT, '.env'));
loadEnvFile(resolve(PI_ROOT, '.env'));

const port = Number(process.env.POINT_INTELLIGENCE_PORT || 3025);

const { createPointIntelligenceApp } = await import(
  pathToFileURL(resolve(PI_ROOT, 'point-intelligence/src/api/server.js')).href
);
const { PgRegistryRepository } = await import(
  pathToFileURL(resolve(PI_ROOT, 'point-intelligence/src/registry/pg-repository.js')).href
);
const { getDatabaseUrl } = await import(
  pathToFileURL(resolve(PI_ROOT, 'point-intelligence/src/registry/database-config.js')).href
);

const dbUrl = getDatabaseUrl();
const repo = await PgRegistryRepository.connect(dbUrl, { skipMigrations: true });
const { app } = await createPointIntelligenceApp(repo);

const server = app.listen(port, () => {
  console.log(`IQAI Point Intelligence (PG) listening on http://localhost:${port}`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
