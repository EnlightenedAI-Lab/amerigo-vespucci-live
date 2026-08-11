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

const BASE = 'http://localhost:3000';
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
  if (!data.token) throw new Error(data.error?.message || 'ArcGIS generateToken failed');
  return { token: data.token, expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000 };
}

const report = {
  shell: {},
  oauth: {},
  webmap: {},
  features: {}
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let oauthPopupUrl = null;
page.on('popup', (popup) => {
  popup.url().then((url) => { oauthPopupUrl = url; }).catch(() => {});
});

const preauth = await fetchPreauthToken().catch(() => null);
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });

report.shell.hasControlDeck = await page.locator('.control-deck').count() > 0;
report.shell.hasDeterministic = await page.locator('#spatial-deterministic-input').count() > 0;
report.shell.hasAiSpatial = await page.locator('#spatial-ai-input').count() > 0;
report.shell.hasContextDock = await page.locator('.context-dock__tabs').count() > 0;
report.shell.openInvestigationHref = await page.locator('a.spatial-header-action').getAttribute('href');

const oauthConfig = await fetch(`${BASE}/api/spatial/operational-map/oauth-config`).then((r) => r.json());
report.oauth.popupCallbackUrl = oauthConfig.popupCallbackUrl;
report.oauth.redirectUses3000 = oauthConfig.popupCallbackUrl?.includes('localhost:3000');

const signIn = page.locator('#spatial-sign-in');
await signIn.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
if (await signIn.isVisible().catch(() => false)) {
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await signIn.click();
  const popup = await popupPromise;
  if (popup) {
    oauthPopupUrl = popup.url();
    if (arcgisUsername) {
      await popup.locator('#user_username, input[name="username"]').first().fill(arcgisUsername).catch(() => {});
      await popup.locator('#user_password, input[name="password"]').first().fill(arcgisPassword || '').catch(() => {});
      await popup.locator('button[type="submit"], input[type="submit"], #signIn').first().click().catch(() => {});
      await popup.waitForEvent('close', { timeout: 120000 }).catch(() => {});
    } else {
      await popup.close().catch(() => {});
    }
  }
}

report.oauth.popupUrl = oauthPopupUrl;
report.oauth.popupRedirectValid = !oauthPopupUrl || /localhost:3000|127\.0\.0\.1:3000/.test(oauthPopupUrl);
report.oauth.noInvalidRedirect = !oauthPopupUrl || !/invalid_redirect|error=400/i.test(oauthPopupUrl);

await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('.esri-identity-modal')?.remove());

const mapHost = page.locator('#spatial-map-host');
report.webmap.mapHostVisible = await mapHost.isVisible().catch(() => false);
report.webmap.canvasPresent = await page.locator('#spatial-map-host canvas').count() > 0;
report.webmap.systemIndicator = (await page.locator('#spatial-system-indicator').textContent())?.trim() || '';
report.webmap.layerTreePresent = await page.locator('#spatial-layer-tree .layer-group, #spatial-layer-tree .layer-row').count() > 0;
report.webmap.layerCountMeta = (await page.locator('#spatial-layer-meta').textContent())?.trim() || '';

// Deterministic GIS
await page.fill('#spatial-deterministic-input', 'show fire stations within 3 km of 997 de la Commune');
await page.locator('#spatial-deterministic-run').click({ force: true });
await page.waitForTimeout(20000);
report.features.deterministicFeedback = (await page.locator('#spatial-deterministic-feedback').textContent())?.trim() || '';
report.features.deterministicOk = !((await page.locator('#spatial-detail-error').textContent()) || '').includes('failed');

// Context dock
const resultsTab = page.locator('.context-dock__tab[data-tab="RESULTS"]');
if (await resultsTab.isVisible().catch(() => false)) {
  await resultsTab.click();
}
report.features.contextDockTabs = await page.locator('.context-dock__tab').count();
report.features.dockOpen = await page.locator('.context-dock.is-open, .execution-drawer.is-open').count() > 0
  || await page.locator('#spatial-results-panel table, #spatial-results-panel .results-table').count() > 0;

// AI Spatial config
report.features.aiAvailable = await page.locator('#spatial-ai-run:not([disabled])').count() > 0
  || (await page.locator('#spatial-ai-model-badge').textContent().catch(() => '')) !== '';

report.features.openInvestigationOk = report.shell.openInvestigationHref === '/spatial/intelligence-lab/';

await page.screenshot({ path: resolve(__dirname, '../artifacts/verify-spatial-port3000.png'), fullPage: false });

await browser.close();
console.log(JSON.stringify(report, null, 2));
