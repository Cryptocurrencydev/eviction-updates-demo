import { randomUUID } from "node:crypto";
import { firmRoute } from "@/lib/api";
import { applyBillingEvent, type BillingEvent } from "@/lib/billing/events";
import { withSystem } from "@/lib/db";

const SCENARIOS: Record<string, { type: string; object?: Record<string, unknown> }> = {
  trial_ending: { type: "customer.subscription.trial_will_end" },
  payment_failed: { type: "invoice.payment_failed" },
  grace_over: { type: "customer.subscription.updated", object: { status: "unpaid" } },
  recovered: { type: "invoice.paid" },
};

/** Builds the event Stripe would send and passes it through the same handler. */
export const POST = firmRoute(async (ctx, _s, req) => {
  const { scenario } = await req.json();
  const s = SCENARIOS[scenario];
  if (!s) throw Object.assign(new Error("Unknown scenario."), { code: "DL404" });
  const event: BillingEvent = {
    id: `sim_${randomUUID()}`, type: s.type,
    data: { object: { metadata: { firm_id: ctx.firmId }, ...s.object } },
  };
  return withSystem((tx) => applyBillingEvent(tx, event, "simulator"));
}, { admin: true });
