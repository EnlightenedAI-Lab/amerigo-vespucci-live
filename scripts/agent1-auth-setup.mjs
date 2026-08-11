/**
 * One-time headed ArcGIS OAuth setup for autonomous Agent 1 acceptance.
 * Preserves session in .playwright-auth/montreal (gitignored).
 *
 * Usage: npm run spatial:auth-setup
 * Opens a maximized headed browser on the primary monitor (0,0).
 * OAuth runs in the main window — not a hidden popup.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPortOpen,
  killProcessOnPort,
  startSpatialServer,
  waitForHttp,
  stopSpatialServer
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FOCUS_SCRIPT = resolve(__dirname, 'lib', 'focus-browser-window.ps1');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const AUTH_READY_MARKER = resolve(AUTH_PROFILE_DIR, '.auth-ready.json');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-acceptance');
const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const WAIT_MS = Number(process.env.AUTH_SETUP_WAIT_MS || 1800000);
const VISIBLE_CONFIRM_MS = Number(process.env.AUTH_VISIBLE_CONFIRM_MS || 90000);
const WINDOW_TITLE_NEEDLE = 'IQAI ARC GIS AUTH';

const LAUNCH_ARGS = [
  '--start-maximized',
  '--window-position=0,0',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-popup-blocking',
  '--force-device-scale-factor=1'
];

function focusPrimaryMonitorWindow(titleNeedle = WINDOW_TITLE_NEEDLE) {
  return execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${FOCUS_SCRIPT}" -TitleNeedle "${titleNeedle.replace(/"/g, '`"')}"`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

function verifyBrowserWindowOnPrimaryMonitor(titleNeedle = WINDOW_TITLE_NEEDLE) {
  const info = focusPrimaryMonitorWindow(titleNeedle);
  const rectMatch = info.match(/rect=(-?\d+),(-?\d+),(-?\d+),(-?\d+)/);
  const primaryMatch = info.match(/primary=(-?\d+),(-?\d+),(\d+),(\d+)/);
  if (!rectMatch) return null;
  const left = Number(rectMatch[1]);
  const top = Number(rectMatch[2]);
  const right = Number(rectMatch[3]);
  const bottom = Number(rectMatch[4]);
  const width = right - left;
  const height = bottom - top;
  const pLeft = primaryMatch ? Number(primaryMatch[1]) : 0;
  const pTop = primaryMatch ? Number(primaryMatch[2]) : 0;
  const pWidth = primaryMatch ? Number(primaryMatch[3]) : 1920;
  const pHeight = primaryMatch ? Number(primaryMatch[4]) : 1080;
  const overlapsPrimary = left < pLeft + pWidth
    && right > pLeft
    && top < pTop + pHeight
    && bottom > pTop;
  return {
    title: info.split('|rect=')[0],
    left,
    top,
    width,
    height,
    onPrimary: overlapsPrimary && width > 400 && height > 300
  };
}

async function waitForMapReady(page, timeoutMs = 120000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    const signInHidden = document.querySelector('#spatial-sign-in')?.hidden !== false;
    return Boolean(canvas && layers.length > 0 && catalog > 5 && signInHidden);
  }, { timeout: timeoutMs }).catch(() => false);
}

function isArcGisLoginUrl(url) {
  return /arcgis\.com/i.test(url) && /oauth|signin|login|authorize/i.test(url);
}

async function isArcGisLoginVisible(page) {
  const url = page.url();
  if (isArcGisLoginUrl(url)) return true;
  const passwordField = await page.locator(
    'input[type="password"], input[name="password"], #user_password'
  ).first().isVisible().catch(() => false);
  return passwordField && /arcgis\.com/i.test(url);
}

async function waitForArcGisLoginVisible(page, timeoutMs = VISIBLE_CONFIRM_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isArcGisLoginVisible(page)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

function wireOAuthToMainWindow(page) {
  page.on('popup', async (popup) => {
    const url = popup.url();
    console.log('[auth-setup] OAuth popup intercepted — opening in main window:', url);
    try { await popup.close(); } catch { /* ignore */ }
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate((title) => { document.title = title; }, `${WINDOW_TITLE_NEEDLE} — SIGN IN HERE`);
  });
}

async function clickArcGisOAuthModal(page) {
  const hasPrompt = await page.getByText(/please sign in to arcgis online/i).isVisible().catch(() => false);
  if (!hasPrompt) return false;
  const ok = page.getByRole('button', { name: /^ok$/i }).first();
  if (!(await ok.isVisible().catch(() => false))) return false;
  console.log('[auth-setup] Clicking OK — OAuth opens in main window.');
  await ok.click({ force: true });
  await page.waitForTimeout(1500);
  return true;
}

async function triggerSignIn(page) {
  await clickArcGisOAuthModal(page);
  const visible = await page.locator('#spatial-sign-in').isVisible().catch(() => false);
  if (!visible) return false;
  await page.locator('#spatial-sign-in').click({ force: true });
  await page.waitForTimeout(1500);
  return true;
}

async function forcePrimaryMaximizedWindow(context, page) {
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'maximized' }
    });
    console.log(`[auth-setup] CDP window ${windowId} set maximized at 0,0.`);
  } catch (error) {
    console.log('[auth-setup] CDP window bounds fallback:', error?.message || error);
  }
  await page.bringToFront();
}

async function launchVisibleBrowser() {
  const baseOptions = {
    headless: false,
    viewport: null,
    slowMo: 20,
    args: LAUNCH_ARGS
  };
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      const context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
        ...baseOptions,
        ...(channel ? { channel } : {})
      });
      console.log(`[auth-setup] Launched headed browser${channel ? ` (${channel})` : ' (chromium)'} at 0,0 maximized.`);
      return context;
    } catch {
      if (!channel) throw new Error('Could not launch headed browser');
    }
  }
  throw new Error('Could not launch headed browser');
}

async function assertWindowVisibleOnPrimary(attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const win = verifyBrowserWindowOnPrimaryMonitor();
      if (win?.onPrimary) return win;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  mkdirSync(AUTH_PROFILE_DIR, { recursive: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  let serverChild = null;
  let startedServer = false;
  if (await isPortOpen(PORT)) {
    killProcessOnPort(PORT);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!(await isPortOpen(PORT))) {
    serverChild = startSpatialServer(REPO_ROOT);
    startedServer = true;
    const ready = await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000);
    if (!ready) {
      console.error('[auth-setup] Spatial server failed to start.');
      stopSpatialServer(serverChild);
      process.exit(1);
    }
  }

  const context = await launchVisibleBrowser();
  const page = context.pages()[0] || await context.newPage();
  wireOAuthToMainWindow(page);
  await forcePrimaryMaximizedWindow(context, page);

  try {
    await page.bringToFront();
    await page.goto(`${BASE}/spatial/auth-signin.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(800);
    await page.evaluate((title) => { document.title = title; }, `${WINDOW_TITLE_NEEDLE} — SIGN IN HERE`);

    let win = await assertWindowVisibleOnPrimary();
    if (!win) {
      console.error('[auth-setup] Headed browser process launched but no visible primary-monitor window found.');
      await context.close();
      if (startedServer) stopSpatialServer(serverChild);
      process.exit(1);
    }
    console.log(`[auth-setup] Window verified on primary monitor: ${win.title} @ ${win.left},${win.top} ${win.width}x${win.height}`);

    await page.waitForTimeout(2600);
    await page.bringToFront();
    await page.goto(`${BASE}/spatial/?auth-setup=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(800);
    await page.evaluate((title) => { document.title = title; }, `${WINDOW_TITLE_NEEDLE} — SIGN IN HERE`);
    await page.waitForSelector('.spatial-shell', { timeout: 60000 }).catch(() => {});

    win = await assertWindowVisibleOnPrimary();
    if (!win) {
      console.error('[auth-setup] Lost visible primary-monitor browser window after navigation.');
      await context.close();
      if (startedServer) stopSpatialServer(serverChild);
      process.exit(1);
    }

    let ready = await waitForMapReady(page, 12000);
    if (!ready) await triggerSignIn(page);

    let loginVisible = await waitForArcGisLoginVisible(page, 25000);
    if (!loginVisible) {
      await clickArcGisOAuthModal(page);
      loginVisible = await waitForArcGisLoginVisible(page, VISIBLE_CONFIRM_MS);
    }

    await page.waitForTimeout(800);
    await page.evaluate((title) => { document.title = title; }, `${WINDOW_TITLE_NEEDLE} — SIGN IN HERE`);
    win = await assertWindowVisibleOnPrimary();
    if (!win || !loginVisible) {
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'auth-setup-not-visible.png'), fullPage: true });
      console.error('[auth-setup] Could not confirm ArcGIS login in a visible primary-monitor window.');
      await context.close();
      if (startedServer) stopSpatialServer(serverChild);
      process.exit(1);
    }

    await page.bringToFront();
    focusPrimaryMonitorWindow();
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'auth-login-visible.png'), fullPage: true });
    console.log(`ARC_GIS_AUTH_WINDOW_READY|${win.left},${win.top},${win.width},${win.height}|${page.url()}`);

    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      ready = await waitForMapReady(page, 10000);
      if (ready) break;
      if (await isArcGisLoginVisible(page)) {
        focusPrimaryMonitorWindow();
      } else {
        await clickArcGisOAuthModal(page);
        const signInVisible = await page.locator('#spatial-sign-in').isVisible().catch(() => false);
        if (signInVisible) await triggerSignIn(page);
      }
      await page.waitForTimeout(3000);
    }

    if (!ready) {
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'auth-setup-timeout.png'), fullPage: true });
      console.error('[auth-setup] Timed out waiting for authenticated map.');
      await context.close();
      if (startedServer) stopSpatialServer(serverChild);
      process.exit(1);
    }

    writeFileSync(AUTH_READY_MARKER, JSON.stringify({
      readyAt: new Date().toISOString(),
      profileDir: AUTH_PROFILE_DIR,
      session: await page.evaluate(() => ({
        catalogLayers: window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0,
        mapOperational: Boolean(document.querySelector('#spatial-map-host canvas')),
        webmapTitle: window.__IQAI_WEBMAP_LAYER_CATALOG__?.webmapTitle || null
      }))
    }, null, 2));
    console.log('[auth-setup] Authentication preserved in .playwright-auth/montreal');
    await page.waitForTimeout(2000);
    await context.close();
    if (startedServer) stopSpatialServer(serverChild);
    process.exit(0);
  } catch (error) {
    console.error('[auth-setup] Failed:', error?.message || error);
    try {
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'auth-setup-error.png'), fullPage: true });
    } catch { /* ignore */ }
    await context.close();
    if (startedServer) stopSpatialServer(serverChild);
    process.exit(1);
  }
}

main();
