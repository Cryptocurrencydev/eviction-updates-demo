import "server-only";
import { Pool, type PoolClient } from "pg";

export type Role = "admin" | "team" | "owner" | "system";
export type FirmCtx = { firmId: string; role: Role; actor: string };
export type Tx = PoolClient;

let pool: Pool | undefined;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /localhost|127\.0\.0\.1|\/tmp/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: local ? undefined : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return pool;
}

async function inTx<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    await setup(c);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Every firm request runs here: as app_user, with RLS keyed on this firm. */
export function withFirm<T>(ctx: FirmCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTx(async (c) => {
    await c.query("set local role app_user");
    await c.query("select set_config('app.firm_id', $1, true), set_config('app.role', $2, true)", [ctx.firmId, ctx.role]);
  }, fn);
}

/** Table-owner connection, outside RLS. Only for lookups before a firm is known, webhooks and the demo reset. */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTx(async () => {}, fn);
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}
