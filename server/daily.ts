import seedrandom from 'seedrandom';
import type { Place } from '../src/types';

/**
 * A new puzzle unlocks at midnight US Eastern time (EST, or EDT in summer) for everyone.
 * Day #1 is 4 Nov 2026, WoW: Forever's launch day. Puzzle numbers are internal only.
 */
export const TIME_ZONE = 'America/New_York';
const EPOCH_DATE = Date.UTC(2026, 10, 4);
const DAY_MS = 86_400_000;

/** The calendar date (as UTC midnight of that date) that the clock in TIME_ZONE shows at `instant`. */
function zonedDate(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(instant).map(p => [p.type, p.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

/** Milliseconds TIME_ZONE is ahead of UTC at `instant` (negative for US Eastern). */
function zoneOffset(instant: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(instant)).map(x => [x.type, x.value]),
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(instant / 1000) * 1000;
}

/** The instant the clock in TIME_ZONE reads 00:00 on the given calendar date. */
function zonedMidnight(dateUtc: number): Date {
  let t = dateUtc - zoneOffset(dateUtc);
  t = dateUtc - zoneOffset(t); // settle across DST changes
  return new Date(t);
}

/**
 * Each day pulls from three "bags" so every puzzle has a mix of difficulty.
 * Within a bag, places are dealt from a seeded shuffle and never repeat until
 * the whole bag has been played (a new shuffle starts every cycle).
 */
export const TIERS = {
  /** ×1 – zones and capital cities */
  realm: { match: (p: Place) => p.kind === 'city' || p.kind === 'zone' },
  /** ×1 – the big, well-known town hubs */
  hub: { match: (p: Place) => p.kind === 'town' && !!p.popular },
  /** ×2 – lesser-known towns, landmarks, dungeons and raids */
  outpost: { match: (p: Place) => (p.kind === 'town' && !p.popular) || ['landmark', 'dungeon', 'raid'].includes(p.kind) },
  /** ×3 – famous characters and quest targets */
  legend: { match: (p: Place) => p.kind === 'npc' || p.kind === 'mob' },
} as const;
export type TierName = keyof typeof TIERS;

/**
 * Round order for a day, matched to the round multipliers (×1, ×1, ×2, ×3, ×3): towns and
 * cities early, characters and quest targets in the high-stakes rounds.
 */
export const DAY_PLAN: TierName[] = ['realm', 'hub', 'outpost', 'legend', 'legend'];

/** Puzzle number for a moment in time (1-based, US Eastern calendar days). */
export const dayNumber = (now = new Date()) => Math.round((zonedDate(now) - EPOCH_DATE) / DAY_MS) + 1;

/** When the given puzzle day ends: the next midnight in US Eastern time. */
export const dayEndsAt = (day: number) => zonedMidnight(EPOCH_DATE + day * DAY_MS);

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
  return places.filter(TIERS[tier].match).sort((a, b) => a.id.localeCompare(b.id));
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
