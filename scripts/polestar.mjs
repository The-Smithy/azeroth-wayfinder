// Polestar's forever-db (https://github.com/fitzforge/polestar/tree/main/forever-db): an open
// database of WoW: Forever NPCs and spawn points, built from the game client and independent
// open sources (CMaNGOS, VMaNGOS, ForeverTDB, QuestieDB, pfQuest, EG Link).
// Database tables GPL-3.0, curated layer CC BY 4.0; see forever-db/NOTICE.md.
//
// Spawns are in world yards on the client map (x north, y west), so they carry no zone-map
// frame at all. That makes them the one source we can place without frame guesswork.
//
// Pinned to a commit so builds are reproducible. Bump POLESTAR_COMMIT to take a newer release.
import { readFile } from 'node:fs/promises';
import { download } from './shared.mjs';

export const POLESTAR_REPO = 'https://github.com/fitzforge/polestar';
export const POLESTAR_COMMIT = 'cafeb253903d49c5d0e65fdc90bd4425d29d35c9'; // forever-db 2026.11.1
const RAW = `https://raw.githubusercontent.com/fitzforge/polestar/${POLESTAR_COMMIT}`;

/** Subnames of townsfolk: innkeepers, flight masters, vendors, trainers, bankers … */
const TOWNSFOLK = /innkeeper|stable master|banker|trainer|goods|supplies|merchant|vendor|smith|bowyer|butcher|bartender|food|drink|cook|fisherman|herbalist|tailor|leatherworker|alchemist|enchanter|engineer|gunsmith|armorer|tradesman|gryphon master|wind rider master|hippogryph master|bat handler|flight master/i;

const lines = async path => (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));

export async function loadPolestar({ fresh = false } = {}) {
  const get = (file) => download(`${RAW}/${file}`, `.cache/polestar/${POLESTAR_COMMIT.slice(0, 12)}/${file}`, { force: fresh });
  const [npcRows, spawnRows, uiMaps, entrances] = await Promise.all([
    get('forever-db/data/npc.jsonl').then(lines),
    get('forever-db/data/spawn.jsonl').then(lines),
    get('forever-db/data/ui_map.jsonl').then(lines),
    get('data/codex/entrances.json').then(p => readFile(p, 'utf8')).then(JSON.parse),
  ]);

  const npcs = new Map(npcRows.map(n => [n.id, n]));
  const idsByName = new Map();
  for (const n of npcRows) {
    if (!idsByName.has(n.name)) idsByName.set(n.name, []);
    idsByName.get(n.name).push(n.id);
  }
  const spawns = new Map();
  for (const s of spawnRows) {
    if (s.kind !== 'npc') continue;
    if (!spawns.has(s.id)) spawns.set(s.id, []);
    spawns.get(s.id).push({ map: s.map, x: s.x, y: s.y });
  }

  return {
    /** Live (Forever) zone-map frames in world yards, by uiMapID. */
    uiMaps: new Map(uiMaps.map(u => [u.ui_map, u])),
    /** Curated dungeon/raid entrances (live-frame map percent), by key. */
    entrances: new Map(entrances.entrances.map(e => [e.key, e])),
    npc: id => npcs.get(id) ?? null,
    /**
     * Spawn points (world yards) of an NPC by English name. Several NPCs can share a name
     * (Forever added copies for new content): pass `id` to pick one, otherwise the lowest id
     * that has spawns is used – the original.
     */
    spawnsOf(name, id) {
      const ids = id ? [id] : (idsByName.get(name) || []).slice().sort((a, b) => a - b);
      for (const i of ids) {
        const pts = spawns.get(i);
        if (pts?.length) return { id: i, points: pts };
      }
      return null;
    },
    /** Every townsfolk spawn, for town-centre cross-checks. */
    townsfolk() {
      const out = [];
      for (const [id, pts] of spawns) {
        const n = npcs.get(id);
        if (n?.subname && TOWNSFOLK.test(n.subname)) out.push(...pts);
      }
      return out;
    },
  };
}
