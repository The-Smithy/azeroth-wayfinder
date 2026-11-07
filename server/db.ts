import { getDatabase } from '@netlify/database';

export interface QueryResult<T> { rows: T[]; rowCount: number | null; }
/** The slice of pg's API we use – satisfied by a Pool and by a checked-out client. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}
interface PoolLike extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

let pool: PoolLike | null = null;

/** Lazily connect to Netlify Database (or a test pool). */
export function db(): PoolLike {
  pool ??= getDatabase().pool as unknown as PoolLike;
  return pool;
}

/** Tests inject a pg.Pool pointing at a local Postgres. */
export function useTestPool(p: PoolLike | null) { pool = p; }

/** Run fn inside a transaction on a single connection. */
export async function tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
