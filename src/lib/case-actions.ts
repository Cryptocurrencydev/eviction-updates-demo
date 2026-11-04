import type { Tx } from "./db";

/** Decision moves belong to the owner. A continued case gets its new date on the team screen's Continued card. */
export async function transitions(tx: Tx) {
  const { rows } = await tx.query<{ from_stage: string; to_stage: string; label: string }>(
    `select from_stage, to_stage, label from stage_transitions
     where not (from_stage = 'writ_filed' and to_stage in ('stay_closed', 'lockout_scheduled'))
       and not (from_stage = 'court_day' and to_stage = 'continued_new_date')`,
  );
  return rows;
}
