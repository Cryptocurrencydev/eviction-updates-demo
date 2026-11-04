import { UploadFlow } from "@/components/UploadFlow";
import { CSV_COLUMNS } from "@/lib/csv";
import { getBilling } from "@/lib/billing/events";
import { withFirm } from "@/lib/db";
import { ctxOf, requireSession } from "@/lib/session";

export default async function UploadPage() {
  const s = await requireSession();
  const billing = await withFirm(ctxOf(s), getBilling);
  return (
    <>
      <h1 className="font-serif text-2xl text-plum-900">Upload new filings</h1>
      <p className="mb-4 text-sm text-muted">Columns: {CSV_COLUMNS.join(", ")}. You'll see a preview first, and only valid rows are added.</p>
      <UploadFlow readOnly={billing.effective === "read_only" || billing.effective === "canceled"} />
    </>
  );
}
