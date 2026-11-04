import { AppHeader } from "@/components/AppHeader";
import { BillingBanner } from "@/components/BillingBanner";
import { ClockBar } from "@/components/ClockBar";
import { ctxOf, requireSession } from "@/lib/session";
import { getShell } from "@/lib/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const { firm, billing, reminderCount, queued } = await getShell(ctxOf(s));
  return (
    <>
      <AppHeader firmName={firm.name} userName={s.name} role={s.role} reminderCount={reminderCount} />
      <ClockBar now={firm.demo_now} timezone={firm.timezone} queued={queued} />
      <BillingBanner billing={billing} timezone={firm.timezone} isAdmin={s.role === "admin"} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">{children}</main>
    </>
  );
}
