import Link from "next/link";
import { VerifyButton } from "@/components/VerifyButton";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { queryAudit } from "@/lib/audit-query";
import { withFirm } from "@/lib/db";
import { shortDateTime } from "@/lib/format";
import { loadFirm } from "@/lib/messaging/outbox";
import { ctxOf, requireSession } from "@/lib/session";

const summarise = (d: Record<string, unknown>) =>
  Object.entries(d).filter(([k]) => !["consent_text", "send_after"].includes(k) && d[k] != null).map(([k, v]) => `${k}: ${v}`).join(", ");

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const filter = { action: sp.action ?? "", q: sp.q ?? "" };
  const { rows, firm } = await withFirm(ctxOf(s), async (tx) => ({ rows: await queryAudit(tx, filter, 200), firm: await loadFirm(tx) }));
  const exportUrl = `/api/audit/export?${new URLSearchParams(filter)}`;
  return (
    <>
      <h1 className="font-serif text-2xl text-plum-900">Audit log</h1>
      <p className="mb-4 text-sm text-muted">Append-only. Postgres refuses updates and deletes, and each row's hash chains to the one before it.</p>
      <div className="mb-4 space-y-3">
        <VerifyButton />
        <form className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="action">Action</label>
            <select id="action" name="action" defaultValue={filter.action} className="input">
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q">Search</label>
            <input id="q" name="q" defaultValue={filter.q} placeholder="Owner, case or actor" className="input" />
          </div>
          <button className="btn btn-ghost">Filter</button>
          <a className="btn btn-ghost" data-testid="audit-export" href={exportUrl}>Export CSV</a>
        </form>
      </div>
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-muted">No entries match. <Link href="/audit" className="underline">Clear filters</Link></div>
      ) : (
        <div className="card overflow-x-auto">
          <table data-testid="audit-table" className="w-full min-w-[760px] text-sm">
            <thead className="bg-plum-50 text-left text-xs text-muted">
              <tr><th className="px-3 py-2">#</th><th className="px-2 py-2">When</th><th className="px-2 py-2">Who</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Detail</th><th className="px-3 py-2">Hash</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.seq}>
                  <td className="px-3 py-1.5 text-muted">{r.seq}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{shortDateTime(r.at, firm.timezone)}</td>
                  <td className="px-2 py-1.5">{r.actor}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium">{r.action}</td>
                  <td className="max-w-[320px] truncate px-2 py-1.5 text-muted" title={summarise(r.detail)}>{summarise(r.detail)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted" title={r.hash}>{r.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 200 && <p className="p-3 text-center text-xs text-muted">Showing the latest 200 rows. Export for the full log.</p>}
        </div>
      )}
    </>
  );
}
