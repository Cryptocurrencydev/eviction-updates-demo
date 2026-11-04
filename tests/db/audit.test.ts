import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyChain } from "@/lib/audit";
import { sendGroup } from "@/lib/cases";
import { withFirm, withSystem } from "@/lib/db";
import { q, resetBoth, type Firms } from "../helpers";

let f: Firms;
beforeEach(async () => {
  f = await resetBoth();
  await sendGroup(f.a, "dismissed");
});

describe("audit log", () => {
  it("rejects UPDATE from the app role", async () => {
    await expect(q(f.a, "update audit_log set actor = 'x'")).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects DELETE from the app role", async () => {
    await expect(q(f.a, "delete from audit_log")).rejects.toMatchObject({ code: "42501" });
  });

  it("the trigger rejects UPDATE, DELETE and TRUNCATE even for the table owner", async () => {
    await expect(withSystem((tx) => tx.query("update audit_log set actor = 'x'"))).rejects.toMatchObject({ code: "DL005" });
    await expect(withSystem((tx) => tx.query("delete from audit_log"))).rejects.toMatchObject({ code: "DL005" });
    await expect(withSystem((tx) => tx.query("truncate audit_log"))).rejects.toMatchObject({ code: "DL005" });
  });

  it("the chain verifies", async () => {
    const r = await withFirm(f.a, verifyChain);
    expect(r.ok).toBe(true);
    expect(r.checked).toBeGreaterThan(10);
  });

  it("each firm has its own chain", async () => {
    expect((await withFirm(f.b, verifyChain)).ok).toBe(true);
    const seqs = await q(f.b, "select min(seq)::int as s from audit_log");
    expect(seqs[0].s).toBe(1);
  });

  it("each row links to the one before", async () => {
    const rows = await q(f.a, "select seq, prev_hash, hash from audit_log order by seq");
    expect(rows[0].prev_hash).toBe("0".repeat(64));
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
  });

  it("the stored hash is plain SHA-256 that an outsider can recompute", async () => {
    const [r] = await q(f.a, `select firm_id, seq, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, actor, action, case_id, detail::text as detail, prev_hash, hash from audit_log order by seq desc limit 1`);
    const text = [r.firm_id, r.seq, r.at, r.actor, r.action, r.case_id ?? "", r.detail, r.prev_hash].join("|");
    expect(createHash("sha256").update(text).digest("hex")).toBe(r.hash);
  });

  it("tampering is detected once the triggers are forced off", async () => {
    const [{ seq }] = await q(f.a, "select seq from audit_log order by seq desc offset 3 limit 1");
    await withSystem(async (tx) => {
      await tx.query("alter table audit_log disable trigger audit_no_update");
      await tx.query("update audit_log set actor = 'tampered' where firm_id = $1 and seq = $2", [f.a.firmId, seq]);
      const check = await tx.query("select set_config('app.firm_id', $1, true)", [f.a.firmId]).then(() => verifyChain(tx));
      expect(check).toMatchObject({ ok: false, first_bad_seq: Number(seq) });
      throw Object.assign(new Error("rollback"), { rollback: true });
    }).catch((e) => { if (!e.rollback) throw e; });
    expect((await withFirm(f.a, verifyChain)).ok).toBe(true);
  });

  it("the demo reset appends and never rewrites", async () => {
    const before = (await q(f.a, "select count(*)::int as n from audit_log"))[0].n;
    const { resetFirm } = await import("@/lib/seed");
    await withSystem((tx) => resetFirm(tx, "pinecrest", "test"));
    const after = (await q(f.a, "select count(*)::int as n from audit_log"))[0].n;
    expect(after).toBe(before + 1);
    expect((await withFirm(f.a, verifyChain)).ok).toBe(true);
  });
});
