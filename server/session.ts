import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from './db';
import { HttpError } from './http';

export const SESSION_COOKIE = 'pp_session';
const GUEST_DAYS = 180;
export const MEMBER_DAYS = 30;

/** The subset of Netlify's context.cookies we rely on (easy to fake in tests). */
export interface CookieJar {
  get(name: string): string | undefined;
  set(options: { name: string; value: string; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; expires?: Date; maxAge?: number }): void;
  delete(name: string | { name: string; path?: string }): void;
}

export interface Player {
  id: string;
  discord_id: string | null;
  name: string;
  avatar_url: string | null;
  is_public: boolean;
  banned: boolean;
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const PLAYER_COLS = 'p.id, p.discord_id, p.name, p.avatar_url, p.is_public, p.banned';

/** The signed-in (or guest) player for this request, if the session is valid. */
export async function currentPlayer(q: Queryable, cookies: CookieJar): Promise<Player | null> {
  const token = cookies.get(SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const { rows } = await q.query<Player>(
    `SELECT ${PLAYER_COLS} FROM sessions s JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const player = rows[0] ?? null;
  if (player) {
    // Cheap activity marker for guest cleanup; at most one write per hour.
    await q.query(`UPDATE players SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 hour'`, [player.id]);
  }
  return player;
}

export async function startSession(q: Queryable, cookies: CookieJar, playerId: string, days: number, secure: boolean) {
  const token = newToken();
  const expires = new Date(Date.now() + days * 86_400_000);
  await q.query(`INSERT INTO sessions (token_hash, player_id, expires_at) VALUES ($1, $2, $3)`, [hashToken(token), playerId, expires]);
  cookies.set({ name: SESSION_COOKIE, value: token, path: '/', httpOnly: true, secure, sameSite: 'Lax', expires });
}

export async function endSession(q: Queryable, cookies: CookieJar) {
  const token = cookies.get(SESSION_COOKIE);
  if (token) await q.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  cookies.delete({ name: SESSION_COOKIE, path: '/' });
}

/** Current player, creating a guest (and session) on first play. */
export async function ensurePlayer(q: Queryable, cookies: CookieJar, secure: boolean): Promise<Player> {
  const existing = await currentPlayer(q, cookies);
  if (existing) return assertNotBanned(existing);
  const { rows } = await q.query<Player>(
    `INSERT INTO players (name) VALUES ('Wandering Adventurer')
     RETURNING id, discord_id, name, avatar_url, is_public, banned`,
  );
  await startSession(q, cookies, rows[0].id, GUEST_DAYS, secure);
  return rows[0];
}

export function assertNotBanned(p: Player): Player {
  if (p.banned) throw new HttpError(403, 'banned', 'This account has been barred from the expedition.');
  return p;
}
