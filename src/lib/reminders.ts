import type { Tx } from "./db";
import { loadFirm } from "./messaging/outbox";

/** Demo values, to be confirmed against the client's scope sheet. */
export const APPEAL_WINDOW_DAYS = 10;
export const DECISION_STALE_HOURS = 48;
export const HEARING_LOOKAHEAD_DAYS = 7;

export type Reminder = {
  kind: "hearing" | "appeal_closing" | "writ_ready" | "decision_stale" | "deadline_missed";
  caseId: string; caseNumber: string; address: string; due: Date | null;
};

export async function getReminders(tx: Tx): Promise<Reminder[]> {
  const { demo_now: now } = await loadFirm(tx);
  const { rows } = await tx.query(
    `select kind, id, case_number, address, due from (
       select 'hearing' as kind, id, case_number, address, court_at as due from cases
         where stage in ('court_date_set', 'continued_new_date') and court_at between $1 and $1 + make_interval(days => $2)
       union all
       select 'appeal_closing', id, case_number, address, possession_at + make_interval(days => $3) from cases
         where stage = 'possession_won' and possession_at + make_interval(days => $3) > $1
       union all
       select 'writ_ready', id, case_number, address, possession_at + make_interval(days => $3) from cases
         where stage = 'possession_won' and possession_at + make_interval(days => $3) <= $1
       union all
       select 'deadline_missed', id, case_number, address, reply_deadline from cases
         where stage = 'writ_filed' and reply_deadline <= $1
       union all
       select 'decision_stale', id, case_number, address, writ_filed_at from cases
         where stage = 'writ_filed' and reply_deadline > $1 and writ_filed_at <= $1 - make_interval(hours => $4)
     ) r order by due nulls last`,
    [now, HEARING_LOOKAHEAD_DAYS, APPEAL_WINDOW_DAYS, DECISION_STALE_HOURS],
  );
  return rows.map((r) => ({ kind: r.kind, caseId: r.id, caseNumber: r.case_number, address: r.address, due: r.due }));
}
