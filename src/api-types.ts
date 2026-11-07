// The JSON contract between the browser and the Netlify Functions.
// Shared by both sides – keep it free of runtime code.
import type { Faction, LatLngTuple, LocationKind } from './types';

/** What the player sees before guessing. Never contains coordinates. */
export interface Clue {
  round: number;
  multiplier: number;
  name: string;
  kind: LocationKind;
  faction: Faction;
  /** True for zones & capitals: anywhere inside the outline is a bullseye. */
  area: boolean;
  /** Continent, once the hint has been used for this round. */
  hint?: string;
  /** Practice only: opaque id to send back with the guess. */
  ref?: string;
}

/** Revealed only after the guess is locked in. */
export interface Answer {
  latlng: LatLngTuple;
  /** End of the reveal line: the target point or the nearest edge of the target zone. */
  anchor: LatLngTuple;
  zone: string;
  continent: string;
  /** Zone id whose outline is the target, for area rounds. */
  area?: string;
}

export interface RoundOutcome {
  round: number;
  guess: LatLngTuple;
  yards: number;
  /** Accuracy 0–100. */
  score: number;
  /** score × the round multiplier. */
  points: number;
  hint: boolean;
  /** Time from clue to guess (daily only). */
  ms: number | null;
  answer: Answer;
}

export interface PlayedRound { clue: Clue; outcome: RoundOutcome; }

export interface RankInfo { rank: number; of: number; }

export interface DailyState {
  day: number;
  /** ISO time the next puzzle unlocks (midnight US Eastern). */
  resetsAt: string;
  rounds: PlayedRound[];
  /** The dealt-but-unguessed clue, if any. */
  current: Clue | null;
  finished: boolean;
  total: number;
  totalMs: number;
  /** Global rank once finished (signed-in, public players only). */
  rank: RankInfo | null;
}

export interface GuessResponse {
  outcome: RoundOutcome;
  finished: boolean;
  total: number;
  rank: RankInfo | null;
}

export interface ServerInfo { id: string; name: string; icon: string | null; players: number; }

export interface Me {
  player: { name: string; avatar: string | null; discord: boolean; isPublic: boolean } | null;
  /** Discord servers you share with at least one other player. */
  servers: ServerInfo[];
  /** False until the Discord app credentials are configured. */
  discordEnabled: boolean;
  day: number;
}

export type Period = 'day' | 'week';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  avatar: string | null;
  points: number;
  ms: number;
  /** Day boards: accuracy per round, for the emoji row. */
  scores?: number[];
  /** Week boards: games played in the window. */
  games?: number;
  me: boolean;
}

export interface Leaderboard {
  period: Period;
  /** 'global' or a Discord server id. */
  scope: string;
  day: number;
  entries: LeaderboardEntry[];
  /** The viewer's own row, even when outside the top entries. */
  me: LeaderboardEntry | null;
  players: number;
}

export interface StatsView {
  played: number;
  average: number;
  best: number;
  streak: number;
  maxStreak: number;
  /** Games per 200-point bucket. */
  buckets: number[];
}

export interface ApiError { error: string; message: string; }
