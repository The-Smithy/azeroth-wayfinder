// Nightly housekeeping at 04:23 UTC: expired sessions and long-idle guests.
import type { Config } from '@netlify/functions';
import { db } from '../../server/db';

export default async () => {
  const sessions = await db().query(`DELETE FROM sessions WHERE expires_at < now()`);
  const guests = await db().query(`DELETE FROM players WHERE discord_id IS NULL AND last_seen_at < now() - interval '60 days'`);
  console.log(`cleanup: removed ${sessions.rowCount} sessions, ${guests.rowCount} idle guests`);
};

export const config: Config = { schedule: '23 4 * * *' };
