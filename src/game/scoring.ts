import type { LatLngTuple, Place, Zone } from '../types';
import { distanceToZone, distanceUnits, nearestPointOnZone, YARDS_PER_UNIT } from './geo';

export const MAX_ROUND_SCORE = 1000;
export const ROUNDS = 5;
/** Pins this close to a point target count as a bullseye. */
export const BULLSEYE_YARDS = 75;
/** e-folding distance of the score curve: ~37% of the points at this many yards past the bullseye. */
export const FALLOFF_YARDS = 2600;
/** Using the hint scales the round's score by this factor. */
export const HINT_FACTOR = 0.75;

export interface Measured {
  yards: number;
  /** Where the reveal line should end (target point or nearest edge of the target area). */
  anchor: LatLngTuple;
}

export function measure(guess: LatLngTuple, place: Place, zones: Record<string, Zone>): Measured {
  const zone = place.area ? zones[place.area] : undefined;
  if (zone?.rings.length) {
    const yards = distanceToZone(guess, zone) * YARDS_PER_UNIT;
    return { yards, anchor: yards === 0 ? guess : nearestPointOnZone(guess, zone) };
  }
  const yards = distanceUnits(guess, place.latlng) * YARDS_PER_UNIT;
  return { yards: yards <= BULLSEYE_YARDS ? 0 : yards, anchor: place.latlng };
}

export function scoreFor(yards: number, hint = false): number {
  const raw = MAX_ROUND_SCORE * Math.exp(-Math.max(0, yards - BULLSEYE_YARDS) / FALLOFF_YARDS);
  const score = Math.round(raw * (hint ? HINT_FACTOR : 1));
  return score < 5 ? 0 : score;
}

export function emojiFor(score: number): string {
  if (score >= 950) return '🎯';
  if (score >= 750) return '🟩';
  if (score >= 500) return '🟨';
  if (score >= 250) return '🟧';
  return '🟥';
}

export const TITLES: [number, string, string][] = [
  [4750, 'Keeper of the Atlas', 'The Titans themselves would ask you for directions.'],
  [4250, 'Master Cartographer', 'Your maps hang in the halls of Ironforge.'],
  [3500, 'Seasoned Pathfinder', 'Flight masters nod when you pass.'],
  [2500, 'Wandering Adventurer', 'You know the roads – mostly.'],
  [1500, 'Lost Recruit', 'Perhaps ask a guard for directions.'],
  [0, 'Fresh from the Murloc Coast', 'Mrglglgl… the map was upside down?'],
];

export const titleFor = (total: number) => TITLES.find(([min]) => total >= min)!;

export function formatYards(yards: number): string {
  if (yards === 0) return 'Bullseye!';
  if (yards >= 10000) return `${(yards / 1000).toFixed(1)}k yards`;
  return `${Math.round(yards).toLocaleString('en-US')} yards`;
}
