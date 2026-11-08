// The /wayfinder slash command, delivered by Discord to an HTTP interactions endpoint
// (no bot or gateway connection needed). Requests are verified with the application's
// Ed25519 public key.
//
// Flow: try to build the board within ~2 s and answer Discord directly. If the database
// is slow (cold start), answer "thinking…" instead and let a background function – which
// re-verifies the same signed request – fill the answer in.
import { createPublicKey, verify } from 'node:crypto';
import type { Queryable } from './db';
import { dayNumber } from './daily';
import { type BoardMode, buildDigest } from './discord-digest';

const API = 'https://discord.com/api/v10';
const EPHEMERAL = 1 << 6;
/** Reject signed requests older than this (replay protection). */
const MAX_AGE_S = 300;
/** Discord allows 3 s for the first response; leave room for the network. */
export const FAST_PATH_MS = 2200;

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

export interface Interaction {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  data?: { name?: string; options?: { name: string; value: unknown }[] };
}

/** What to do with an interaction: answer immediately, or show a board. */
export type Plan =
  | { kind: 'reply'; response: Record<string, unknown> }
  | { kind: 'board'; serverId: string; day: number; mode: BoardMode; ephemeral: boolean; applicationId: string; token: string };

const reply = (content: string): Plan =>
  ({ kind: 'reply', response: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } } });

export function planInteraction(interaction: Interaction): Plan {
  if (interaction.type === 1) return { kind: 'reply', response: { type: 1 } }; // PING from Discord
  if (interaction.type !== 2 || interaction.data?.name !== 'wayfinder') return reply('Unknown command.');
  if (!interaction.guild_id) return reply('Use /wayfinder inside a server to see its leaderboard.');
  const opt = (name: string) => interaction.data?.options?.find(o => o.name === name)?.value;
  const board = opt('board') ?? 'today';
  const today = dayNumber();
  const [mode, day]: [BoardMode, number] =
    board === 'yesterday' ? ['final', today - 1] : board === 'week' ? ['week', today] : ['live', today];
  return {
    kind: 'board',
    serverId: interaction.guild_id,
    day,
    mode,
    ephemeral: opt('private') === true,
    applicationId: interaction.application_id,
    token: interaction.token,
  };
}

type BoardPlan = Extract<Plan, { kind: 'board' }>;

/** The message body (embeds, no pings) for a board plan. */
export async function boardBody(q: Queryable, plan: BoardPlan, site: string) {
  const message = await buildDigest(q, plan.serverId, plan.day, site, plan.mode);
  return { embeds: message.embeds, allowed_mentions: message.allowed_mentions, flags: plan.ephemeral ? EPHEMERAL : 0 };
}

/** Immediate answer, or null if the board isn't ready within `budgetMs`. */
export async function respondFast(q: Queryable, plan: Plan, site: string, budgetMs = FAST_PATH_MS): Promise<Record<string, unknown> | null> {
  if (plan.kind === 'reply') return plan.response;
  const build = boardBody(q, plan, site).then(data => ({ type: 4, data }));
  build.catch(() => {}); // a late failure is handled by the slow path
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), budgetMs));
  try {
    return await Promise.race([build, timeout]);
  } catch (err) {
    console.error('discord-interactions: fast path failed', err);
    return null;
  }
}

/** "Wayfinder is thinking…" – the background function edits it into the board. */
export const deferredResponse = (plan: BoardPlan) => ({ type: 5, data: { flags: plan.ephemeral ? EPHEMERAL : 0 } });

/** Slow path (background function): build the board and edit the deferred reply. */
export async function completeDeferred(q: Queryable, plan: BoardPlan, site: string, fetcher: typeof fetch = fetch) {
  const edit = (body: unknown) => fetcher(`${API}/webhooks/${plan.applicationId}/${plan.token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  try {
    const { flags: _flags, ...body } = await boardBody(q, plan, site);
    const res = await edit(body);
    if (!res.ok) throw new Error(`Discord rejected the edit: ${res.status} ${await res.text().catch(() => '')}`);
  } catch (err) {
    console.error('discord-interactions: deferred reply failed', err);
    await edit({ content: 'The archives are unreachable right now – please try again in a moment.' }).catch(() => {});
    throw err;
  }
}
