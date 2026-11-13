#!/usr/bin/env node
// Distils the wowforever.gg Azeroth Atlas (≈76 MB), cross-checked against Polestar's
// forever-db (scripts/polestar.mjs), into the small, committed location + zone datasets the
// game ships with:
//   server/data/places.json  – every guessable place with its answer (server-only)
//   src/data/zones.json      – zone outlines (simplified) for hover labels & area targets
//
// Usage: npm run build-data            (uses .cache/ if present)
//        npm run build-data -- --fresh (re-download the atlas)
import { mkdir, writeFile } from 'node:fs/promises';
import { ATLAS_URL, CATALOG_URL, ROUTING_URL, download, readJson } from './shared.mjs';
import { POLESTAR_COMMIT, loadPolestar } from './polestar.mjs';

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

// ------------------------------------------------------------- frames ----
// Polestar's forever-db gives NPC spawns in world yards. Each continent's zone maps sit in
// one linear world → map transform (1 map unit = 133⅓ yd), which we derive from our zone
// bounds and Polestar's live zone frames – and check, so a change on either side fails loudly.
//
// Map percentages, though, depend on the zone-map frame they were measured in. WoW: Forever
// re-framed four zone maps (scripts/zone-frames.json): Classic sources use the Era frame,
// Forever sources the live one. And the imagery we draw is in the live frame everywhere except
// Eastern Plaguelands, where it is laid out in the Era frame. Every position is therefore
// converted from its source's frame into the imagery frame before it is used.
const polestar = await loadPolestar({ fresh });
const zoneFrames = await readJson('scripts/zone-frames.json');
const K = 0.0075; // map units per world yard
const continents = new Map(); // continent → { map, lat0, lng0 }: lat = x·K + lat0, lng = −y·K + lng0
for (const [id, z] of Object.entries(zones)) {
  const u = polestar.uiMaps.get(Number(id));
  if (!u) throw new Error(`Polestar has no live frame for ${z.name} (${id})`);
  const [[s, w], [n, e]] = z.bounds;
  if (!continents.has(z.continent)) continents.set(z.continent, { map: u.map, lat0: n - u.top * K, lng0: w + u.left * K });
  const c = continents.get(z.continent);
  const err = Math.max(Math.abs(c.lat0 + u.top * K - n), Math.abs(c.lat0 + u.bottom * K - s),
    Math.abs(c.lng0 - u.left * K - w), Math.abs(c.lng0 - u.right * K - e));
  if (c.map !== u.map || err > 0.01) throw new Error(`${z.name}: our zone bounds no longer match Polestar's live frame (${Math.round(err / K)} yd off)`);
}
const liveFrames = new Map(Object.keys(zones).map(id => {
  const { continent, bounds: [[s, w], [n, e]] } = zones[id];
  const c = continents.get(continent);
  return [Number(id), { top: (n - c.lat0) / K, bottom: (s - c.lat0) / K, left: (c.lng0 - w) / K, right: (c.lng0 - e) / K }];
}));
const liveFrame = zoneId => liveFrames.get(Number(zoneId));
const eraFrame = zoneId => zoneFrames.era[zoneId] ?? liveFrame(zoneId);
const IMAGERY_ERA = new Set(zoneFrames.imageryEra.zones);
const imageryFrame = zoneId => IMAGERY_ERA.has(Number(zoneId)) ? eraFrame(zoneId) : liveFrame(zoneId);
const pctToWorld = (f, [px, py]) => ({ x: f.top - (py / 100) * (f.top - f.bottom), y: f.left - (px / 100) * (f.left - f.right) });
const worldToPct = (f, { x, y }) => [((f.left - y) / (f.left - f.right)) * 100, ((f.top - x) / (f.top - f.bottom)) * 100];
/** Map percent in the imagery frame → map lat/lng. */
function imageryLatLng(zoneId, [cx, cy]) {
  const [[s, w], [n, e]] = zones[zoneId].bounds;
  return [round(n - (cy / 100) * (n - s)), round(w + (cx / 100) * (e - w))];
}
/** Which frame an Atlas position was measured in, from its source ('imagery': the Atlas' own map labels). */
const frameOf = source => /^local-maps/.test(source) ? 'imagery'
  : /questiedb|mapwise|confirmed-forever/.test(source) ? 'live' : /travel|classic/.test(source) ? 'era' : 'live';

const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, bi] = ring[i], [aj, bj] = ring[j];
    if ((ai > p[0]) !== (aj > p[0]) && p[1] < ((bj - bi) * (p[0] - ai)) / (aj - ai) + bi) inside = !inside;
  }
  return inside;
};
const inZone = (p, zone) => zone.rings.some(ring => inRing(p, ring));
/** Distance (map units) from a point to a ring's edges. */
function ringDistance(p, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ay, ax] = ring[j], [by, bx] = ring[i];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[1] - ax) * dx + (p[0] - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p[1] - (ax + t * dx), p[0] - (ay + t * dy)));
  }
  return best;
}
/** How far outside every zone outline a spawn may sit and still count for the nearest zone. */
const OUTLINE_SLACK_YARDS = 200;
const ringsArea = zone => zone.rings.reduce((a, r) => a + ringArea(r), 0);
const inBounds = (p, { bounds: [[s, w], [n, e]] }) => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;

/**
 * A world-yard point (Polestar spawn) → { zoneId, latlng } on our map, or null when it is
 * inside an instance or outside every zone outline. A point in a zone drawn in the Era frame
 * is placed through that frame; the most specific zone (a city inside its zone) wins, unless
 * `hint` (the zone a game database files it under) also holds the point – city outlines
 * don't cover everything underground, such as Undercity's Royal Quarter.
 */
function worldToLatLng({ map, x, y }, hint) {
  const c = [...continents.entries()].find(([, v]) => v.map === map);
  if (!c) return null;
  const [continent, { lat0, lng0 }] = c;
  const live = [x * K + lat0, -y * K + lng0];
  let best = null, nearest = null;
  for (const [id, zone] of Object.entries(zones)) {
    if (zone.continent !== continent) continue;
    const zoneId = Number(id);
    const latlng = IMAGERY_ERA.has(zoneId) ? imageryLatLng(id, worldToPct(eraFrame(id), { x, y })) : live.map(v => round(v));
    if (!inBounds(latlng, zone)) continue;
    if (zoneId === hint) return { zoneId, latlng };
    if (!zone.rings.length) continue;
    if (inZone(latlng, zone)) {
      if (!best || ringsArea(zone) < ringsArea(zones[best.zoneId])) best = { zoneId, latlng };
    } else {
      const d = Math.min(...zone.rings.map(r => ringDistance(latlng, r))) * YARDS;
      if (d <= OUTLINE_SLACK_YARDS && (!nearest || d < nearest.d)) nearest = { zoneId, latlng, d };
    }
  }
  // The simplified outlines can clip a zone's edge (Darrowshire falls just outside the
  // Eastern Plaguelands outline), so a point just outside every outline joins the nearest.
  return best ?? (nearest && { zoneId: nearest.zoneId, latlng: nearest.latlng });
}

// ------------------------------------------------------------ locations ----
// Every place collects candidate positions from several independent sources, and the
// best one is chosen by explicit rules. docs/locations.md records the decision.
//
//   atlas      the Atlas place record: Classic instance entrances / Classic flight
//              points ("travel"), or Forever-confirmed entrances and observations
//   centre     WoW: Forever game database (QuestieDB Forever): median position of the
//              town's service NPCs (innkeeper, vendors, trainers, flight master …)
//   polestar   Polestar's forever-db: world-yard spawns of the town's townsfolk (used when
//              there is no QuestieDB centre; a cross-check otherwise) and its curated
//              Forever instance entrances (a cross-check)
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

/** Zone-map percent measured in `frame` ('live', 'era' or 'imagery') → map lat/lng in the imagery frame. */
function toLatLng(pos, frame = 'live') {
  if (!zones[pos.zoneId] || !Array.isArray(pos.coords)) return null;
  const src = frame === 'era' ? eraFrame(pos.zoneId) : frame === 'imagery' ? imageryFrame(pos.zoneId) : liveFrame(pos.zoneId);
  const img = imageryFrame(pos.zoneId);
  return imageryLatLng(pos.zoneId, src === img ? pos.coords : worldToPct(img, pctToWorld(src, pos.coords)));
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

/** Polestar's townsfolk (innkeepers, flight masters, vendors, trainers …), placed on our map. */
const polestarTownsfolk = polestar.townsfolk().map(worldToLatLng).filter(Boolean);
/** Median of Polestar's townsfolk within `radius` yards of a point in the same zone. */
function polestarCentre(point, zoneId, radius = 300) {
  const near = polestarTownsfolk.filter(p => p.zoneId === zoneId && yardsBetween(p.latlng, point) <= radius).map(p => p.latlng);
  if (near.length < 3) return null;
  return { latlng: [round(median(near.map(p => p[0]))), round(median(near.map(p => p[1])))], n: near.length };
}
/**
 * Polestar's entrances are curated for Forever (QuestieDB's Forever dungeon table, checked
 * against the client's corpse points). They mark the way in (a gate, a path), where the Atlas
 * marks the building or mountain, so they differ by up to ~200 yd; beyond this is flagged.
 */
const ENTRANCE_WARN_YARDS = 250;
/** A town without a QuestieDB centre snaps to Polestar's townsfolk centre when this many agree. */
const POLESTAR_SNAP_MIN_NPCS = 5;
/** Settlements further than this from Polestar's townsfolk centre get flagged for review. */
const POLESTAR_WARN_YARDS = 250;

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
  const atlasPos = toLatLng(pos, frameOf(atlasSource));
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

  // Cross-check settlements against Polestar's townsfolk, and instance entrances against
  // Polestar's curated (Forever-checked) entrance list.
  if (!area && ['town', 'city', 'landmark'].includes(r.kind)) {
    const ps = polestarCentre(latlng, pos.zoneId);
    if (ps && !fix && chosen.startsWith('atlas') && r.kind === 'town' && ps.n >= POLESTAR_SNAP_MIN_NPCS) {
      // No usable QuestieDB centre: the Atlas point is a Classic flight point, which can sit
      // well outside town (Lakeshire's is across the lake). Use Polestar's townsfolk instead.
      const d = Math.round(yardsBetween(ps.latlng, latlng));
      candidates.push(`Polestar townsfolk centre (${ps.n} NPCs, ${d} yd from the Atlas point)`);
      latlng = ps.latlng; chosen = 'Polestar townsfolk centre';
    } else if (ps) {
      const d = Math.round(yardsBetween(ps.latlng, latlng));
      candidates.push(`Polestar townsfolk centre (${ps.n} NPCs, ${d} yd from the position used)`);
      if (d > POLESTAR_WARN_YARDS && !fix) {
        note = `⚠ ${d} yd from Polestar's townsfolk – needs review. ${note}`.trim();
        console.warn(`[build-data] ⚠ ${name}: ${d} yd from Polestar's townsfolk centre`);
      }
    }
  }
  if (r.kind === 'dungeon' || r.kind === 'raid') {
    const ent = polestar.entrances.get(id);
    if (ent) {
      // Every way in Polestar lists: the main point, the Alliance's own (A) and any other
      // side named in the note ("the Burning Steppes way in is at 1428 29.4,38.3").
      const ways = [ent, ent.A, ...[...(ent.note || '').matchAll(/\b(1\d{3}|2\d{3}) (\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/g)].map(m => ({ map: +m[1], x: +m[2], y: +m[3] }))]
        .filter(w => w && zones[w.map]);
      const d = Math.min(...ways.map(w => Math.round(yardsBetween(toLatLng({ zoneId: w.map, coords: [w.x, w.y] }, 'live'), latlng))));
      if (Number.isFinite(d)) {
        candidates.push(`Polestar entrance (${d} yd from the position used)`);
        if (d > ENTRANCE_WARN_YARDS && !fix) {
          note = `⚠ ${d} yd from Polestar's entrance – needs review. ${note}`.trim();
          console.warn(`[build-data] ⚠ ${name}: ${d} yd from Polestar's entrance`);
        }
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
// Famous NPCs and named mobs (scripts/notable-npcs.json), positioned from Polestar's
// forever-db spawn points (world yards, so no zone-frame guesswork), and cross-checked
// against the Atlas' copy of the QuestieDB Forever positions. Patrolling NPCs are pinned
// mid-route. Skipped: anything that roams (spawns spread out, or a long patrol), has no
// outdoor position (inside an instance) or falls outside every zone outline.
const notable = await readJson('scripts/notable-npcs.json');
const MAX_SPREAD_YARDS = 250;
/** A patrolling NPC whose route strays further than this from its middle is too vague to guess. */
const PATROL_MAX_YARDS = 400;
/** Polestar and the Atlas copy of QuestieDB should agree; further apart than this is flagged. */
const NPC_WARN_YARDS = 60;
const npcRecords = new Map();
for (const r of atlas.records) if (r.kind === 'npc' && r.en && !npcRecords.has(r.en)) npcRecords.set(r.en, r);
const medianPoint = pts => [round(median(pts.map(p => p[0]))), round(median(pts.map(p => p[1])))];

for (const entry of notable.entries) {
  const name = entry.name ?? entry.npc;
  const skip = why => { console.warn(`[build-data] skipped ${name}: ${why}`); report.push({ name, kind: entry.kind, zone: '–', chosen: 'skipped', moved: 0, candidates: [], note: why, area: false }); };
  if (entry.skip) { skip(entry.skip); continue; }
  const ps = polestar.spawnsOf(entry.npc, entry.id);
  if (!ps) { skip('no spawn point in the Polestar database'); continue; }
  const r = npcRecords.get(entry.npc);
  const hint = (r?.positions || []).find(p => isForeverDb(r, p) && zones[p.zoneId])?.zoneId;
  const pts = ps.points.map(p => worldToLatLng(p, hint)).filter(Boolean);
  if (!pts.length) { skip('no outdoor position (inside an instance or off the map)'); continue; }
  const zoneId = pts[0].zoneId;
  if (pts.some(p => p.zoneId !== zoneId)) { skip('appears in several zones'); continue; }
  const spawnAt = medianPoint(pts.map(p => p.latlng));
  const spread = Math.max(...pts.map(p => yardsBetween(p.latlng, spawnAt)));
  if (spread > MAX_SPREAD_YARDS) { skip(`roams (spawns spread over ${Math.round(spread)} yd)`); continue; }
  const zone = zones[zoneId];

  const candidates = [`Polestar forever-db: npc ${ps.id} (${pts.length} spawn${pts.length > 1 ? 's' : ''})`];
  let note = '';
  // A patrolling NPC is pinned at the middle of its walk, not where it happens to spawn, so
  // a pin anywhere on its route scores fairly. Walks that stray too far are left out.
  let latlng = spawnAt;
  const route = (r?.patrolRoutes || []).flatMap(rt => rt.points)
    .filter(pt => pt.zoneId === zoneId && Array.isArray(pt.coords)).map(pt => toLatLng(pt, 'live'));
  if (route.length) {
    const walk = [spawnAt, ...route];
    const box = [(Math.min(...walk.map(p => p[0])) + Math.max(...walk.map(p => p[0]))) / 2, (Math.min(...walk.map(p => p[1])) + Math.max(...walk.map(p => p[1]))) / 2];
    const mid = walk.reduce((a, b) => (yardsBetween(b, box) < yardsBetween(a, box) ? b : a));
    const reach = Math.max(...walk.map(p => yardsBetween(p, mid)));
    if (reach > PATROL_MAX_YARDS) { skip(`patrols too far (${Math.round(reach)} yd from the middle of its route)`); continue; }
    latlng = mid;
    candidates.push(`Atlas patrol route (${route.length} points; pinned mid-route, ${Math.round(yardsBetween(mid, spawnAt))} yd from the spawn, walks up to ${Math.round(reach)} yd away)`);
  }
  const atlasPts = (r?.positions || []).filter(p => isForeverDb(r, p) && p.zoneId === zoneId).map(p => toLatLng(p)).filter(Boolean);
  if (atlasPts.length) {
    const d = Math.round(yardsBetween(medianPoint(atlasPts), spawnAt));
    candidates.push(`Atlas / QuestieDB Forever (${d} yd away)`);
    if (d > NPC_WARN_YARDS) {
      note = `⚠ Polestar and QuestieDB disagree by ${d} yd – needs review`;
      console.warn(`[build-data] ⚠ ${name}: Polestar and QuestieDB disagree by ${d} yd`);
    }
  } else candidates.push('not in the Atlas copy of QuestieDB');

  const faction = entry.faction ?? (['alliance', 'horde'].includes(r?.faction) ? r.faction : 'neutral');
  report.push({ name, kind: entry.kind, zone: zone.name, chosen: 'Polestar forever-db', moved: 0, candidates, note, area: false });
  locations.push({
    id: `${entry.kind}-${slug(name)}`,
    name,
    kind: entry.kind,
    faction,
    zoneId,
    zone: zone.name,
    continent: zone.continent,
    latlng,
  });
}
// A place that drops out of the data is retired, not deleted: puzzles already frozen in the
// database may name it, so it must stay resolvable, but it is never dealt again.
const previous = await readJson('server/data/places.json').catch(() => []);
const current = new Set(locations.map(l => l.id));
for (const old of previous) {
  if (current.has(old.id)) continue;
  locations.push({ ...old, retired: true });
  report.push({ name: old.name, kind: old.kind, zone: old.zone, chosen: 'retired', moved: 0, candidates: [], note: 'No longer produced by the sources above; kept for puzzles already played, never dealt again.', area: !!old.area });
}
locations.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
report.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

const md = [
  '# Location sources',
  '',
  'Generated by `npm run build-data`. Each place lists the candidate positions considered and the one used.',
  `Sources: the wowforever.gg Azeroth Atlas (and its copy of the QuestieDB Forever database and its routing survey), and Polestar's forever-db at [${POLESTAR_COMMIT.slice(0, 7)}](https://github.com/fitzforge/polestar/tree/${POLESTAR_COMMIT}/forever-db).`,
  'Positions from Classic sources are converted from the Era to the live zone-map frame (or the other way round in Eastern Plaguelands, whose imagery is drawn in the Era frame) – see `scripts/zone-frames.json`.',
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
