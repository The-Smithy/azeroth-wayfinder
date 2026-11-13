import type { RoundOutcome } from '../api-types';
import type { LatLngTuple, Zone } from '../types';
import { zoneAt } from './geo';
import { formatYards } from './scoring';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass direction (8 points) from one map point to another. North is up (+lat), east is +lng. */
export function direction(from: LatLngTuple, to: LatLngTuple): string {
  const deg = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI; // 0 = north, 90 = east
  return COMPASS[Math.round((deg + 360) / 45) % 8];
}

/** "on Kalimdor", "in the Eastern Kingdoms". */
const onContinent = (c: string) => (/kingdoms/i.test(c) ? `in the ${c}` : `on ${c}`);

/** Very close pins get a "so close" line rather than a zone lesson. */
const CLOSE_YARDS = 150;

/**
 * A one-line explanation of a miss that teaches the map: where the pin actually landed and
 * which way the answer lies, e.g. "Your pin was in Duskwood; it's in Elwynn Forest, 400 yards
 * north." Returns null for a bullseye.
 */
export function nearMiss(outcome: RoundOutcome, targetName: string, zones: Record<string, Zone>): string | null {
  const { guess, yards, answer } = outcome;
  if (yards === 0) return null;
  const at = zoneAt(guess, zones)?.[1];
  const dir = direction(guess, answer.anchor);
  const far = formatYards(yards);
  const areaRound = !!answer.area;

  if (at && at.continent !== answer.continent) {
    return areaRound
      ? `Your pin was in ${at.name}, ${onContinent(at.continent)}. ${targetName} is ${onContinent(answer.continent)}.`
      : `Your pin was in ${at.name}, ${onContinent(at.continent)}. It's in ${answer.zone}, ${onContinent(answer.continent)}.`;
  }
  if (areaRound) {
    const where = at ? `Your pin was in ${at.name}` : 'Your pin was out at sea';
    return `${where}; ${targetName} begins ${far} ${dir}.`;
  }
  if (at?.name === answer.zone) {
    return yards <= CLOSE_YARDS ? `So close: just ${far} ${dir}.` : `Right zone! It's ${far} ${dir} of your pin.`;
  }
  const where = at ? `Your pin was in ${at.name}` : 'Your pin was out at sea';
  return `${where}; it's in ${answer.zone}, ${far} ${dir}.`;
}
