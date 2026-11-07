// Discord sign-in (OAuth 2 authorisation-code flow) and sign-out.
import type { Config, Context } from '@netlify/functions';
import { db, tx } from '../../server/db';
import { beginLogin, completeLogin } from '../../server/discord';
import { assertSameOrigin, handle, HttpError, json, redirect } from '../../server/http';
import { endSession } from '../../server/session';

export default (req: Request, context: Context) =>
  handle(async () => {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
    const secure = url.protocol === 'https:';

    switch (route) {
      case 'GET /auth/discord':
        return redirect(beginLogin(context.cookies, url.origin, secure, url.searchParams.get('return')));

      case 'GET /auth/discord/callback':
        try {
          return redirect(await tx(q => completeLogin(q, context.cookies, url.searchParams, url.origin, secure)));
        } catch (err) {
          // Land back in the game with a readable reason rather than a JSON error page.
          const code = err instanceof HttpError ? err.code : 'server_error';
          if (!(err instanceof HttpError)) console.error(err);
          return redirect(`/?auth=${encodeURIComponent(code)}`);
        }

      case 'POST /auth/logout':
        assertSameOrigin(req);
        await endSession(db(), context.cookies);
        return json({ ok: true });

      default:
        throw new HttpError(404, 'not_found', 'No such path.');
    }
  });

export const config: Config = {
  path: '/auth/*',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
