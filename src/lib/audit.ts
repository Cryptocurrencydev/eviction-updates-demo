import type { FirmCtx, Tx } from "./db";

/** The hash, sequence and timestamp are filled in by the audit_chain trigger. */
export async function audit(
  tx: Tx,
  firmId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
  caseId?: string | null,
) {
  await tx.query("insert into audit_log (firm_id, actor, action, case_id, detail, prev_hash, hash, seq) values ($1,$2,$3,$4,$5,'','',0)", [
    firmId,
    actor,
    action,
    caseId ?? null,
    JSON.stringify(detail),
  ]);
}

export async function verifyChain(tx: Tx) {
  const { rows } = await tx.query("select ok, checked::int, first_bad_seq::int from verify_audit_chain()");
  return rows[0] as { ok: boolean; checked: number; first_bad_seq: number | null };
}

export const AUDIT_ACTIONS = [
  "csv.uploaded", "case.created", "case.result_recorded", "case.advanced",
  "text.queued", "text.held", "text.sent", "text.blocked", "text.received",
  "consent.opt_in", "consent.opt_out", "consent.requested", "decision.recorded",
  "template.updated", "settings.updated", "clock.advanced", "billing.event", "demo.reset",
] as const;

export type { FirmCtx };
