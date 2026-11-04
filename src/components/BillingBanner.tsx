import Link from "next/link";
import type { BillingView } from "@/lib/billing/events";
import { shortDate } from "@/lib/format";

export function BillingBanner({ billing, timezone, isAdmin }: { billing: BillingView; timezone: string; isAdmin: boolean }) {
  const link = isAdmin ? <Link href="/billing" className="font-semibold underline">Open billing</Link> : <span>Ask your Firm Admin to update it.</span>;
  if (billing.effective === "read_only" || billing.effective === "canceled") {
    return (
      <div role="alert" data-testid="billing-banner" className="bg-bad px-4 py-2 text-center text-sm text-white">
        Read-only mode: payment is overdue. Cases stay visible, but advancing and texting are paused. {link}
      </div>
    );
  }
  if (billing.effective === "past_due") {
    return (
      <div role="alert" data-testid="billing-banner" className="bg-warn-tint px-4 py-2 text-center text-sm text-warn">
        Payment failed. Grace period ends {billing.grace_ends_at ? shortDate(billing.grace_ends_at, timezone) : "soon"}, then the account goes read-only. {link}
      </div>
    );
  }
  if (billing.trial_ending_notice) {
    return (
      <div data-testid="billing-banner" className="bg-plum-50 px-4 py-2 text-center text-sm text-plum-900">
        Your free trial ends soon{billing.trial_ends_at ? ` (${shortDate(billing.trial_ends_at, timezone)})` : ""}. {link}
      </div>
    );
  }
  return null;
}
