// Applies db/migrations/*.sql in filename order, each once, each in its own transaction.
// Usage: DATABASE_URL=... npm run db:migrate   (or: node scripts/with-env.mjs .env.vercel npm run db:migrate)
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";

export async function migrate(url: string, log = console.log) {
  const local = /localhost|127\.0\.0\.1|\/tmp/.test(url);
  const c = new Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("set client_min_messages = warning");
    await c.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await c.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(name)) continue;
      await c.query("begin");
      try {
        await c.query(readFileSync(new URL(name, dir), "utf8"));
        await c.query("insert into schema_migrations (name) values ($1)", [name]);
        await c.query("commit");
        log(`applied ${name}`);
      } catch (e) {
        await c.query("rollback");
        throw new Error(`${name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  await migrate(url);
  console.log("migrations up to date");
}
