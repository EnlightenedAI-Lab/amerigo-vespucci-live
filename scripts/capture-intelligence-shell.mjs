import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.SPATIAL_URL || 'http://localhost:3456';
const outPath = path.join(__dirname, '..', 'artifacts', 'intelligence-shell-redesign.png');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${baseUrl}/spatial/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: outPath, fullPage: false });
console.log('Saved', outPath);
await browser.close();
