#!/usr/bin/env node
/**
 * Test existing RD Grok credential — statuses only.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditReflectiveDiagnosticsSecrets,
  loadSharedProviderEnv,
  getProviderCredentialStatus
} from '../src/spatial/intelligence-layer-shared-env.js';
import { probeGrokConnectivity } from '../src/spatial/intelligence-layer-grok-connectivity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'agent1-grok-rd-credential');

loadSharedProviderEnv();
const rdAudit = auditReflectiveDiagnosticsSecrets();
const credentials = getProviderCredentialStatus();
const grok = await probeGrokConnectivity();

const report = {
  generatedAt: new Date().toISOString(),
  rdGrokConfiguration: {
    canonicalSecretName: 'GROK_API_KEY',
    legacyAliasInSomeModules: 'XAI_API_KEY',
    baseUrlChatCompletions: 'https://api.x.ai/v1/chat/completions',
    baseUrlResponsesResearch: 'https://api.x.ai/v1/responses',
    defaultModelInRd: 'grok-4.3',
    sdkUsage: 'REST (requests/fetch) — no xAI SDK required'
  },
  credentials: {
    GROK_API_KEY: rdAudit.keys.GROK_API_KEY,
    XAI_API_KEY: rdAudit.keys.XAI_API_KEY,
    GEMINI_API_KEY: rdAudit.keys.GEMINI_API_KEY,
    DEEPSEEK_API_KEY: rdAudit.keys.DEEPSEEK_API_KEY,
    OPENAI_API_KEY: rdAudit.keys.OPENAI_API_KEY
  },
  spatialAfterLoad: {
    GROK_API_KEY: credentials.GROK_API_KEY ? 'PRESENT' : 'ABSENT',
    XAI_API_KEY: credentials.XAI_API_KEY ? 'PRESENT' : 'ABSENT',
    GEMINI_API_KEY: credentials.GEMINI_API_KEY ? 'PRESENT' : 'ABSENT',
    DEEPSEEK_API_KEY: credentials.DEEPSEEK_API_KEY ? 'PRESENT' : 'ABSENT',
    OPENAI_API_KEY: credentials.OPENAI_API_KEY ? 'PRESENT' : 'ABSENT'
  },
  grokConnectivity: grok
};

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
