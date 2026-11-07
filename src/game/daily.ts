import seedrandom from 'seedrandom';
import type { Place } from '../types';

/** Day #1 is WoW: Forever's launch day. */
export const EPOCH = { y: 2026, m: 11, d: 4 };
const SEED = 'azeroth-pinpoint:v1';

/**
 * Each day pulls from three "bags" so every puzzle has a mix of difficulty.
 * Within a bag, places are dealt from a seeded shuffle and never repeat until
 * the whole bag has been played (a new shuffle starts every cycle).
 */
export const TIERS = {
  realm: { kinds: ['city', 'zone'], label: 'Realm' },
  settlement: { kinds: ['town', 'landmark'], label: 'Settlement' },
  delve: { kinds: ['dungeon', 'raid'], label: 'Dungeon' },
} as const;
export type TierName = keyof typeof TIERS;

/** Round order for a day: an easy opener, a dungeon in the middle, settlements around it. */
export const DAY_PLAN: TierName[] = ['realm', 'settlement', 'delve', 'settlement', 'settlement'];

/** Puzzle number for a local calendar date (1-based). */
export function dayNumber(date = new Date()): number {
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const epoch = Date.UTC(EPOCH.y, EPOCH.m - 1, EPOCH.d);
  return Math.floor((today - epoch) / 86_400_000) + 1;
}

/** Milliseconds until the next local midnight (when the next puzzle unlocks). */
export function msUntilNextDay(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

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

/** The five places for a given puzzle number. Deterministic for everyone. */
export function dailyPlaces(places: Place[], day: number): Place[] {
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
      const place = shuffled(pool, `${SEED}:${tier}:${cycle}`)[i % pool.length];
      if (!picked.some(p => p.id === place.id || sameSpot(p, place))) { picked.push(place); break; }
      i++;
    }
  }
  return picked;
}

/** Practice mode: five random, distinct places. */
export function practicePlaces(places: Place[], rng = Math.random): Place[] {
  return DAY_PLAN.map(tier => tier).reduce<Place[]>((acc, tier) => {
    const pool = tierPool(places, tier).filter(p => !acc.some(q => q.id === p.id || sameSpot(q, p)));
    acc.push(pool[Math.floor(rng() * pool.length)]);
    return acc;
  }, []);
}

/** Molten Core & Blackrock Depths share an entrance – never ask for both on one day. */
const sameSpot = (a: Place, b: Place) => a.latlng[0] === b.latlng[0] && a.latlng[1] === b.latlng[1];
