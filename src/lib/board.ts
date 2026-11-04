import type { Tx } from "./db";

export type BoardCase = {
  id: string; case_number: string; address: string; owner_name: string; owner_id: string; consent: string; owner_timezone: string;
  stage: string; pending_stage: string | null; paused_from: string | null;
  court_at: Date | null; reply_deadline: Date | null; lockout_at: Date | null; keys_held_until: Date | null; possession_at: Date | null;
};

export type Board = {
  dueCount: number;
  dismissed: BoardCase[];
  possession: BoardCase[]; readyForWrit: BoardCase[];
  continued: BoardCase[]; awaitingDate: BoardCase[];
  appeal: BoardCase[]; paused: BoardCase[];
  writWaiting: BoardCase[];
  lockoutScheduled: BoardCase[];
  lockoutComplete: BoardCase[]; keysHeld: BoardCase[];
};

export async function getBoard(tx: Tx): Promise<Board> {
  const { rows } = await tx.query<BoardCase>(
    `select c.id, c.case_number, c.address, c.stage, c.pending_stage, c.paused_from, c.court_at, c.reply_deadline,
            c.lockout_at, c.keys_held_until, c.possession_at,
            o.id as owner_id, o.name as owner_name, o.consent, o.timezone as owner_timezone
     from cases c join owners o on o.id = c.owner_id
     where c.closed_at is null order by c.case_number`,
  );
  const pending = (...stages: string[]) => rows.filter((r) => r.pending_stage && stages.includes(r.pending_stage));
  const at = (stage: string) => rows.filter((r) => r.stage === stage && !r.pending_stage);
  const dismissed = pending("dismissed_paid");
  const possession = pending("possession_won");
  return {
    // Her banner counts the final court results. Continued cases have their own card.
    dueCount: dismissed.length + possession.length,
    dismissed, possession, readyForWrit: at("possession_won"),
    continued: pending("continued_pending", "continued_new_date"), awaitingDate: at("continued_pending"),
    appeal: pending("appeal_filed"), paused: at("appeal_filed"),
    writWaiting: at("writ_filed"),
    lockoutScheduled: at("lockout_scheduled"),
    lockoutComplete: pending("lockout_complete"), keysHeld: at("lockout_complete"),
  };
}
