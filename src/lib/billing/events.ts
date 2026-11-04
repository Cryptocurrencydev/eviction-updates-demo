import { audit } from "../audit";
import type { Tx } from "../db";

export const GRACE_DAYS = 7;

export type BillingEvent = { id: string; type: string; data: { object: Record<string, any> } };

async function resolveFirm(tx: Tx, obj: Record<string, any>): Promise<string | null> {
  const direct = obj.metadata?.firm_id ?? obj.client_reference_id ?? obj.subscription_details?.metadata?.firm_id ?? obj.parent?.subscription_details?.metadata?.firm_id;
  if (direct) return direct;
  const customer = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  if (!customer) return null;
  const { rows } = await tx.query("select firm_id from subscriptions where stripe_customer_id = $1", [customer]);
  return rows[0]?.firm_id ?? null;
}

const STATUS_MAP: Record<string, string> = {
  trialing: "trialing", active: "active", past_due: "past_due",
  unpaid: "read_only", paused: "read_only", canceled: "canceled", incomplete_expired: "canceled",
};

/**
 * One handler for real Stripe webhooks and the simulator buttons.
 * Runs in a single transaction: if anything fails the event id isn't kept, so a retry works.
 */
export async function applyBillingEvent(tx: Tx, event: BillingEvent, source: "stripe" | "simulator") {
  const firstTime = await tx.query(
    "insert into processed_events (event_id, type, source) values ($1,$2,$3) on conflict do nothing returning event_id",
    [event.id, event.type, source],
  );
  if (!firstTime.rows[0]) return { duplicate: true, applied: false };

  const obj = event.data.object;
  const firmId = await resolveFirm(tx, obj);
  // The sandbox is shared with other demos. Events for other apps are recorded and skipped.
  if (!firmId || !(await tx.query("select 1 from firms where id = $1", [firmId])).rows[0]) {
    return { duplicate: false, applied: false };
  }
  await tx.query("update processed_events set firm_id = $2 where event_id = $1", [event.id, firmId]);

  const set = (sql: string, ...args: unknown[]) =>
    tx.query(`update subscriptions set ${sql}, updated_at = now() where firm_id = $1`, [firmId, ...args]);
  const startGrace = `grace_ends_at = coalesce(grace_ends_at, (select demo_now from firms where id = $1) + interval '${GRACE_DAYS} days')`;

  switch (event.type) {
    case "checkout.session.completed":
      await set("stripe_customer_id = $2, stripe_subscription_id = $3", obj.customer, obj.subscription);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const status = STATUS_MAP[obj.status];
      if (!status) break;
      await set(
        `status = $2, stripe_subscription_id = coalesce($3, stripe_subscription_id),
         trial_ends_at = coalesce($4, trial_ends_at),
         trial_ending_notice = case when $2 = 'trialing' then trial_ending_notice else false end`,
        status, obj.id ?? null, obj.trial_end ? new Date(obj.trial_end * 1000) : null,
      );
      if (status === "past_due") await set(startGrace);
      if (status === "active" || status === "trialing") await set("grace_ends_at = null");
      break;
    }
    case "customer.subscription.deleted":
      await set("status = 'canceled'");
      break;
    case "customer.subscription.trial_will_end":
      await set("trial_ending_notice = true");
      break;
    case "invoice.payment_failed":
      await set(`status = 'past_due', trial_ending_notice = false, ${startGrace}`);
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      await set(`status = case when status in ('past_due', 'read_only') then 'active' else status end,
                 grace_ends_at = case when status in ('past_due', 'read_only') then null else grace_ends_at end`);
      break;
    default:
      return { duplicate: false, applied: false };
  }
  await audit(tx, firmId, `system:${source}`, "billing.event", { event_id: event.id, type: event.type });
  return { duplicate: false, applied: true };
}

export type BillingView = {
  status: string; effective: "trialing" | "active" | "past_due" | "read_only" | "canceled";
  trial_ends_at: Date | null; trial_ending_notice: boolean; grace_ends_at: Date | null; stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export async function getBilling(tx: Tx): Promise<BillingView> {
  const { rows } = await tx.query("select s.*, firm_read_only() as ro from subscriptions s where firm_id = current_firm()");
  const s = rows[0];
  return { ...s, effective: s.ro && s.status === "past_due" ? "read_only" : s.status };
}
