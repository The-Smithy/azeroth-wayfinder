import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable } from './db';
import { env } from './env';
import { HttpError } from './http';
import { type CookieJar, currentPlayer, endSession, MEMBER_DAYS, startSession } from './session';

const API = 'https://discord.com/api/v10';
export const STATE_COOKIE = 'pp_oauth_state';
const STATE_TTL_S = 600;

export interface DiscordConfig { clientId: string; clientSecret: string; }

export function discordConfig(): DiscordConfig {
  const clientId = env('DISCORD_CLIENT_ID'), clientSecret = env('DISCORD_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new HttpError(503, 'discord_not_configured', 'Discord sign-in is not configured yet.');
  return { clientId, clientSecret };
}

export const callbackUrl = (origin: string) => `${origin}/auth/discord/callback`;

/** Only same-site relative paths may be used as a post-login destination. */
export const safeReturnTo = (v: string | null) => (v && /^\/(?!\/)[\w\-/?=&#.]*$/.test(v) ? v : '/');

/** Step 1: remember a random state (and where to return) in a short-lived cookie, then go to Discord. */
export function beginLogin(cookies: CookieJar, origin: string, secure: boolean, returnTo: string | null): string {
  const { clientId } = discordConfig();
  const state = randomBytes(24).toString('base64url');
  cookies.set({
    name: STATE_COOKIE,
    value: `${state}.${encodeURIComponent(safeReturnTo(returnTo))}`,
    path: '/auth/',
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: STATE_TTL_S,
  });
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'identify guilds',
    redirect_uri: callbackUrl(origin),
    state,
    prompt: 'none',
  }).toString();
  return url.toString();
}

interface DiscordUser { id: string; username: string; global_name: string | null; avatar: string | null; }
interface DiscordGuild { id: string; name: string; icon: string | null; }

export function avatarUrl(u: DiscordUser): string {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  const fallback = Number((BigInt(u.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${fallback}.png`;
}
export const serverIconUrl = (g: DiscordGuild) => (g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null);

const isId = (v: unknown): v is string => typeof v === 'string' && /^\d{5,25}$/.test(v);
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || 'Adventurer';

async function discordFetch<T>(path: string, init: RequestInit, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(`${API}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new HttpError(502, 'discord_error', `Discord responded ${res.status}.`);
  return (await res.json()) as T;
}

/**
 * Step 2: verify state, exchange the code, load the profile and servers, then sign in.
 * A guest's in-progress or finished games are carried over to the account (unless the
 * account already played that day). Discord tokens are revoked and never stored.
 * Returns the path to send the browser back to.
 */
export async function completeLogin(
  q: Queryable,
  cookies: CookieJar,
  params: URLSearchParams,
  origin: string,
  secure: boolean,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const stored = cookies.get(STATE_COOKIE);
  cookies.delete({ name: STATE_COOKIE, path: '/auth/' });
  const [expected, encodedReturn] = (stored ?? '').split('.');
  const state = params.get('state') ?? '';
  if (!expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    throw new HttpError(400, 'bad_state', 'Sign-in expired or was tampered with – please try again.');
  }
  const returnTo = safeReturnTo(decodeURIComponent(encodedReturn ?? ''));
  if (params.get('error')) return `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth=cancelled`;
  const code = params.get('code');
  if (!code || code.length > 200) throw new HttpError(400, 'bad_code', 'Missing authorisation code.');

  const { clientId, clientSecret } = discordConfig();
  const token = await discordFetch<{ access_token: string; token_type: string }>('/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(origin) }),
  }, fetcher);
  const auth = { headers: { authorization: `Bearer ${token.access_token}` } };
  const [user, guilds] = await Promise.all([
    discordFetch<DiscordUser>('/users/@me', auth, fetcher),
    discordFetch<DiscordGuild[]>('/users/@me/guilds', auth, fetcher),
  ]);
  if (!isId(user.id)) throw new HttpError(502, 'discord_error', 'Unexpected Discord profile.');

  // Best effort: we only needed the token for these two reads.
  void fetcher(`${API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ token: token.access_token, token_type_hint: 'access_token' }),
  }).catch(() => {});

  const guest = await currentPlayer(q, cookies);
  const { rows } = await q.query<{ id: string; banned: boolean }>(
    `INSERT INTO players (discord_id, name, avatar_url) VALUES ($1, $2, $3)
     ON CONFLICT (discord_id) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, last_seen_at = now()
     RETURNING id, banned`,
    [user.id, clean(user.global_name ?? user.username, 40), avatarUrl(user)],
  );
  const account = rows[0];

  // Refresh server memberships.
  const valid = (Array.isArray(guilds) ? guilds : []).filter(g => isId(g?.id)).slice(0, 250);
  await q.query(`DELETE FROM player_servers WHERE player_id = $1`, [account.id]);
  if (valid.length) {
    await q.query(
      `INSERT INTO discord_servers (id, name, icon, updated_at)
       SELECT * , now() FROM UNNEST($1::text[], $2::text[], $3::text[])
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, updated_at = now()`,
      [valid.map(g => g.id), valid.map(g => clean(g.name, 100)), valid.map(serverIconUrl)],
    );
    await q.query(`INSERT INTO player_servers (player_id, server_id) SELECT $1, UNNEST($2::text[]) ON CONFLICT DO NOTHING`, [account.id, valid.map(g => g.id)]);
  }

  // Carry a guest's games over, then retire the guest.
  if (guest && !guest.discord_id && guest.id !== account.id) {
    await q.query(
      `UPDATE games SET player_id = $2
        WHERE player_id = $1 AND day NOT IN (SELECT day FROM games WHERE player_id = $2)`,
      [guest.id, account.id],
    );
    await q.query(`DELETE FROM players WHERE id = $1`, [guest.id]);
  } else if (guest) {
    await endSession(q, cookies);
  }

  if (account.banned) throw new HttpError(403, 'banned', 'This account has been barred from the expedition.');
  await startSession(q, cookies, account.id, MEMBER_DAYS, secure);
  return returnTo;
}
