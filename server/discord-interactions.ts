// The /wayfinder slash command, delivered by Discord to an HTTP interactions endpoint
// (no bot or gateway connection needed). Requests are verified with the application's
// Ed25519 public key.
import { createPublicKey, verify } from 'node:crypto';
import type { Queryable } from './db';
import { dayNumber } from './daily';
import { type BoardMode, buildDigest } from './discord-digest';

const API = 'https://discord.com/api/v10';
const EPHEMERAL = 1 << 6;
/** Reject signed requests older than this (replay protection). */
const MAX_AGE_S = 300;

// Raw 32-byte Ed25519 keys need this SPKI DER prefix for node:crypto.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string, now = Date.now()): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_AGE_S) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

interface Interaction {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  data?: { name?: string; options?: { name: string; value: unknown }[] };
}

export type InteractionResult =
  | { response: Record<string, unknown> }
  /** Acknowledge now, then run `followUp` (edits the deferred reply). */
  | { response: Record<string, unknown>; followUp: () => Promise<void> };

const reply = (content: string, ephemeral = true) =>
  ({ response: { type: 4, data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } } });

export function handleInteraction(
  q: Queryable,
  interaction: Interaction,
  site: string,
  fetcher: typeof fetch = fetch,
): InteractionResult {
  if (interaction.type === 1) return { response: { type: 1 } }; // PING from Discord
  if (interaction.type !== 2 || interaction.data?.name !== 'wayfinder') return reply('Unknown command.');
  if (!interaction.guild_id) return reply('Use /wayfinder inside a server to see its leaderboard.');

  const opt = (name: string) => interaction.data?.options?.find(o => o.name === name)?.value;
  const board = opt('board') ?? 'today';
  const isPrivate = opt('private') === true;
  const today = dayNumber();
  const [mode, day]: [BoardMode, number] =
    board === 'yesterday' ? ['final', today - 1] : board === 'week' ? ['week', today] : ['live', today];
  const serverId = interaction.guild_id;

  return {
    // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: shows "Wayfinder is thinking…" while we query.
    response: { type: 5, data: { flags: isPrivate ? EPHEMERAL : 0 } },
    followUp: async () => {
      const edit = (body: unknown) => fetcher(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      try {
        const message = await buildDigest(q, serverId, day, site, mode);
        const res = await edit({ embeds: message.embeds, allowed_mentions: message.allowed_mentions });
        if (!res.ok) console.error(`discord interaction follow-up failed: ${res.status} ${await res.text().catch(() => '')}`);
      } catch (err) {
        console.error(err);
        await edit({ content: 'The archives are unreachable right now – please try again in a moment.' }).catch(() => {});
      }
    },
  };
}
