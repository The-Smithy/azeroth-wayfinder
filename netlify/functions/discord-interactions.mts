// Discord interactions endpoint for the /wayfinder slash command.
// In the Discord Developer Portal set "Interactions Endpoint URL" to
// https://<your-site>/discord/interactions and add DISCORD_PUBLIC_KEY in Netlify.
import type { Config } from '@netlify/functions';
import { db } from '../../server/db';
import { deferredResponse, planInteraction, respondFast, verifyDiscordRequest } from '../../server/discord-interactions';
import { env } from '../../server/env';

export default async (req: Request) => {
  const publicKey = env('DISCORD_PUBLIC_KEY');
  if (!publicKey) return new Response('Discord commands are not configured (DISCORD_PUBLIC_KEY).', { status: 503 });

  const body = await req.text();
  if (body.length > 20_000) return new Response('too large', { status: 413 });
  const signature = req.headers.get('x-signature-ed25519');
  const timestamp = req.headers.get('x-signature-timestamp');
  if (!verifyDiscordRequest(publicKey, signature, timestamp, body)) return new Response('invalid request signature', { status: 401 });

  let interaction;
  try { interaction = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }

  const origin = new URL(req.url).origin;
  const site = (env('URL') ?? origin).replace(/\/+$/, '');
  const plan = planInteraction(interaction);

  // Fast path: answer with the board directly.
  const fast = await respondFast(db(), plan, site);
  if (fast) return Response.json(fast);

  // Slow path: hand the original signed request to the background function (which
  // re-verifies it), then tell Discord we're working on it.
  if (plan.kind !== 'board') return Response.json({ type: 4, data: { content: 'Something went wrong.', flags: 64 } });
  const handoff = await fetch(`${origin}/discord/interactions/followup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature-ed25519': signature!, 'x-signature-timestamp': timestamp! },
    body,
  }).catch(err => { console.error('discord-interactions: handoff failed', err); return null; });
  if (!handoff || handoff.status !== 202) console.error(`discord-interactions: handoff status ${handoff?.status}`);
  return Response.json(deferredResponse(plan));
};

export const config: Config = {
  path: '/discord/interactions',
  method: 'POST',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
