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
const xaiRequests = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('request', (req) => {
  if (/xai|grok|api\.x\.ai/i.test(req.url())) xaiRequests.push(req.url());
});

const preauth = await fetchPreauthToken().catch((err) => {
  console.warn('preauth token unavailable:', err.message);
  return null;
});
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

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

async function runPrompt(prompt) {
  await dismissIdentityModal();
  await page.fill('#spatial-command-input', '');
  await page.fill('#spatial-command-input', prompt);
  await page.waitForTimeout(300);
  await page.locator('#spatial-command-run').click({ force: true });
  await page.waitForTimeout(25000);

  const understood = (await page.locator('#spatial-understood-line').textContent().catch(() => '')) || '';
  const response = (await page.locator('#spatial-response-line').textContent().catch(() => '')) || '';
  const error = (await page.locator('#spatial-detail-error').textContent().catch(() => '')) || '';
  const matched = (await page.locator('[data-field="Matched features"]').first().textContent().catch(() => '')) || '';
  const dataset = (await page.locator('[data-field="Dataset"]').first().textContent().catch(() => '')) || '';
  const radius = (await page.locator('[data-field="Radius"]').first().textContent().catch(() => '')) || '';
  const source = (await page.locator('[data-field="Source"]').first().textContent().catch(() => '')) || '';
  const mapVisible = await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0;

  return {
    prompt,
    understood,
    response,
    error,
    matched,
    dataset,
    radius,
    source,
    mapVisible,
    badSourceError: /Verified GIS source not configured: me pharmacies are/i.test(error + response + understood)
  };
}

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.spatial-shell', { timeout: 30000 });
await signInIfNeeded();
await page.waitForFunction(
  () => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount === 1,
  { timeout: 180000 }
).catch(() => {});
await page.waitForTimeout(8000);

const malformed = await runPrompt('show me pharmacies are within 1km of 997 de la commune');
const canonical = await runPrompt('Show pharmacies within 1 km of 997 de la Commune.');

const passMalformed =
  !malformed.badSourceError
  && /UNDERSTOOD:/i.test(malformed.understood)
  && /pharmacies within 1 km/i.test(malformed.understood)
  && !malformed.error
  && malformed.mapVisible
  && Number(malformed.matched) > 0;

const passCanonical =
  !canonical.badSourceError
  && !canonical.error
  && canonical.mapVisible
  && Number(canonical.matched) > 0;

const result = {
  malformed,
  canonical,
  passMalformed,
  passCanonical,
  xaiGrokCalls: xaiRequests.length
};

console.log(JSON.stringify(result, null, 2));
await browser.close();

if (!passMalformed || !passCanonical || xaiRequests.length > 0) {
  process.exit(1);
}
