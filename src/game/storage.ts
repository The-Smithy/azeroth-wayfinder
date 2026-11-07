import type { RoundResult } from '../types';
import { pointsFor } from './scoring';

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
  /** Count of games per 200-point bucket (0–199, …, 800–1000). */
  buckets: number[];
}
export interface Settings { sound: boolean; zoneLabels: boolean; mapStyle: 'auto' | 'parchment' | 'terrain'; seenHelp: boolean; }

function savedDays(): number[] {
  try {
    return Object.keys(localStorage).map(k => k.match(new RegExp(`^${PREFIX}day:(\\d+)$`))?.[1]).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

export function loadProgress(day: number): DayProgress {
  const p = read<DayProgress>(`day:${day}`, { day, rounds: [] });
  // Progress saved before the 1,000-point scale had 0–1000 accuracy and no multipliers.
  p.rounds = p.rounds.map((r, i) => {
    if (typeof r.points === 'number') return r;
    const score = Math.round(r.score / 10);
    return { ...r, score, points: pointsFor(score, i) };
  });
  return p;
}
export const saveProgress = (p: DayProgress) => write(`day:${p.day}`, p);

const emptyStats = (): Stats => ({ played: 0, streak: 0, maxStreak: 0, lastDay: 0, best: 0, totalScore: 0, buckets: [0, 0, 0, 0, 0] });
export function loadStats(): Stats {
  const raw = read<Partial<Stats> & { scale?: number }>('stats', {});
  const s: Stats = { ...emptyStats(), ...raw };
  if (raw.played && raw.scale !== 1000) {
    // Old stats were out of 5,000. Rebuild the score figures from the saved games
    // (converted by loadProgress); fall back to a straight rescale if none are left.
    const totals = savedDays().map(d => loadProgress(d).rounds).filter(r => r.length >= 5)
      .map(rounds => rounds.reduce((t, r) => t + r.points, 0));
    if (totals.length) {
      s.best = Math.max(...totals);
      s.totalScore = Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * s.played);
      s.buckets = [0, 0, 0, 0, 0];
      totals.forEach(t => s.buckets[Math.min(4, Math.floor(t / 200))]++);
    } else {
      s.best = Math.round(s.best / 5);
      s.totalScore = Math.round(s.totalScore / 5);
    }
    write('stats', { ...s, scale: 1000 });
  }
  return s;
}

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
  s.buckets[Math.min(4, Math.floor(total / 200))]++;
  write('stats', { ...s, scale: 1000 });
  return s;
}

/** A streak only counts if yesterday (or today) was played. */
export function liveStreak(s: Stats, today: number) {
  return s.lastDay >= today - 1 ? s.streak : 0;
}

export const loadSettings = (): Settings =>
  ({ sound: true, zoneLabels: true, mapStyle: 'auto', seenHelp: false, ...read<Partial<Settings>>('settings', {}) });
export const saveSettings = (s: Settings) => write('settings', s);
