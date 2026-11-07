import seedrandom from 'seedrandom';
import type { Place } from '../src/types';

/** Day #1 is WoW: Forever's launch day. Days roll over at 00:00 UTC for everyone. */
export const EPOCH_UTC = Date.UTC(2026, 10, 4);
const DAY_MS = 86_400_000;

/**
 * Each day pulls from three "bags" so every puzzle has a mix of difficulty.
 * Within a bag, places are dealt from a seeded shuffle and never repeat until
 * the whole bag has been played (a new shuffle starts every cycle).
 */
export const TIERS = {
  realm: { kinds: ['city', 'zone'] },
  settlement: { kinds: ['town', 'landmark'] },
  delve: { kinds: ['dungeon', 'raid'] },
} as const;
export type TierName = keyof typeof TIERS;

/** Round order for a day: an easy opener, a dungeon in the middle, settlements around it. */
export const DAY_PLAN: TierName[] = ['realm', 'settlement', 'delve', 'settlement', 'settlement'];

/** Puzzle number for a moment in time (1-based, UTC days). */
export const dayNumber = (now = new Date()) => Math.floor((now.getTime() - EPOCH_UTC) / DAY_MS) + 1;

/** When the given puzzle day ends (next UTC midnight). */
export const dayEndsAt = (day: number) => new Date(EPOCH_UTC + day * DAY_MS);

function shuffled<T>(items: T[], seed: string): T[] {
  const rng = seedrandom(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function tierPool(places: Place[], tier: TierName): Place[] {
  const kinds = TIERS[tier].kinds as readonly string[];
  return places.filter(p => kinds.includes(p.kind)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Molten Core & Blackrock Depths share an entrance – never ask for both on one day. */
const sameSpot = (a: Place, b: Place) => a.latlng[0] === b.latlng[0] && a.latlng[1] === b.latlng[1];

/**
 * The five places for a puzzle day. Deterministic for a given secret, but the
 * secret lives only on the server, so future puzzles can't be computed from the
 * public source code.
 */
export function dailyPlaces(places: Place[], day: number, secret: string): Place[] {
  const picked: Place[] = [];
  const perDay = new Map<TierName, number>();
  DAY_PLAN.forEach(t => perDay.set(t, (perDay.get(t) ?? 0) + 1));
  const taken = new Map<TierName, number>();
  const n = Math.max(0, day - 1);

  for (const tier of DAY_PLAN) {
    const pool = tierPool(places, tier);
    const k = taken.get(tier) ?? 0;
    taken.set(tier, k + 1);
    // Global deal index for this tier; walk forward past anything already used today
    // (only possible when a day straddles two shuffles).
    let i = n * perDay.get(tier)! + k;
    for (;;) {
      const cycle = Math.floor(i / pool.length);
      const place = shuffled(pool, `${secret}:${tier}:${cycle}`)[i % pool.length];
      if (!picked.some(p => p.id === place.id || sameSpot(p, place))) { picked.push(place); break; }
      i++;
    }
  }
  return picked;
}

/** Practice mode: five random, distinct places that aren't in today's puzzle. */
export function practicePlaces(places: Place[], exclude: Set<string>, rng = Math.random): Place[] {
  const blocked = places.filter(p => exclude.has(p.id));
  return DAY_PLAN.reduce<Place[]>((acc, tier) => {
    const pool = tierPool(places, tier).filter(
      p => !exclude.has(p.id) && !blocked.some(b => sameSpot(b, p)) && !acc.some(q => q.id === p.id || sameSpot(q, p)),
    );
    acc.push(pool[Math.floor(rng() * pool.length)]);
    return acc;
  }, []);
}
