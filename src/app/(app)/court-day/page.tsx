import { TeamBoard } from "@/components/TeamBoard";
import { getBilling } from "@/lib/billing/events";
import { getBoard } from "@/lib/board";
import { withFirm } from "@/lib/db";
import { loadFirm } from "@/lib/messaging/outbox";
import { ctxOf, requireSession } from "@/lib/session";

export default async function CourtDayPage() {
  const s = await requireSession();
  const { board, firm, billing } = await withFirm(ctxOf(s), async (tx) => ({
    board: await getBoard(tx), firm: await loadFirm(tx), billing: await getBilling(tx),
  }));
  const readOnly = billing.effective === "read_only" || billing.effective === "canceled";
  return <TeamBoard board={board} now={firm.demo_now} timezone={firm.timezone} readOnly={readOnly} />;
}
