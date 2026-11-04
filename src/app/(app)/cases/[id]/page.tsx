import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseActions } from "@/components/CaseActions";
import { getBilling } from "@/lib/billing/events";
import { transitions } from "@/lib/case-actions";
import { withFirm } from "@/lib/db";
import { CONSENT_LABEL, shortDate, shortDateTime } from "@/lib/format";
import { loadFirm } from "@/lib/messaging/outbox";
import { ctxOf, requireSession } from "@/lib/session";

const UUID = /^[0-9a-f-]{36}$/;

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const s = await requireSession();
  const d = await withFirm(ctxOf(s), async (tx) => {
    const { rows } = await tx.query(
      `select c.*, o.name as owner_name, o.phone, o.consent, o.timezone as owner_tz, st.name as stage_name, st.display_no, p.name as pending_name
       from cases c join owners o on o.id = c.owner_id join stages st on st.code = c.stage left join stages p on p.code = c.pending_stage
       where c.id = $1`, [id],
    );
    if (!rows[0]) return null;
    return {
      c: rows[0], firm: await loadFirm(tx), billing: await getBilling(tx), moves: await transitions(tx),
      decision: (await tx.query("select * from decisions where case_id = $1", [id])).rows[0],
      history: (await tx.query("select seq, at, actor, action, detail from audit_log where case_id = $1 order by seq desc limit 40", [id])).rows,
    };
  });
  if (!d) notFound();
  const { c, firm, decision } = d;
  const tz = firm.timezone;
  const actions = d.moves
    .filter((m) => m.from_stage === c.stage && (c.stage !== "appeal_filed" || m.to_stage === c.paused_from))
    .map((m) => ({ to: m.to_stage, label: m.label }));
  const facts: [string, string][] = [
    ["County", c.county], ["Filed", shortDate(c.filing_date, "UTC")], ["Resident", c.resident_name],
    ["Owner", `${c.owner_name}, ${c.phone}`], ["Owner texts", CONSENT_LABEL[c.consent]], ["Owner time zone", c.owner_tz],
  ];
  if (c.court_at) facts.push(["Court", shortDateTime(c.court_at, tz)]);
  if (c.reply_deadline) facts.push(["Reply by", shortDateTime(c.reply_deadline, tz)]);
  if (c.lockout_at) facts.push(["Lockout", shortDateTime(c.lockout_at, tz)]);
  if (c.keys_held_until) facts.push(["Keys held until", shortDate(c.keys_held_until, tz)]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <div>
          <Link href="/cases" className="text-sm text-plum-800 underline">Back to cases</Link>
          <h1 className="mt-1 font-serif text-2xl text-plum-900">{c.address}</h1>
          <p className="text-sm text-muted">{c.case_number}</p>
        </div>
        <dl className="card grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k}><dt className="text-xs font-semibold text-muted">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <section className="card p-4">
          <h2 className="font-serif text-plum-900">History</h2>
          {d.history.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Seeded before this demo session. New activity appears here.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {d.history.map((h) => (
                <li key={h.seq} className="flex flex-wrap justify-between gap-x-3">
                  <span>{h.action}{h.detail.to ? ` to ${h.detail.to}` : ""} <span className="text-muted">by {h.actor}</span></span>
                  <span className="text-xs text-muted">{shortDateTime(h.at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <aside className="space-y-4">
        <section className="card p-4">
          <p className="text-xs font-semibold text-muted">Stage</p>
          <p data-testid="case-stage" className="font-serif text-lg text-plum-900">{c.display_no} {c.stage_name}</p>
          {c.pending_name && <p className="mt-1 text-sm text-warn">Recorded, not sent yet: {c.pending_name}</p>}
          {c.stage === "writ_filed" && <p className="mt-1 text-sm text-muted">Only the owner's reply moves this case forward.</p>}
          {c.closed_at && <p className="mt-1 text-sm text-muted">This case is closed.</p>}
          {actions.length > 0 && !c.pending_stage && (
            <div className="mt-3 border-t border-line pt-3">
              <CaseActions caseIds={[c.id]} stage={c.stage} actions={actions} now={firm.demo_now} timezone={tz}
                disabled={d.billing.effective === "read_only" || d.billing.effective === "canceled"} />
            </div>
          )}
        </section>
        {decision && (
          <section data-testid="decision-record" className="card p-4 text-sm">
            <h2 className="font-serif text-plum-900">Owner decision</h2>
            <p className="mt-1 font-semibold">{decision.choice}</p>
            <p className="text-muted">By {decision.decided_by}, by {decision.channel === "sms" ? "text reply" : "one-click link"}, {shortDateTime(decision.decided_at, tz)}</p>
          </section>
        )}
        <p className="demo-note">Timings shown are demo values, to be confirmed against the client's scope sheet.</p>
      </aside>
    </div>
  );
}
