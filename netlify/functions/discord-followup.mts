// Background half of the /wayfinder command: when the board wasn't ready within Discord's
// 3-second window, the interactions endpoint replied "thinking…" and forwarded the
// original Discord-signed request here. We re-verify that signature (so nobody else can
// trigger this), build the board and edit it into the reply. Background functions return
// 202 immediately and may run for up to 15 minutes.
import type { Config } from '@netlify/functions';
import { db } from '../../server/db';
import { completeDeferred, planInteraction, verifyDiscordRequest } from '../../server/discord-interactions';
import { env } from '../../server/env';

export default async (req: Request) => {
  const publicKey = env('DISCORD_PUBLIC_KEY');
  const body = await req.text();
  if (!publicKey || body.length > 20_000) return;
  if (!verifyDiscordRequest(publicKey, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'), body)) {
    console.error('discord-followup: invalid signature – ignored');
    return;
  }
  const plan = planInteraction(JSON.parse(body));
  if (plan.kind !== 'board') return;
  const site = (env('URL') ?? new URL(req.url).origin).replace(/\/+$/, '');
  await completeDeferred(db(), plan, site);
  console.log(`discord-followup: board posted for server ${plan.serverId} (${plan.mode})`);
};

export const config: Config = { path: '/discord/interactions/followup', method: 'POST', background: true };
