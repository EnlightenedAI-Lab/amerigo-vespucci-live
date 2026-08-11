/**
 * Optional shared credential loading — supplements process.env without overwriting.
 * NEVER logs secret values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RD_SECRETS_CANDIDATES = [
  process.env.IQAI_REFLECTIVE_DIAGNOSTICS_SECRETS_TOML,
  process.env.IQAI_SHARED_SECRETS_TOML,
  resolve(
    process.env.USERPROFILE || process.env.HOME || '',
    'OneDrive - ouutu.com',
    'RD DASHBOARD CURRENT BUILD',
    'IQAI_DIAGNOSTICS_DEV',
    'enlightened_ai_root',
    '.streamlit',
    'secrets.toml'
  ),
  resolve(
    process.env.USERPROFILE || process.env.HOME || '',
    'OneDrive - ouutu.com',
    'RD DASHBOARD CURRENT BUILD',
    'reflective diagnostic dashboard working version 01-09',
    'enlightened_ai_root',
    '.streamlit',
    'secrets.toml'
  )
].filter(Boolean);

const KNOWN_SHARED_ENV_PATHS = [
  process.env.IQAI_SHARED_ENV_PATH,
  process.env.IQAI_REFLECTIVE_DIAGNOSTICS_ENV_PATH,
  resolve(process.env.USERPROFILE || process.env.HOME || '', 'OneDrive', 'Reflective Diagnostics api backup version', 'reflective-diagnostics-api', '.env'),
  resolve(process.env.USERPROFILE || process.env.HOME || '', 'OneDrive', 'reflective diagnostics version2 working 01-17', 'reflective-diagnostics-api', '.env')
].filter(Boolean);

const SUPPLEMENT_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'GROK_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'IQAI_GEMINI_RESEARCH_MODEL',
  'IQAI_INTELLIGENCE_RESEARCH_MODEL',
  'XAI_MODEL',
  'GROK_MODEL',
  'XAI_API_BASE_URL',
  'IQAI_DEEPSEEK_RESEARCH_MODEL',
  'DEEPSEEK_API_BASE_URL'
];

/** Legacy Reflective Diagnostics key aliases → IQAI Spatial env names. */
const LEGACY_KEY_MAP = [
  { sources: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'gemini_api_key', 'google_api_key'], target: 'GEMINI_API_KEY' },
  { sources: ['OPENAI_API_KEY', 'openai_api_key', 'OPENAI_KEY'], target: 'OPENAI_API_KEY' },
  { sources: ['GROK_API_KEY', 'grok_api_key', 'XAI_API_KEY', 'xai_api_key'], target: 'GROK_API_KEY' },
  { sources: ['DEEPSEEK_API_KEY', 'deepseek_api_key'], target: 'DEEPSEEK_API_KEY' }
];

let loaded = false;
let lastLoadMeta = { loadedFrom: null, mechanism: null, supplemented: [] };

/**
 * @returns {{ loadedFrom: string|null, mechanism: string|null, supplemented: string[] }}
 */
export function getSharedProviderEnvMeta() {
  loadSharedProviderEnv();
  return { ...lastLoadMeta };
}

/**
 * Load unset provider credentials from RD Streamlit secrets or shared env files.
 * @returns {{ loadedFrom: string|null, mechanism: string|null, supplemented: string[] }}
 */
export function loadSharedProviderEnv() {
  if (loaded) return { ...lastLoadMeta };
  loaded = true;

  const supplemented = [];
  let loadedFrom = null;
  let mechanism = null;

  for (const tomlPath of RD_SECRETS_CANDIDATES) {
    if (!existsSync(tomlPath)) continue;
    const parsed = parseStreamlitSecretsToml(tomlPath);
    const applied = applyLegacyMappings(parsed, supplemented);
    if (applied) {
      loadedFrom = tomlPath;
      mechanism = 'streamlit-secrets-toml';
      break;
    }
  }

  if (!loadedFrom) {
    for (const envPath of KNOWN_SHARED_ENV_PATHS) {
      if (!existsSync(envPath)) continue;
      const parsed = parseEnvFile(envPath);
      const applied = applyLegacyMappings(parsed, supplemented);
      if (applied) {
        loadedFrom = envPath;
        mechanism = 'dotenv-file';
        break;
      }
    }
  }

  if (process.env.GROK_API_KEY && !process.env.XAI_API_KEY) {
    process.env.XAI_API_KEY = process.env.GROK_API_KEY;
    supplemented.push('XAI_API_KEY(alias from GROK_API_KEY)');
  }
  if (process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
    supplemented.push('GEMINI_API_KEY(from GOOGLE_API_KEY)');
  }

  lastLoadMeta = { loadedFrom, mechanism, supplemented };
  return { ...lastLoadMeta };
}

/**
 * Audit RD secrets without exposing values.
 * @returns {{ secretsTomlPath: string|null, keys: Record<string, 'PRESENT'|'ABSENT'> }}
 */
export function auditReflectiveDiagnosticsSecrets() {
  let secretsTomlPath = null;
  let flat = {};

  for (const tomlPath of RD_SECRETS_CANDIDATES) {
    if (!existsSync(tomlPath)) continue;
    secretsTomlPath = tomlPath;
    flat = parseStreamlitSecretsToml(tomlPath);
    break;
  }

  const resolvePresent = (aliases) => aliases.some((alias) => Boolean(String(flat[alias] || '').trim()));

  return {
    secretsTomlPath,
    mechanism: secretsTomlPath ? 'streamlit-secrets-toml' : null,
    keys: {
      GROK_API_KEY: resolvePresent(['GROK_API_KEY', 'grok_api_key']) ? 'PRESENT' : 'ABSENT',
      XAI_API_KEY: resolvePresent(['XAI_API_KEY', 'xai_api_key']) ? 'PRESENT' : 'ABSENT',
      GEMINI_API_KEY: resolvePresent(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'gemini_api_key', 'google_api_key']) ? 'PRESENT' : 'ABSENT',
      DEEPSEEK_API_KEY: resolvePresent(['DEEPSEEK_API_KEY', 'deepseek_api_key']) ? 'PRESENT' : 'ABSENT',
      OPENAI_API_KEY: resolvePresent(['OPENAI_API_KEY', 'openai_api_key', 'OPENAI_KEY']) ? 'PRESENT' : 'ABSENT'
    },
    rawKeyNames: Object.keys(flat).sort()
  };
}

/**
 * @param {Record<string, string>} parsed
 * @param {string[]} supplemented
 */
function applyLegacyMappings(parsed, supplemented) {
  let applied = false;
  for (const mapping of LEGACY_KEY_MAP) {
    if (process.env[mapping.target]) continue;
    for (const source of mapping.sources) {
      const value = parsed[source];
      if (!value) continue;
      process.env[mapping.target] = value;
      supplemented.push(`${mapping.target}(from ${source})`);
      applied = true;
      break;
    }
  }
  for (const key of SUPPLEMENT_KEYS) {
    if (process.env[key] || !parsed[key]) continue;
    process.env[key] = parsed[key];
    supplemented.push(key);
    applied = true;
  }
  return applied;
}

/**
 * Minimal Streamlit secrets.toml parser — keys only, no logging.
 * @param {string} content
 */
export function parseStreamlitSecretsContent(content) {
  const out = {};
  let section = '';
  try {
    for (const rawLine of String(content).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      const fullKey = section ? `${section}.${key}` : key;
      out[fullKey] = value;
      out[key] = value;
    }
  } catch {
    return {};
  }
  return out;
}

/**
 * @param {string} path
 */
export function parseStreamlitSecretsToml(path) {
  try {
    return parseStreamlitSecretsContent(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {string} path
 */
function parseEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      out[key] = value;
    }
  } catch {
    return {};
  }
  return out;
}

/**
 * @returns {Record<string, boolean>}
 */
export function getProviderCredentialStatus() {
  loadSharedProviderEnv();
  return {
    GEMINI_API_KEY: Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()),
    GROK_API_KEY: Boolean(String(process.env.GROK_API_KEY || '').trim()),
    XAI_API_KEY: Boolean(String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim()),
    DEEPSEEK_API_KEY: Boolean(String(process.env.DEEPSEEK_API_KEY || '').trim()),
    OPENAI_API_KEY: Boolean(String(process.env.OPENAI_API_KEY || '').trim())
  };
}

/**
 * @returns {string|null}
 */
export function resolveReflectiveDiagnosticsProjectRoot() {
  for (const tomlPath of RD_SECRETS_CANDIDATES) {
    if (!existsSync(tomlPath)) continue;
    return resolve(tomlPath, '..', '..');
  }
  return null;
}
