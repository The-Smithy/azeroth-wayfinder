#!/usr/bin/env node
// Distils the wowforever.gg Azeroth Atlas (≈76 MB) into the small, committed
// location + zone datasets the game ships with:
//   src/data/locations.json  – every guessable place, in world map coordinates
//   src/data/zones.json      – zone outlines (simplified) for hover labels & area targets
//
// Usage: npm run build-data            (uses .cache/ if present)
//        npm run build-data -- --fresh (re-download the atlas)
import { writeFile } from 'node:fs/promises';
import { ATLAS_URL, CATALOG_URL, download, readJson } from './shared.mjs';

const fresh = process.argv.includes('--fresh');
const atlasPath = await download(ATLAS_URL, '.cache/atlas.json', { force: fresh });
const catalogPath = await download(CATALOG_URL, '.cache/catalog.json', { force: fresh });
const atlas = await readJson(atlasPath);
const catalog = await readJson(catalogPath);

const round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

// ---------------------------------------------------------------- zones ----
const zoneInfo = new Map(atlas.zones.map(z => [z.uiMapId, z]));

/** Ramer–Douglas–Peucker on an open polyline of [lat,lng] points. */
function rdp(points, eps) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const len = Math.hypot(dx, dy) || 1e-9;
    const d = Math.abs(dy * p[1] - dx * p[0] + b[1] * a[0] - b[0] * a[1]) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return [...rdp(points.slice(0, idx + 1), eps).slice(0, -1), ...rdp(points.slice(idx), eps)];
}
/** Simplify a closed ring: split it at the vertex farthest from the start, simplify both halves. */
function simplifyRing(ring, eps) {
  const [a] = ring;
  let far = 0, best = -1;
  ring.forEach((p, i) => { const d = Math.hypot(p[0] - a[0], p[1] - a[1]); if (d > best) { best = d; far = i; } });
  const first = rdp(ring.slice(0, far + 1), eps);
  const second = rdp([...ring.slice(far), a], eps);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}
const ringArea = ring => Math.abs(ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return s + p[1] * q[0] - q[1] * p[0];
}, 0) / 2);

const zones = {};
for (const [id, z] of Object.entries(catalog.markerZones)) {
  const geo = catalog.zones[id];
  if (geo && geo.tileSet !== 'world') continue; // Zephras Isle lives in its own coordinate space
  const info = zoneInfo.get(Number(id));
  if (!info || info.realm !== 'azeroth') continue;
  const rings = (geo?.rings || [])
    .filter(r => ringArea(r) >= 0.6) // drop specks & tracing artifacts
    .map(r => simplifyRing(r, 0.12).map(([la, ln]) => [round(la), round(ln)]))
    .filter(r => r.length >= 3);
  zones[id] = {
    name: info.name,
    continent: info.continent,
    city: !!info.city,
    // Zone-map rectangle: [[south, west], [north, east]] in world lat/lng. In-game x/y
    // coordinates (0–100) are measured across this rectangle.
    bounds: z.bounds.map(([la, ln]) => [round(la, 4), round(ln, 4)]),
    rings,
  };
}

// ------------------------------------------------------------ locations ----
const KINDS = new Set(['city', 'town', 'dungeon', 'raid', 'landmark', 'zone']);
const isMailbox = r => /briefkasten|mailbox/i.test(r.name);

function toLatLng(pos) {
  const zone = zones[pos.zoneId];
  if (!zone || !Array.isArray(pos.coords)) return null;
  const [[s, w], [n, e]] = zone.bounds;
  const [cx, cy] = pos.coords;
  return [round(n - (cy / 100) * (n - s)), round(w + (cx / 100) * (e - w))];
}

const slug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const locations = [];
const seen = new Set();
for (const r of atlas.records) {
  if (!KINDS.has(r.kind) || isMailbox(r)) continue;
  const name = (r.en || r.localizedNames?.en || '').replace(/’/g, "'").trim();
  if (!name) continue; // no verified English name yet (e.g. brand-new Forever towns)
  const pos = (r.positions || []).find(p => zones[p.zoneId]);
  if (!pos) continue;
  const id = slug(name);
  if (seen.has(id)) continue;
  seen.add(id);
  const zone = zones[pos.zoneId];
  // Zones and cities are judged against their outline (pin inside = bullseye).
  const area = (r.kind === 'zone' || r.kind === 'city') && zone.rings.length ? String(pos.zoneId) : undefined;
  locations.push({
    id,
    name,
    kind: r.kind,
    faction: ['alliance', 'horde'].includes(r.faction) ? r.faction : 'neutral',
    zoneId: pos.zoneId,
    zone: zone.name,
    continent: zone.continent,
    latlng: toLatLng(pos),
    ...(area ? { area } : {}),
    ...(r.new ? { isNew: true } : {}),
  });
}
locations.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

await writeFile('src/data/zones.json', JSON.stringify(zones));
await writeFile('src/data/locations.json', JSON.stringify(locations, null, 1));

const byKind = locations.reduce((m, l) => ({ ...m, [l.kind]: (m[l.kind] || 0) + 1 }), {});
console.log(`zones: ${Object.keys(zones).length}, locations: ${locations.length}`, byKind);
