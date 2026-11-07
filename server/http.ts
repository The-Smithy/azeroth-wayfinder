/** An error that becomes a JSON response with a given status. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

const NO_STORE = { 'cache-control': 'no-store' };

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { ...NO_STORE, ...headers } });

export const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { ...NO_STORE, location } });

/**
 * State-changing requests must come from our own pages: same-origin Origin header
 * and a JSON body (which a cross-site form can't send without a CORS preflight).
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const self = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host');
  const allowed = new Set([self.host, ...(forwardedHost ? [forwardedHost] : [])]);
  if (!origin || !allowed.has(safeHost(origin))) throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
}
const safeHost = (u: string) => { try { return new URL(u).host; } catch { return ''; } };

export async function readJson<T>(req: Request, maxBytes = 1024): Promise<T> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'json_required');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large');
  try { return JSON.parse(text) as T; } catch { throw new HttpError(400, 'bad_json'); }
}

/** Wrap a handler so thrown HttpErrors (and surprises) become JSON errors. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch(err => {
    if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return json({ error: 'server_error', message: 'Something went wrong in the Twisting Nether.' }, 500);
  });
}

// --------------------------------------------------------------- validation --
export const int = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, 'bad_input', `Invalid ${name}.`);
  return v;
};
export const num = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, 'bad_input', `Invalid ${name}.`);
  return v;
};
