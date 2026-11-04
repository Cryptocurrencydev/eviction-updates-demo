import { beforeEach, describe, expect, it } from "vitest";
import { advanceClock, advanceMany, recordResult, sendGroup } from "@/lib/cases";
import { decideByLink, linkState, signToken, verifyToken } from "@/lib/decision";
import { getReminders } from "@/lib/reminders";
import { withFirm, withSystem } from "@/lib/db";
import { handleInbound } from "@/lib/messaging/inbound";
import { caseWhere, ownerOf, outbound, q, resetBoth, type Firms } from "../helpers";
import type { CaseRow } from "@/lib/types";

let f: Firms;
let c: CaseRow;
let token: string;
let owner: Awaited<ReturnType<typeof ownerOf>>;

const tokenFrom = (body: string) => body.match(/\/d\/([\w.-]+)/)![1];

beforeEach(async () => {
  f = await resetBoth();
  // The writ filed today, with two days to reply.
  [c] = await caseWhere(f.a, "stage = 'writ_filed' and reply_deadline > (select demo_now from firms) + interval '36 hours'");
  owner = await ownerOf(f.a, c);
  const writ = (await outbound(f.a, owner.id)).find((m) => m.stage_code === "writ_filed")!;
  token = tokenFrom(writ.body);
});

const fresh = async () => (await caseWhere(f.a, "id = $1", [c.id]))[0];

describe("reply keywords", () => {
  it("STAY closes the case with a confirmation", async () => {
    expect(await handleInbound(f.a.firmId, owner.phone, " stay ")).toBe("decision");
    expect((await fresh()).stage).toBe("stay_closed");
    const [d] = await q(f.a, "select * from decisions where case_id = $1", [c.id]);
    expect(d).toMatchObject({ choice: "STAY", channel: "sms" });
    expect(d.decided_by).toContain(owner.name);
    expect(d.decided_at).toBeInstanceOf(Date);
    expect((await outbound(f.a, owner.id)).at(-1)!.body).toContain("resident stays");
  });

  it("LOCKOUT moves to lockout scheduled and texts the date", async () => {
    await handleInbound(f.a.firmId, owner.phone, "LOCKOUT");
    const after = await fresh();
    expect(after.stage).toBe("lockout_scheduled");
    expect(after.lockout_at).not.toBeNull();
    expect((await outbound(f.a, owner.id)).at(-1)!.body).toMatch(/Lockout is scheduled for .* on \w+, \w+ \d+ at \d+:\d+ AM/);
  });

  it("an unrecognised reply gets one short text with the two options, and the case doesn't move", async () => {
    const before = (await outbound(f.a, owner.id)).length;
    expect(await handleInbound(f.a.firmId, owner.phone, "what does this mean")).toBe("unrecognised");
    const out = await outbound(f.a, owner.id);
    expect(out.length).toBe(before + 1);
    expect(out.at(-1)!.body).toContain("STAY");
    expect(out.at(-1)!.body).toContain("LOCKOUT");
    expect((await fresh()).stage).toBe("writ_filed");
  });

  it("a reply with two decisions open never guesses", async () => {
    await withSystem((tx) => tx.query(
      "update cases set owner_id = $1 where id = (select id from cases where stage = 'writ_filed' and id <> $2 and firm_id = $3 limit 1)",
      [owner.id, c.id, f.a.firmId],
    ));
    expect(await handleInbound(f.a.firmId, owner.phone, "STAY")).toBe("ambiguous");
    expect((await q(f.a, "select count(*)::int as n from decisions where choice = 'STAY'"))[0].n).toBe(0);
  });

  it("a reply while the case is paused for appeal does nothing to it", async () => {
    await recordResult(f.a, [c.id], "appeal_filed");
    await sendGroup(f.a, "appeal");
    expect(await handleInbound(f.a.firmId, owner.phone, "STAY")).toBe("no_open_decision");
    expect((await fresh()).stage).toBe("appeal_filed");
  });
});

describe("one-click link", () => {
  it("rides along with the word-for-word writ text", async () => {
    const writ = (await outbound(f.a, owner.id)).find((m) => m.stage_code === "writ_filed")!;
    expect(writ.body).toMatch(/^The writ was filed for .*Please reply by .*\.\n\nOr tap to choose: http/s);
  });

  it("viewing doesn't spend it", async () => {
    expect((await linkState(token)).state).toBe("ready");
    expect((await linkState(token)).state).toBe("ready");
  });

  it("records the choice with channel link and advances", async () => {
    const r = await decideByLink(token, "LOCKOUT");
    expect(r).toMatchObject({ state: "already", choice: "LOCKOUT", channel: "link" });
    expect((await fresh()).stage).toBe("lockout_scheduled");
  });

  it("is single-use: a second attempt shows already recorded and changes nothing", async () => {
    await decideByLink(token, "STAY");
    const second = await decideByLink(token, "LOCKOUT");
    expect(second).toMatchObject({ state: "already", choice: "STAY" });
    expect((await fresh()).stage).toBe("stay_closed");
    expect((await q(f.a, "select count(*)::int as n from decisions where case_id = $1", [c.id]))[0].n).toBe(1);
  });

  it("two simultaneous clicks record exactly one decision", async () => {
    await Promise.allSettled([decideByLink(token, "STAY"), decideByLink(token, "LOCKOUT")]);
    expect((await q(f.a, "select count(*)::int as n from decisions where case_id = $1", [c.id]))[0].n).toBe(1);
  });

  it("a text reply after the link shows as already recorded on the link", async () => {
    await handleInbound(f.a.firmId, owner.phone, "STAY");
    expect(await linkState(token)).toMatchObject({ state: "already", channel: "sms" });
  });

  it("expires at the reply-by deadline", async () => {
    await advanceClock(f.a, 24 * 3);
    expect((await linkState(token)).state).toBe("expired");
    await decideByLink(token, "STAY");
    expect((await fresh()).stage).toBe("writ_filed");
  });

  it("rejects a tampered token", async () => {
    const [data, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ t: "00000000-0000-0000-0000-000000000000", f: f.a.firmId })).toString("base64url");
    expect(verifyToken(`${other}.${sig}`)).toBeNull();
    expect(verifyToken(`${data}.${sig}x`)).toBeNull();
    expect((await linkState("nonsense")).state).toBe("invalid");
  });

  it("a validly signed token for another firm finds nothing", async () => {
    const payload = verifyToken(token)!;
    const crossed = signToken({ t: payload.t, f: f.b.firmId });
    expect((await linkState(crossed)).state).toBe("invalid");
  });

  it("is paused during an appeal, and re-filing issues a fresh link", async () => {
    await recordResult(f.a, [c.id], "appeal_filed");
    await sendGroup(f.a, "appeal");
    expect((await linkState(token)).state).toBe("paused");
    await advanceMany(f.a, [c.id], "writ_filed", { reply_deadline: "2030-01-01T17:00:00Z" });
    const writs = (await outbound(f.a, owner.id)).filter((m) => m.stage_code === "writ_filed");
    expect((await linkState(token)).state).toBe("expired");
    expect((await linkState(tokenFrom(writs.at(-1)!.body))).state).toBe("ready");
  });
});

describe("team reminders", () => {
  it("covers all five kinds from the seed", async () => {
    const r = await withFirm(f.a, getReminders);
    const kinds = new Set(r.map((x) => x.kind));
    expect([...kinds].sort()).toEqual(["appeal_closing", "deadline_missed", "decision_stale", "hearing", "writ_ready"]);
  });

  it("no reply by the deadline shows up, and clears once decided", async () => {
    const hit = (r: Awaited<ReturnType<typeof getReminders>>) => r.find((x) => x.caseId === c.id && x.kind === "deadline_missed");
    expect(hit(await withFirm(f.a, getReminders))).toBeUndefined();
    await advanceClock(f.a, 24 * 3);
    expect(hit(await withFirm(f.a, getReminders))).toBeDefined();
    await handleInbound(f.a.firmId, owner.phone, "STAY");
    expect(hit(await withFirm(f.a, getReminders))).toBeUndefined();
  });
});
