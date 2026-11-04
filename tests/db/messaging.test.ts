import { beforeEach, describe, expect, it } from "vitest";
import { advanceMany, sendGroup } from "@/lib/cases";
import { handleInbound, normalizeKeyword, START_WORDS, STOP_WORDS } from "@/lib/messaging/inbound";
import { caseWhere, newOwnerCase, ownerOf, outbound, q, resetBoth, setClock, type Firms } from "../helpers";
import { advanceClock } from "@/lib/cases";

let f: Firms;
beforeEach(async () => { f = await resetBoth(); });

const say = (o: { phone: string }, body: string, firm = f.a) => handleInbound(firm.firmId, o.phone, body);

async function optedInOwner() {
  const [c] = await caseWhere(f.a, "stage = 'filed'");
  return { c, owner: await ownerOf(f.a, c) };
}

describe("opt-in", () => {
  it("a new owner gets one opt-in request and the stage text is held", async () => {
    const { owner } = await newOwnerCase(f.a, 1);
    expect(owner.consent).toBe("pending");
    const out = await outbound(f.a, owner.id);
    expect(out.map((m) => [m.kind, m.status])).toEqual([["opt_in", "sent"], ["stage", "held_opt_in"]]);
  });

  it("nothing else sends before YES, and no second request goes out", async () => {
    const { c, owner } = await newOwnerCase(f.a, 2);
    await advanceMany(f.a, [c.id], "court_date_set");
    const out = await outbound(f.a, owner.id);
    expect(out.filter((m) => m.status === "sent").map((m) => m.kind)).toEqual(["opt_in"]);
    expect(out.filter((m) => m.kind === "opt_in").length).toBe(1);
  });

  it("YES records timestamp, method and the exact text, then releases held texts", async () => {
    const { owner } = await newOwnerCase(f.a, 3);
    const [request] = await outbound(f.a, owner.id);
    expect(await say(owner, " yes ")).toBe("opted_in");
    const [ev] = await q(f.a, "select * from consent_events where owner_id = $1", [owner.id]);
    expect(ev).toMatchObject({ kind: "opt_in", method: "sms_reply", keyword: "YES", consent_text: request.body });
    expect(ev.at).toBeInstanceOf(Date);
    const out = await outbound(f.a, owner.id);
    expect(out.at(-1)).toMatchObject({ kind: "stage", status: "sent", body: "We filed eviction today for 3 Sample Test Street." });
  });

  it("other replies before YES don't opt in", async () => {
    const { owner } = await newOwnerCase(f.a, 4);
    expect(await say(owner, "maybe")).toBe("ignored");
    expect((await ownerOf(f.a, { owner_id: owner.id })).consent).toBe("pending");
  });

  it("the opt-in request itself respects quiet hours", async () => {
    await setClock(f.a, "2026-06-15T03:00:00Z"); // 11pm ET
    const { owner } = await newOwnerCase(f.a, 5);
    expect((await outbound(f.a, owner.id))[0]).toMatchObject({ kind: "opt_in", status: "queued", quiet_held: true });
  });
});

describe("opt-out", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeKeyword("  sToP\n")).toBe("STOP");
  });

  it.each(STOP_WORDS)("%s opts out at once, confirms once, and blocks further sends", async (word) => {
    const { c, owner } = await optedInOwner();
    const lower = `  ${word.toLowerCase()} `;
    expect(await say(owner, lower)).toBe("opted_out");
    expect((await ownerOf(f.a, c)).consent).toBe("opted_out");

    const confirmations = (await outbound(f.a, owner.id)).filter((m) => m.body.includes("unsubscribed"));
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].status).toBe("sent");

    await advanceMany(f.a, [c.id], "court_date_set");
    expect((await outbound(f.a, owner.id)).at(-1)).toMatchObject({ status: "blocked", block_reason: "opted_out" });

    expect(await say(owner, word)).toBe("already_opted_out");
    expect((await outbound(f.a, owner.id)).filter((m) => m.body.includes("unsubscribed"))).toHaveLength(1);
  });

  it("a text waiting for quiet hours is cancelled by STOP", async () => {
    await sendGroup(f.a, "dismissed");
    const [o] = await q(f.a, "select * from owners where timezone = 'America/Los_Angeles'");
    await say(o, "STOP");
    await advanceClock(f.a, 2);
    const out = await outbound(f.a, o.id);
    expect(out.find((m) => m.stage_code === "dismissed_paid")).toMatchObject({ status: "blocked" });
  });

  it("STOP also works before opt-in and cancels held texts", async () => {
    const { owner } = await newOwnerCase(f.a, 6);
    await say(owner, "stop");
    expect((await outbound(f.a, owner.id)).find((m) => m.kind === "stage")).toMatchObject({ status: "blocked" });
  });

  it.each(START_WORDS)("%s re-opts in and sending resumes", async (word) => {
    const { c, owner } = await optedInOwner();
    await say(owner, "STOP");
    expect(await say(owner, word.toLowerCase())).toBe("opted_in");
    const [ev] = await q(f.a, "select * from consent_events where owner_id = $1 and kind = 're_opt_in'", [owner.id]);
    expect(ev.keyword).toBe(word);
    await advanceMany(f.a, [c.id], "court_date_set");
    expect((await outbound(f.a, owner.id)).at(-1)).toMatchObject({ status: "sent", stage_code: "court_date_set" });
  });

  it("YES doesn't undo a STOP", async () => {
    const { c, owner } = await optedInOwner();
    await say(owner, "STOP");
    expect(await say(owner, "YES")).toBe("ignored");
    expect((await ownerOf(f.a, c)).consent).toBe("opted_out");
  });
});

describe("HELP", () => {
  it("returns firm name and contact info, case-insensitive", async () => {
    const { owner } = await optedInOwner();
    expect(await say(owner, "  help ")).toBe("help");
    const last = (await outbound(f.a, owner.id)).at(-1)!;
    expect(last.body).toContain("Pinecrest Property Group");
    expect(last.body).toContain("(919) 555-0100");
    expect(last.body).toContain("help@pinecrest.example");
    expect(last.status).toBe("sent");
  });

  it("uses the right firm's details", async () => {
    const [c] = await caseWhere(f.b, "stage = 'court_date_set'");
    const o = await ownerOf(f.b, c);
    await say(o, "HELP", f.b);
    expect((await outbound(f.b, o.id)).at(-1)!.body).toContain("Harbor Lane Rentals");
  });

  it("is answered in quiet hours, as are STOP confirmations", async () => {
    await setClock(f.a, "2026-06-15T03:00:00Z");
    const { owner } = await optedInOwner();
    await say(owner, "HELP");
    expect((await outbound(f.a, owner.id)).at(-1)).toMatchObject({ status: "sent" });
  });
});

describe("routing", () => {
  it("an unknown number changes nothing", async () => {
    expect(await handleInbound(f.a.firmId, "+19845559999", "STOP")).toBe("unknown_sender");
  });

  it("a number that belongs to firm B isn't found under firm A", async () => {
    const [c] = await caseWhere(f.b, "true");
    const o = await ownerOf(f.b, c);
    expect(await handleInbound(f.a.firmId, o.phone, "STOP")).toBe("unknown_sender");
    expect((await ownerOf(f.b, c)).consent).toBe("opted_in");
  });

  it("every inbound text and outcome is in the audit log", async () => {
    const { owner } = await optedInOwner();
    await say(owner, "STOP");
    const rows = await q(f.a, "select action from audit_log where detail->>'owner' = $1 order by seq", [owner.name]);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["text.received", "consent.opt_out", "text.queued", "text.sent"]));
  });
});
