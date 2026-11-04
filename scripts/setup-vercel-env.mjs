// Pushes app env to Vercel and registers the Stripe webhook. Values never reach stdout.
// Usage: node scripts/setup-vercel-env.mjs <site-url> <path-to-env-with-stripe-key>
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import Stripe from "stripe";

const [site, envFile] = process.argv.slice(2);
if (!site || !envFile) throw new Error("usage: setup-vercel-env.mjs <site-url> <env-file>");
const key = config({ path: envFile, processEnv: {}, quiet: true }).parsed?.STRIPE_SECRET_KEY;
if (!key?.startsWith("sk_test_")) throw new Error("expected a Stripe test key");

function setEnv(name, value, envs = ["production", "preview"]) {
  for (const e of envs) {
    spawnSync("vercel", ["env", "rm", name, e, "--yes"], { stdio: "ignore" });
    const r = spawnSync("vercel", ["env", "add", name, e], { input: value, stdio: ["pipe", "ignore", "pipe"] });
    console.log(`${name} -> ${e}: ${r.status === 0 ? "ok" : r.stderr.toString().slice(0, 200)}`);
  }
}

const stripe = new Stripe(key);
const url = `${site}/api/stripe/webhook`;
for (const w of (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((w) => w.url === url)) {
  await stripe.webhookEndpoints.del(w.id);
}
const hook = await stripe.webhookEndpoints.create({
  url,
  description: "Docketlight demo (eviction-updates-demo)",
  enabled_events: [
    "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted", "customer.subscription.trial_will_end", "invoice.paid", "invoice.payment_failed",
  ],
});
console.log("webhook endpoint", hook.id);

setEnv("STRIPE_SECRET_KEY", key);
setEnv("STRIPE_WEBHOOK_SECRET", hook.secret);
setEnv("APP_SECRET", randomBytes(32).toString("hex"));
setEnv("APP_URL", site, ["production"]);
