import { createHmac, timingSafeEqual } from "node:crypto";
import { audit } from "./audit";
import { advanceAndText, getOwner } from "./cases";
import { withFirm, type Tx } from "./db";
import { dispatchDue, loadFirm } from "./messaging/outbox";
import { appSecret, appUrl } from "./secret";
import type { CaseRow, Firm } from "./types";
import { DateTime } from "luxon";

export type Choice = "STAY" | "LOCKOUT";
type Payload = { t: string; f: string };

const sign = (data: string) => createHmac("sha256", appSecret()).update(`decision:${data}`).digest("base64url");

export function signToken(p: Payload): string {
  const data = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyToken(token: string): Payload | null {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(data));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

/** A new link replaces any earlier one for the case. It expires at the reply-by deadline. */
export async function issueDecisionLink(tx: Tx, firm: Firm, c: CaseRow): Promise<string> {
  await tx.query("update decision_tokens set used_at = $2 where case_id = $1 and used_at is null", [c.id, firm.demo_now]);
  const { rows } = await tx.query(
    "insert into decision_tokens (firm_id, case_id, expires_at, created_at) values ($1,$2,$3,$4) returning id",
    [firm.id, c.id, c.reply_deadline, firm.demo_now],
  );
  return `${appUrl()}/d/${signToken({ t: rows[0].id, f: firm.id })}`;
}

export type RecordResult = "recorded" | "already_recorded" | "not_open";

/** All three paths (STAY, LOCKOUT, link) end here. The unique index on decisions makes it once-only. */
export async function recordDecision(tx: Tx, firm: Firm, c: CaseRow, choice: Choice, channel: "sms" | "link"): Promise<RecordResult> {
  const owner = await getOwner(tx, c.owner_id);
  const decidedBy = `${owner.name} (${owner.phone})`;
  const { rows } = await tx.query(
    `insert into decisions (firm_id, case_id, choice, channel, decided_by, decided_at)
     select $1,$2,$3,$4,$5,$6 from cases where id = $2 and stage = 'writ_filed'
     on conflict (case_id) do nothing returning id`,
    [firm.id, c.id, choice, channel, decidedBy, firm.demo_now],
  );
  if (!rows[0]) {
    const done = await tx.query("select 1 from decisions where case_id = $1", [c.id]);
    return done.rows[0] ? "already_recorded" : "not_open";
  }
  await tx.query("update decision_tokens set used_at = $2 where case_id = $1 and used_at is null", [c.id, firm.demo_now]);
  await audit(tx, firm.id, decidedBy, "decision.recorded", { case_number: c.case_number, choice, channel }, c.id);

  const actor = `owner:${owner.name}`;
  if (choice === "STAY") {
    await advanceAndText(tx, firm, c.id, "stay_closed", actor);
  } else {
    let day = DateTime.fromJSDate(firm.demo_now).setZone(firm.timezone).plus({ days: firm.lockout_lead_days });
    while (day.weekday > 5) day = day.plus({ days: 1 });
    const lockoutAt = day.set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toISO()!;
    await advanceAndText(tx, firm, c.id, "lockout_scheduled", actor, { lockout_at: lockoutAt });
  }
  return "recorded";
}

export type LinkState =
  | { state: "invalid" }
  | { state: "expired" | "paused" | "unavailable"; firmName: string; firmPhone: string; address?: string }
  | { state: "already"; firmName: string; firmPhone: string; address: string; choice: Choice; channel: string; decidedAt: Date; timezone: string }
  | { state: "ready"; firmName: string; firmPhone: string; address: string; deadline: Date; timezone: string };

async function readState(tx: Tx, tokenId: string): Promise<{ link: LinkState; firm: Firm; c?: CaseRow }> {
  const firm = await loadFirm(tx);
  const base = { firmName: firm.name, firmPhone: firm.contact_phone };
  const { rows } = await tx.query(
    `select t.expires_at, t.used_at, to_jsonb(c) as c, d.choice, d.channel, d.decided_at
     from decision_tokens t join cases c on c.id = t.case_id left join decisions d on d.case_id = c.id
     where t.id = $1`,
    [tokenId],
  );
  const r = rows[0];
  if (!r) return { link: { state: "invalid" }, firm };
  const c: CaseRow = { ...r.c, reply_deadline: r.c.reply_deadline && new Date(r.c.reply_deadline) };
  if (r.choice) {
    return { firm, c, link: { ...base, state: "already", address: c.address, choice: r.choice, channel: r.channel, decidedAt: r.decided_at, timezone: firm.timezone } };
  }
  if (r.used_at) return { firm, c, link: { ...base, state: "expired", address: c.address } };
  if (r.expires_at <= firm.demo_now) return { firm, c, link: { ...base, state: "expired", address: c.address } };
  if (c.stage === "appeal_filed") return { firm, c, link: { ...base, state: "paused", address: c.address } };
  if (c.stage !== "writ_filed") return { firm, c, link: { ...base, state: "expired", address: c.address } };
  if ((await tx.query("select firm_read_only() as ro")).rows[0].ro) return { firm, c, link: { ...base, state: "unavailable", address: c.address } };
  return { firm, c, link: { ...base, state: "ready", address: c.address, deadline: r.expires_at, timezone: firm.timezone } };
}

const ownerCtx = (firmId: string) => ({ firmId, role: "owner" as const, actor: "owner:link" });

export async function linkState(token: string): Promise<LinkState> {
  const p = verifyToken(token);
  if (!p) return { state: "invalid" };
  return withFirm(ownerCtx(p.f), async (tx) => (await readState(tx, p.t)).link);
}

/** Viewing never spends the link; only this POST does. */
export async function decideByLink(token: string, choice: Choice): Promise<LinkState> {
  const p = verifyToken(token);
  if (!p) return { state: "invalid" };
  await withFirm(ownerCtx(p.f), async (tx) => {
    const { link, firm, c } = await readState(tx, p.t);
    if (link.state !== "ready" || !c) return;
    await tx.query("select 1 from cases where id = $1 for update", [c.id]);
    await recordDecision(tx, firm, c, choice, "link");
    await dispatchDue(tx);
  });
  return linkState(token);
}
