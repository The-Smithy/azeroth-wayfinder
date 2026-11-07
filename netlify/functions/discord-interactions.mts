// Discord interactions endpoint for the /wayfinder slash command.
// In the Discord Developer Portal set "Interactions Endpoint URL" to
// https://<your-site>/discord/interactions and add DISCORD_PUBLIC_KEY in Netlify.
import type { Config, Context } from '@netlify/functions';
import { db } from '../../server/db';
import { handleInteraction, verifyDiscordRequest } from '../../server/discord-interactions';
import { env } from '../../server/env';

export default async (req: Request, context: Context) => {
  const publicKey = env('DISCORD_PUBLIC_KEY');
  if (!publicKey) return new Response('Discord commands are not configured (DISCORD_PUBLIC_KEY).', { status: 503 });

  const body = await req.text();
  if (body.length > 20_000) return new Response('too large', { status: 413 });
  const valid = verifyDiscordRequest(publicKey, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'), body);
  if (!valid) return new Response('invalid request signature', { status: 401 });

  let interaction;
  try { interaction = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }

  const site = (env('URL') ?? new URL(req.url).origin).replace(/\/+$/, '');
  const result = handleInteraction(db(), interaction, site);
  if ('followUp' in result) context.waitUntil(result.followUp());
  return Response.json(result.response);
};

export const config: Config = {
  path: '/discord/interactions',
  method: 'POST',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
