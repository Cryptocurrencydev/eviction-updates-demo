import { firmRoute } from "@/lib/api";
import { sampleCsv } from "@/lib/csv";
import { withFirm } from "@/lib/db";
import { loadFirm } from "@/lib/messaging/outbox";

export const GET = firmRoute(async (ctx) => {
  const csv = await withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const { rows } = await tx.query("select count(*)::int as n from cases");
    return sampleCsv(firm, 2000 + rows[0].n * 30);
  });
  return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="docketlight-sample-filings.csv"' } });
});
