import { beforeEach, describe, expect, it } from "vitest";
import { commitCsv, previewCsv, sampleCsv } from "@/lib/csv";
import { q, resetBoth, type Firms } from "../helpers";

let f: Firms;
beforeEach(async () => { f = await resetBoth(); });

describe("csv commit", () => {
  it("commits only the valid rows, audits the upload and asks each new owner to opt in", async () => {
    const before = (await q(f.a, "select count(*)::int as n from cases"))[0].n;
    const text = sampleCsv({ demo_now: new Date() }, 7000);
    expect(await commitCsv(f.a, "sample.csv", text)).toMatchObject({ created: 25, skipped: 3 });
    expect((await q(f.a, "select count(*)::int as n from cases"))[0].n).toBe(before + 25);
    const [log] = await q(f.a, "select detail from audit_log where action = 'csv.uploaded' order by seq desc limit 1");
    expect(log.detail).toMatchObject({ filename: "sample.csv", valid: 25, invalid: 3 });
    const held = await q(f.a, "select count(*)::int as n from messages where status = 'held_opt_in'");
    expect(held[0].n).toBeGreaterThanOrEqual(25);
  });

  it("uploading the same file again finds every row is a duplicate", async () => {
    const text = sampleCsv({ demo_now: new Date() }, 7100);
    await commitCsv(f.a, "a.csv", text);
    const p = await previewCsv(f.a, text);
    expect(p.valid).toBe(0);
    expect(await commitCsv(f.a, "a.csv", text)).toMatchObject({ created: 0 });
  });

  it("a case number used by firm B is not a duplicate for firm A", async () => {
    const text = sampleCsv({ demo_now: new Date() }, 7200);
    await commitCsv(f.b, "b.csv", text);
    expect((await previewCsv(f.a, text)).valid).toBe(25);
  });
});
