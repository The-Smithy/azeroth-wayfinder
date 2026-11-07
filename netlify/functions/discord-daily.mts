// Daily Discord results post, just after the puzzle rolls over at midnight US Eastern.
//
// Cron runs in UTC, and midnight Eastern is 04:00 UTC in summer (EDT) and 05:00 UTC in
// winter (EST), so this runs at 04:07 and 05:07 UTC. Each run posts the results of the
// Eastern day that just ended; whichever run comes second finds it already posted.
//
// Set DISCORD_WEBHOOK_URL (Server Settings → Integrations → Webhooks) to enable it.
import type { Config, Context } from '@netlify/functions';
import { db } from '../../server/db';
import { postDailyDigest } from '../../server/discord-digest';
import { env } from '../../server/env';

export default async (_req: Request, context: Context) => {
  const webhook = env('DISCORD_WEBHOOK_URL');
  if (!webhook) {
    console.log('discord-daily: DISCORD_WEBHOOK_URL not set – skipping');
    return;
  }
  const site = (env('URL') ?? context.site?.url ?? 'https://azeroth-wayfinder.netlify.app').replace(/\/+$/, '');
  const result = await postDailyDigest(db(), webhook, site);
  console.log(`discord-daily: ${result}`);
};

export const config: Config = { schedule: '7 4,5 * * *' };
