declare const Netlify: { env: { get(key: string): string | undefined } } | undefined;

/** Read an environment variable inside Netlify Functions (falls back to process.env for tests). */
export function env(key: string): string | undefined {
  try {
    if (typeof Netlify !== 'undefined' && Netlify) return Netlify.env.get(key) ?? process.env[key];
  } catch { /* not in a Netlify runtime */ }
  return process.env[key];
}

/** True in tests – never on a deploy. Local dev sets PUZZLE_SECRET in .env instead. */
export const isLocalDev = () => !!process.env.VITEST;
