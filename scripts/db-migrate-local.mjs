#!/usr/bin/env node
// Apply netlify/database/migrations to the LOCAL database that `npm run dev` starts
// (Netlify applies them automatically on deploys, but not locally).
// Start `npm run dev` first, then: npm run db:migrate
import { readFile } from 'node:fs/promises';
import { applyMigrations } from '@netlify/database-dev';
import pg from 'pg';

const state = JSON.parse(await readFile('.netlify/state.json', 'utf8').catch(() => '{}'));
const url = state.dbConnectionString;
if (!url || !/@(localhost|127\.0\.0\.1):/.test(url)) {
  console.error('[db:migrate] No local database found – start `npm run dev` first.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
const executor = {
  exec: sql => client.query(sql),
  query: (sql, params) => client.query(sql, params),
  async transaction(fn) {
    await client.query('BEGIN');
    try { const r = await fn(executor); await client.query('COMMIT'); return r; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
  },
};
const applied = await applyMigrations(executor, 'netlify/database/migrations');
console.log(applied.length ? `[db:migrate] Applied: ${applied.join(', ')}` : '[db:migrate] Already up to date.');
await client.end();
