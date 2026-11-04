import type { Tx } from "./db";

export type AuditFilter = { action?: string; q?: string };
export type AuditRow = {
  seq: string; at: Date; actor: string; action: string; case_id: string | null;
  detail: Record<string, unknown>; prev_hash: string; hash: string;
};

export async function queryAudit(tx: Tx, f: AuditFilter, limit: number): Promise<AuditRow[]> {
  const { rows } = await tx.query(
    `select seq, at, actor, action, case_id, detail, prev_hash, hash from audit_log
     where ($1::text is null or action = $1)
       and ($2::text is null or actor ilike '%' || $2 || '%' or detail::text ilike '%' || $2 || '%')
     order by seq desc limit $3`,
    [f.action || null, f.q || null, limit],
  );
  return rows;
}
