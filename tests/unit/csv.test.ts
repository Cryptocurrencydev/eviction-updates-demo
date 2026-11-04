import { describe, expect, it } from "vitest";
import { normalizePhone, normalizeZone, sampleCsv, validateCsv, CSV_COLUMNS } from "@/lib/csv";

const HEAD = CSV_COLUMNS.join(",");
const row = (o: Partial<Record<string, string>> = {}) => {
  const r = { n: "26CV1", county: "Wake", filing: "2026-01-05", addr: "1 Sample Oak Street", res: "R", own: "O", phone: "(919) 555-0123", tz: "America/New_York", hearing: "2026-01-12", ...o };
  return [r.n, r.county, r.filing, r.addr, r.res, r.own, r.phone, r.tz, r.hearing].join(",");
};
const check = (...rows: string[]) => validateCsv([HEAD, ...rows].join("\n"), new Set());
const messages = (p: ReturnType<typeof check>, i = 0) => p.rows[i].errors.map((e) => e.message).join(" | ");

describe("csv validation", () => {
  it("accepts a good row", () => {
    expect(check(row())).toMatchObject({ valid: 1, invalid: 0 });
  });

  it.each(["555-12", "abc", "(919) 155-0123", "919555012", "+44 20 7946 0958"])("catches bad phone %s", (phone) => {
    expect(messages(check(row({ phone })))).toContain("Bad phone");
  });

  it("catches a missing case number", () => {
    expect(messages(check(row({ n: "" })))).toContain("Missing case number");
  });

  it("catches a duplicate case number in the same county within the file", () => {
    const p = check(row(), row());
    expect(p.valid).toBe(1);
    expect(messages(p, 1)).toContain("Duplicate");
  });

  it("allows the same case number in a different county", () => {
    expect(check(row(), row({ county: "Durham" })).invalid).toBe(0);
  });

  it("catches a duplicate of a case already in the firm", () => {
    const p = validateCsv([HEAD, row()].join("\n"), new Set(["wake|26cv1"]));
    expect(p.rows[0].errors[0].message).toContain("already exists");
  });

  it.each(["Mars/Olympus", "Eastern Standard", "", "New_York"])("catches unknown time zone '%s'", (tz) => {
    expect(messages(check(row({ tz })))).toContain("Unknown time zone");
  });

  it("catches bad dates and a hearing before filing", () => {
    expect(messages(check(row({ filing: "soon" })))).toContain("Bad filing date");
    expect(messages(check(row({ hearing: "13/45/2026" })))).toContain("Bad hearing date");
    expect(messages(check(row({ hearing: "2026-01-01" })))).toContain("before the filing date");
  });

  it("reports every problem on a row, with its spreadsheet line number", () => {
    const p = check(row(), row({ n: "2", phone: "x", tz: "y" }));
    expect(p.rows[1].line).toBe(3);
    expect(p.rows[1].errors).toHaveLength(2);
  });

  it("rejects a file with missing columns", () => {
    expect(validateCsv("case number,county\n1,Wake", new Set()).fileError).toContain("owner phone");
  });

  it("rejects an empty file", () => {
    expect(validateCsv(HEAD, new Set()).fileError).toContain("no rows");
  });

  it("tolerates a BOM, odd header case and quoted commas", () => {
    const text = `﻿${HEAD.toUpperCase()}\n26CV2,Wake,1/5/2026,"1 Sample Oak Street, Raleigh",R,O,9195550123,PT,1/12/2026`;
    expect(validateCsv(text, new Set())).toMatchObject({ valid: 1, invalid: 0 });
  });

  it("normalises phones and zones", () => {
    expect(normalizePhone("1 (919) 555-0123")).toBe("+19195550123");
    expect(normalizeZone("pt")).toBe("America/Los_Angeles");
  });

  it("the sample has 25 good rows, 3 bad rows and all four error types", () => {
    const p = validateCsv(sampleCsv({ demo_now: new Date("2026-06-15T14:00:00Z") }, 5000), new Set());
    expect(p.rows).toHaveLength(28);
    expect(p).toMatchObject({ valid: 25, invalid: 3 });
    const all = p.rows.flatMap((r) => r.errors.map((e) => e.message)).join(" | ");
    for (const s of ["Bad phone", "Unknown time zone", "Missing case number", "Duplicate"]) expect(all).toContain(s);
  });
});
