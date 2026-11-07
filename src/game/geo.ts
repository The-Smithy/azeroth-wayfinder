import type { LatLngTuple, Zone } from '../types';

/** One world map unit is a quarter of a 533⅓-yard ADT tile. */
export const YARDS_PER_UNIT = 1600 / 3 / 4;

export const distanceUnits = (a: LatLngTuple, b: LatLngTuple) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const distanceYards = (a: LatLngTuple, b: LatLngTuple) => distanceUnits(a, b) * YARDS_PER_UNIT;

export function pointInRing([lat, lng]: LatLngTuple, ring: LatLngTuple[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, bi] = ring[i], [aj, bj] = ring[j];
    if ((ai > lat) !== (aj > lat) && lng < ((bj - bi) * (lat - ai)) / (aj - ai) + bi) inside = !inside;
  }
  return inside;
}

export const pointInZone = (p: LatLngTuple, zone: Zone) => zone.rings.some(r => pointInRing(p, r));

function distanceToSegment(p: LatLngTuple, a: LatLngTuple, b: LatLngTuple): number {
  const dx = b[1] - a[1], dy = b[0] - a[0];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / len2)) : 0;
  return Math.hypot(p[1] - (a[1] + t * dx), p[0] - (a[0] + t * dy));
}

/** Distance (units) from p to a zone's outline; 0 when p is inside it. */
export function distanceToZone(p: LatLngTuple, zone: Zone): number {
  if (pointInZone(p, zone)) return 0;
  let best = Infinity;
  for (const ring of zone.rings)
    for (let i = 0; i < ring.length; i++) best = Math.min(best, distanceToSegment(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

/** Closest point on a zone outline to p (used to draw the reveal line for area targets). */
export function nearestPointOnZone(p: LatLngTuple, zone: Zone): LatLngTuple {
  let best = Infinity, out: LatLngTuple = p;
  for (const ring of zone.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[1] - a[1], dy = b[0] - a[0], len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / len2)) : 0;
      const q: LatLngTuple = [a[0] + t * dy, a[1] + t * dx];
      const d = distanceUnits(p, q);
      if (d < best) { best = d; out = q; }
    }
  return out;
}

/** The zone under a point – smallest matching zone wins, so cities beat the zone around them. */
export function zoneAt(p: LatLngTuple, zones: Record<string, Zone>): [string, Zone] | null {
  let hit: [string, Zone] | null = null, hitArea = Infinity;
  for (const entry of Object.entries(zones)) {
    const [[s, w], [n, e]] = entry[1].bounds;
    if (p[0] < s || p[0] > n || p[1] < w || p[1] > e || !pointInZone(p, entry[1])) continue;
    const area = (n - s) * (e - w);
    if (area < hitArea) { hit = entry; hitArea = area; }
  }
  return hit;
}

/** In-game style 0–100 map coordinates of p inside a zone's map rectangle. */
export function zoneCoords(p: LatLngTuple, zone: Zone): [number, number] {
  const [[s, w], [n, e]] = zone.bounds;
  return [(100 * (p[1] - w)) / (e - w), (100 * (n - p[0])) / (n - s)];
}
