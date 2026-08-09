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
const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';

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
  if (!data.token) throw new Error(data.error?.message || 'generateToken failed');
  return { token: data.token, expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000 };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const preauth = await fetchPreauthToken().catch((err) => {
  console.warn('preauth failed:', err.message);
  return null;
});
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

async function dismissIdentityModal() {
  await page.evaluate(() => document.querySelector('.esri-identity-modal')?.remove());
}

async function signInIfNeeded() {
  const signIn = page.locator('#spatial-sign-in');
  if (!await signIn.isVisible({ timeout: 5000 }).catch(() => false)) return;
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await signIn.click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const user = popup.locator('#user_username, input[name="username"]').first();
    if (await user.isVisible({ timeout: 10000 }).catch(() => false)) {
      await user.fill(arcgisUsername || '');
      const pass = popup.locator('#user_password, input[name="password"]').first();
      if (await pass.isVisible({ timeout: 3000 }).catch(() => false)) await pass.fill(arcgisPassword || '');
      const submit = popup.locator('button[type="submit"], #signIn').first();
      if (await submit.isVisible({ timeout: 3000 }).catch(() => false)) await submit.click();
    }
    await popup.waitForEvent('close', { timeout: 120000 }).catch(() => {});
  }
  await page.waitForTimeout(5000);
}

async function runPrompt(prompt) {
  await dismissIdentityModal();
  await page.fill('#spatial-command-input', '');
  await page.fill('#spatial-command-input', prompt);
  await page.waitForTimeout(300);
  await page.locator('#spatial-command-run').click({ force: true });
  await page.waitForTimeout(25000);
}

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.spatial-shell', { timeout: 30000 });
await signInIfNeeded();
await dismissIdentityModal();
await page.waitForFunction(
  () => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount === 1,
  { timeout: 180000 }
).catch(() => {});
await page.waitForTimeout(8000);

const oneKm = await runPrompt('show me pharmacies are within 1km of 997 de la commune');
const inspect1 = await page.evaluate(async () => {
  const view = window.__iqaiSpatialV1Diagnostics?.()?.mapView;
  const webMap = view?.map;
  const group = webMap?.findLayerById('iqai-map-result');
  const layers = [];
  const walk = (collection) => {
    for (const layer of collection?.items || []) {
      layers.push(layer);
      if (layer.type === 'group') walk(layer.layers);
    }
  };
  if (group?.layers) walk(group.layers);
  const pharmacy = layers.find((l) => /pharmacy|iqai-concept/i.test(`${l.id} ${l.title}`));
  if (!pharmacy) return { found: false, layerIds: layers.map((l) => l.id) };
  let layerView = null;
  try { layerView = await view.whenLayerView(pharmacy); } catch {}
  const renderer = pharmacy.renderer?.toJSON?.() || pharmacy.renderer;
  return {
    found: true,
    id: pharmacy.id,
    title: pharmacy.title,
    type: pharmacy.type,
    visible: pharmacy.visible,
    sourceLength: pharmacy.source?.length,
    rendererType: renderer?.type,
    symbolType: renderer?.symbol?.type,
    symbolUrlPrefix: String(renderer?.symbol?.url || '').slice(0, 30),
    popupTemplate: Boolean(pharmacy.popupTemplate),
    minScale: pharmacy.minScale,
    maxScale: pharmacy.maxScale,
  layerViewExists: Boolean(layerView),
    layerViewSuspended: layerView?.suspended,
    queryFeatureCount: layerView?.queryFeatureCount
  };
});

const understood = await page.locator('#spatial-understood-line').textContent().catch(() => '');
const matched = await page.locator('[data-field="Matched features"]').first().textContent().catch(() => '');
const error = await page.locator('#spatial-detail-error').textContent().catch(() => '');

const threeKm = await runPrompt('show me pharmacies are within 3km of 997 de la commune');
const matched3 = await page.locator('[data-field="Matched features"]').first().textContent().catch(() => '');

const result = {
  understood,
  matched,
  matched3,
  error,
  inspect1,
  passVisible: inspect1?.symbolType === 'picture-marker' && Number(matched) > 0 && !error
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.passVisible ? 0 : 1);
