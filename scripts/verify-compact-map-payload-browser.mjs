import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
loadEnvFile(resolve(__dirname, '../../amerigo-vespucci-live/.env'));

const arcgisUsername = process.env.ARCGIS_USERNAME;
const arcgisPassword = process.env.ARCGIS_PASSWORD;
const arcgisPortalUrl = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');

async function fetchPreauthToken() {
  if (!arcgisUsername || !arcgisPassword) return null;
  const params = new URLSearchParams({
    username: arcgisUsername,
    password: arcgisPassword,
    client: 'requestip',
    expiration: '60',
    f: 'json'
  });
  const res = await fetch(`${arcgisPortalUrl}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  if (!data.token) {
    throw new Error(data.error?.message || 'ArcGIS generateToken failed');
  }
  return {
    token: data.token,
    expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000
  };
}

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const BATHROOM = 'Show bathrooms within 5 km of 997 de la Commune';
const CAMERAS = 'Show Cameras within 3 km of 997 de la Commune';
const HIDE_ALL = 'Turn off all layers.';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const preauth = await fetchPreauthToken().catch((err) => {
  console.warn('preauth token unavailable:', err.message);
  return null;
});
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

const mapApiCalls = [];
const xaiRequests = [];

page.on('request', (req) => {
  if (/xai|grok|api\.x\.ai/i.test(req.url())) xaiRequests.push(req.url());
  if (req.url().includes('/api/spatial/map') && req.method() === 'POST') {
    mapApiCalls.push({
      url: req.url(),
      postData: req.postData() || '',
      postBytes: req.postData()?.length || 0
    });
  }
});

page.on('response', async (res) => {
  if (res.url().includes('/api/spatial/map') && res.request().method() === 'POST') {
    const idx = mapApiCalls.findIndex((c) => c.url === res.url() && !c.status);
    const entry = idx >= 0 ? mapApiCalls[idx] : { url: res.url() };
    entry.status = res.status();
    try {
      entry.body = await res.json();
    } catch {
      entry.body = null;
    }
    if (idx >= 0) mapApiCalls[idx] = entry;
    else mapApiCalls.push(entry);
  }
});

async function completeArcgisPopup(popup) {
  if (!popup) return false;
  await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  const userField = popup.locator('#user_username, input[name="username"]').first();
  await userField.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (arcgisUsername && await userField.isVisible().catch(() => false)) {
    await userField.fill(arcgisUsername);
    const passField = popup.locator('#user_password, input[name="password"]').first();
    if (await passField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await passField.fill(arcgisPassword || '');
    }
    const submit = popup.locator('button[type="submit"], input[type="submit"], #signIn').first();
    if (await submit.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submit.click();
    }
  }
  await popup.waitForEvent('close', { timeout: 120000 }).catch(() => {});
  return true;
}

async function signInIfNeeded() {
  const signIn = page.locator('#spatial-sign-in');
  await signIn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (!await signIn.isVisible().catch(() => false)) return;
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await signIn.click();
  const popup = await popupPromise;
  await completeArcgisPopup(popup);
  await page.waitForTimeout(5000);
}

async function dismissIdentityModal() {
  await page.evaluate(() => {
    document.querySelector('.esri-identity-modal')?.remove();
  });
}

async function runCommand(prompt) {
  await dismissIdentityModal();
  const input = page.locator('#spatial-command-input');
  await input.fill(prompt);
  await page.waitForTimeout(200);
  await page.locator('#spatial-command-run').click({ force: true });
  await page.waitForTimeout(25000);
}

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.spatial-shell', { timeout: 30000 });
await signInIfNeeded();
await page.waitForFunction(
  () => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount === 1,
  { timeout: 180000 }
).catch(() => {});
await page.waitForFunction(
  () => window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length > 0,
  { timeout: 120000 }
).catch(() => {});
await page.waitForTimeout(5000);

mapApiCalls.length = 0;
await runCommand(BATHROOM);

const bathroomMapCall = mapApiCalls.find((c) => c.postData?.includes('bathrooms'));
const bathroomError = await page.locator('#spatial-command-response, [data-field="Response"]').first().textContent().catch(() => '');
const bathroomFreshness = await page.locator('[data-field="Freshness"]').textContent().catch(() => '0');
const lastMapError = await page.evaluate(() => window.__IQAI_LAST_MAP_ERROR__ || null);
const iqaiLayerText = await page.locator('#spatial-arcgis-layerlist').innerText().catch(() => '');

mapApiCalls.length = 0;
await runCommand(HIDE_ALL);
const hideResponse = await page.locator('#spatial-command-response, [data-field="Response"]').first().textContent().catch(() => '');

mapApiCalls.length = 0;
await runCommand(CAMERAS);
const camerasMapCall = mapApiCalls.find((c) => c.postData?.includes('Cameras'));
const camerasFreshness = await page.locator('[data-field="Freshness"]').textContent().catch(() => '0');

const diag = await page.evaluate(() => ({
  mapViewCreateCount: window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount,
  webMapCreateCount: window.__iqaiSpatialV1Diagnostics?.()?.webMapCreateCount,
  catalogLayerCount: window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0
}));

const result = {
  bathroom: {
    httpStatus: bathroomMapCall?.status,
    postBytes: bathroomMapCall?.postBytes,
    supported: bathroomMapCall?.body?.supported,
    conceptId: bathroomMapCall?.body?.summary?.conceptId,
    matchedFeatures: bathroomMapCall?.body?.summary?.matchedFeatures,
    mapCommandFailed: /Map command failed/i.test(bathroomError),
    responseText: bathroomError?.slice(0, 120),
    freshness: bathroomFreshness,
    iqaiLayerListed: /IQAI|bathroom|toilet/i.test(iqaiLayerText),
    lastMapError: lastMapError?.stage || lastMapError?.message || null,
    catalogHasFields: bathroomMapCall?.postData?.includes('"fields"'),
    catalogHasPopup: bathroomMapCall?.postData?.includes('popupTemplate')
  },
  hideAll: {
    responseText: hideResponse?.slice(0, 120)
  },
  cameras: {
    httpStatus: camerasMapCall?.status,
    postBytes: camerasMapCall?.postBytes,
    supported: camerasMapCall?.body?.supported,
    freshness: camerasFreshness
  },
  diag,
  xaiCalls: xaiRequests.length
};

console.log(JSON.stringify(result, null, 2));
await browser.close();

const pass = result.bathroom.httpStatus === 200
  && result.bathroom.supported === true
  && !result.bathroom.mapCommandFailed
  && result.bathroom.postBytes < 16384
  && result.xaiCalls === 0
  && diag.mapViewCreateCount === 1;

if (!pass) {
  console.error('Compact MAP payload browser verification FAILED');
  process.exit(1);
}
