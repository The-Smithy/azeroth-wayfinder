#!/usr/bin/env node
// Registers the /wayfinder slash command with Discord. Runs after `npm run build`
// (postbuild) on production deploys, using the app credentials already configured in
// Netlify – no bot token needed. Never fails the build.
import { readFile } from 'node:fs/promises';

const { DISCORD_CLIENT_ID: id, DISCORD_CLIENT_SECRET: secret, CONTEXT } = process.env;
const force = process.argv.includes('--force');

if (!force && CONTEXT !== 'production') {
  console.log('[discord-register] Not a production deploy – skipping command registration.');
  process.exit(0);
}
if (!id || !secret) {
  console.log('[discord-register] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET not set – skipping.');
  process.exit(0);
}

try {
  const commands = JSON.parse(await readFile('server/discord-commands.json', 'utf8'));
  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'applications.commands.update' }),
  });
  if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
  const { access_token: token } = await tokenRes.json();
  const res = await fetch(`https://discord.com/api/v10/applications/${id}/commands`, {
    method: 'PUT', // replaces the global command set – idempotent
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`commands ${res.status}: ${await res.text()}`);
  const saved = await res.json();
  console.log(`[discord-register] Registered: ${saved.map(c => `/${c.name}`).join(', ')}`);
} catch (err) {
  console.warn(`[discord-register] Could not register commands (build continues): ${err.message}`);
}
