import { defineConfig, type Plugin } from 'vite';
import netlify from '@netlify/vite-plugin';

/**
 * Social cards need absolute URLs. Set SITE_URL (e.g. https://wayfinder.example.com)
 * at build time; Netlify's URL and Vercel's production URL are picked up automatically.
 */
function siteUrl(): Plugin {
  const raw =
    process.env.SITE_URL ||
    process.env.URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const url = raw.replace(/\/+$/, '');
  return {
    name: 'site-url',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!url && !ctx.server) {
          console.warn('\n[site-url] SITE_URL is not set – social preview images will use relative URLs, which most platforms ignore.\n');
        }
        return html.replaceAll('%SITE_URL%', url);
      },
    },
  };
}

export default defineConfig({
  // The Netlify plugin runs Functions and a local Netlify Database under `npm run dev`.
  // Edge Functions are off: the app doesn't use them, and their emulator needs Deno.
  plugins: [siteUrl(), netlify({ edgeFunctions: { enabled: false } })],
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
