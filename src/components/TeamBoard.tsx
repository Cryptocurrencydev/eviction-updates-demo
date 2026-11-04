"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Board, BoardCase } from "@/lib/board";
import { shortDate, shortDateTime } from "@/lib/format";
import { isWithinSendWindow } from "@/lib/messaging/quiet-hours";
import { notifyChanged, post } from "./client-api";
import { PhoneFrame, usePhone } from "./Phone";

type Tone = "good" | "bad" | "warn" | "plain";
const TONES: Record<Tone, { card: string; badge: string; title: string }> = {
  good: { card: "bg-good-tint border-good-line", badge: "bg-good text-white", title: "text-good" },
  bad: { card: "bg-bad-tint border-bad-line", badge: "bg-bad text-white", title: "text-bad" },
  warn: { card: "bg-warn-tint border-warn-line", badge: "bg-warn text-white", title: "text-warn" },
  plain: { card: "bg-plum-50 border-line", badge: "bg-plum-800 text-white", title: "text-plum-900" },
};

type Summary = { advanced: number; sending: number; quiet_hours: number; waiting_opt_in: number; opted_out: number };

function summaryText(s: Summary) {
  const parts = [`${s.sending} sent`];
  if (s.quiet_hours) parts.push(`${s.quiet_hours} waiting for quiet hours`);
  if (s.waiting_opt_in) parts.push(`${s.waiting_opt_in} held for opt-in`);
  if (s.opted_out) parts.push(`${s.opted_out} not sent, opted out`);
  return parts.join(", ");
}

const owners = (cases: BoardCase[]) => new Set(cases.map((c) => c.owner_id)).size;
const plural = (n: number) => `${n} owner${n === 1 ? "" : "s"}`;
const sendLabel = (n: number) => (n === 1 ? "Send text to this 1 owner" : `Send texts to these ${n} owners`);

function Rows({ cases, render }: { cases: BoardCase[]; render: (c: BoardCase) => React.ReactNode }) {
  return (
    <ul className="mt-2 divide-y divide-black/5 text-sm">
      {cases.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
          <Link href={`/cases/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.address}</Link>
          <span className="text-xs text-muted">{render(c)}</span>
        </li>
      ))}
    </ul>
  );
}

function SendCard({
  id, title, tone, cases, now, readOnly, children, dates,
}: {
  id: string; title: string; tone: Tone; cases: BoardCase[]; now: Date; readOnly: boolean;
  children?: React.ReactNode; dates?: Record<string, string>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const t = TONES[tone];
  const n = owners(cases);
  const quiet = cases.filter((c) => c.consent === "opted_in" && !isWithinSendWindow(new Date(now), c.owner_timezone)).length;
  const notOptedIn = cases.filter((c) => c.consent === "pending" || c.consent === "none").length;
  const optedOut = cases.filter((c) => c.consent === "opted_out").length;

  async function confirm() {
    setBusy(true); setError("");
    try {
      const s = await post<Summary>("/api/court-day/send", { group: id, dates });
      dialog.current?.close();
      setResult(summaryText(s));
      const show = cases.find((c) => c.consent === "opted_in" && isWithinSendWindow(new Date(now), c.owner_timezone)) ?? cases[0];
      notifyChanged(show?.owner_id);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <article data-testid={`card-${id}`} className={`rounded-xl border p-4 ${t.card}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className={`font-serif text-lg leading-tight ${t.title}`}>{title}</h3>
        <span data-testid={`badge-${id}`} className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${t.badge}`}>{cases.length}</span>
      </div>
      {cases.length > 0 ? (
        <button data-testid={`send-${id}`} disabled={readOnly} onClick={() => dialog.current?.showModal()} className="btn btn-action mt-3 w-full">
          {sendLabel(n)}
        </button>
      ) : (
        <p className="mt-2 text-sm text-muted">{result ? "" : "Nothing waiting to send."}</p>
      )}
      {result && <p role="status" data-testid={`result-${id}`} className="mt-2 text-sm font-semibold">Done: {result}.</p>}
      {children}

      <dialog ref={dialog} aria-label={`Confirm ${title}`} className="m-auto w-[min(92vw,30rem)] rounded-xl p-0 shadow-xl">
        <div className="p-5">
          <h4 className="font-serif text-xl text-plum-900">{sendLabel(n)}?</h4>
          <p className="mt-1 text-sm text-muted">Each case moves to "{title}" and its owner gets the stage text. This can't be undone.</p>
          <ul className="mt-3 max-h-48 overflow-y-auto rounded-md bg-plum-50 p-2 text-sm">
            {cases.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 py-0.5">
                <span>{c.address}</span><span className="whitespace-nowrap text-muted">{c.owner_name}</span>
              </li>
            ))}
          </ul>
          {(quiet > 0 || notOptedIn > 0 || optedOut > 0) && (
            <ul className="mt-3 space-y-1 text-sm text-warn">
              {quiet > 0 && <li>{plural(quiet)} in quiet hours: their text waits for 8:00 AM their time.</li>}
              {notOptedIn > 0 && <li>{plural(notOptedIn)} not opted in yet: the text is held until they reply YES.</li>}
              {optedOut > 0 && <li>{plural(optedOut)} opted out: no text will go. The case still advances.</li>}
            </ul>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
            <button data-testid={`confirm-${id}`} className="btn btn-action" disabled={busy} onClick={confirm}>{busy ? "Sending…" : "Confirm and send"}</button>
          </div>
        </div>
      </dialog>
    </article>
  );
}

function PendingCard({ id, title, tone, count, note, children }: { id: string; title: string; tone: Tone; count: number; note: string; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <article data-testid={`card-${id}`} className={`rounded-xl border p-4 ${t.card}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className={`font-serif text-lg leading-tight ${t.title}`}>{title}</h3>
        <span data-testid={`badge-${id}`} className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${t.badge}`}>{count}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{note}</p>
      {children}
    </article>
  );
}

export function TeamBoard({ board, now, timezone, readOnly }: { board: Board; now: Date; timezone: string; readOnly: boolean }) {
  const router = useRouter();
  const phone = usePhone(() => router.refresh());
  const [dates, setDates] = useState<Record<string, string>>({});
  const clockNow = new Date(now);

  useEffect(() => { setDates({}); }, [board.continued.length]);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <div data-testid="court-banner" className="rounded-xl bg-plum-800 px-5 py-4 text-white">
          {board.dueCount > 0 ? (
            <p className="text-lg leading-snug">
              <strong>Reminder:</strong> Today is court day. {board.dueCount} case{board.dueCount === 1 ? " is" : "s are"} due an update. Click each group to send the owner texts.
            </p>
          ) : (
            <p className="text-lg leading-snug">All caught up. No court results are waiting to go out.</p>
          )}
        </div>
        {readOnly && <p className="rounded-lg bg-bad-tint px-4 py-2 text-sm text-bad">Sending is paused while the account is read-only.</p>}

        <div className="grid gap-3 md:grid-cols-2">
          <SendCard id="dismissed" title="Dismissed and paid" tone="good" cases={board.dismissed} now={clockNow} readOnly={readOnly} />
          <SendCard id="possession" title="Possession won" tone="bad" cases={board.possession} now={clockNow} readOnly={readOnly}>
            {board.readyForWrit.length > 0 && (
              <div className="mt-3 border-t border-black/10 pt-2">
                <p className="text-xs font-semibold text-muted">Ready for the writ step ({board.readyForWrit.length})</p>
                <Rows cases={board.readyForWrit} render={(c) => (c.possession_at ? `won ${shortDate(c.possession_at, timezone)}` : "")} />
              </div>
            )}
          </SendCard>
          <SendCard id="continued" title="Continued at court" tone="warn" cases={board.continued} now={clockNow} readOnly={readOnly} dates={dates}>
            {board.continued.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-black/10 pt-2">
                <p className="text-xs text-muted">Enter a new court date if you have one. Leave it blank to send "date pending".</p>
                {board.continued.map((c) => (
                  <label key={c.id} className="block text-sm">
                    <span className="font-medium">{c.address}</span>
                    <input type="datetime-local" data-testid={`new-date-${c.case_number}`} className="input mt-0.5" value={dates[c.id] ?? ""}
                      onChange={(e) => setDates((d) => ({ ...d, [c.id]: e.target.value }))} />
                  </label>
                ))}
              </div>
            )}
            {board.awaitingDate.length > 0 && (
              <div className="mt-3 border-t border-black/10 pt-2">
                <p className="text-xs font-semibold text-muted">Waiting on a new date ({board.awaitingDate.length})</p>
                <Rows cases={board.awaitingDate} render={() => "enter it on the case"} />
              </div>
            )}
          </SendCard>
          <SendCard id="appeal" title="Appeal filed" tone="plain" cases={board.appeal} now={clockNow} readOnly={readOnly}>
            {board.paused.length > 0 && (
              <div className="mt-3 border-t border-black/10 pt-2">
                <p className="text-xs font-semibold text-muted">Paused until the team resumes ({board.paused.length})</p>
                <Rows cases={board.paused} render={() => "open the case to resume"} />
              </div>
            )}
          </SendCard>
          <PendingCard id="writ" title="Writ filed, waiting on owner" tone="bad" count={board.writWaiting.length}
            note={board.writWaiting.length ? "Waiting for each owner to reply STAY or LOCKOUT." : "No owners are being waited on."}>
            <Rows cases={board.writWaiting} render={(c) => {
              if (!c.reply_deadline) return "";
              const late = new Date(c.reply_deadline) <= clockNow;
              return <span className={late ? "font-semibold text-bad" : ""}>{late ? "No reply, deadline passed " : "reply by "}{shortDate(c.reply_deadline, timezone)}</span>;
            }} />
          </PendingCard>
          <PendingCard id="lockout" title="Lockout scheduled" tone="bad" count={board.lockoutScheduled.length}
            note={board.lockoutScheduled.length ? "Pending the sheriff's date. Open a case to mark the lockout done." : "No lockouts are scheduled."}>
            <Rows cases={board.lockoutScheduled} render={(c) => (c.lockout_at ? shortDateTime(c.lockout_at, timezone) : "")} />
          </PendingCard>
          <SendCard id="lockout_complete" title="Lockout complete, keys held 7 days" tone="bad" cases={board.lockoutComplete} now={clockNow} readOnly={readOnly}>
            {board.keysHeld.length > 0 && (
              <div className="mt-3 border-t border-black/10 pt-2">
                <p className="text-xs font-semibold text-muted">Keys being held ({board.keysHeld.length})</p>
                <Rows cases={board.keysHeld} render={(c) => (c.keys_held_until ? `until ${shortDate(c.keys_held_until, timezone)}` : "")} />
              </div>
            )}
          </SendCard>
        </div>

        <p data-testid="flow-note" className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
          <strong>How to read the flow:</strong> Dismissed, Possession won, and Continued are different court day results, not steps in a row. A paid case ends at Dismissed.
        </p>
      </div>

      <div className="lg:sticky lg:top-3"><PhoneFrame phone={phone} compact /></div>
    </div>
  );
}

