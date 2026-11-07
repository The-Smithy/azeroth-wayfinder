import type { Leaderboard, LeaderboardEntry, Me, Period, ServerInfo, StatsView } from '../src/api-types';
import { dayNumber } from './daily';
import { env } from './env';
import { HttpError } from './http';
import type { Queryable } from './db';
import type { Player } from './session';

const TOP = 50;
const WEEK_DAYS = 7;

interface BoardRow {
  player_id: string;
  name: string;
  avatar_url: string | null;
  points: number;
  ms: number;
  games: number;
  scores: number[] | null;
  rank: number;
}

/**
 * Daily or 7-day board, global or for one Discord server. Only signed-in, unbanned
 * players appear; the global board also respects the "show me publicly" setting.
 * Ties break on total time, then on who finished first.
 */
export async function leaderboard(q: Queryable, viewer: Player | null, period: Period, scope: string): Promise<Leaderboard> {
  const day = dayNumber();
  const isGlobal = scope === 'global';
  if (!isGlobal) {
    if (!viewer?.discord_id) throw new HttpError(401, 'sign_in', 'Sign in with Discord to see server leaderboards.');
    const { rowCount } = await q.query(`SELECT 1 FROM player_servers WHERE player_id = $1 AND server_id = $2`, [viewer.id, scope]);
    if (!rowCount) throw new HttpError(403, 'not_member', 'You are not a member of that server.');
  }

  const from = period === 'week' ? day - (WEEK_DAYS - 1) : day;
  const params: unknown[] = [from, day];
  const scopeFilter = isGlobal
    ? 'p.is_public'
    : `EXISTS (SELECT 1 FROM player_servers ps WHERE ps.player_id = p.id AND ps.server_id = $${params.push(scope)})`;
  const viewerParam = `$${params.push(viewer?.id ?? null)}`;

  const { rows } = await q.query<BoardRow & { pos: number; total_players: number }>(
    `WITH totals AS (
       SELECT g.player_id,
              SUM(g.total_points)::int AS points,
              SUM(g.total_ms)::int AS ms,
              COUNT(*)::int AS games,
              MAX(g.finished_at) AS last_finish
         FROM games g JOIN players p ON p.id = g.player_id
        WHERE g.day BETWEEN $1 AND $2 AND g.finished_at IS NOT NULL
          AND p.discord_id IS NOT NULL AND NOT p.banned AND ${scopeFilter}
        GROUP BY g.player_id),
     ranked AS (
       SELECT t.*, RANK() OVER (ORDER BY points DESC, ms ASC)::int AS rank,
              ROW_NUMBER() OVER (ORDER BY points DESC, ms ASC, last_finish ASC) AS pos,
              COUNT(*) OVER ()::int AS total_players
         FROM totals t)
     SELECT r.player_id, p.name, p.avatar_url, r.points, r.ms, r.games, r.rank, r.pos::int AS pos, r.total_players,
            ${period === 'day'
              ? `(SELECT ARRAY_AGG(score ORDER BY idx) FROM rounds x WHERE x.player_id = r.player_id AND x.day = $2)`
              : 'NULL'} AS scores
       FROM ranked r JOIN players p ON p.id = r.player_id
      WHERE r.pos <= ${TOP} OR r.player_id = ${viewerParam}
      ORDER BY r.pos`,
    params,
  );

  const toEntry = (r: BoardRow): LeaderboardEntry => ({
    rank: r.rank,
    name: r.name,
    avatar: r.avatar_url,
    points: r.points,
    ms: r.ms,
    ...(period === 'day' ? { scores: r.scores ?? [] } : { games: r.games }),
    me: r.player_id === viewer?.id,
  });
  const mine = rows.find(r => r.player_id === viewer?.id);
  return {
    period,
    scope,
    day,
    entries: rows.filter(r => r.pos <= TOP).map(toEntry),
    me: mine ? toEntry(mine) : null,
    players: rows[0]?.total_players ?? 0,
  };
}

/** Lifetime stats for the stats panel, computed from finished daily games. */
export async function stats(q: Queryable, player: Player | null): Promise<StatsView> {
  const empty: StatsView = { played: 0, average: 0, best: 0, streak: 0, maxStreak: 0, buckets: [0, 0, 0, 0, 0] };
  if (!player) return empty;
  const { rows } = await q.query<{ day: number; total_points: number }>(
    `SELECT day, total_points FROM games WHERE player_id = $1 AND finished_at IS NOT NULL ORDER BY day`,
    [player.id],
  );
  if (!rows.length) return empty;
  const today = dayNumber();
  let maxStreak = 0, run = 0, prev = -Infinity;
  for (const { day } of rows) {
    run = day === prev + 1 ? run + 1 : 1;
    maxStreak = Math.max(maxStreak, run);
    prev = day;
  }
  const last = rows[rows.length - 1].day;
  const buckets = [0, 0, 0, 0, 0];
  rows.forEach(r => buckets[Math.min(4, Math.floor(r.total_points / 200))]++);
  const sum = rows.reduce((s, r) => s + r.total_points, 0);
  return {
    played: rows.length,
    average: Math.round(sum / rows.length),
    best: Math.max(...rows.map(r => r.total_points)),
    streak: last >= today - 1 ? run : 0,
    maxStreak,
    buckets,
  };
}

/** Who am I, and which of my Discord servers have other players? */
export async function me(q: Queryable, player: Player | null): Promise<Me> {
  const discordEnabled = !!(env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET'));
  const day = dayNumber();
  if (!player) return { player: null, servers: [], discordEnabled, day };
  let servers: ServerInfo[] = [];
  if (player.discord_id) {
    const { rows } = await q.query<ServerInfo>(
      `SELECT s.id, s.name, s.icon, COUNT(other.player_id)::int + 1 AS players
         FROM player_servers mine
         JOIN discord_servers s ON s.id = mine.server_id
         JOIN player_servers other ON other.server_id = mine.server_id AND other.player_id <> mine.player_id
         JOIN players op ON op.id = other.player_id AND NOT op.banned
        WHERE mine.player_id = $1
        GROUP BY s.id, s.name, s.icon
        ORDER BY players DESC, s.name
        LIMIT 25`,
      [player.id],
    );
    servers = rows;
  }
  return {
    player: { name: player.name, avatar: player.avatar_url, discord: !!player.discord_id, isPublic: player.is_public },
    servers,
    discordEnabled,
    day,
  };
}

export async function setPublic(q: Queryable, player: Player, isPublic: boolean) {
  if (!player.discord_id) throw new HttpError(401, 'sign_in', 'Sign in with Discord first.');
  await q.query(`UPDATE players SET is_public = $2 WHERE id = $1`, [player.id, isPublic]);
}
