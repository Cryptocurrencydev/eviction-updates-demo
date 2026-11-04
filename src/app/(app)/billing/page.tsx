import { BillingPanel } from "@/components/BillingPanel";
import { getBilling } from "@/lib/billing/events";
import { GRACE_DAYS } from "@/lib/billing/events";
import { PLAN_CENTS, PLAN_NAME, stripeEnabled, TRIAL_DAYS } from "@/lib/billing/stripe";
import { withFirm } from "@/lib/db";
import { shortDate } from "@/lib/format";
import { loadFirm } from "@/lib/messaging/outbox";
import { ctxOf, requireSession } from "@/lib/session";

const STATUS: Record<string, string> = {
  trialing: "Free trial", active: "Active", past_due: "Past due, in grace period", read_only: "Read-only", canceled: "Canceled",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const s = await requireSession();
  if (s.role !== "admin") {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="font-serif text-xl text-plum-900">Firm Admins only</h1>
        <p className="mt-1 text-sm text-muted">Team Members can't view or change billing.</p>
      </div>
    );
  }
  const { billing, firm } = await withFirm(ctxOf(s), async (tx) => ({ billing: await getBilling(tx), firm: await loadFirm(tx) }));
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="font-serif text-2xl text-plum-900">Billing</h1>
      {checkout === "success" && <p role="status" className="rounded-lg bg-good-tint p-3 text-sm text-good">Checkout finished. Stripe's webhook updates this page within a few seconds.</p>}
      {checkout === "cancelled" && <p role="status" className="rounded-lg bg-plum-50 p-3 text-sm">Checkout was cancelled. Nothing changed.</p>}
      <section className="card p-4">
        <p className="text-sm text-muted">{PLAN_NAME}, flat monthly price per firm</p>
        <p className="font-serif text-3xl text-plum-900">${PLAN_CENTS / 100}<span className="font-sans text-base text-muted"> / month</span></p>
        <p data-testid="billing-status" className="mt-2 font-semibold">Status: {STATUS[billing.effective]}</p>
        {billing.effective === "trialing" && billing.trial_ends_at && <p className="text-sm text-muted">Trial ends {shortDate(billing.trial_ends_at, firm.timezone)}</p>}
        {billing.effective === "past_due" && billing.grace_ends_at && <p className="text-sm text-muted">Grace period ends {shortDate(billing.grace_ends_at, firm.timezone)}</p>}
        <p className="demo-note mt-2">Demo values, to be confirmed against the client's scope sheet: ${PLAN_CENTS / 100} a month, {TRIAL_DAYS}-day trial, {GRACE_DAYS}-day grace period.</p>
      </section>
      <BillingPanel stripeReady={stripeEnabled()} hasSubscription={Boolean(billing.stripe_customer_id)} />
    </div>
  );
}
