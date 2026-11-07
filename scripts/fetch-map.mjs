#!/usr/bin/env node
// Downloads the WoW: Forever map imagery from wowforever.gg's Azeroth Atlas and
// prepares it for the game in public/map/ (git-ignored – the imagery is not ours
// to redistribute, see README):
//
//   public/map/tiles/{z}/{x}/{y}.webp  terrain pyramid (512px, Leaflet CRS.Simple),
//                                      with the atlas' water masks baked in as alpha
//   public/map/overview.webp           the parchment world map (status bar cropped)
//   public/map/ocean.webp              decorative sea illustration
//   public/map/manifest.json           tile list + calibrated bounds for all layers
//
// Runs automatically before `npm run dev` / `npm run build` and is a no-op when
// the manifest already exists. Pass --force to rebuild.
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ASSETS, CATALOG_URL, download, exists, pool, readJson } from './shared.mjs';

const OUT = 'public/map';
const MANIFEST = `${OUT}/manifest.json`;
const OVERVIEW = 'zones/azeroth-overview-screenshot-20260924-wowforever.png';
const STATUS_BAR_PX = 14; // the in-game "Cursor / Player" strip under the screenshot
const force = process.argv.includes('--force');

if (!force && await exists(MANIFEST)) {
  console.log(`[fetch-map] ${MANIFEST} present – skipping (use --force to rebuild).`);
  process.exit(0);
}

console.log('[fetch-map] Fetching terrain catalog…');
const catalog = await readJson(await download(CATALOG_URL, '.cache/catalog.json', { force }));
const tiles = catalog.tiles.filter(t => t.startsWith('world/'));
const world = catalog.worlds.world;

// ------------------------------------------------------------- terrain ----
let done = 0;
await pool(tiles, 8, async key => {
  const raw = await download(`${ASSETS}/terrain/${key}`, `.cache/terrain/${key}`);
  const dest = `${OUT}/tiles/${key.slice('world/'.length)}`;
  await mkdir(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
  const masks = catalog.waterMasks?.[key];
  if (!masks) {
    await sharp(raw).toFile(dest);
  } else {
    // Water masks are flat [x, y, w, h, …] rectangles of open sea painted into the
    // minimap tiles; clear them so the illustrated ocean shows through.
    const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < masks.length; i += 4) {
      const [mx, my, mw, mh] = masks.slice(i, i + 4).map(Math.round);
      for (let y = Math.max(0, my); y < Math.min(info.height, my + mh); y++) {
        for (let x = Math.max(0, mx); x < Math.min(info.width, mx + mw); x++) {
          data[(y * info.width + x) * 4 + 3] = 0;
        }
      }
    }
    await sharp(data, { raw: info }).webp({ quality: 82, alphaQuality: 90 }).toFile(dest);
  }
  if (++done % 100 === 0) console.log(`[fetch-map]   ${done}/${tiles.length} tiles`);
});

// ------------------------------------------------------------ overview ----
console.log('[fetch-map] Fetching parchment overview…');
const overviewRaw = await download(`${ASSETS}/${OVERVIEW}`, `.cache/${OVERVIEW}`);
const meta = await sharp(overviewRaw).metadata();
// The atlas calibrates the overview by fitting the world bounds to the image's
// aspect ratio around their common centre (see fitWorldBounds in the atlas).
const [[s, w], [n, e]] = catalog.overviews.azeroth.bounds;
const ratio = meta.width / meta.height;
const h = Math.max(n - s, (e - w) / ratio), wd = h * ratio;
const cLat = (s + n) / 2, cLng = (w + e) / 2;
const top = cLat + h / 2, left = cLng - wd / 2;
const unitsPerPx = wd / meta.width;
const cropH = meta.height - STATUS_BAR_PX;
await sharp(overviewRaw)
  .extract({ left: 0, top: 0, width: meta.width, height: cropH })
  .webp({ quality: 86 })
  .toFile(`${OUT}/overview.webp`);
const overviewBounds = [[top - cropH * unitsPerPx, left], [top, left + wd]];

// --------------------------------------------------------------- ocean ----
const oceanRaw = await download(`${ASSETS}/terrain/${world.ocean.path}`, `.cache/terrain/${world.ocean.path}`);
await sharp(oceanRaw).toFile(`${OUT}/ocean.webp`);

const r4 = v => Math.round(v * 1e4) / 1e4;
const manifest = {
  source: 'https://wowforever.gg/en/atlas/',
  fetchedAt: new Date().toISOString(),
  tileSize: 512,
  maxNativeZoom: catalog.maxZoom,
  tiles: tiles.map(t => t.slice('world/'.length, -'.webp'.length)),
  worldBounds: world.bounds,
  overviewBounds: overviewBounds.map(p => p.map(r4)),
  oceanBounds: world.ocean.bounds,
};
await writeFile(MANIFEST, JSON.stringify(manifest));
console.log(`[fetch-map] Done: ${tiles.length} tiles, overview ${meta.width}×${cropH}.`);
