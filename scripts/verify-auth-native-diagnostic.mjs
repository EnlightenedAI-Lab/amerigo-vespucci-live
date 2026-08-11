/**
 * Automated AUTH-NATIVE diagnostic capture after amenities query.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(__dirname, '../artifacts');

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

loadEnvFile(resolve(__dirname, '../.env'));

const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';
const HEADED = process.env.HEADED === '1';
const MANUAL_AUTH_MS = Number(process.env.MANUAL_AUTH_MS || 180000);
const PROMPT = 'map amenities within 3km of 997 de la commune';

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({
    username,
    password,
    client: 'requestip',
    expiration: '60',
    f: 'json'
  });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  if (!data.token) return null;
  return { token: data.token, expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000 };
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage();

  const preauth = await fetchPreauthToken();
  if (preauth) {
    await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((tokenData) => {
      localStorage.setItem('esriJSAPIOAuth', JSON.stringify({
        '/': {
          appId: 'preview',
          token: tokenData.token,
          expires: tokenData.expires,
          ssl: true,
          userId: 'verify-script'
        }
      }));
    }, preauth);
  }

  await page.goto(`${BASE}/spatial/`, { waitUntil: 'networkidle', timeout: MANUAL_AUTH_MS });
  await page.waitForSelector('#spatial-deterministic-input', { timeout: MANUAL_AUTH_MS });
  await page.fill('#spatial-deterministic-input', PROMPT);
  await page.locator('#spatial-deterministic-run').click({ force: true });
  await page.waitForTimeout(32000);

  const runtimeInfo = await fetch(`${BASE}/api/spatial/runtime-info`).then((r) => r.json()).catch(() => null);
  const client = await page.evaluate(() => ({
    authNative: window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__,
    renderer: window.__IQAI_RESULT_RENDERER__,
    scoped: window.__IQAI_SCOPED_LAYER_ATTEMPT__,
    provenance: window.__IQAI_OBJECTID_PROVENANCE__,
    webStyle: window.__IQAI_WEBSTYLE_SYMBOL_DIAGNOSTIC__,
    badge: document.getElementById('iqai-spatial-dev-badge')?.textContent || null
  }));

  const report = {
    at: new Date().toISOString(),
    prompt: PROMPT,
    runtimeInfo,
    client,
    summary: {
      failureStage: client.authNative?.failureStage || null,
      failureReason: client.authNative?.failureReason || runtimeInfo?.fallbackReason || null,
      shortCode: client.authNative?.shortCode || runtimeInfo?.authNativeShortReason || null,
      badge: client.badge
    }
  };

  const out = resolve(ARTIFACTS, 'verify-auth-native-diagnostic.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${out}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
