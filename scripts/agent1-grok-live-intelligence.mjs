#!/usr/bin/env node
/**
 * Live Grok intelligence probe — evidence metadata only, no secrets.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharedProviderEnv } from '../src/spatial/intelligence-layer-shared-env.js';
import { gatherGrokResearchCandidates } from '../src/spatial/intelligence-layer-grok-research.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'agent1-grok-live-intelligence');
const QUERY = 'Find protests or demonstrations reported or planned in Greater Montréal during the next 7 days.';

loadSharedProviderEnv();
const started = Date.now();
const request = {
  query: QUERY,
  geography: 'Greater Montréal',
  from: new Date().toISOString(),
  to: new Date(Date.now() + 7 * 86400000).toISOString(),
  temporalField: 'OCCURRED',
  includeLive: true
};

const run = await gatherGrokResearchCandidates(request);
const urls = [];
const postIds = [];
for (const candidate of run.candidates || []) {
  for (const report of candidate.sourceReports || []) {
    const url = String(report?.url || '').trim();
    if (!url) continue;
    urls.push(url);
    const xMatch = url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
    if (xMatch) postIds.push(xMatch[1]);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  query: QUERY,
  provider: 'GROK_XAI',
  model: run.audit?.model || null,
  toolsInvoked: run.receipt?.toolsUsed || [],
  sourceCount: run.receipt?.sourceCount || 0,
  candidateCount: run.candidates?.length || 0,
  legitimateUrls: [...new Set(urls)].slice(0, 20),
  xPostIds: [...new Set(postIds)].slice(0, 20),
  latencyMs: Date.now() - started,
  mapped: 0,
  unresolved: run.candidates?.length || 0,
  coverageCaveats: [
    'OPEN WEB · NON-EXHAUSTIVE',
    'X/social evidence only when returned by xAI tools with verifiable URLs'
  ],
  status: run.receipt?.status || 'UNKNOWN'
};

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
