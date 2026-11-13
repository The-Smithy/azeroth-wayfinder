import placesJson from './data/places.json';
import zonesJson from '../src/data/zones.json';
import type { Place, Zone } from '../src/types';
import type { Answer, Clue, DailyState, GuessResponse, PlayedRound, RankInfo, RoundOutcome } from '../src/api-types';
import { measure, multiplierFor, pointsFor, ROUNDS, scoreFor } from '../src/game/scoring';
import { dailyPlaces, dayEndsAt, dayNumber, practicePlaces } from './daily';
import { loadOverrides, recentPlaces } from './difficulty';
import { env, isLocalDev } from './env';
import { HttpError } from './http';
import type { Queryable } from './db';
import type { Player } from './session';

export const places = placesJson as Place[];
export const zones = zonesJson as unknown as Record<string, Zone>;
const byId = new Map(places.map(p => [p.id, p]));

/** Playable world rectangle (matches the map's world bounds, with a little slack). */
export const WORLD = { south: -210, north: 25, west: -20, east: 330 };
/** Per-round time is capped for tie-breaks so an idle tab can't dominate the total. */
const MAX_ROUND_MS = 10 * 60_000;

function puzzleSecret(): string {
  const secret = env('PUZZLE_SECRET');
  if (secret) return secret;
  if (isLocalDev()) return 'local-dev-secret';
  throw new HttpError(503, 'not_configured', 'The expedition is not configured yet (PUZZLE_SECRET).');
}

/** Today's puzzle number; the client must be playing today's puzzle. */
export function assertToday(day: number) {
  if (day !== dayNumber()) throw new HttpError(409, 'stale_day', 'A new expedition has begun – reload to continue.');
}

/** The day's five places, generated once and frozen in the database. */
export async function puzzleFor(q: Queryable, day: number): Promise<Place[]> {
  const read = async () =>
    (await q.query<{ place_ids: string[] }>(`SELECT place_ids FROM puzzles WHERE day = $1`, [day])).rows[0]?.place_ids;
  let ids = await read();
  if (!ids) {
    // Tiers tuned from players' results, and no repeats of the last couple of weeks.
    const overrides = await loadOverrides(q);
    const recent = await recentPlaces(q, day);
    const picked = dailyPlaces(places, day, puzzleSecret(), { overrides, recent }).map(p => p.id);
    await q.query(`INSERT INTO puzzles (day, place_ids) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING`, [day, picked]);
    ids = (await read())!;
  }
  return ids.map(id => {
    const place = byId.get(id);
    if (!place) throw new HttpError(500, 'unknown_place', `Puzzle references unknown place ${id}.`);
    return place;
  });
}

export function clueFor(place: Place, round: number, hintUsed = false): Clue {
  return {
    round,
    multiplier: multiplierFor(round),
    name: place.name,
    kind: place.kind,
    faction: place.faction,
    area: !!place.area,
    ...(hintUsed ? { hint: place.continent } : {}),
  };
}

export function answerFor(place: Place, anchor: Answer['anchor']): Answer {
  return { latlng: place.latlng, anchor, zone: place.zone, continent: place.continent, ...(place.area ? { area: place.area } : {}) };
}

/** Serialise concurrent requests (double clicks, two tabs) for one player's game. Call inside a transaction. */
async function lockGame(q: Queryable, player: Player, day: number) {
  await q.query(`SELECT 1 FROM games WHERE player_id = $1 AND day = $2 FOR UPDATE`, [player.id, day]);
}

interface RoundRow {
  idx: number;
  hint_at: Date | null;
  guessed_at: Date | null;
  guess_lat: number | null;
  guess_lng: number | null;
  yards: number | null;
  score: number | null;
  points: number | null;
  ms: number | null;
}

function outcomeFrom(place: Place, r: RoundRow): RoundOutcome {
  const guess: [number, number] = [r.guess_lat!, r.guess_lng!];
  return {
    round: r.idx,
    guess,
    yards: r.yards!,
    score: r.score!,
    points: r.points!,
    hint: !!r.hint_at,
    ms: r.ms,
    answer: answerFor(place, measure(guess, place, zones).anchor),
  };
}

const ROUND_COLS = 'idx, hint_at, guessed_at, guess_lat, guess_lng, yards, score, points, ms';

/** Everything the client needs to resume today's game. Read-only. */
export async function dailyState(q: Queryable, player: Player | null): Promise<DailyState> {
  const day = dayNumber();
  const base: DailyState = { day, resetsAt: dayEndsAt(day).toISOString(), rounds: [], current: null, finished: false, total: 0, totalMs: 0, rank: null };
  if (!player) return base;
  const { rows } = await q.query<RoundRow>(`SELECT ${ROUND_COLS} FROM rounds WHERE player_id = $1 AND day = $2 ORDER BY idx`, [player.id, day]);
  if (!rows.length) return base;
  const puzzle = await puzzleFor(q, day);
  const played: PlayedRound[] = [];
  let current: Clue | null = null;
  for (const r of rows) {
    const place = puzzle[r.idx];
    if (r.guessed_at) played.push({ clue: clueFor(place, r.idx, !!r.hint_at), outcome: outcomeFrom(place, r) });
    else current = clueFor(place, r.idx, !!r.hint_at);
  }
  const finished = played.length === ROUNDS;
  const total = played.reduce((s, r) => s + r.outcome.points, 0);
  const totalMs = played.reduce((s, r) => s + Math.min(r.outcome.ms ?? 0, MAX_ROUND_MS), 0);
  return { ...base, rounds: played, current, finished, total, totalMs, rank: finished ? await rankOf(q, player, day) : null };
}

/** Deal the next clue (idempotent: returns the open clue if one is already dealt). */
export async function dealNextRound(q: Queryable, player: Player, day: number): Promise<Clue> {
  assertToday(day);
  const puzzle = await puzzleFor(q, day);
  await q.query(`INSERT INTO games (player_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [player.id, day]);
  await lockGame(q, player, day);
  const { rows } = await q.query<RoundRow>(`SELECT ${ROUND_COLS} FROM rounds WHERE player_id = $1 AND day = $2 ORDER BY idx`, [player.id, day]);
  const open = rows.find(r => !r.guessed_at);
  if (open) return clueFor(puzzle[open.idx], open.idx, !!open.hint_at);
  if (rows.length >= ROUNDS) throw new HttpError(409, 'finished', 'Today\'s expedition is already complete.');
  const idx = rows.length;
  await q.query(`INSERT INTO rounds (player_id, day, idx) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [player.id, day, idx]);
  return clueFor(puzzle[idx], idx);
}

/** Reveal the continent for the open round (costs 25% of that round). */
export async function takeHint(q: Queryable, player: Player, day: number, round: number): Promise<{ continent: string }> {
  assertToday(day);
  const { rowCount } = await q.query(
    `UPDATE rounds SET hint_at = COALESCE(hint_at, now())
      WHERE player_id = $1 AND day = $2 AND idx = $3 AND guessed_at IS NULL`,
    [player.id, day, round],
  );
  if (!rowCount) throw new HttpError(409, 'no_open_round', 'That location is not open for hints.');
  const puzzle = await puzzleFor(q, day);
  return { continent: puzzle[round].continent };
}

export function assertInWorld(lat: number, lng: number) {
  if (lat < WORLD.south || lat > WORLD.north || lng < WORLD.west || lng > WORLD.east) {
    throw new HttpError(400, 'off_map', 'That pin is off the edge of the world.');
  }
}

/** Score a guess on the server. Must run inside a transaction. */
export async function submitGuess(q: Queryable, player: Player, day: number, round: number, lat: number, lng: number): Promise<GuessResponse> {
  assertToday(day);
  assertInWorld(lat, lng);
  await lockGame(q, player, day);
  const { rows } = await q.query<{ hint_at: Date | null; ms: number }>(
    `SELECT hint_at, LEAST(EXTRACT(EPOCH FROM (now() - shown_at)) * 1000, 2147483647)::int AS ms
       FROM rounds WHERE player_id = $1 AND day = $2 AND idx = $3 AND guessed_at IS NULL
       FOR UPDATE`,
    [player.id, day, round],
  );
  const open = rows[0];
  if (!open) throw new HttpError(409, 'no_open_round', 'That location has already been answered.');

  const puzzle = await puzzleFor(q, day);
  const place = puzzle[round];
  const guess: [number, number] = [lat, lng];
  const { yards, anchor } = measure(guess, place, zones);
  const score = scoreFor(yards, !!open.hint_at);
  const points = pointsFor(score, round);
  // Guarded update: even without the lock, a round can only ever be scored once.
  const updated = await q.query(
    `UPDATE rounds SET guessed_at = now(), guess_lat = $4, guess_lng = $5, yards = $6, score = $7, points = $8, ms = $9
      WHERE player_id = $1 AND day = $2 AND idx = $3 AND guessed_at IS NULL`,
    [player.id, day, round, lat, lng, Math.round(yards), score, points, open.ms],
  );
  if (updated.rowCount !== 1) throw new HttpError(409, 'no_open_round', 'That location has already been answered.');

  const finished = round === ROUNDS - 1;
  const { rows: totals } = await q.query<{ total: number; total_ms: number }>(
    `SELECT COALESCE(SUM(points), 0)::int AS total, COALESCE(SUM(LEAST(ms, ${MAX_ROUND_MS})), 0)::int AS total_ms
       FROM rounds WHERE player_id = $1 AND day = $2 AND guessed_at IS NOT NULL`,
    [player.id, day],
  );
  const { total, total_ms } = totals[0];
  await q.query(
    `UPDATE games SET total_points = $3, total_ms = $4, finished_at = CASE WHEN $5 THEN now() ELSE finished_at END
      WHERE player_id = $1 AND day = $2`,
    [player.id, day, total, total_ms, finished],
  );

  const outcome: RoundOutcome = {
    round, guess, yards: Math.round(yards), score, points, hint: !!open.hint_at, ms: open.ms, answer: answerFor(place, anchor),
  };
  return { outcome, finished, total, rank: finished ? await rankOf(q, player, day) : null };
}

/** Global rank for a finished, ranked player (null for guests and hidden players). */
export async function rankOf(q: Queryable, player: Player, day: number): Promise<RankInfo | null> {
  if (!player.discord_id || !player.is_public || player.banned) return null;
  const { rows } = await q.query<{ rank: number; of: number }>(
    `WITH board AS (
       SELECT g.player_id, RANK() OVER (ORDER BY g.total_points DESC, g.total_ms ASC) AS rank
         FROM games g JOIN players p ON p.id = g.player_id
        WHERE g.day = $1 AND g.finished_at IS NOT NULL
          AND p.discord_id IS NOT NULL AND p.is_public AND NOT p.banned)
     SELECT rank::int, (SELECT COUNT(*) FROM board)::int AS of FROM board WHERE player_id = $2`,
    [day, player.id],
  );
  return rows[0] ?? null;
}

// ----------------------------------------------------------------- practice --
/** Practice clues: random places, never today's. `ref` is sent back with the guess. */
export async function practiceClues(q: Queryable): Promise<Clue[]> {
  const today = new Set((await puzzleFor(q, dayNumber())).map(p => p.id));
  return practicePlaces(places, today, Math.random, await loadOverrides(q)).map((p, i) => ({ ...clueFor(p, i), ref: p.id }));
}

async function practicePlace(q: Queryable, ref: unknown): Promise<Place> {
  const place = typeof ref === 'string' ? byId.get(ref) : undefined;
  if (!place) throw new HttpError(400, 'bad_input', 'Unknown practice location.');
  const today = await puzzleFor(q, dayNumber());
  if (today.some(p => p.id === place.id || (p.latlng[0] === place.latlng[0] && p.latlng[1] === place.latlng[1]))) {
    throw new HttpError(403, 'daily_place', 'That location is part of today\'s expedition.');
  }
  return place;
}

export async function practiceHint(q: Queryable, ref: unknown) {
  return { continent: (await practicePlace(q, ref)).continent };
}

export async function practiceGuess(q: Queryable, ref: unknown, round: number, lat: number, lng: number, hint: boolean): Promise<RoundOutcome> {
  assertInWorld(lat, lng);
  const place = await practicePlace(q, ref);
  const guess: [number, number] = [lat, lng];
  const { yards, anchor } = measure(guess, place, zones);
  const score = scoreFor(yards, hint);
  return { round, guess, yards: Math.round(yards), score, points: pointsFor(score, round), hint, ms: null, answer: answerFor(place, anchor) };
}
