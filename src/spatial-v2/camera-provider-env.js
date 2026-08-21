/**
 * Camera Wall provider credentials from local env only.
 * Never logs secret values. Does not write sibling worktrees.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const home = process.env.USERPROFILE || process.env.HOME || '';

const ENV_CANDIDATES = [
  resolve(ROOT, '.env'),
  resolve(process.cwd(), '.env'),
  resolve(home, 'OneDrive', 'Documents', 'iqai-camera-provider-feeds-v1', '.env')
].filter(Boolean);

function parseEnvFile(filePath) {
  const out = {};
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return {};
  }
  return out;
}

let loaded = false;

export function loadCameraProviderEnv() {
  if (loaded) return;
  loaded = true;
  for (const filePath of ENV_CANDIDATES) {
    if (!existsSync(filePath)) continue;
    const parsed = parseEnvFile(filePath);
    if (!process.env.MAPILLARY_ACCESS_TOKEN && parsed.MAPILLARY_ACCESS_TOKEN) {
      process.env.MAPILLARY_ACCESS_TOKEN = parsed.MAPILLARY_ACCESS_TOKEN;
    }
  }
}

export function getMapillaryAccessToken() {
  loadCameraProviderEnv();
  return String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim() || null;
}

export function cameraProviderCredentialStatus() {
  loadCameraProviderEnv();
  const mapillary = Boolean(getMapillaryAccessToken());
  const google = Boolean(String(process.env.GOOGLE_MAPS_BROWSER_API_KEY || '').trim());
  return {
    MAPILLARY_ACCESS_TOKEN: mapillary ? 'PRESENT' : 'ABSENT',
    GOOGLE_MAPS_BROWSER_API_KEY: google ? 'PRESENT' : 'ABSENT',
    mapillaryCredentialRequired: !mapillary
  };
}
