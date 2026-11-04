import Papa from "papaparse";
import { firmRoute } from "@/lib/api";
import { queryAudit } from "@/lib/audit-query";
import { withFirm } from "@/lib/db";

export const GET = firmRoute(async (ctx, _s, req) => {
  const p = new URL(req.url).searchParams;
  const rows = await withFirm(ctx, (tx) => queryAudit(tx, { action: p.get("action") ?? "", q: p.get("q") ?? "" }, 50_000));
  const csv = Papa.unparse(rows.map((r) => ({
    seq: r.seq, at: r.at.toISOString(), actor: r.actor, action: r.action, case_id: r.case_id ?? "",
    detail: JSON.stringify(r.detail), prev_hash: r.prev_hash, hash: r.hash,
  })));
  return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="docketlight-audit-log.csv"' } });
});
