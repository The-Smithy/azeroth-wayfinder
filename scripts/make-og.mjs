#!/usr/bin/env node
// Renders the social preview card (public/og-image.jpg, 1200×630) from
// scripts/og/og.html. Needs the map imagery (npm run fetch-map) and Playwright:
//   npx playwright install chromium   # once, if you don't have a browser
//   npm run make-og [-- --url pinpoint.example.com]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { exists } from './shared.mjs';

if (!(await exists('public/map/overview.webp'))) {
  console.error('[make-og] public/map/overview.webp missing – run `npm run fetch-map` first.');
  process.exit(1);
}
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Fall back to a CommonJS/global install (resolvable via NODE_PATH).
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* reported below */ }
}
if (!chromium) {
  console.error('[make-og] Playwright is not installed: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const urlArg = process.argv.indexOf('--url');
const label = urlArg > -1 ? process.argv[urlArg + 1] : '';
const page_url = pathToFileURL(resolve('scripts/og/og.html')).href + (label ? `?url=${encodeURIComponent(label)}` : '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(page_url);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const png = await page.screenshot({ type: 'png' });
await browser.close();

await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile('public/og-image.jpg');
console.log('[make-og] wrote public/og-image.jpg');
