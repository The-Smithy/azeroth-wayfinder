import type { RoundResult } from '../types';

const PREFIX = 'azeroth-pinpoint:v1:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

export interface DayProgress { day: number; rounds: RoundResult[]; }
export interface Stats {
  played: number;
  streak: number;
  maxStreak: number;
  lastDay: number;
  best: number;
  totalScore: number;
  /** Count of games per 1000-point bucket (0–999, …, 4000–5000). */
  buckets: number[];
}
export interface Settings { sound: boolean; zoneLabels: boolean; mapStyle: 'auto' | 'parchment' | 'terrain'; seenHelp: boolean; }

export const loadProgress = (day: number): DayProgress => read(`day:${day}`, { day, rounds: [] });
export const saveProgress = (p: DayProgress) => write(`day:${p.day}`, p);

const emptyStats = (): Stats => ({ played: 0, streak: 0, maxStreak: 0, lastDay: 0, best: 0, totalScore: 0, buckets: [0, 0, 0, 0, 0] });
export const loadStats = (): Stats => ({ ...emptyStats(), ...read<Partial<Stats>>('stats', {}) });

/** Record a finished daily puzzle (idempotent per day). */
export function recordGame(day: number, total: number): Stats {
  const s = loadStats();
  if (s.lastDay === day) return s;
  s.played++;
  s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.lastDay = day;
  s.best = Math.max(s.best, total);
  s.totalScore += total;
  s.buckets[Math.min(4, Math.floor(total / 1000))]++;
  write('stats', s);
  return s;
}

/** A streak only counts if yesterday (or today) was played. */
export function liveStreak(s: Stats, today: number) {
  return s.lastDay >= today - 1 ? s.streak : 0;
}

export const loadSettings = (): Settings =>
  ({ sound: true, zoneLabels: true, mapStyle: 'auto', seenHelp: false, ...read<Partial<Settings>>('settings', {}) });
export const saveSettings = (s: Settings) => write('settings', s);
