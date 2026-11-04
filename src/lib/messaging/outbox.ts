import { audit } from "../audit";
import type { Tx } from "../db";
import type { Firm, Owner } from "../types";
import { getSender } from "./index";
import { isWithinSendWindow, nextSendTime } from "./quiet-hours";
import type { MessageSender } from "./sender";

export const optInText = (firm: Pick<Firm, "name">) =>
  `${firm.name}: reply YES to get text updates about your property's court case. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
export const optOutConfirmText = (firm: Pick<Firm, "name">) =>
  `${firm.name}: you are unsubscribed and will get no more texts. Reply START to opt back in.`;
export const optBackInText = (firm: Pick<Firm, "name">) =>
  `${firm.name}: you are opted back in to case updates. Reply HELP for help, STOP to opt out.`;
export const optInConfirmText = (firm: Pick<Firm, "name">) =>
  `${firm.name}: thanks, you are opted in to case updates. Reply HELP for help, STOP to opt out.`;
export const helpText = (firm: Pick<Firm, "name" | "contact_phone" | "contact_email">) =>
  `${firm.name}: for help call ${firm.contact_phone} or email ${firm.contact_email}. Reply STOP to opt out.`;
export const decisionHelpText = "Please reply STAY to accept funds and let the resident stay, or LOCKOUT to move forward.";

export async function loadFirm(tx: Tx): Promise<Firm> {
  const { rows } = await tx.query(
    `select f.*, s.contact_phone, s.contact_email, s.lockout_lead_days
     from firms f join firm_settings s on s.firm_id = f.id where f.id = current_firm()`,
  );
  if (!rows[0]) throw new Error("firm not found");
  return rows[0];
}

type NewMessage = {
  owner: Owner; caseId?: string | null; kind: "stage" | "opt_in" | "compliance" | "decision" | "reply";
  stageCode?: string | null; body: string; actor: string;
};
export type QueueResult = "sending" | "quiet_hours" | "waiting_opt_in" | "opted_out";

async function insert(
  tx: Tx, firm: Firm, m: NewMessage,
  status: "held_opt_in" | "queued" | "blocked", sendAfter: Date | null, quiet: boolean, reason: string | null,
) {
  await tx.query(
    `insert into messages (firm_id, owner_id, case_id, direction, kind, stage_code, body, status, send_after, quiet_held, block_reason, created_at)
     values ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9,$10,$11)`,
    [firm.id, m.owner.id, m.caseId ?? null, m.kind, m.stageCode ?? null, m.body, status, sendAfter, quiet, reason, firm.demo_now],
  );
}

/** Asks once. Nothing but this request goes to an owner until they reply YES. */
export async function requestOptIn(tx: Tx, firm: Firm, owner: Owner, actor: string) {
  if (owner.consent !== "none") return;
  await tx.query("update owners set consent = 'pending', opt_in_requested_at = $2 where id = $1", [owner.id, firm.demo_now]);
  owner.consent = "pending";
  const sendAfter = nextSendTime(firm.demo_now, owner.timezone);
  await insert(tx, firm, { owner, kind: "opt_in", body: optInText(firm), actor }, "queued", sendAfter, sendAfter > firm.demo_now, null);
  await audit(tx, firm.id, actor, "consent.requested", { owner: owner.name, send_after: sendAfter });
}

/** The single gate for owner texts: consent first, then quiet hours. */
export async function enqueue(tx: Tx, firm: Firm, m: NewMessage): Promise<QueueResult> {
  const { owner } = m;
  const detail = { owner: owner.name, stage: m.stageCode ?? null, kind: m.kind };

  if (m.kind === "compliance") {
    await insert(tx, firm, m, "queued", firm.demo_now, false, null);
    await audit(tx, firm.id, m.actor, "text.queued", detail, m.caseId);
    return "sending";
  }
  if (owner.consent === "opted_out") {
    await insert(tx, firm, m, "blocked", null, false, "opted_out");
    await audit(tx, firm.id, m.actor, "text.blocked", { ...detail, reason: "opted_out" }, m.caseId);
    return "opted_out";
  }
  if (owner.consent !== "opted_in") {
    await requestOptIn(tx, firm, owner, m.actor);
    await insert(tx, firm, m, "held_opt_in", null, false, null);
    await audit(tx, firm.id, m.actor, "text.held", { ...detail, reason: "waiting_for_opt_in" }, m.caseId);
    return "waiting_opt_in";
  }
  const sendAfter = nextSendTime(firm.demo_now, owner.timezone);
  const quiet = sendAfter > firm.demo_now;
  await insert(tx, firm, m, "queued", sendAfter, quiet, null);
  await audit(tx, firm.id, m.actor, "text.queued", { ...detail, send_after: sendAfter, quiet_hours: quiet }, m.caseId);
  return quiet ? "quiet_hours" : "sending";
}

/** After YES: everything held for this owner joins the normal queue, still subject to quiet hours. */
export async function releaseHeld(tx: Tx, firm: Firm, owner: Owner, actor: string) {
  const sendAfter = nextSendTime(firm.demo_now, owner.timezone);
  const { rows } = await tx.query(
    `update messages set status = 'queued', send_after = $2, quiet_held = $3
     where owner_id = $1 and status = 'held_opt_in' returning id, case_id, stage_code`,
    [owner.id, sendAfter, sendAfter > firm.demo_now],
  );
  for (const r of rows) {
    await audit(tx, firm.id, actor, "text.queued", { owner: owner.name, stage: r.stage_code, released_after_opt_in: true }, r.case_id);
  }
}

/** Opt-out wins over anything already waiting. */
export async function blockPending(tx: Tx, firm: Firm, owner: Owner, actor: string) {
  const { rows } = await tx.query(
    `update messages set status = 'blocked', block_reason = 'opted_out'
     where owner_id = $1 and status in ('held_opt_in', 'queued') and kind <> 'compliance'
     returning case_id, stage_code`,
    [owner.id],
  );
  for (const r of rows) {
    await audit(tx, firm.id, actor, "text.blocked", { owner: owner.name, stage: r.stage_code, reason: "opted_out" }, r.case_id);
  }
}

/** Sends whatever is due. Rechecks consent and quiet hours at send time, not only at queue time. */
export async function dispatchDue(tx: Tx, sender: MessageSender = getSender()) {
  const firm = await loadFirm(tx);
  const readOnly = (await tx.query("select firm_read_only() as ro")).rows[0].ro as boolean;
  const { rows } = await tx.query(
    `select m.id, m.kind, m.body, m.case_id, m.stage_code, o.name, o.phone, o.timezone, o.consent
     from messages m join owners o on o.id = m.owner_id
     where m.status = 'queued' and m.send_after <= $1 order by (m.kind = 'compliance') desc, m.seq for update of m skip locked`,
    [firm.demo_now],
  );
  let sent = 0;
  for (const m of rows) {
    const compliance = m.kind === "compliance";
    if (readOnly && !compliance) continue;
    if (!compliance && m.consent === "opted_out") {
      await tx.query("update messages set status = 'blocked', block_reason = 'opted_out' where id = $1", [m.id]);
      continue;
    }
    if (!compliance && !isWithinSendWindow(firm.demo_now, m.timezone)) {
      await tx.query("update messages set send_after = $2, quiet_held = true where id = $1", [m.id, nextSendTime(firm.demo_now, m.timezone)]);
      continue;
    }
    const { providerId } = await sender.send({ to: m.phone, from: firm.sms_number, body: m.body });
    await tx.query("update messages set status = 'sent', sent_at = $2, provider_id = $3 where id = $1", [m.id, firm.demo_now, providerId]);
    await audit(tx, firm.id, `system:${sender.name}`, "text.sent", { owner: m.name, stage: m.stage_code, kind: m.kind }, m.case_id);
    sent++;
  }
  return sent;
}
