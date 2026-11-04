import Link from "next/link";
import { withFirm } from "@/lib/db";
import { shortDate, shortDateTime } from "@/lib/format";
import { loadFirm } from "@/lib/messaging/outbox";
import { APPEAL_WINDOW_DAYS, DECISION_STALE_HOURS, getReminders, type Reminder } from "@/lib/reminders";
import { ctxOf, requireSession } from "@/lib/session";

const SECTIONS: { kind: Reminder["kind"]; title: string; tone: string; due: string }[] = [
  { kind: "deadline_missed", title: "No reply by the deadline", tone: "text-bad", due: "Deadline was" },
  { kind: "decision_stale", title: `Decisions pending over ${DECISION_STALE_HOURS} hours`, tone: "text-warn", due: "Writ filed" },
  { kind: "writ_ready", title: "Writs ready to request", tone: "text-plum-900", due: "Appeal window closed" },
  { kind: "appeal_closing", title: "Appeal windows closing", tone: "text-plum-900", due: "Closes" },
  { kind: "hearing", title: "Upcoming hearing dates", tone: "text-plum-900", due: "Court" },
];

export default async function RemindersPage() {
  const s = await requireSession();
  const { reminders, firm } = await withFirm(ctxOf(s), async (tx) => ({ reminders: await getReminders(tx), firm: await loadFirm(tx) }));
  return (
    <>
      <h1 className="font-serif text-2xl text-plum-900">Team reminders</h1>
      <p className="demo-note mb-4">Demo values, to be confirmed against the client's scope sheet: {APPEAL_WINDOW_DAYS}-day appeal window, {DECISION_STALE_HOURS}-hour decision reminder.</p>
      {reminders.length === 0 ? (
        <div className="card p-10 text-center text-muted">Nothing needs attention right now.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {SECTIONS.map((sec) => {
            const items = reminders.filter((r) => r.kind === sec.kind);
            if (items.length === 0) return null;
            return (
              <section key={sec.kind} data-testid={`reminder-${sec.kind}`} className="card p-4">
                <h2 className={`font-serif text-lg ${sec.tone}`}>{sec.title} ({items.length})</h2>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {items.map((r) => (
                    <li key={r.caseId + r.kind} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                      <Link className="font-medium underline-offset-2 hover:underline" href={`/cases/${r.caseId}`}>{r.address}</Link>
                      {r.due && <span className="text-xs text-muted">{sec.due} {sec.kind === "hearing" ? shortDateTime(r.due, firm.timezone) : shortDate(r.due, firm.timezone)}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
