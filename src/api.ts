// Thin, typed client for the Netlify Functions.
import type { Clue, DailyState, GuessResponse, Leaderboard, Me, Period, RoundOutcome, StatsView } from './api-types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Lost contact with Azeroth – check your connection and try again.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok) {
    if (res.status === 429) throw new ApiError(429, 'rate_limited', 'Whoa there, speedy gryphon – try again in a moment.');
    throw new ApiError(res.status, data?.error ?? 'server_error', data?.message ?? 'Something went wrong.');
  }
  return data as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  daily: () => request<DailyState>('GET', '/api/daily'),
  dealRound: (day: number) => request<Clue>('POST', '/api/daily/round', { day }),
  hint: (day: number, round: number) => request<{ continent: string }>('POST', '/api/daily/hint', { day, round }),
  guess: (day: number, round: number, lat: number, lng: number) =>
    request<GuessResponse>('POST', '/api/daily/guess', { day, round, lat, lng }),
  practice: () => request<{ clues: Clue[] }>('GET', '/api/practice'),
  practiceHint: (ref: string) => request<{ continent: string }>('POST', '/api/practice/hint', { ref }),
  practiceGuess: (ref: string, round: number, lat: number, lng: number, hint: boolean) =>
    request<RoundOutcome>('POST', '/api/practice/guess', { ref, round, lat, lng, hint }),
  leaderboard: (period: Period, scope: string) =>
    request<Leaderboard>('GET', `/api/leaderboard?period=${period}&scope=${encodeURIComponent(scope)}`),
  stats: () => request<StatsView>('GET', '/api/stats'),
  setPublic: (isPublic: boolean) => request<{ ok: true }>('POST', '/api/profile', { isPublic }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
};
