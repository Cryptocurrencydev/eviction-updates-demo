// Rebuilds the test database from the migrations before the suite runs.
import { Client } from "pg";
import { migrate } from "../scripts/migrate";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/dl_test";

export default async function setup() {
  const c = new Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("set client_min_messages = warning");
  await c.query("drop schema public cascade; create schema public;");
  await c.end();
  await migrate(TEST_DB, () => {});
}
