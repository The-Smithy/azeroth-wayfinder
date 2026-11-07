// Shared helpers for the data/asset scripts.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SOURCE = 'https://wowforever.gg';
export const ATLAS_URL = `${SOURCE}/de/atlas/data/atlas.json`;
export const ASSETS = `${SOURCE}/de/atlas/assets`;
export const CATALOG_URL = `${ASSETS}/terrain/catalog.json`;
/** The Atlas' Forever routing survey (flight paths, boat & zeppelin stops). */
export const ROUTING_URL = `${SOURCE}/de/atlas/shared/mapwise-routing-data/catalog.json`;
export const UA = 'wayfinder-asset-fetcher/0.1 (+https://github.com/the-smithy/azeroth-maptap)';

export async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

/** Download a URL to disk (cached), retrying transient failures. Returns the local path. */
export async function download(url, dest, { force = false, attempts = 4 } = {}) {
  if (!force && await exists(dest)) return dest;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      return dest;
    } catch (err) {
      lastError = err;
      await new Promise(r => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Run async jobs with a concurrency limit. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
