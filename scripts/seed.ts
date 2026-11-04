// Seeds both demo firms. Usage: DATABASE_URL=... APP_URL=... npm run db:seed
import { closePool, withSystem } from "../src/lib/db";
import { DEMO_FIRMS, resetFirm } from "../src/lib/seed";

for (const f of DEMO_FIRMS) {
  await withSystem((tx) => resetFirm(tx, f.slug, "system:seed"));
  console.log(`seeded ${f.name}`);
}
await closePool();
