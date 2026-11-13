// Weekly difficulty tuning (Mondays 06:41 UTC): recompute how hard each place plays from ranked
// guesses and move places between rounds where the results call for it (server/difficulty.ts).
// Only puzzles not generated yet are affected. Can also be run by hand from the Netlify UI.
import type { Config } from '@netlify/functions';
import { retuneDifficulty } from '../../server/difficulty';
import { places } from '../../server/game';

export default async () => {
  const { rows, moves, held } = await retuneDifficulty(places);
  const fmt = (m: { name: string; from: string; to: string; median: number; plays: number }) =>
    `${m.name} ${m.from}→${m.to} (median ${Math.round(m.median)}, ${m.plays} plays)`;
  console.log(`difficulty: ${rows.length} places with results, ${moves.length} moved, ${held.length} held by the pool floor`);
  for (const m of moves) console.log(`  moved ${fmt(m)}`);
  for (const m of held) console.log(`  held  ${fmt(m)}`);
};

export const config: Config = { schedule: '41 6 * * 1' };
