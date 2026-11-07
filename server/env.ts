declare const Netlify: { env: { get(key: string): string | undefined } } | undefined;

/** Read an environment variable inside Netlify Functions (falls back to process.env for tests). */
export function env(key: string): string | undefined {
  try {
    if (typeof Netlify !== 'undefined' && Netlify) return Netlify.env.get(key) ?? process.env[key];
  } catch { /* not in a Netlify runtime */ }
  return process.env[key];
}

/** True under `netlify dev` / the Vite plugin and in tests – never on a deploy. */
export const isLocalDev = () => env('NETLIFY_DEV') === 'true' || !!process.env.VITEST;
