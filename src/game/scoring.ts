import type { LatLngTuple, Place, Zone } from '../types';
import { distanceToZone, distanceUnits, nearestPointOnZone, YARDS_PER_UNIT } from './geo';

/** Accuracy score per round, before the round multiplier. */
export const MAX_ROUND_SCORE = 100;
/** Every pin earns something: no round scores less than this (hint included), wherever the pin lands. */
export const MIN_ROUND_SCORE = 5;
export const ROUNDS = 5;
/** Later rounds are worth more: 100 + 100 + 200 + 300 + 300 = 1,000. */
export const ROUND_MULTIPLIERS = [1, 1, 2, 3, 3] as const;
export const MAX_TOTAL = ROUND_MULTIPLIERS.reduce<number>((s, m) => s + m * MAX_ROUND_SCORE, 0);
export const multiplierFor = (round: number) => ROUND_MULTIPLIERS[Math.min(round, ROUNDS - 1)];
/** Pins this close to a point target count as a bullseye. */
export const BULLSEYE_YARDS = 75;
/** The edges of the playable map (the world image's bounds), for the furthest possible pin. */
export const MAP_BOUNDS: [LatLngTuple, LatLngTuple] = [[-203.916, -12], [20, 323.876]];
/**
 * How sharply the score bends. Accuracy is (1 − d/D)^power, where d is the distance past the
 * bullseye and D the distance to the far side of the map: still 0 at the far side, but near
 * misses cost real points (about 91 at 1,000 yards, 58 at 5,000, 31 at 10,000).
 */
export const CURVE_POWER = 4;
/**
 * The first daily puzzle scored with this curve. Earlier puzzles keep the old exponential
 * curve (e-folding at FALLOFF_YARDS), so everyone on a day's board is scored alike.
 */
export const CURVE_FROM_DAY = 18;
/** Old curve: ~37% of the points at this many yards past the bullseye. */
export const FALLOFF_YARDS = 2600;
/** Using the hint scales the round's score by this factor. */
export const HINT_FACTOR = 0.75;

export interface Measured {
  yards: number;
  /** Where the reveal line should end (target point or nearest edge of the target area). */
  anchor: LatLngTuple;
  /** The furthest anyone could be from this target on the map: where the score reaches 0. */
  zeroYards: number;
}

/**
 * How far the furthest point on the map is from a place – from its point, or from the nearest
 * edge of its zone outline for area targets. The furthest point is always a corner of the map.
 */
export function furthestYards(place: Place, zones: Record<string, Zone>): number {
  const [[s, w], [n, e]] = MAP_BOUNDS;
  const zone = place.area ? zones[place.area] : undefined;
  const from = (c: LatLngTuple) => (zone?.rings.length ? distanceToZone(c, zone) : distanceUnits(c, place.latlng));
  return Math.max(...([[s, w], [s, e], [n, w], [n, e]] as LatLngTuple[]).map(from)) * YARDS_PER_UNIT;
}

export function measure(guess: LatLngTuple, place: Place, zones: Record<string, Zone>): Measured {
  const zeroYards = furthestYards(place, zones);
  const zone = place.area ? zones[place.area] : undefined;
  if (zone?.rings.length) {
    const yards = distanceToZone(guess, zone) * YARDS_PER_UNIT;
    return { yards, anchor: yards === 0 ? guess : nearestPointOnZone(guess, zone), zeroYards };
  }
  const yards = distanceUnits(guess, place.latlng) * YARDS_PER_UNIT;
  return { yards: yards <= BULLSEYE_YARDS ? 0 : yards, anchor: place.latlng, zeroYards };
}

/**
 * Accuracy score (1–100) for a distance: 100 in the bullseye (within BULLSEYE_YARDS of a point,
 * or inside a zone's outline), bending down towards `zeroYards`, the furthest point on the map
 * from that target (see measure), but never below MIN_ROUND_SCORE. Pass the puzzle `day` for daily rounds: puzzles before
 * CURVE_FROM_DAY keep the old curve. Practice rounds leave it out.
 */
export function scoreFor(yards: number, zeroYards: number, hint = false, day?: number): number {
  const past = Math.max(0, yards - BULLSEYE_YARDS);
  const factor = hint ? HINT_FACTOR : 1;
  if (day !== undefined && day < CURVE_FROM_DAY) return Math.round(MAX_ROUND_SCORE * Math.exp(-past / FALLOFF_YARDS) * factor);
  const accuracy = Math.max(0, 1 - past / Math.max(1, zeroYards - BULLSEYE_YARDS)) ** CURVE_POWER;
  return Math.max(MIN_ROUND_SCORE, Math.round(MAX_ROUND_SCORE * accuracy * factor));
}

/** Points actually banked for a round: accuracy × the round's multiplier. */
export const pointsFor = (score: number, round: number) => score * multiplierFor(round);

/** Emoji and colour tiers follow accuracy (0–100), so every round is judged alike. */
export function emojiFor(score: number): string {
  if (score >= 95) return '🎯';
  if (score >= 75) return '🟩';
  if (score >= 50) return '🟨';
  if (score >= 25) return '🟧';
  return '🟥';
}
export const tierFor = (score: number) =>
  score >= 95 ? 'perfect' : score >= 75 ? 'great' : score >= 50 ? 'good' : score >= 25 ? 'poor' : 'miss';

export const TITLES: [number, string, string][] = [
  [950, 'Keeper of the Atlas', 'The Titans themselves would ask you for directions.'],
  [850, 'Master Cartographer', 'Your maps hang in the halls of Ironforge.'],
  [700, 'Seasoned Pathfinder', 'Flight masters nod when you pass.'],
  [500, 'Wandering Adventurer', 'You know the roads – mostly.'],
  [300, 'Lost Recruit', 'Perhaps ask a guard for directions.'],
  [0, 'Fresh from the Murloc Coast', 'Mrglglgl… the map was upside down?'],
];

export const titleFor = (total: number) => TITLES.find(([min]) => total >= min)!;

export function formatYards(yards: number): string {
  if (yards === 0) return 'Bullseye!';
  if (yards >= 10000) return `${(yards / 1000).toFixed(1)}k yards`;
  return `${Math.round(yards).toLocaleString('en-US')} yards`;
}
