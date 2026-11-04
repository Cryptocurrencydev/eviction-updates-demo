import "server-only";
import Stripe from "stripe";
import { withFirm, type FirmCtx } from "../db";
import { loadFirm } from "../messaging/outbox";
import { appUrl } from "../secret";

export const PLAN_NAME = "Docketlight Firm Plan";
export const PLAN_CENTS = 19900;
export const TRIAL_DAYS = 14;

export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);
const client = () => new Stripe(process.env.STRIPE_SECRET_KEY!);

async function ensureCustomer(ctx: FirmCtx) {
  return withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const { rows } = await tx.query("select stripe_customer_id from subscriptions where firm_id = $1", [firm.id]);
    if (rows[0].stripe_customer_id) return { id: rows[0].stripe_customer_id as string, firm };
    const customer = await client().customers.create({ name: firm.name, metadata: { firm_id: firm.id, app: "docketlight" } });
    await tx.query("update subscriptions set stripe_customer_id = $2 where firm_id = $1", [firm.id, customer.id]);
    return { id: customer.id, firm };
  });
}

export async function createCheckout(ctx: FirmCtx) {
  const { id, firm } = await ensureCustomer(ctx);
  const session = await client().checkout.sessions.create({
    mode: "subscription",
    customer: id,
    client_reference_id: firm.id,
    line_items: [{
      quantity: 1,
      price_data: { currency: "usd", unit_amount: PLAN_CENTS, recurring: { interval: "month" }, product_data: { name: PLAN_NAME } },
    }],
    subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { firm_id: firm.id, app: "docketlight" } },
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/billing?checkout=cancelled`,
  });
  return session.url!;
}

export async function createPortal(ctx: FirmCtx) {
  const { id } = await ensureCustomer(ctx);
  const session = await client().billingPortal.sessions.create({ customer: id, return_url: `${appUrl()}/billing` });
  return session.url;
}
