import { audit } from "../audit";
import { withFirm, type Tx } from "../db";
import { recordDecision } from "../decision";
import type { CaseRow, Firm, Owner } from "../types";
import {
  blockPending, decisionHelpText, dispatchDue, enqueue, helpText, loadFirm,
  optBackInText, optInConfirmText, optInText, optOutConfirmText, releaseHeld,
} from "./outbox";

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
export const START_WORDS = ["START", "UNSTOP"];

export const normalizeKeyword = (s: string) => s.trim().toUpperCase();

async function consentEvent(
  tx: Tx, firm: Firm, owner: Owner, kind: "opt_in" | "opt_out" | "re_opt_in", keyword: string, text: string | null,
) {
  await tx.query(
    `insert into consent_events (firm_id, owner_id, kind, method, keyword, consent_text, at) values ($1,$2,$3,'sms_reply',$4,$5,$6)`,
    [firm.id, owner.id, kind, keyword, text, firm.demo_now],
  );
  await audit(tx, firm.id, `owner:${owner.name}`, kind === "opt_out" ? "consent.opt_out" : "consent.opt_in", {
    owner: owner.name, method: "sms_reply", keyword, consent_text: text,
  });
}

const setConsent = async (tx: Tx, owner: Owner, consent: Owner["consent"]) => {
  await tx.query("update owners set consent = $2 where id = $1", [owner.id, consent]);
  owner.consent = consent;
};

const reply = (tx: Tx, firm: Firm, owner: Owner, body: string, actor = "system:auto-reply") =>
  enqueue(tx, firm, { owner, kind: "compliance", body, actor });

async function handleDecisionReply(tx: Tx, firm: Firm, owner: Owner, word: string): Promise<string> {
  const { rows } = await tx.query<CaseRow>(
    "select * from cases where owner_id = $1 and stage = 'writ_filed' order by reply_deadline for update",
    [owner.id],
  );
  const isChoice = word === "STAY" || word === "LOCKOUT";
  if (rows.length === 0) {
    return isChoice ? "no_open_decision" : "ignored";
  }
  if (!isChoice) {
    await enqueue(tx, firm, { owner, kind: "reply", caseId: rows[0].id, body: decisionHelpText, actor: "system:auto-reply" });
    return "unrecognised";
  }
  // Never guess which property a one-word reply means.
  if (rows.length > 1) {
    await enqueue(tx, firm, {
      owner, kind: "reply",
      body: `You have ${rows.length} decisions open. Please tap the link in each text so we apply your choice to the right property.`,
      actor: "system:auto-reply",
    });
    return "ambiguous";
  }
  if ((await tx.query("select firm_read_only() as ro")).rows[0].ro) {
    await reply(tx, firm, owner, `${firm.name}: we can't record replies by text right now. Please call ${firm.contact_phone}.`);
    return "read_only";
  }
  await recordDecision(tx, firm, rows[0], word as "STAY" | "LOCKOUT", "sms");
  return "decision";
}

/** One path for every inbound text, simulated or from the Twilio webhook. */
export async function handleInbound(firmId: string, fromPhone: string, rawBody: string): Promise<string> {
  return withFirm({ firmId, role: "owner", actor: "owner" }, async (tx) => {
    const firm = await loadFirm(tx);
    const { rows } = await tx.query<Owner>("select * from owners where phone = $1", [fromPhone]);
    const owner = rows[0];
    if (!owner) return "unknown_sender";

    await tx.query(
      `insert into messages (firm_id, owner_id, direction, kind, body, status, created_at) values ($1,$2,'in','reply',$3,'received',$4)`,
      [firm.id, owner.id, rawBody, firm.demo_now],
    );
    await audit(tx, firm.id, `owner:${owner.name}`, "text.received", { owner: owner.name, body: rawBody });

    const outcome = await route(tx, firm, owner, normalizeKeyword(rawBody));
    await dispatchDue(tx);
    return outcome;
  });
}

async function route(tx: Tx, firm: Firm, owner: Owner, word: string): Promise<string> {
  if (STOP_WORDS.includes(word)) {
    if (owner.consent === "opted_out") return "already_opted_out";
    await setConsent(tx, owner, "opted_out");
    await consentEvent(tx, firm, owner, "opt_out", word, null);
    await blockPending(tx, firm, owner, `owner:${owner.name}`);
    await reply(tx, firm, owner, optOutConfirmText(firm));
    return "opted_out";
  }
  if (START_WORDS.includes(word)) {
    if (owner.consent === "opted_in") return "already_opted_in";
    await setConsent(tx, owner, "opted_in");
    await consentEvent(tx, firm, owner, "re_opt_in", word, optInText(firm));
    await reply(tx, firm, owner, optBackInText(firm));
    await releaseHeld(tx, firm, owner, `owner:${owner.name}`);
    return "opted_in";
  }
  if (word === "HELP") {
    await reply(tx, firm, owner, helpText(firm));
    return "help";
  }
  if (owner.consent === "opted_out") return "ignored";
  if (owner.consent !== "opted_in") {
    if (word !== "YES") return "ignored";
    const sent = await tx.query(
      "select body from messages where owner_id = $1 and kind = 'opt_in' order by seq desc limit 1",
      [owner.id],
    );
    await setConsent(tx, owner, "opted_in");
    await consentEvent(tx, firm, owner, "opt_in", word, sent.rows[0]?.body ?? optInText(firm));
    await reply(tx, firm, owner, optInConfirmText(firm));
    await releaseHeld(tx, firm, owner, `owner:${owner.name}`);
    return "opted_in";
  }
  return handleDecisionReply(tx, firm, owner, word);
}
