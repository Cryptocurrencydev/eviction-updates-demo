import { DateTime } from "luxon";
import { audit } from "./audit";
import type { FirmCtx, Tx } from "./db";
import { withFirm } from "./db";
import { issueDecisionLink } from "./decision";
import { dispatchDue, enqueue, loadFirm, type QueueResult } from "./messaging/outbox";
import { fmtDateTime, fmtDay, fmtTime, renderTemplate } from "./messaging/render";
import type { CaseRow, Firm, Owner } from "./types";

export const RESUMED_TEXT = "The appeal for {address} is resolved and the case has resumed.";

/** The team screen's groups. `pending` lists the recorded results a group's button sends. */
export const SEND_GROUPS = {
  dismissed: { pending: ["dismissed_paid"] },
  possession: { pending: ["possession_won"] },
  continued: { pending: ["continued_pending", "continued_new_date"] },
  appeal: { pending: ["appeal_filed"] },
  lockout_complete: { pending: ["lockout_complete"] },
} as const;
export type SendGroup = keyof typeof SEND_GROUPS;

/** These moves are recorded first and sent from the team screen. */
export const RECORDED_FIRST = new Set(["dismissed_paid", "possession_won", "continued_pending", "appeal_filed", "lockout_complete"]);

export type Fields = { reply_deadline?: string; court_at?: string; lockout_at?: string };
export type SendSummary = Record<QueueResult, number> & { advanced: number };
const emptySummary = (): SendSummary => ({ advanced: 0, sending: 0, quiet_hours: 0, waiting_opt_in: 0, opted_out: 0 });

export async function getOwner(tx: Tx, id: string): Promise<Owner> {
  const { rows } = await tx.query("select * from owners where id = $1", [id]);
  if (!rows[0]) throw new Error("owner not found");
  return rows[0];
}

/** Renders the firm's template for this stage, or the client's default. */
export async function stageBody(tx: Tx, firm: Firm, c: CaseRow, stage: string): Promise<string | null> {
  const { rows } = await tx.query(
    `select coalesce(t.body, s.default_template) as body, s.sends_text
     from stages s left join templates t on t.stage_code = s.code and t.firm_id = $2 where s.code = $1`,
    [stage, firm.id],
  );
  if (!rows[0]?.sends_text) return null;
  const when = stage === "lockout_scheduled" ? c.lockout_at : c.court_at;
  return renderTemplate(rows[0].body, {
    address: c.address,
    day: when ? fmtDay(when, firm.timezone) : "",
    time: when ? fmtTime(when, firm.timezone) : "",
    deadline: c.reply_deadline ? fmtDateTime(c.reply_deadline, firm.timezone) : "",
  });
}

export async function queueStageText(tx: Tx, firm: Firm, c: CaseRow, stage: string, actor: string): Promise<QueueResult | null> {
  let body = await stageBody(tx, firm, c, stage);
  if (!body) return null;
  if (stage === "writ_filed") {
    body += `\n\nOr tap to choose: ${await issueDecisionLink(tx, firm, c)}`;
  }
  const owner = await getOwner(tx, c.owner_id);
  return enqueue(tx, firm, { owner, caseId: c.id, kind: "stage", stageCode: stage, body, actor });
}

/** Moves one case through the database function, then queues its owner text. */
export async function advanceAndText(tx: Tx, firm: Firm, caseId: string, to: string, actor: string, fields: Fields = {}) {
  const before = (await tx.query("select stage from cases where id = $1", [caseId])).rows[0]?.stage as string | undefined;
  const { rows } = await tx.query("select * from advance_case($1, $2, $3, $4)", [caseId, to, actor, JSON.stringify(fields)]);
  const c = rows[0] as CaseRow;
  if (before === "appeal_filed" && to !== "writ_filed") {
    const owner = await getOwner(tx, c.owner_id);
    const body = renderTemplate(RESUMED_TEXT, { address: c.address });
    return enqueue(tx, firm, { owner, caseId: c.id, kind: "stage", stageCode: to, body, actor });
  }
  return queueStageText(tx, firm, c, to, actor);
}

/** Date inputs arrive with no offset and mean the firm's local time. */
function asInstant(value: string, tz: string): string {
  const d = DateTime.fromISO(value, { zone: tz });
  if (!d.isValid) throw Object.assign(new Error("That date isn't valid."), { code: "DL002" });
  return d.toUTC().toISO()!;
}
const instants = (f: Fields, tz: string): Fields =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, asInstant(v!, tz)]));

const tally = (s: SendSummary, r: QueueResult | null) => {
  s.advanced++;
  if (r) s[r]++;
};

/** One click on the team screen: advance and text every case in a group. */
export async function sendGroup(ctx: FirmCtx, group: SendGroup, dates: Record<string, string> = {}) {
  const summary = await withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const { rows } = await tx.query<{ id: string; pending_stage: string }>(
      "select id, pending_stage from cases where pending_stage = any($1) order by case_number for update",
      [[...SEND_GROUPS[group].pending]],
    );
    const s = emptySummary();
    for (const c of rows) {
      const date = dates[c.id];
      const to = group === "continued" && date ? "continued_new_date" : c.pending_stage;
      tally(s, await advanceAndText(tx, firm, c.id, to, ctx.actor, date ? { court_at: asInstant(date, firm.timezone) } : {}));
    }
    await dispatchDue(tx);
    return s;
  });
  return summary;
}

/** Cases list and direct API: moves selected cases now. Every move is checked by Postgres. */
export async function advanceMany(ctx: FirmCtx, caseIds: string[], to: string, fields: Fields = {}) {
  return withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const s = emptySummary();
    const f = instants(fields, firm.timezone);
    for (const id of caseIds) tally(s, await advanceAndText(tx, firm, id, to, ctx.actor, f));
    await dispatchDue(tx);
    return s;
  });
}

/** Records a result for the team screen to send. No text goes yet. */
export async function recordResult(ctx: FirmCtx, caseIds: string[], result: string) {
  if (!RECORDED_FIRST.has(result)) throw Object.assign(new Error("not a recordable result"), { code: "DL001" });
  return withFirm(ctx, async (tx) => {
    for (const id of caseIds) {
      const { rows } = await tx.query("update cases set pending_stage = $2 where id = $1 returning case_number", [id, result]);
      if (!rows[0]) throw Object.assign(new Error("case not found"), { code: "DL404" });
      await audit(tx, ctx.firmId, ctx.actor, "case.result_recorded", { case_number: rows[0].case_number, result }, id);
    }
    return { recorded: caseIds.length };
  });
}

/** Cases whose court date has arrived move onto the docket. Court Day has no owner text. */
export async function rollCourtDay(tx: Tx, firm: Firm, actor: string) {
  if ((await tx.query("select firm_read_only() as ro")).rows[0].ro) return 0;
  const endOfDay = DateTime.fromJSDate(firm.demo_now).setZone(firm.timezone).endOf("day").toJSDate();
  const { rows } = await tx.query(
    "select id from cases where stage in ('court_date_set', 'continued_new_date') and court_at <= $1",
    [endOfDay],
  );
  for (const r of rows) await tx.query("select advance_case($1, 'court_day', $2)", [r.id, actor]);
  return rows.length;
}

export async function advanceClock(ctx: FirmCtx, hours: number) {
  return withFirm(ctx, async (tx) => {
    await tx.query("update firms set demo_now = demo_now + make_interval(hours => $1) where id = current_firm()", [hours]);
    const firm = await loadFirm(tx);
    await audit(tx, firm.id, ctx.actor, "clock.advanced", { hours, now: firm.demo_now });
    const rolled = await rollCourtDay(tx, firm, "system:clock");
    const released = await dispatchDue(tx);
    return { released, rolled, now: firm.demo_now };
  });
}
