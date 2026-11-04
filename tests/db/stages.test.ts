import { beforeEach, describe, expect, it } from "vitest";
import { advanceClock, advanceMany, recordResult, sendGroup } from "@/lib/cases";
import { getBoard } from "@/lib/board";
import { withFirm, withSystem } from "@/lib/db";
import { caseWhere, newOwnerCase, outbound, q, resetBoth, type Firms } from "../helpers";

let f: Firms;
beforeEach(async () => { f = await resetBoth(); });

const stageOf = async (id: string) => (await caseWhere(f.a, "id = $1", [id]))[0].stage;

describe("stages in the database", () => {
  it("has exactly 13 stages", async () => {
    expect((await q(f.a, "select count(*)::int as n from stages"))[0].n).toBe(13);
  });

  it("uses the client's texts word for word", async () => {
    const rows = await q(f.a, "select code, default_template from stages");
    const t = Object.fromEntries(rows.map((r) => [r.code, r.default_template]));
    expect(t.filed).toBe("We filed eviction today for {address}.");
    expect(t.possession_won).toBe("Court is complete for {address} and we won possession.");
    expect(t.writ_filed).toBe("The writ was filed for {address}. Reply STAY to accept funds and let the resident stay. Reply LOCKOUT to move forward. Please reply by {deadline}.");
    expect(t.possession_returned).toBe("The keys have been turned in and we can now walk {address}. Our marketing team will send you a full report.");
  });

  it.each([
    ["filed", "possession_won"],
    ["filed", "lockout_complete"],
    ["filed", "dismissed_paid"],
  ])("rejects the jump %s -> %s through advance_case", async (from, to) => {
    const [c] = await caseWhere(f.a, "stage = $1", [from]);
    await expect(q(f.a, "select advance_case($1, $2, 'x', $3)", [c.id, to, "{}"])).rejects.toMatchObject({ code: "DL001" });
    expect(await stageOf(c.id)).toBe(from);
  });

  it("rejects a raw UPDATE of the stage column too", async () => {
    const [c] = await caseWhere(f.a, "stage = 'filed'");
    await expect(q(f.a, "update cases set stage = 'possession_returned' where id = $1", [c.id])).rejects.toMatchObject({ code: "DL001" });
  });

  it("rejects inserting a new case part-way through the flow", async () => {
    const [c] = await caseWhere(f.a, "stage = 'filed'");
    await expect(q(f.a, "insert into cases (firm_id, owner_id, case_number, county, filing_date, address, resident_name, stage) values ($1,$2,'J','Wake','2026-01-01','a','b','lockout_complete')", [f.a.firmId, c.owner_id]))
      .rejects.toMatchObject({ code: "DL001" });
  });

  it("3A is the end of the road", async () => {
    await sendGroup(f.a, "dismissed");
    const [c] = await caseWhere(f.a, "stage = 'dismissed_paid'");
    expect(c.closed_at).not.toBeNull();
    await expect(q(f.a, "select advance_case($1, 'writ_filed', 'x', $2)", [c.id, JSON.stringify({ reply_deadline: "2030-01-01" })]))
      .rejects.toMatchObject({ code: "DL001" });
  });

  it("3A, 3B and 3C are alternatives: a case can't go from one to another", async () => {
    await sendGroup(f.a, "possession");
    const [c] = await caseWhere(f.a, "stage = 'possession_won' and possession_at is not null");
    await expect(q(f.a, "select advance_case($1, 'dismissed_paid', 'x')", [c.id])).rejects.toMatchObject({ code: "DL001" });
    await expect(q(f.a, "select advance_case($1, 'continued_pending', 'x')", [c.id])).rejects.toMatchObject({ code: "DL001" });
  });

  it("the writ needs a reply-by deadline", async () => {
    const [c] = await caseWhere(f.a, "stage = 'possession_won' and pending_stage is null");
    await expect(q(f.a, "select advance_case($1, 'writ_filed', 'x')", [c.id])).rejects.toMatchObject({ code: "DL002" });
  });

  it("STAY and LOCKOUT stages need a recorded owner decision", async () => {
    const [c] = await caseWhere(f.a, "stage = 'writ_filed'");
    await expect(q(f.a, "select advance_case($1, 'stay_closed', 'x')", [c.id])).rejects.toMatchObject({ code: "DL001" });
    await expect(q(f.a, "select advance_case($1, 'lockout_scheduled', 'x', $2)", [c.id, JSON.stringify({ lockout_at: "2030-01-01" })]))
      .rejects.toMatchObject({ code: "DL001" });
  });

  it("appeal: allowed after the writ, pauses, and resumes only where it paused", async () => {
    const [c] = await caseWhere(f.a, "stage = 'writ_filed'");
    await recordResult(f.a, [c.id], "appeal_filed");
    await sendGroup(f.a, "appeal");
    const [paused] = await caseWhere(f.a, "id = $1", [c.id]);
    expect(paused.stage).toBe("appeal_filed");
    expect(paused.paused_from).toBe("writ_filed");
    await expect(advanceMany(f.a, [c.id], "possession_won")).rejects.toMatchObject({ code: "DL001" });
    await advanceMany(f.a, [c.id], "writ_filed", { reply_deadline: "2030-01-01T17:00:00Z" });
    expect(await stageOf(c.id)).toBe("writ_filed");
  });

  it("appeal can't happen before possession or after lockout", async () => {
    const [early] = await caseWhere(f.a, "stage = 'filed'");
    await expect(recordResult(f.a, [early.id], "appeal_filed")).rejects.toMatchObject({ code: "DL001" });
    await sendGroup(f.a, "lockout_complete");
    const [late] = await caseWhere(f.a, "stage = 'lockout_complete'");
    await expect(recordResult(f.a, [late.id], "appeal_filed")).rejects.toMatchObject({ code: "DL001" });
  });

  it("3D needs a date and leads back to court day when it arrives", async () => {
    const [c] = await caseWhere(f.a, "pending_stage = 'continued_pending'");
    const next = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await sendGroup(f.a, "continued", { [c.id]: next });
    expect(await stageOf(c.id)).toBe("continued_new_date");
    await advanceClock(f.a, 72);
    expect(await stageOf(c.id)).toBe("court_day");
  });

  it("court day has no owner text", async () => {
    const { c, owner } = await newOwnerCase(f.a, 501);
    await advanceMany(f.a, [c.id], "court_date_set");
    const before = (await outbound(f.a, owner.id)).length;
    await advanceMany(f.a, [c.id], "court_day");
    expect((await outbound(f.a, owner.id)).length).toBe(before);
  });
});

describe("team screen opening scene", () => {
  it("matches the client's picture", async () => {
    const b = await withFirm(f.a, getBoard);
    expect({
      due: b.dueCount, dismissed: b.dismissed.length, possession: b.possession.length, continued: b.continued.length,
      appeal: b.appeal.length, writ: b.writWaiting.length, lockout: b.lockoutScheduled.length, complete: b.lockoutComplete.length,
    }).toEqual({ due: 12, dismissed: 5, possession: 7, continued: 2, appeal: 1, writ: 3, lockout: 2, complete: 1 });
  });

  it("one click sends a whole group, and reports who was held back", async () => {
    const s = await sendGroup(f.a, "possession");
    expect(s).toMatchObject({ advanced: 7, sending: 5, waiting_opt_in: 1, opted_out: 1 });
    const b = await withFirm(f.a, getBoard);
    expect(b.dueCount).toBe(5);
    expect(b.possession.length).toBe(0);
  });

  it("every advance is audited", async () => {
    const count = async () => (await q(f.a, "select count(*)::int as n from audit_log where action = 'case.advanced'"))[0].n;
    const before = await count();
    await sendGroup(f.a, "dismissed");
    expect((await count()) - before).toBe(5);
  });

  it("a second click sends nothing", async () => {
    await sendGroup(f.a, "dismissed");
    expect((await sendGroup(f.a, "dismissed")).advanced).toBe(0);
  });

  it("the Pacific owner's text waits for 8am their time, then the clock releases it", async () => {
    const s = await sendGroup(f.a, "dismissed");
    expect(s).toMatchObject({ advanced: 5, sending: 4, quiet_hours: 1 });
    const owners = await q(f.a, "select id from owners where timezone = 'America/Los_Angeles'");
    const before = await outbound(f.a, owners[0].id);
    expect(before.at(-1)).toMatchObject({ status: "queued", quiet_held: true });
    const r = await advanceClock(f.a, 1);
    expect(r.released).toBeGreaterThanOrEqual(1);
    expect((await outbound(f.a, owners[0].id)).at(-1)).toMatchObject({ status: "sent" });
  });

  it("firm B's seed is its own", async () => {
    const b = await withFirm(f.b, getBoard);
    expect(b.dueCount).toBe(4);
  });
});

describe("read-only mode", () => {
  it("blocks advancing in the database and leaves cases readable", async () => {
    await withSystem((tx) => tx.query("update subscriptions set status = 'read_only' where firm_id = $1", [f.a.firmId]));
    await expect(sendGroup(f.a, "dismissed")).rejects.toMatchObject({ code: "DL003" });
    expect((await caseWhere(f.a, "true")).length).toBeGreaterThan(20);
    const [c] = await caseWhere(f.a, "stage = 'court_day' and pending_stage is null");
    await expect(recordResult(f.a, [c.id], "possession_won")).rejects.toMatchObject({ code: "DL003" });
  });

  it("queued texts stay queued while read-only", async () => {
    await sendGroup(f.a, "dismissed");
    await withSystem((tx) => tx.query("update subscriptions set status = 'read_only' where firm_id = $1", [f.a.firmId]));
    await advanceClock(f.a, 1);
    const [o] = await q(f.a, "select id from owners where timezone = 'America/Los_Angeles'");
    expect((await outbound(f.a, o.id)).at(-1)).toMatchObject({ status: "queued" });
  });
});
