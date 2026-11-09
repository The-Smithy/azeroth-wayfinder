#!/usr/bin/env node
// Distils the wowforever.gg Azeroth Atlas (≈76 MB) into the small, committed
// location + zone datasets the game ships with:
//   server/data/places.json  – every guessable place with its answer (server-only)
//   src/data/zones.json      – zone outlines (simplified) for hover labels & area targets
//
// Usage: npm run build-data            (uses .cache/ if present)
//        npm run build-data -- --fresh (re-download the atlas)
import { mkdir, writeFile } from 'node:fs/promises';
import { ATLAS_URL, CATALOG_URL, ROUTING_URL, download, readJson } from './shared.mjs';

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
// Every place collects candidate positions from several independent sources, and the
// best one is chosen by explicit rules. docs/locations.md records the decision.
//
//   atlas      the Atlas place record: Classic instance entrances / Classic flight
//              points ("travel"), or Forever-confirmed entrances and observations
//   centre     WoW: Forever game database (QuestieDB Forever): median position of the
//              town's service NPCs (innkeeper, vendors, trainers, flight master …)
//   override   hand-checked fixes in scripts/location-overrides.json, anchored on a
//              Forever source (an NPC from the Forever database, or a boat/zeppelin
//              stop from the Forever routing survey)
const KINDS = new Set(['city', 'town', 'dungeon', 'raid', 'landmark', 'zone']);
const isMailbox = r => /briefkasten|mailbox/i.test(r.name);
const YARDS = 1600 / 3 / 4;
/** Snap a town to its Forever centre only when both agree on the place (sanity check). */
const SNAP_MAX_YARDS = 300;
const SERVICES = new Set(['innkeeper', 'flightmaster', 'vendor', 'repair', 'trainer', 'banker', 'stablemaster', 'class']);

const routing = await readJson(await download(ROUTING_URL, '.cache/mapwise/catalog.json', { force: fresh }));
const overrides = await readJson('scripts/location-overrides.json');
/**
 * The big, well-known hubs. These are dealt in the ×1 "hub" round; every other town is
 * dealt in the ×2 round alongside dungeons and raids.
 */
const POPULAR_TOWNS = new Set([
  'Booty Bay', 'Crossroads', 'Ratchet', 'Southshore', 'Tarren Mill', 'Menethil Harbor',
  'Theramore Isle', 'Auberdine', 'Astranaar', 'Darkshire', 'Lakeshire', 'Sentinel Hill',
  'Thelsamar', "Grom'gol Base Camp", 'Camp Taurajo', 'Everlook', 'Cenarion Hold',
  'The Sepulcher', 'Stormwind Harbor', "Light's Hope Chapel", 'Hammerfall', 'Refuge Pointe',
]);

function toLatLng(pos) {
  const zone = zones[pos.zoneId];
  if (!zone || !Array.isArray(pos.coords)) return null;
  const [[s, w], [n, e]] = zone.bounds;
  const [cx, cy] = pos.coords;
  return [round(n - (cy / 100) * (n - s)), round(w + (cx / 100) * (e - w))];
}
const yardsBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * YARDS;
const median = xs => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const isForeverDb = (r, p) => (p.sourceId ?? (r.sourceIds || []).join(',')).includes('questiedb');

// Forever NPC positions, indexed by linked place and by English name.
const npcsByPlace = new Map();
const npcByName = new Map();
/** Every Forever NPC that offers something (quests, vendors, trainers …) – i.e. townsfolk, not mobs. */
const forever_townsfolk = [];
for (const r of atlas.records) {
  if (r.kind !== 'npc') continue;
  const pts = (r.positions || []).filter(p => isForeverDb(r, p)).map(p => ({ zoneId: p.zoneId, latlng: toLatLng(p) })).filter(p => p.latlng);
  if (!pts.length) continue;
  if (r.en && !npcByName.has(r.en)) npcByName.set(r.en, pts);
  if ((r.services || []).some(s => s !== 'rare')) forever_townsfolk.push(...pts);
  if (!(r.services || []).some(s => SERVICES.has(s))) continue;
  for (const pid of r.placeIds || []) {
    if (!npcsByPlace.has(pid)) npcsByPlace.set(pid, []);
    npcsByPlace.get(pid).push(...pts.map(p => p.latlng));
  }
}

/** Robust town centre: median, drop stragglers > 600 yd, median again. */
function serviceCentre(placeId) {
  const pts = npcsByPlace.get(placeId);
  if (!pts || pts.length < 3) return null;
  const m1 = [median(pts.map(p => p[0])), median(pts.map(p => p[1]))];
  const core = pts.filter(p => yardsBetween(p, m1) < 600);
  if (core.length < 3) return null;
  return { latlng: [round(median(core.map(p => p[0]))), round(median(core.map(p => p[1])))], n: core.length };
}

/** A flight point or boat/zeppelin stop from the Forever routing survey, by name, in a zone. */
function surveyPoint(name, zoneId, kinds = ['flightNodes', 'transportStops']) {
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  for (const list of kinds) {
    const hit = routing[list].find(s => s.n && Number(s.zone) === zoneId && norm(s.n.split(',')[0]) === norm(name));
    if (hit) return { latlng: toLatLng({ zoneId, coords: [hit.mx * 100, hit.my * 100] }), kind: list === 'flightNodes' ? 'flight point' : hit.transportKind ?? 'stop' };
  }
  return null;
}

/** Median of the Forever townsfolk within `radius` yards of a point in the same zone. */
function townsfolkCentre(point, zoneId, radius) {
  const near = forever_townsfolk.filter(p => p.zoneId === zoneId && yardsBetween(p.latlng, point) <= radius).map(p => p.latlng);
  if (near.length < 3) return null;
  return { latlng: [round(median(near.map(p => p[0]))), round(median(near.map(p => p[1])))], n: near.length };
}

function resolveAnchor(anchor, zoneId) {
  let point = null;
  if (anchor.npc) {
    const pts = npcByName.get(anchor.npc) || [];
    point = (pts.find(p => p.zoneId === zoneId) ?? pts[0])?.latlng ?? null;
  } else if (anchor.transportStop) {
    point = surveyPoint(anchor.transportStop, zoneId, ['transportStops'])?.latlng ?? null;
  } else if (anchor.flightNode) {
    point = surveyPoint(anchor.flightNode, zoneId, ['flightNodes'])?.latlng ?? null;
  }
  // Optionally move to the centre of the Forever townsfolk gathered around that point.
  if (point && anchor.npcCentre) point = townsfolkCentre(point, zoneId, anchor.npcCentre)?.latlng ?? point;
  return point;
}

/** Towns further than this from their own Forever flight point / dock get flagged for review. */
const SURVEY_WARN_YARDS = 250;

const slug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const locations = [];
const report = [];
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
  // Zones and cities with an outline are judged against it (pin inside = bullseye).
  const area = (r.kind === 'zone' || r.kind === 'city') && zone.rings.length ? String(pos.zoneId) : undefined;

  const atlasSource = pos.sourceId ?? (r.sourceIds || []).join('+');
  const atlasPos = toLatLng(pos);
  let latlng = atlasPos, chosen = `atlas (${atlasSource})`, note = '';
  const candidates = [`atlas (${atlasSource})`];

  const centre = !area && ['town', 'city', 'landmark'].includes(r.kind) ? serviceCentre(r.id) : null;
  if (centre) {
    const d = yardsBetween(centre.latlng, atlasPos);
    candidates.push(`Forever town centre (${centre.n} NPCs, ${Math.round(d)} yd away)`);
    if (d <= SNAP_MAX_YARDS) { latlng = centre.latlng; chosen = 'Forever town centre'; }
    else note = `town centre ${Math.round(d)} yd away – not trusted, kept atlas`;
  }
  const fix = overrides[id];
  if (fix?.keep) {
    note = fix.why; // reviewed by hand: keep the position chosen above
  } else if (fix) {
    const anchored = resolveAnchor(fix.anchor, pos.zoneId);
    if (!anchored) throw new Error(`Override for ${id} could not be resolved`);
    candidates.push(`override → ${JSON.stringify(fix.anchor)} (${Math.round(yardsBetween(anchored, atlasPos))} yd from atlas)`);
    latlng = anchored; chosen = 'override (Forever anchor)'; note = fix.why;
  }

  // Cross-check settlements against the Forever routing survey (flight point or dock).
  if (!area && ['town', 'city', 'landmark'].includes(r.kind)) {
    const survey = surveyPoint(name, pos.zoneId);
    if (survey) {
      const d = Math.round(yardsBetween(survey.latlng, latlng));
      candidates.push(`Forever survey ${survey.kind} (${d} yd from the position used)`);
      if (d > SURVEY_WARN_YARDS && !fix?.keep) {
        note = `⚠ ${d} yd from its Forever ${survey.kind} – needs review. ${note}`.trim();
        console.warn(`[build-data] ⚠ ${name}: ${d} yd from its Forever ${survey.kind}`);
      }
    }
  }

  report.push({ name, kind: r.kind, zone: zone.name, chosen, moved: Math.round(yardsBetween(latlng, atlasPos)), candidates, note, area: !!area });
  locations.push({
    id,
    name,
    kind: r.kind,
    faction: ['alliance', 'horde'].includes(r.faction) ? r.faction : 'neutral',
    zoneId: pos.zoneId,
    zone: zone.name,
    continent: zone.continent,
    latlng,
    ...(area ? { area } : {}),
    ...(r.new ? { isNew: true } : {}),
    ...(r.kind === 'town' && POPULAR_TOWNS.has(name) ? { popular: true } : {}),
  });
}

// ------------------------------------------------- characters & quest targets --
// Famous NPCs and named mobs (scripts/notable-npcs.json), positioned from the WoW:
// Forever database. Skipped: anything that roams (spawns spread out), has no outdoor
// position (inside an instance), lies in a zone whose live map frame doesn't match the
// map we draw, or doesn't land inside its own zone.
const notable = await readJson('scripts/notable-npcs.json');
/** Zones where live-Forever coordinates don't line up with our map (see docs/locations.md). */
const FRAME_MISMATCH = new Set([1423]); // Eastern Plaguelands: the live zone map is re-scaled
const MAX_SPREAD_YARDS = 250;
const npcRecords = new Map();
for (const r of atlas.records) if (r.kind === 'npc' && r.en && !npcRecords.has(r.en)) npcRecords.set(r.en, r);

const inZone = (p, zone) => zone.rings.some(ring => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, bi] = ring[i], [aj, bj] = ring[j];
    if ((ai > p[0]) !== (aj > p[0]) && p[1] < ((bj - bi) * (p[0] - ai)) / (aj - ai) + bi) inside = !inside;
  }
  return inside;
});

for (const entry of notable.entries) {
  const r = npcRecords.get(entry.npc);
  const name = entry.name ?? entry.npc;
  const skip = why => { console.warn(`[build-data] skipped ${name}: ${why}`); report.push({ name, kind: entry.kind, zone: '–', chosen: 'skipped', moved: 0, candidates: [], note: why, area: false }); };
  if (!r) { skip('not in the Forever database'); continue; }
  const pts = (r.positions || []).filter(p => isForeverDb(r, p) && zones[p.zoneId]).map(p => ({ zoneId: p.zoneId, latlng: toLatLng(p) }));
  if (!pts.length) { skip('no outdoor Forever position'); continue; }
  const zoneId = pts[0].zoneId;
  if (pts.some(p => p.zoneId !== zoneId)) { skip('appears in several zones'); continue; }
  if (FRAME_MISMATCH.has(zoneId)) { skip('zone map frame mismatch (Eastern Plaguelands)'); continue; }
  const latlng = [round(median(pts.map(p => p.latlng[0]))), round(median(pts.map(p => p.latlng[1])))];
  const spread = Math.max(...pts.map(p => yardsBetween(p.latlng, latlng)));
  if (spread > MAX_SPREAD_YARDS) { skip(`roams (spawns spread over ${Math.round(spread)} yd)`); continue; }
  const zone = zones[zoneId];
  if (zone.rings.length && !inZone(latlng, zone)) { skip('position falls outside its zone'); continue; }
  const id = `${entry.kind}-${slug(name)}`;
  report.push({ name, kind: entry.kind, zone: zone.name, chosen: `Forever database (${pts.length} position${pts.length > 1 ? 's' : ''})`, moved: 0, candidates: [`Forever database: ${entry.npc}`], note: '', area: false });
  locations.push({
    id,
    name,
    kind: entry.kind,
    faction: ['alliance', 'horde'].includes(r.faction) ? r.faction : 'neutral',
    zoneId,
    zone: zone.name,
    continent: zone.continent,
    latlng,
  });
}
locations.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
report.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

const md = [
  '# Location sources',
  '',
  'Generated by `npm run build-data`. Each place lists the candidate positions considered and the one used.',
  'Zones and capitals with an outline are scored against the outline, so their point is only used for display.',
  '',
  '| Place | Kind | Zone | Used | Moved | Candidates | Note |',
  '| --- | --- | --- | --- | ---: | --- | --- |',
  ...report.map(x => `| ${x.name} | ${x.kind} | ${x.zone} | ${x.area ? 'zone outline' : x.chosen} | ${x.moved ? `${x.moved} yd` : '–'} | ${x.candidates.join('<br>')} | ${x.note} |`),
  '',
].join('\n');
await mkdir('docs', { recursive: true });
await writeFile('docs/locations.md', md);

await writeFile('src/data/zones.json', JSON.stringify(zones));
await writeFile('server/data/places.json', JSON.stringify(locations, null, 1));

const byKind = locations.reduce((m, l) => ({ ...m, [l.kind]: (m[l.kind] || 0) + 1 }), {});
console.log(`zones: ${Object.keys(zones).length}, locations: ${locations.length}`, byKind);
