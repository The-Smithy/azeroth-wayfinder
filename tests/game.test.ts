import { describe, expect, it } from 'vitest';
import locations from '../src/data/locations.json';
import zonesJson from '../src/data/zones.json';
import { dailyPlaces, dayNumber, DAY_PLAN, practicePlaces, tierPool, TIERS } from '../src/game/daily';
import { distanceToZone, pointInZone, zoneAt, zoneCoords } from '../src/game/geo';
import { emojiFor, MAX_ROUND_SCORE, MAX_TOTAL, measure, multiplierFor, pointsFor, ROUND_MULTIPLIERS, scoreFor, titleFor } from '../src/game/scoring';
import type { Place, Zone } from '../src/types';

const places = locations as Place[];
const zones = zonesJson as unknown as Record<string, Zone>;

describe('daily puzzle', () => {
  it('numbers days from the WoW: Forever launch (4 Nov 2026)', () => {
    expect(dayNumber(new Date(2026, 10, 4, 0, 1))).toBe(1);
    expect(dayNumber(new Date(2026, 10, 7, 23, 59))).toBe(4);
    expect(dayNumber(new Date(2027, 0, 1, 12))).toBe(59);
  });

  it('is deterministic', () => {
    expect(dailyPlaces(places, 42).map(p => p.id)).toEqual(dailyPlaces(places, 42).map(p => p.id));
  });

  it('gives five distinct places that follow the day plan, every day for years', () => {
    for (let day = 1; day <= 1500; day++) {
      const picks = dailyPlaces(places, day);
      expect(picks).toHaveLength(5);
      expect(new Set(picks.map(p => p.id)).size).toBe(5);
      expect(new Set(picks.map(p => p.latlng.join())).size).toBe(5);
      picks.forEach((p, i) => expect(TIERS[DAY_PLAN[i]].kinds as readonly string[]).toContain(p.kind));
    }
  });

  it('never repeats a place within a tier until its bag is exhausted', () => {
    const pool = tierPool(places, 'delve');
    const seen = new Set<string>();
    for (let day = 1; day <= pool.length; day++) {
      const id = dailyPlaces(places, day)[2].id;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('practice rounds are distinct', () => {
    for (let i = 0; i < 200; i++) expect(new Set(practicePlaces(places).map(p => p.id)).size).toBe(5);
  });
});

describe('geometry & scoring', () => {
  const durotar = zones['1411'];

  it('every place sits inside the world and its own zone rectangle', () => {
    for (const p of places) {
      const [[s, w], [n, e]] = zones[p.zoneId].bounds;
      expect(p.latlng[0]).toBeGreaterThanOrEqual(s - 0.01);
      expect(p.latlng[0]).toBeLessThanOrEqual(n + 0.01);
      expect(p.latlng[1]).toBeGreaterThanOrEqual(w - 0.01);
      expect(p.latlng[1]).toBeLessThanOrEqual(e + 0.01);
    }
  });

  it('knows which zone a point is in', () => {
    const orgrimmar = places.find(p => p.id === 'orgrimmar')!;
    expect(zoneAt(orgrimmar.latlng, zones)?.[1].name).toBe('Orgrimmar'); // city beats Durotar
    const booty = places.find(p => p.id === 'booty-bay')!;
    expect(zoneAt(booty.latlng, zones)?.[1].name).toBe('Stranglethorn Vale');
    const [x, y] = zoneCoords(booty.latlng, zones['1434']);
    expect(x).toBeCloseTo(27, 0);
    expect(y).toBeCloseTo(77, 0);
  });

  it('area targets: inside is a bullseye, outside measures to the edge', () => {
    const target = places.find(p => p.kind === 'zone' && p.zone === 'Durotar')!;
    expect(pointInZone(target.latlng, durotar)).toBe(true);
    expect(measure(target.latlng, target, zones).yards).toBe(0);
    const far = measure([-90, 0], target, zones);
    expect(far.yards).toBeCloseTo(distanceToZone([-90, 0], durotar) * (1600 / 12), 3);
  });

  it('accuracy falls off smoothly with distance (0–100)', () => {
    expect(scoreFor(0)).toBe(100);
    expect(scoreFor(1000)).toBeLessThan(scoreFor(500));
    expect(scoreFor(1000)).toBeGreaterThan(60);
    expect(scoreFor(40000)).toBe(0);
    expect(scoreFor(0, true)).toBe(75);
    expect(emojiFor(100)).toBe('🎯');
    expect(emojiFor(0)).toBe('🟥');
  });

  it('rounds are worth 100, 100, 200, 300, 300 – a perfect day is exactly 1,000', () => {
    expect(ROUND_MULTIPLIERS).toEqual([1, 1, 2, 3, 3]);
    expect([0, 1, 2, 3, 4].map(i => pointsFor(MAX_ROUND_SCORE, i))).toEqual([100, 100, 200, 300, 300]);
    expect(MAX_TOTAL).toBe(1000);
    expect(multiplierFor(2)).toBe(2);
    expect(pointsFor(87, 4)).toBe(261);
    expect(titleFor(1000)[1]).toBe('Keeper of the Atlas');
    expect(titleFor(0)[1]).toBe('Fresh from the Murloc Coast');
  });
});
