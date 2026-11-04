import { beforeAll, describe, expect, it } from "vitest";
import { withFirm, withSystem } from "@/lib/db";
import { caseWhere, q, resetBoth, type Firms } from "../helpers";

const TABLES = ["users", "owners", "cases", "messages", "consent_events", "decision_tokens", "decisions", "audit_log", "templates", "firm_settings", "subscriptions"];

describe("firm isolation in Postgres", () => {
  let f: Firms;
  let bCase: string, bOwner: string;

  beforeAll(async () => {
    f = await resetBoth();
    const [c] = await caseWhere(f.b, "true");
    bCase = c.id; bOwner = c.owner_id;
  });

  it("the requests really run as a role that RLS applies to", async () => {
    const [r] = await q(f.a, "select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass");
    expect(r).toEqual({ current_user: "app_user", bypass: false });
  });

  it.each(TABLES)("%s: firm A sees none of firm B's rows", async (t) => {
    const rows = await q(f.a, `select count(*)::int as n from ${t} where firm_id = $1`, [f.b.firmId]);
    expect(rows[0].n).toBe(0);
  });

  it("an unfiltered select only returns the firm's own cases", async () => {
    const rows = await q(f.a, "select distinct firm_id from cases");
    expect(rows).toEqual([{ firm_id: f.a.firmId }]);
  });

  it("firms table: only your own row", async () => {
    expect(await q(f.a, "select name from firms")).toEqual([{ name: "Pinecrest Property Group" }]);
  });

  it("with no firm id set, no rows come back", async () => {
    const n = await withSystem(async (tx) => {
      await tx.query("set local role app_user");
      return (await tx.query("select count(*)::int as n from cases")).rows[0].n;
    });
    expect(n).toBe(0);
  });

  it("firm A can't update firm B's case: zero rows touched", async () => {
    const r = await withFirm(f.a, (tx) => tx.query("update cases set address = 'hacked' where id = $1", [bCase]));
    expect(r.rowCount).toBe(0);
    expect((await caseWhere(f.b, "id = $1", [bCase]))[0].address).not.toBe("hacked");
  });

  it("firm A can't delete: no privilege at all", async () => {
    await expect(q(f.a, "delete from cases where id = $1", [bCase])).rejects.toMatchObject({ code: "42501" });
  });

  it("firm A can't insert a row tagged as firm B", async () => {
    await expect(q(f.a, "insert into owners (firm_id, name, phone, timezone) values ($1,'x','+19845550000','America/New_York')", [f.b.firmId]))
      .rejects.toThrow(/row-level security/);
  });

  it("firm A can't attach a case to firm B", async () => {
    await expect(q(f.a, "insert into cases (firm_id, owner_id, case_number, county, filing_date, address, resident_name) values ($1,$2,'X','Wake','2026-01-01','a','b')", [f.b.firmId, bOwner]))
      .rejects.toThrow(/row-level security/);
  });

  it("advance_case can't reach another firm's case", async () => {
    await expect(q(f.a, "select advance_case($1, 'court_date_set', 'x')", [bCase])).rejects.toMatchObject({ code: "DL404" });
  });

  it("firm A can't move firm B's demo clock", async () => {
    const r = await withFirm(f.a, (tx) => tx.query("update firms set demo_now = now() where id = $1", [f.b.firmId]));
    expect(r.rowCount).toBe(0);
  });

  it("team members can't write billing, settings or templates, even in SQL", async () => {
    const r1 = await withFirm(f.aTeam, (tx) => tx.query("update subscriptions set status = 'active'"));
    const r2 = await withFirm(f.aTeam, (tx) => tx.query("update firm_settings set contact_phone = 'x'"));
    expect([r1.rowCount, r2.rowCount]).toEqual([0, 0]);
    await expect(q(f.aTeam, "insert into templates (firm_id, stage_code, body) values ($1,'filed','x')", [f.a.firmId])).rejects.toThrow(/row-level security/);
  });

  it("team members can still read them, and admins can write", async () => {
    expect((await q(f.aTeam, "select status from subscriptions")).length).toBe(1);
    const r = await withFirm(f.a, (tx) => tx.query("update firm_settings set lockout_lead_days = 5"));
    expect(r.rowCount).toBe(1);
  });
});
