// The daily Discord results post: everyone from one Discord server who played the
// puzzle that just ended, ranked, plus the week's leaders. Sent through a channel
// webhook – no bot required.
import type { Queryable } from './db';
import { dayEndsAt, dayNumber, TIME_ZONE } from './daily';
import { rankBoard } from './leaderboard';
import { emojiFor, MAX_TOTAL } from '../src/game/scoring';

const GOLD = 0xe8c372;
const MAX_LISTED = 25;
const MEDALS = ['🥇', '🥈', '🥉'];

/** Parse a Discord webhook URL into its id and token. */
export function parseWebhook(url: string): { id: string; token: string } | null {
  const m = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{5,25})\/([\w-]{20,200})\/?$/.exec(url.trim());
  return m ? { id: m[1], token: m[2] } : null;
}

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The calendar date a puzzle day was played on, e.g. "Saturday, November 7". */
export function puzzleDateLabel(day: number) {
  return new Date(dayEndsAt(day).getTime() - 1).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: TIME_ZONE,
  });
}

/** Mentions render as names for server members; allowed_mentions below stops them pinging. */
const who = (discordId: string) => `<@${discordId}>`;

export interface DiscordMessage {
  username: string;
  avatar_url?: string;
  allowed_mentions: { parse: never[] };
  embeds: Record<string, unknown>[];
}

/** Build the results post for one server and one (finished) puzzle day. */
export async function buildDigest(q: Queryable, serverId: string, day: number, site: string): Promise<DiscordMessage> {
  const [board, week, unfinished, server] = await Promise.all([
    rankBoard(q, { period: 'day', scope: serverId, day, limit: MAX_LISTED }),
    rankBoard(q, { period: 'week', scope: serverId, day, limit: 3 }),
    q.query<{ discord_id: string }>(
      `SELECT p.discord_id FROM games g JOIN players p ON p.id = g.player_id
        WHERE g.day = $1 AND g.finished_at IS NULL AND p.discord_id IS NOT NULL AND NOT p.banned
          AND EXISTS (SELECT 1 FROM player_servers ps WHERE ps.player_id = p.id AND ps.server_id = $2)
        ORDER BY g.started_at LIMIT 20`,
      [day, serverId],
    ),
    q.query<{ name: string }>(`SELECT name FROM discord_servers WHERE id = $1`, [serverId]),
  ]);
  const serverName = server.rows[0]?.name ?? 'this server';
  const finished = board[0]?.total_players ?? 0;
  const date = puzzleDateLabel(day);

  const lines = board.map(r => {
    const place = MEDALS[r.rank - 1] ?? `**${r.rank}.**`;
    const emojis = (r.scores ?? []).map(emojiFor).join('');
    return `${place} ${who(r.discord_id)} — **${r.points.toLocaleString('en-US')}** ${emojis} · ${fmtTime(r.ms)}`;
  });
  if (finished > board.length) lines.push(`…and ${finished - board.length} more`);

  const description = finished
    ? [
        `**${finished}** ${finished === 1 ? 'adventurer' : 'adventurers'} from **${serverName}** completed the expedition (best possible: ${MAX_TOTAL.toLocaleString('en-US')}).`,
        '',
        ...lines,
      ].join('\n')
    : `No one from **${serverName}** completed this expedition. The map awaits!`;

  const fields: Record<string, unknown>[] = [];
  if (unfinished.rows.length) {
    fields.push({ name: '🧭 Set out but didn\'t finish', value: unfinished.rows.map(r => who(r.discord_id)).join(' ') });
  }
  if (week.length) {
    fields.push({
      name: '📅 This week',
      value: week.map(r => `${MEDALS[r.rank - 1] ?? `${r.rank}.`} ${who(r.discord_id)} — **${r.points.toLocaleString('en-US')}** (${r.games} ${r.games === 1 ? 'day' : 'days'})`).join('\n'),
    });
  }
  fields.push({ name: '​', value: `**A new expedition is live** – five new places await.\n[Play Wayfinder](${site})` });

  return {
    username: 'Wayfinder',
    avatar_url: `${site}/apple-touch-icon.png`,
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `🏆 Wayfinder results · ${date}`,
      url: site,
      color: GOLD,
      description,
      fields,
      footer: { text: 'Server board: Discord members who signed in to Wayfinder' },
      timestamp: dayEndsAt(day).toISOString(),
    }],
  };
}

/** Look up which server a webhook posts into (the webhook URL alone is enough). */
export async function webhookServer(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Discord webhook lookup failed: ${res.status}`);
  const info = (await res.json()) as { guild_id?: string };
  if (!info.guild_id) throw new Error('Webhook is not attached to a server channel');
  return info.guild_id;
}

/**
 * Post yesterday's results once. Safe to run any number of times: the day is claimed
 * in the database first, and released again if Discord rejects the post.
 */
export async function postDailyDigest(
  q: Queryable,
  webhookUrl: string,
  site: string,
  opts: { now?: Date; fetcher?: typeof fetch } = {},
): Promise<'posted' | 'already_posted'> {
  const fetcher = opts.fetcher ?? fetch;
  const hook = parseWebhook(webhookUrl);
  if (!hook) throw new Error('DISCORD_WEBHOOK_URL is not a valid Discord webhook URL');
  const day = dayNumber(opts.now) - 1;
  const serverId = await webhookServer(webhookUrl, fetcher);

  const claim = await q.query(
    `INSERT INTO discord_posts (webhook_id, day, server_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [hook.id, day, serverId],
  );
  if (!claim.rowCount) return 'already_posted';
  try {
    const message = await buildDigest(q, serverId, day, site);
    const res = await fetcher(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Discord rejected the post: ${res.status} ${await res.text().catch(() => '')}`);
    return 'posted';
  } catch (err) {
    await q.query(`DELETE FROM discord_posts WHERE webhook_id = $1 AND day = $2`, [hook.id, day]);
    throw err;
  }
}
