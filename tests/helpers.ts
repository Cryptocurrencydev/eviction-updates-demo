import { withFirm, withSystem, type FirmCtx, type Tx } from "@/lib/db";
import { resetFirm } from "@/lib/seed";
import type { CaseRow, Owner } from "@/lib/types";

export type Firms = { a: FirmCtx; b: FirmCtx; aTeam: FirmCtx };

export async function resetBoth(): Promise<Firms> {
  const a = await withSystem((tx) => resetFirm(tx, "pinecrest", "test"));
  const b = await withSystem((tx) => resetFirm(tx, "harbor-lane", "test"));
  return {
    a: { firmId: a, role: "admin", actor: "Test Admin" },
    aTeam: { firmId: a, role: "team", actor: "Test Team" },
    b: { firmId: b, role: "admin", actor: "Test Admin B" },
  };
}

export const q = <T = any>(ctx: FirmCtx, sql: string, args: unknown[] = []) =>
  withFirm(ctx, async (tx: Tx) => (await tx.query(sql, args)).rows as T[]);

export const caseWhere = async (ctx: FirmCtx, where: string, args: unknown[] = []) =>
  (await q<CaseRow>(ctx, `select * from cases where ${where} order by case_number`, args));

export const ownerOf = async (ctx: FirmCtx, c: { owner_id: string }) =>
  (await q<Owner>(ctx, "select * from owners where id = $1", [c.owner_id]))[0];

export const outbound = (ctx: FirmCtx, ownerId: string) =>
  q<{ body: string; status: string; kind: string; stage_code: string | null; quiet_held: boolean; block_reason: string | null }>(
    ctx, "select * from messages where owner_id = $1 and direction = 'out' order by delivered_seq nulls last, seq", [ownerId],
  );

export const setClock = (ctx: FirmCtx, iso: string) =>
  withSystem((tx) => tx.query("update firms set demo_now = $2 where id = $1", [ctx.firmId, iso]));

/** A brand-new owner with one case at `filed`, through the real CSV path. */
export async function newOwnerCase(ctx: FirmCtx, n: number, tz = "America/New_York") {
  const { commitCsv } = await import("@/lib/csv");
  const num = `TEST${n}`;
  const phone = `(984) 555-${2000 + n}`;
  const text = `case number,county,filing date,property address,resident name,owner name,owner phone,owner time zone,hearing date
${num},Wake,2026-01-05,${n} Sample Test Street,Resident T,Owner ${n},${phone},${tz},2026-01-12`;
  await commitCsv(ctx, "t.csv", text);
  const [c] = await caseWhere(ctx, "case_number = $1", [num]);
  return { c, owner: await ownerOf(ctx, c) };
}
