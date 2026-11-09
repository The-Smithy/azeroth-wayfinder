import { describe, expect, it } from 'vitest';
import locations from '../server/data/places.json';
import zonesJson from '../src/data/zones.json';
import { dailyPlaces, dayEndsAt, dayNumber, DAY_PLAN, practicePlaces, tierPool, TIERS } from '../server/daily';
import { distanceToZone, pointInZone, zoneAt, zoneCoords } from '../src/game/geo';
import { emojiFor, MAX_ROUND_SCORE, MAX_TOTAL, measure, multiplierFor, pointsFor, ROUND_MULTIPLIERS, scoreFor, titleFor } from '../src/game/scoring';
import type { Place, Zone } from '../src/types';
import { shareText } from '../src/ui/share';

const places = locations as Place[];
const zones = zonesJson as unknown as Record<string, Zone>;

describe('daily puzzle', () => {
  it('rolls days over at midnight US Eastern, counting from the WoW: Forever launch', () => {
    // 4 Nov 2026 00:00 EST = 05:00 UTC
    expect(dayNumber(new Date('2026-11-04T04:59:59Z'))).toBe(0);
    expect(dayNumber(new Date('2026-11-04T05:00:00Z'))).toBe(1);
    expect(dayNumber(new Date('2026-11-08T04:59:59Z'))).toBe(4);
    expect(dayNumber(new Date('2026-11-08T05:00:00Z'))).toBe(5);
    expect(dayEndsAt(4).toISOString()).toBe('2026-11-08T05:00:00.000Z');
    // Summer: EDT, so midnight Eastern is 04:00 UTC – and the day count stays continuous.
    const july1 = dayNumber(new Date('2027-07-01T12:00:00Z'));
    expect(dayEndsAt(july1).toISOString()).toBe('2027-07-02T04:00:00.000Z');
    expect(dayNumber(new Date('2027-07-02T03:59:59Z'))).toBe(july1);
    expect(dayNumber(new Date('2027-07-02T04:00:00Z'))).toBe(july1 + 1);
    // DST transitions (8 Mar 2027 starts EDT, 7 Nov 2027 ends it) don't skip or repeat days.
    for (let d = 1; d < 800; d++) expect(dayNumber(new Date(dayEndsAt(d).getTime() - 1000))).toBe(d);
  });

  it('is deterministic for a secret, and the secret changes the puzzle', () => {
    expect(dailyPlaces(places, 42, 's').map(p => p.id)).toEqual(dailyPlaces(places, 42, 's').map(p => p.id));
    const a = Array.from({ length: 10 }, (_, d) => dailyPlaces(places, d + 1, 'one').map(p => p.id).join());
    const b = Array.from({ length: 10 }, (_, d) => dailyPlaces(places, d + 1, 'two').map(p => p.id).join());
    expect(a).not.toEqual(b);
  });

  it('gives five distinct places that follow the day plan, every day for years', () => {
    for (let day = 1; day <= 1500; day++) {
      const picks = dailyPlaces(places, day, 'secret');
      expect(picks).toHaveLength(5);
      expect(new Set(picks.map(p => p.id)).size).toBe(5);
      expect(new Set(picks.map(p => p.latlng.join())).size).toBe(5);
      picks.forEach((p, i) => expect(TIERS[DAY_PLAN[i]].match(p)).toBe(true));
    }
  });

  it('never repeats a place within a tier until its bag is exhausted', () => {
    const pool = tierPool(places, 'outpost');
    const seen = new Set<string>();
    for (let day = 1; day <= pool.length; day++) {
      const id = dailyPlaces(places, day, 'secret')[2].id;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('practice rounds are distinct and skip excluded places', () => {
    const exclude = new Set(dailyPlaces(places, 4, 'secret').map(p => p.id));
    for (let i = 0; i < 200; i++) {
      const picks = practicePlaces(places, exclude);
      expect(new Set(picks.map(p => p.id)).size).toBe(5);
      picks.forEach(p => expect(exclude.has(p.id)).toBe(false));
    }
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
    expect(Math.abs(x - 27)).toBeLessThan(2); // town centre, near the old flight point (27, 77)
    expect(Math.abs(y - 77)).toBeLessThan(2);
  });

  it('uses Forever positions where Forever redrew the map', () => {
    const at = (id: string, zoneId: string) => zoneCoords(places.find(p => p.id === id)!.latlng, zones[zoneId]);
    // The Stockade gate (Warden Thelwater, Forever DB) – not the Classic (40.3, 55.2).
    const [sx, sy] = at('the-stockade', '1453');
    expect(Math.hypot(sx - 51.49, sy - 69.38)).toBeLessThan(0.5);
    // Stormwind Harbor sits on the west-side docks (Forever routing survey boat stop).
    const [hx, hy] = at('stormwind-harbor', '1453');
    expect(Math.hypot(hx - 21.79, hy - 56.86)).toBeLessThan(0.5);
    // Steamwheedle Port is on the Tanaris coast – not Gadgetzan's flight point (51, 29).
    const [px, py] = at('steamwheedle-port', '1446');
    expect(Math.hypot(px - 67.0, py - 23.9)).toBeLessThan(1);
    // Light's Hope Chapel stays on the chapel in the map frame this game draws (81, 59).
    const [lx, ly] = at('lights-hope-chapel', '1423');
    expect(Math.hypot(lx - 81, ly - 59)).toBeLessThan(0.5);
    // Lakeshire is the town north of the lake (Polestar's townsfolk), not the flight point
    // across the water.
    const [kx, ky] = at('lakeshire', '1433');
    expect(Math.hypot(kx - 21.8, ky - 45.65)).toBeLessThan(0.5);
  });

  it('places Eastern Plaguelands characters through the Era frame its imagery is drawn in', () => {
    // Polestar's world-yard spawns land on the well-known Classic coordinates.
    const at = (id: string) => zoneCoords(places.find(p => p.id === id)!.latlng, zones['1423']);
    for (const [id, x, y] of [['npc-tirion-fordring', 7.5, 43.7], ['npc-nathanos-blightcaller', 26.5, 74.7], ['npc-pamela-redpath', 36.5, 90.8]] as const) {
      const [px, py] = at(id);
      expect(Math.hypot(px - x, py - y), id).toBeLessThan(0.5);
    }
  });

  it('keeps capital-city characters in their capital', () => {
    const zoneOf = (id: string) => places.find(p => p.id === id)!.zone;
    expect(zoneOf('npc-king-magni-bronzebeard')).toBe('Ironforge');
    expect(zoneOf('npc-lady-sylvanas-windrunner')).toBe('Undercity');
    expect(zoneOf('npc-thrall')).toBe('Orgrimmar');
    expect(places.some(p => p.id === 'npc-rexxar')).toBe(false); // roams Desolace
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

describe('share text', () => {
  it('is spoiler-free and names the site without a link', () => {
    const rounds = [[100, 100], [94, 94], [75, 150], [71, 213], [100, 300]].map(([score, points]) => ({ score, points }));
    const text = shareText({ date: 'Nov 7, 2026', total: 857, rounds, site: 'azeroth-wayfinder.netlify.app' });
    expect(text).toBe('Wayfinder · Nov 7, 2026 📍 857/1,000\n🎯 100 · 🟩 94 · 🟩 150 · 🟨 213 · 🎯 300\nazeroth-wayfinder.netlify.app');
    expect(text).not.toMatch(/https?:/);
    for (const p of places) expect(text).not.toContain(p.name);
  });
});
