// Game API: daily rounds (server-scored), practice, leaderboards, stats and profile.
import type { Config, Context } from '@netlify/functions';
import type { Period } from '../../src/api-types';
import { db, tx } from '../../server/db';
import { dealNextRound, dailyState, practiceClues, practiceGuess, practiceHint, submitGuess, takeHint } from '../../server/game';
import { assertSameOrigin, handle, HttpError, int, json, num, readJson } from '../../server/http';
import { leaderboard, me, setPublic, stats } from '../../server/leaderboard';
import { assertNotBanned, currentPlayer, ensurePlayer } from '../../server/session';

type Body = Record<string, unknown>;

export default (req: Request, context: Context) =>
  handle(async () => {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
    const secure = url.protocol === 'https:';
    const cookies = context.cookies;

    if (req.method !== 'GET') assertSameOrigin(req);

    switch (route) {
      case 'GET /api/me':
        return json(await me(db(), await currentPlayer(db(), cookies)));

      case 'GET /api/daily':
        return json(await dailyState(db(), await currentPlayer(db(), cookies)));

      case 'POST /api/daily/round': {
        const { day } = await readJson<Body>(req);
        return json(await tx(async q => dealNextRound(q, await ensurePlayer(q, cookies, secure), int(day, 'day', 1, 1e6))));
      }

      case 'POST /api/daily/hint': {
        const { day, round } = await readJson<Body>(req);
        return json(await tx(async q => {
          const player = assertNotBanned((await currentPlayer(q, cookies)) ?? unauthorised());
          return takeHint(q, player, int(day, 'day', 1, 1e6), int(round, 'round', 0, 4));
        }));
      }

      case 'POST /api/daily/guess': {
        const { day, round, lat, lng } = await readJson<Body>(req);
        return json(await tx(async q => {
          const player = assertNotBanned((await currentPlayer(q, cookies)) ?? unauthorised());
          return submitGuess(q, player, int(day, 'day', 1, 1e6), int(round, 'round', 0, 4), num(lat, 'lat', -1e3, 1e3), num(lng, 'lng', -1e3, 1e3));
        }));
      }

      case 'GET /api/practice':
        return json({ clues: await practiceClues(db()) });

      case 'POST /api/practice/hint': {
        const { ref } = await readJson<Body>(req);
        return json(await practiceHint(db(), ref));
      }

      case 'POST /api/practice/guess': {
        const { ref, round, lat, lng, hint } = await readJson<Body>(req);
        return json(await practiceGuess(db(), ref, int(round, 'round', 0, 4), num(lat, 'lat', -1e3, 1e3), num(lng, 'lng', -1e3, 1e3), hint === true));
      }

      case 'GET /api/leaderboard': {
        const period = (url.searchParams.get('period') ?? 'day') as Period;
        if (period !== 'day' && period !== 'week') throw new HttpError(400, 'bad_input', 'Invalid period.');
        const scope = url.searchParams.get('scope') ?? 'global';
        if (scope !== 'global' && !/^\d{5,25}$/.test(scope)) throw new HttpError(400, 'bad_input', 'Invalid scope.');
        return json(await leaderboard(db(), await currentPlayer(db(), cookies), period, scope));
      }

      case 'GET /api/stats':
        return json(await stats(db(), await currentPlayer(db(), cookies)));

      case 'POST /api/profile': {
        const { isPublic } = await readJson<Body>(req);
        if (typeof isPublic !== 'boolean') throw new HttpError(400, 'bad_input', 'Invalid setting.');
        const player = (await currentPlayer(db(), cookies)) ?? unauthorised();
        await setPublic(db(), player, isPublic);
        return json({ ok: true });
      }

      default:
        throw new HttpError(404, 'not_found', 'No such path in Azeroth.');
    }
  });

function unauthorised(): never {
  throw new HttpError(401, 'no_session', 'Your expedition session has expired – reload to continue.');
}

export const config: Config = {
  path: '/api/*',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
