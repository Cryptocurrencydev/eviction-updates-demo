import Link from "next/link";
import { CasesList, type ListCase, type StageGroup } from "@/components/CasesList";
import { getBilling } from "@/lib/billing/events";
import { transitions } from "@/lib/case-actions";
import { withFirm } from "@/lib/db";
import { loadFirm } from "@/lib/messaging/outbox";
import { ctxOf, requireSession } from "@/lib/session";

export default async function CasesPage() {
  const s = await requireSession();
  const data = await withFirm(ctxOf(s), async (tx) => {
    const firm = await loadFirm(tx);
    const billing = await getBilling(tx);
    const stages = (await tx.query("select code, display_no, name from stages order by sort")).rows;
    const moves = await transitions(tx);
    const cases = (await tx.query<ListCase & { stage: string }>(
      `select c.id, c.case_number, c.county, c.address, c.court_at, c.stage, o.name as owner_name, p.name as pending_name
       from cases c join owners o on o.id = c.owner_id left join stages p on p.code = c.pending_stage
       order by c.case_number`,
    )).rows;
    return { firm, billing, stages, moves, cases };
  });

  const groups: StageGroup[] = data.stages
    .map((st) => ({
      ...st,
      cases: data.cases.filter((c) => c.stage === st.code),
      // Appeal resume depends on each case's own paused stage, so it's done on the case page.
      actions: st.code === "appeal_filed" ? [] : data.moves.filter((m) => m.from_stage === st.code).map((m) => ({ to: m.to_stage, label: m.label })),
    }))
    .filter((g) => g.cases.length > 0);

  return (
    <>
      <h1 className="font-serif text-2xl text-plum-900">Cases by stage</h1>
      <p className="mb-4 text-sm text-muted">Select a group and apply a step. Court results are recorded here, then sent from the Court day screen.</p>
      {groups.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-serif text-lg text-plum-900">No cases yet</p>
          <p className="mt-1 text-sm text-muted">Upload a CSV of new filings to get started.</p>
          <Link href="/upload" className="btn btn-action mt-4">Upload filings</Link>
        </div>
      ) : (
        <CasesList groups={groups} now={data.firm.demo_now} timezone={data.firm.timezone} readOnly={data.billing.effective === "read_only" || data.billing.effective === "canceled"} />
      )}
    </>
  );
}
