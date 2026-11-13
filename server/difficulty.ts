// Difficulty from real results. Each week the median hint-free accuracy of every place is
// recomputed from ranked guesses, and places that play clearly easier or harder than their
// round move to a neighbouring round – within limits:
//
//   towns                         ×1 (hub)  ⇄  ×2 (outpost)
//   characters and quest targets  ×2        ⇄  ×3 (legend)
//   zones, capitals, dungeons and raids stay where their kind puts them.
//
// The thresholds leave a wide gap (hysteresis), so a place doesn't flip back and forth, and no
// round's pool is allowed to shrink below three weeks of puzzles. Only days that have not been
// generated yet are affected: frozen puzzles never change.
import type { LocationKind, Place } from '../src/types';
import { baseTier, DAY_PLAN, REPEAT_WINDOW_DAYS, type TierName, type TierOverrides, tierOf } from './daily';
import { type Queryable, tx } from './db';

/** A place needs this many ranked, hint-free guesses before its result counts. */
export const MIN_PLAYS = 25;
/** No round's pool may shrink below this many days of puzzles. */
export const MIN_POOL_DAYS = 21;

interface Rule { from: TierName; to: TierName; kinds: LocationKind[]; when: (median: number) => boolean; /** How far past the bar. */ by: (median: number) => number; }

export const RULES: Rule[] = [
  // A "popular" town few players can find belongs in the ×2 round …
  { from: 'hub', to: 'outpost', kinds: ['town'], when: m => m < 45, by: m => 45 - m },
  // … and a lesser-known town nearly everyone finds belongs in ×1.
  { from: 'outpost', to: 'hub', kinds: ['town'], when: m => m >= 80, by: m => m - 80 },
  // A character or quest target nearly everyone finds is worth ×2, not ×3 …
  { from: 'legend', to: 'outpost', kinds: ['npc', 'mob'], when: m => m >= 85, by: m => m - 85 },
  // … and one that turns out hard after all goes back to ×3.
  { from: 'outpost', to: 'legend', kinds: ['npc', 'mob'], when: m => m < 65, by: m => 65 - m },
];

export interface PlaceStat { place_id: string; plays: number; median_score: number; }
export interface Move { id: string; name: string; from: TierName; to: TierName; median: number; plays: number; }
export interface RetuneResult {
  overrides: Map<string, TierName>;
  rows: { place_id: string; plays: number; median_score: number; default_tier: TierName; tier: TierName }[];
  moves: Move[];
  /** Moves the pool floor held back. */
  held: Move[];
}

const perDay = (tier: TierName) => DAY_PLAN.filter(t => t === tier).length;

/** Work out every place's tier from this week's results and last week's tiers. Pure. */
export function retune(places: Place[], stats: PlaceStat[], current: TierOverrides): RetuneResult {
  const live = places.filter(p => !p.retired);
  const byId = new Map(live.map(p => [p.id, p]));
  const tier = new Map(live.map(p => [p.id, tierOf(p, current)]));
  const size = (t: TierName) => [...tier.values()].filter(x => x === t).length;

  // Candidate moves, strongest evidence first.
  const candidates = stats
    .filter(s => s.plays >= MIN_PLAYS && byId.has(s.place_id))
    .flatMap(s => {
      const p = byId.get(s.place_id)!;
      const rule = RULES.find(r => r.from === tier.get(p.id) && r.kinds.includes(p.kind) && r.when(s.median_score));
      return rule ? [{ rule, move: { id: p.id, name: p.name, from: rule.from, to: rule.to, median: s.median_score, plays: s.plays } }] : [];
    })
    .sort((a, b) => b.rule.by(b.move.median) - a.rule.by(a.move.median) || a.move.id.localeCompare(b.move.id));

  const moves: Move[] = [], held: Move[] = [];
  for (const { move } of candidates) {
    if (size(move.from) - 1 < perDay(move.from) * MIN_POOL_DAYS) { held.push(move); continue; }
    tier.set(move.id, move.to);
    moves.push(move);
  }

  const overrides = new Map<string, TierName>();
  for (const p of live) if (tier.get(p.id) !== baseTier(p)) overrides.set(p.id, tier.get(p.id)!);
  const rows = stats.filter(s => byId.has(s.place_id)).map(s => {
    const p = byId.get(s.place_id)!;
    return { place_id: p.id, plays: s.plays, median_score: s.median_score, default_tier: baseTier(p), tier: tier.get(p.id)! };
  });
  // A place moved earlier keeps its tier even if it has no stats row this time.
  for (const [id, t] of overrides) {
    if (!rows.some(r => r.place_id === id)) rows.push({ place_id: id, plays: 0, median_score: 0, default_tier: baseTier(byId.get(id)!), tier: t });
  }
  return { overrides, rows, moves, held };
}

// --------------------------------------------------------------- database --
/** The tiers in force: places whose results moved them away from their default round. */
export async function loadOverrides(q: Queryable): Promise<Map<string, TierName>> {
  const { rows } = await q.query<{ place_id: string; tier: TierName }>(
    `SELECT place_id, tier FROM place_difficulty WHERE tier <> default_tier`,
  );
  return new Map(rows.map(r => [r.place_id, r.tier]));
}

/** Place ids dealt in the REPEAT_WINDOW_DAYS days before `day`. */
export async function recentPlaces(q: Queryable, day: number): Promise<Set<string>> {
  const { rows } = await q.query<{ place_ids: string[] }>(
    `SELECT place_ids FROM puzzles WHERE day >= $1 AND day < $2`, [day - REPEAT_WINDOW_DAYS, day],
  );
  return new Set(rows.flatMap(r => r.place_ids));
}

/** Median hint-free accuracy per place, from every ranked guess by players in good standing. */
export async function placeStats(q: Queryable): Promise<PlaceStat[]> {
  const { rows } = await q.query<PlaceStat>(
    `SELECT pz.place_ids[r.idx + 1] AS place_id,
            COUNT(*)::int AS plays,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY r.score))::real AS median_score
       FROM rounds r
       JOIN puzzles pz ON pz.day = r.day
       JOIN players p ON p.id = r.player_id
      WHERE r.score IS NOT NULL AND r.hint_at IS NULL AND NOT p.banned
      GROUP BY 1`,
  );
  return rows.map(r => ({ place_id: r.place_id, plays: Number(r.plays), median_score: Number(r.median_score) }));
}

/** The weekly job: recompute stats and tiers, and store them for future puzzles. */
export async function retuneDifficulty(places: Place[]): Promise<RetuneResult> {
  return tx(async q => {
    const result = retune(places, await placeStats(q), await loadOverrides(q));
    await q.query(`DELETE FROM place_difficulty`);
    const r = result.rows;
    if (r.length) {
      await q.query(
        `INSERT INTO place_difficulty (place_id, plays, median_score, default_tier, tier)
         SELECT * FROM unnest($1::text[], $2::int[], $3::real[], $4::text[], $5::text[])`,
        [r.map(x => x.place_id), r.map(x => x.plays), r.map(x => x.median_score), r.map(x => x.default_tier), r.map(x => x.tier)],
      );
    }
    return result;
  });
}
