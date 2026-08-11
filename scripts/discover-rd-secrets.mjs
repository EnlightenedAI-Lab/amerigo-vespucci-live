#!/usr/bin/env node
/**
 * Safe Reflective Diagnostics secret discovery — key names and PRESENT/ABSENT only.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditReflectiveDiagnosticsSecrets,
  loadSharedProviderEnv,
  getProviderCredentialStatus,
  resolveReflectiveDiagnosticsProjectRoot
} from '../src/spatial/intelligence-layer-shared-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'agent1-rd-secret-discovery');

const report = {
  generatedAt: new Date().toISOString(),
  reflectiveDiagnosticsProjectRoot: resolveReflectiveDiagnosticsProjectRoot(),
  audit: auditReflectiveDiagnosticsSecrets(),
  activation: null
};

loadSharedProviderEnv();
const credentials = getProviderCredentialStatus();
report.activation = {
  loadedFrom: report.audit.secretsTomlPath,
  mechanism: report.audit.mechanism,
  spatialCredentials: {
    GEMINI_API_KEY: credentials.GEMINI_API_KEY ? 'PRESENT' : 'ABSENT',
    GROK_API_KEY: credentials.GROK_API_KEY ? 'PRESENT' : 'ABSENT',
    XAI_API_KEY: credentials.XAI_API_KEY ? 'PRESENT' : 'ABSENT',
    DEEPSEEK_API_KEY: credentials.DEEPSEEK_API_KEY ? 'PRESENT' : 'ABSENT',
    OPENAI_API_KEY: credentials.OPENAI_API_KEY ? 'PRESENT' : 'ABSENT'
  }
};

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  projectRoot: report.reflectiveDiagnosticsProjectRoot,
  secretsToml: report.audit.secretsTomlPath,
  mechanism: report.audit.mechanism,
  credentials: report.audit.keys,
  spatialAfterLoad: report.activation.spatialCredentials,
  rawKeyCount: report.audit.rawKeyNames?.length || 0
}, null, 2));
