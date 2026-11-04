import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { advanceClock, sendGroup } from "@/lib/cases";
import { applyBillingEvent, getBilling, type BillingEvent } from "@/lib/billing/events";
import { handleStripeWebhook } from "@/lib/billing/webhook";
import { withFirm, withSystem } from "@/lib/db";
import { handleInbound } from "@/lib/messaging/inbound";
import { caseWhere, ownerOf, outbound, q, resetBoth, type Firms } from "../helpers";

let f: Firms;
let n = 0;
const SECRET = "whsec_test";

beforeEach(async () => {
  f = await resetBoth();
  await withSystem((tx) => tx.query("delete from processed_events"));
});

const evt = (type: string, object: Record<string, unknown> = {}, id = `evt_${++n}`): BillingEvent =>
  ({ id, type, data: { object: { metadata: { firm_id: f.a.firmId }, ...object } } });
const apply = (e: BillingEvent) => withSystem((tx) => applyBillingEvent(tx, e, "simulator"));
const billing = () => withFirm(f.a, getBilling);

function signed(e: BillingEvent) {
  const payload = JSON.stringify({ object: "event", ...e });
  return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}

describe("stripe webhook", () => {
  it("accepts a correctly signed event", async () => {
    const { payload, header } = signed(evt("invoice.payment_failed"));
    expect(await handleStripeWebhook(payload, header, SECRET)).toMatchObject({ applied: true });
    expect((await billing()).status).toBe("past_due");
  });

  it("rejects a bad signature and changes nothing", async () => {
    const { payload } = signed(evt("invoice.payment_failed"));
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    await expect(handleStripeWebhook(payload, header, SECRET)).rejects.toThrow();
    expect((await billing()).status).toBe("trialing");
  });

  it("rejects a tampered body", async () => {
    const { payload, header } = signed(evt("invoice.paid"));
    await expect(handleStripeWebhook(payload.replace("invoice.paid", "invoice.payment_failed"), header, SECRET)).rejects.toThrow();
  });

  it("idempotency: the same event id applies once", async () => {
    const e = evt("invoice.payment_failed");
    const { payload, header } = signed(e);
    expect(await handleStripeWebhook(payload, header, SECRET)).toMatchObject({ duplicate: false, applied: true });
    const first = await billing();
    await advanceClock(f.a, 24);
    expect(await handleStripeWebhook(payload, header, SECRET)).toMatchObject({ duplicate: true, applied: false });
    const second = await billing();
    expect(second.grace_ends_at).toEqual(first.grace_ends_at);
    expect((await q(f.a, "select count(*)::int as n from audit_log where action = 'billing.event' and detail->>'event_id' = $1", [e.id]))[0].n).toBe(1);
  });

  it("a replayed failure can't undo a later recovery", async () => {
    const failed = evt("invoice.payment_failed");
    await apply(failed);
    await apply(evt("invoice.paid"));
    await apply(failed);
    expect((await billing()).status).toBe("active");
  });

  it("a failed handler doesn't burn the event id, so Stripe's retry still works", async () => {
    const e = evt("customer.subscription.updated", { status: "active", trial_end: "not-a-number" });
    await expect(apply(e)).rejects.toThrow();
    e.data.object.trial_end = null;
    expect(await apply(e)).toMatchObject({ applied: true });
  });

  it("skips events for other apps sharing the sandbox", async () => {
    const e: BillingEvent = { id: "evt_other", type: "invoice.paid", data: { object: { customer: "cus_unknown" } } };
    expect(await apply(e)).toEqual({ duplicate: false, applied: false });
  });

  it("finds the firm by customer id when there is no metadata", async () => {
    await withSystem((tx) => tx.query("update subscriptions set stripe_customer_id = 'cus_x' where firm_id = $1", [f.a.firmId]));
    await apply({ id: "evt_c", type: "invoice.payment_failed", data: { object: { customer: "cus_x" } } });
    expect((await billing()).status).toBe("past_due");
  });
});

describe("billing lifecycle", () => {
  it("trial ending raises a notice", async () => {
    await apply(evt("customer.subscription.trial_will_end"));
    expect((await billing()).trial_ending_notice).toBe(true);
  });

  it("a failed payment starts past_due with a grace period, and work continues", async () => {
    await apply(evt("invoice.payment_failed"));
    const b = await billing();
    expect(b.effective).toBe("past_due");
    expect(b.grace_ends_at).not.toBeNull();
    expect((await sendGroup(f.a, "dismissed")).advanced).toBe(5);
  });

  it("when grace runs out, the firm goes read-only by itself", async () => {
    await apply(evt("invoice.payment_failed"));
    await advanceClock(f.a, 24 * 8);
    expect((await billing()).effective).toBe("read_only");
    await expect(sendGroup(f.a, "possession")).rejects.toMatchObject({ code: "DL003" });
  });

  it("unpaid goes read-only straight away", async () => {
    await apply(evt("customer.subscription.updated", { status: "unpaid" }));
    expect((await billing()).effective).toBe("read_only");
  });

  it("recovery on payment clears it all", async () => {
    await apply(evt("invoice.payment_failed"));
    await advanceClock(f.a, 24 * 8);
    await apply(evt("invoice.paid"));
    const b = await billing();
    expect(b).toMatchObject({ effective: "active", grace_ends_at: null });
    expect((await sendGroup(f.a, "dismissed")).advanced).toBe(5);
  });

  it("the $0 trial invoice doesn't end the trial", async () => {
    await apply(evt("invoice.paid"));
    expect((await billing()).status).toBe("trialing");
  });

  it("STOP still works in read-only mode, and STAY explains itself", async () => {
    await apply(evt("customer.subscription.updated", { status: "unpaid" }));
    const [c] = await caseWhere(f.a, "stage = 'writ_filed'");
    const o = await ownerOf(f.a, c);
    expect(await handleInbound(f.a.firmId, o.phone, "STAY")).toBe("read_only");
    expect((await outbound(f.a, o.id)).at(-1)!.body).toContain("(919) 555-0100");
    expect(await handleInbound(f.a.firmId, o.phone, "STOP")).toBe("opted_out");
    expect((await outbound(f.a, o.id)).at(-1)).toMatchObject({ status: "sent" });
  });
});
