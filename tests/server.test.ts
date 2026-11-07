// Integration tests: the real migrations and SQL against a local Postgres.
import { NetlifyDB } from '@netlify/database-dev';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, useTestPool } from '../server/db';
import { dayNumber } from '../server/daily';
import { completeLogin, beginLogin, STATE_COOKIE } from '../server/discord';
import { dailyState, dealNextRound, places, practiceClues, practiceGuess, puzzleFor, submitGuess, takeHint, zones } from '../server/game';
import { HttpError } from '../server/http';
import { leaderboard, me, stats } from '../server/leaderboard';
import { type CookieJar, ensurePlayer, type Player, SESSION_COOKIE, currentPlayer } from '../server/session';
import { measure, scoreFor } from '../src/game/scoring';

let netlifyDb: NetlifyDB;
let pool: pg.Pool;

class Jar implements CookieJar {
  store = new Map<string, string>();
  get(name: string) { return this.store.get(name); }
  set(o: { name: string; value: string }) { this.store.set(o.name, o.value); }
  delete(n: string | { name: string }) { this.store.delete(typeof n === 'string' ? n : n.name); }
}

const today = () => dayNumber();
async function tx<T>(fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const code = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { return e instanceof HttpError ? e.code : String(e); }
};

beforeAll(async () => {
  process.env.PUZZLE_SECRET = 'test-secret';
  process.env.DISCORD_CLIENT_ID = '123456789012';
  process.env.DISCORD_CLIENT_SECRET = 'shh';
  netlifyDb = new NetlifyDB();
  const url = await netlifyDb.start();
  await netlifyDb.applyMigrations('./netlify/database/migrations');
  // The local engine (PGlite) is single-session, so keep one connection; row locks are
  // exercised for real on hosted Postgres.
  pool = new pg.Pool({ connectionString: url, max: 1 });
  useTestPool(pool as never);
}, 60_000);

afterAll(async () => {
  useTestPool(null);
  await pool?.end();
  await netlifyDb?.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE players, discord_servers, puzzles CASCADE');
});

/** Play a whole daily game for a player, guessing exactly on each target. */
async function playPerfect(player: Player, offsets: [number, number][] = []) {
  const puzzle = await puzzleFor(db(), today());
  let total = 0;
  for (let i = 0; i < 5; i++) {
    await tx(q => dealNextRound(q, player, today()));
    const [dLat, dLng] = offsets[i] ?? [0, 0];
    const res = await tx(q => submitGuess(q, player, today(), i, puzzle[i].latlng[0] + dLat, puzzle[i].latlng[1] + dLng));
    total = res.total;
  }
  return total;
}

async function discordPlayer(name: string, opts: { public?: boolean; banned?: boolean; servers?: string[] } = {}): Promise<Player> {
  const { rows } = await pool.query<Player>(
    `INSERT INTO players (discord_id, name, is_public, banned) VALUES ($1, $2, $3, $4)
     RETURNING id, discord_id, name, avatar_url, is_public, banned`,
    [String(1e11 + Math.floor(Math.random() * 1e10)), name, opts.public ?? true, opts.banned ?? false],
  );
  for (const s of opts.servers ?? []) {
    await pool.query(`INSERT INTO discord_servers (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [s]);
    await pool.query(`INSERT INTO player_servers VALUES ($1, $2)`, [rows[0].id, s]);
  }
  return rows[0];
}

describe('daily game (server-authoritative)', () => {
  it('deals clues without answers and scores guesses on the server', async () => {
    const jar = new Jar();
    const player = await tx(q => ensurePlayer(q, jar, true));
    expect(jar.get(SESSION_COOKIE)).toBeTruthy();
    expect((await currentPlayer(pool, jar))?.id).toBe(player.id);

    const clue = await tx(q => dealNextRound(q, player, today()));
    expect(clue.round).toBe(0);
    expect(JSON.stringify(clue)).not.toMatch(/latlng|anchor|continent|"zone":/);

    const puzzle = await puzzleFor(pool, today());
    const guess: [number, number] = [puzzle[0].latlng[0] + 3, puzzle[0].latlng[1] - 2];
    const res = await tx(q => submitGuess(q, player, today(), 0, ...guess));
    const expected = scoreFor(measure(guess, puzzle[0], zones).yards);
    expect(res.outcome.score).toBe(expected);
    expect(res.outcome.points).toBe(expected);
    expect(res.outcome.answer.latlng).toEqual(puzzle[0].latlng);
    expect(res.finished).toBe(false);
  });

  it('refuses replays, skipped rounds, late hints, stale days and off-map pins', async () => {
    const player = await tx(q => ensurePlayer(q, new Jar(), true));
    expect(await code(tx(q => submitGuess(q, player, today(), 0, -100, 80)))).toBe('no_open_round'); // not dealt yet
    await tx(q => dealNextRound(q, player, today()));
    expect(await code(tx(q => submitGuess(q, player, today(), 1, -100, 80)))).toBe('no_open_round'); // skipping ahead
    expect(await code(tx(q => submitGuess(q, player, today(), 0, 500, 80)))).toBe('off_map');
    expect(await code(tx(q => submitGuess(q, player, today() - 1, 0, -100, 80)))).toBe('stale_day');
    await tx(q => submitGuess(q, player, today(), 0, -100, 80));
    expect(await code(tx(q => submitGuess(q, player, today(), 0, -100, 80)))).toBe('no_open_round'); // replay
    expect(await code(tx(q => takeHint(q, player, today(), 0)))).toBe('no_open_round'); // hint after guessing
  });

  it('dealing is idempotent and the hint costs 25%', async () => {
    const player = await tx(q => ensurePlayer(q, new Jar(), true));
    const a = await tx(q => dealNextRound(q, player, today()));
    const b = await tx(q => dealNextRound(q, player, today()));
    expect(b).toEqual(a);
    const puzzle = await puzzleFor(pool, today());
    const { continent } = await tx(q => takeHint(q, player, today(), 0));
    expect(continent).toBe(puzzle[0].continent);
    expect((await tx(q => dealNextRound(q, player, today()))).hint).toBe(continent);
    const res = await tx(q => submitGuess(q, player, today(), 0, ...puzzle[0].latlng));
    expect(res.outcome.score).toBe(75);
    expect(res.outcome.hint).toBe(true);
  });

  it('repeated submissions of the same guess only count once', async () => {
    const player = await tx(q => ensurePlayer(q, new Jar(), true));
    await tx(q => dealNextRound(q, player, today()));
    const results = await Promise.all([0, 1, 2].map(() => code(tx(q => submitGuess(q, player, today(), 0, -100, 80)))));
    expect(results.filter(r => r === 'ok')).toHaveLength(1);
  });

  it('a full game totals 1,000 when perfect, then locks', { timeout: 30_000 }, async () => {
    const player = await tx(q => ensurePlayer(q, new Jar(), true));
    expect(await playPerfect(player)).toBe(1000);
    expect(await code(tx(q => dealNextRound(q, player, today())))).toBe('finished');
    const state = await dailyState(pool, player);
    expect(state.finished).toBe(true);
    expect(state.total).toBe(1000);
    expect(state.rounds).toHaveLength(5);
    expect(state.rank).toBeNull(); // guests are not ranked
  });

  it('freezes the puzzle once generated', async () => {
    const first = (await puzzleFor(pool, today())).map(p => p.id);
    process.env.PUZZLE_SECRET = 'rotated';
    expect((await puzzleFor(pool, today())).map(p => p.id)).toEqual(first);
    process.env.PUZZLE_SECRET = 'test-secret';
  });

  it('practice never touches today\'s places', async () => {
    const todays = new Set((await puzzleFor(pool, today())).map(p => p.id));
    for (let i = 0; i < 20; i++) {
      for (const clue of await practiceClues(pool)) expect(todays.has(clue.ref!)).toBe(false);
    }
    expect(await code(practiceGuess(pool, [...todays][0], 0, -100, 80, false))).toBe('daily_place');
    const other = places.find(p => !todays.has(p.id))!;
    expect((await practiceGuess(pool, other.id, 0, ...other.latlng, false)).score).toBe(100);
  });
});

describe('leaderboards', () => {
  it('ranks by points then time, hides guests/banned/private from the global board', { timeout: 60_000 }, async () => {
    const ada = await discordPlayer('Ada', { servers: ['900000000001'] });
    const bob = await discordPlayer('Bob', { servers: ['900000000001'] });
    const cyd = await discordPlayer('Cyd', { public: false, servers: ['900000000001'] });
    const eve = await discordPlayer('Eve', { banned: true });
    const guest = await tx(q => ensurePlayer(q, new Jar(), true));

    await playPerfect(ada);
    await playPerfect(bob, [[0, 0], [0, 0], [0, 0], [0, 0], [3, 3]]);
    await playPerfect(cyd);
    await playPerfect(eve);
    await playPerfect(guest);

    const global = await leaderboard(pool, bob, 'day', 'global');
    expect(global.entries.map(e => e.name)).toEqual(['Ada', 'Bob']);
    expect(global.entries[0].scores).toHaveLength(5);
    expect(global.me).toMatchObject({ name: 'Bob', rank: 2, me: true });
    expect(global.players).toBe(2);

    const server = await leaderboard(pool, bob, 'day', '900000000001');
    expect(server.entries.map(e => e.name).sort()).toEqual(['Ada', 'Bob', 'Cyd']);
    expect(await code(leaderboard(pool, eve, 'day', '900000000001'))).toBe('not_member');
    expect(await code(leaderboard(pool, null, 'day', '900000000001'))).toBe('sign_in');

    const week = await leaderboard(pool, ada, 'week', 'global');
    expect(week.entries[0]).toMatchObject({ name: 'Ada', points: 1000, games: 1 });

    // Ties on points break on time.
    await pool.query(`UPDATE games SET total_points = 1000, total_ms = 5000 WHERE player_id = $1`, [bob.id]);
    await pool.query(`UPDATE games SET total_ms = 9000 WHERE player_id = $1`, [ada.id]);
    expect((await leaderboard(pool, null, 'day', 'global')).entries.map(e => e.name)).toEqual(['Bob', 'Ada']);
  });

  it('stats track streaks and buckets', { timeout: 30_000 }, async () => {
    const ada = await discordPlayer('Ada');
    for (const d of [today() - 5, today() - 2, today() - 1]) {
      await pool.query(`INSERT INTO puzzles VALUES ($1, $2) ON CONFLICT DO NOTHING`, [d, places.slice(0, 5).map(p => p.id)]);
      await pool.query(`INSERT INTO games (player_id, day, finished_at, total_points) VALUES ($1, $2, now(), $3)`, [ada.id, d, Math.abs(d * 137) % 1000]);
    }
    await playPerfect(ada);
    const s = await stats(pool, ada);
    expect(s).toMatchObject({ played: 4, streak: 3, maxStreak: 3, best: 1000 });
    expect(s.buckets.reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('Discord sign-in', () => {
  const fakeDiscord = (user: object, guilds: object[]): typeof fetch => (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'tok', token_type: 'Bearer' });
    if (url.endsWith('/users/@me')) return Response.json(user);
    if (url.endsWith('/users/@me/guilds')) return Response.json(guilds);
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  it('rejects a forged state', async () => {
    const jar = new Jar();
    beginLogin(jar, 'https://x.test', true, '/');
    const params = new URLSearchParams({ code: 'abc', state: 'forged-state-forged-state-forged!' });
    expect(await code(tx(q => completeLogin(q, jar, params, 'https://x.test', true, fakeDiscord({}, []))))).toBe('bad_state');
  });

  it('signs in, records servers, and carries over a guest game', { timeout: 30_000 }, async () => {
    const jar = new Jar();
    const guest = await tx(q => ensurePlayer(q, jar, true));
    await tx(q => dealNextRound(q, guest, today()));
    const puzzle = await puzzleFor(pool, today());
    await tx(q => submitGuess(q, guest, today(), 0, ...puzzle[0].latlng));

    const url = new URL(beginLogin(jar, 'https://x.test', true, '/?from=test'));
    expect(url.searchParams.get('scope')).toBe('identify guilds');
    const state = url.searchParams.get('state')!;
    const discord = fakeDiscord(
      { id: '222222222222222222', username: 'thrall', global_name: 'Go\'el', avatar: null },
      [{ id: '900000000002', name: 'Frostwolf Clan', icon: 'abc' }],
    );
    const back = await tx(q => completeLogin(q, jar, new URLSearchParams({ code: 'c0de', state }), 'https://x.test', true, discord));
    expect(back).toBe('/?from=test');
    expect(jar.get(STATE_COOKIE)).toBeUndefined();

    const account = (await currentPlayer(pool, jar))!;
    expect(account).toMatchObject({ discord_id: '222222222222222222', name: 'Go\'el' });
    expect(account.avatar_url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/);
    const state2 = await dailyState(pool, account);
    expect(state2.rounds).toHaveLength(1); // guest progress claimed
    expect((await pool.query(`SELECT 1 FROM players WHERE id = $1`, [guest.id])).rowCount).toBe(0);

    const other = await discordPlayer('Saurfang', { servers: ['900000000002'] });
    const mine = await me(pool, account);
    expect(mine.player).toMatchObject({ name: 'Go\'el', discord: true });
    expect(mine.servers).toEqual([{ id: '900000000002', name: 'Frostwolf Clan', icon: expect.stringContaining('/icons/900000000002/abc.png'), players: 2 }]);
    expect(other).toBeTruthy();
  });
});
