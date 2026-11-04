import { DateTime, IANAZone } from "luxon";
import Papa from "papaparse";
import { audit } from "./audit";
import { queueStageText } from "./cases";
import { withFirm, type FirmCtx, type Tx } from "./db";
import { dispatchDue, loadFirm } from "./messaging/outbox";
import type { CaseRow, Firm, Owner } from "./types";

export const CSV_COLUMNS = [
  "case number", "county", "filing date", "property address", "resident name",
  "owner name", "owner phone", "owner time zone", "hearing date",
] as const;

const ZONE_ALIASES: Record<string, string> = {
  ET: "America/New_York", EASTERN: "America/New_York", CT: "America/Chicago", CENTRAL: "America/Chicago",
  MT: "America/Denver", MOUNTAIN: "America/Denver", PT: "America/Los_Angeles", PACIFIC: "America/Los_Angeles",
};

export type CsvRow = {
  caseNumber: string; county: string; filingDate: string; address: string; resident: string;
  ownerName: string; ownerPhone: string; ownerTimezone: string; hearingDate: string;
};
export type RowError = { field: string; message: string };
export type RowResult = { line: number; row: CsvRow; errors: RowError[] };
export type CsvPreview = { rows: RowResult[]; valid: number; invalid: number; fileError?: string };

/** US numbers only. Returns E.164 or null. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

export function normalizeZone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const alias = ZONE_ALIASES[v.toUpperCase()];
  if (alias) return alias;
  return v.includes("/") && IANAZone.isValidZone(v) ? v : null;
}

function parseDate(raw: string): DateTime | null {
  for (const f of ["yyyy-MM-dd", "M/d/yyyy"]) {
    const d = DateTime.fromFormat(raw.trim(), f);
    if (d.isValid) return d;
  }
  return null;
}

const dupKey = (county: string, caseNumber: string) => `${county.trim().toLowerCase()}|${caseNumber.trim().toLowerCase()}`;

/** `existing` holds county|case number keys already in this firm. */
export function validateCsv(text: string, existing: Set<string>): CsvPreview {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase(),
  });
  const missing = CSV_COLUMNS.filter((c) => !parsed.meta.fields?.includes(c));
  if (missing.length) return { rows: [], valid: 0, invalid: 0, fileError: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` };
  if (parsed.data.length === 0) return { rows: [], valid: 0, invalid: 0, fileError: "The file has no rows." };

  const seen = new Set<string>();
  const rows = parsed.data.map((r, i): RowResult => {
    const get = (k: (typeof CSV_COLUMNS)[number]) => (r[k] ?? "").trim();
    const row: CsvRow = {
      caseNumber: get("case number"), county: get("county"), filingDate: get("filing date"), address: get("property address"),
      resident: get("resident name"), ownerName: get("owner name"), ownerPhone: get("owner phone"),
      ownerTimezone: get("owner time zone"), hearingDate: get("hearing date"),
    };
    const errors: RowError[] = [];
    const need = (value: string, field: string, label: string) => {
      if (!value) errors.push({ field, message: `Missing ${label}` });
    };
    need(row.caseNumber, "caseNumber", "case number");
    need(row.county, "county", "county");
    need(row.address, "address", "property address");
    need(row.resident, "resident", "resident name");
    need(row.ownerName, "ownerName", "owner name");
    if (!normalizePhone(row.ownerPhone)) errors.push({ field: "ownerPhone", message: `Bad phone number "${row.ownerPhone}"` });
    if (!normalizeZone(row.ownerTimezone)) errors.push({ field: "ownerTimezone", message: `Unknown time zone "${row.ownerTimezone}"` });
    const filing = parseDate(row.filingDate);
    const hearing = parseDate(row.hearingDate);
    if (!filing) errors.push({ field: "filingDate", message: `Bad filing date "${row.filingDate}"` });
    if (!hearing) errors.push({ field: "hearingDate", message: `Bad hearing date "${row.hearingDate}"` });
    if (filing && hearing && hearing < filing) errors.push({ field: "hearingDate", message: "Hearing date is before the filing date" });
    if (row.caseNumber && row.county) {
      const key = dupKey(row.county, row.caseNumber);
      if (existing.has(key)) errors.push({ field: "caseNumber", message: `Case ${row.caseNumber} already exists in ${row.county} County` });
      else if (seen.has(key)) errors.push({ field: "caseNumber", message: `Duplicate of an earlier row: ${row.caseNumber} in ${row.county} County` });
      seen.add(key);
    }
    return { line: i + 2, row, errors };
  });
  const invalid = rows.filter((r) => r.errors.length).length;
  return { rows, valid: rows.length - invalid, invalid };
}

async function existingKeys(tx: Tx) {
  const { rows } = await tx.query<{ county: string; case_number: string }>("select county, case_number from cases");
  return new Set(rows.map((r) => dupKey(r.county, r.case_number)));
}

export const previewCsv = (ctx: FirmCtx, text: string) => withFirm(ctx, async (tx) => validateCsv(text, await existingKeys(tx)));

async function upsertOwner(tx: Tx, firm: Firm, r: CsvRow): Promise<Owner> {
  const { rows } = await tx.query<Owner>(
    `insert into owners (firm_id, name, phone, timezone) values ($1,$2,$3,$4)
     on conflict (firm_id, phone) do update set name = excluded.name returning *`,
    [firm.id, r.ownerName, normalizePhone(r.ownerPhone), normalizeZone(r.ownerTimezone)],
  );
  return rows[0];
}

/** Revalidates on the server, then commits only the valid rows. */
export async function commitCsv(ctx: FirmCtx, filename: string, text: string) {
  return withFirm(ctx, async (tx) => {
    const firm = await loadFirm(tx);
    const preview = validateCsv(text, await existingKeys(tx));
    if (preview.fileError) return { created: 0, skipped: 0, fileError: preview.fileError };
    await audit(tx, firm.id, ctx.actor, "csv.uploaded", { filename, valid: preview.valid, invalid: preview.invalid });

    for (const { row, errors } of preview.rows) {
      if (errors.length) continue;
      const owner = await upsertOwner(tx, firm, row);
      // The CSV has a date only, so the time is a demo default.
      const courtAt = parseDate(row.hearingDate)!.setZone(firm.timezone, { keepLocalTime: true }).set({ hour: 9, minute: 30 }).toJSDate();
      const { rows } = await tx.query<CaseRow>(
        `insert into cases (firm_id, owner_id, case_number, county, filing_date, address, resident_name, court_at, stage_changed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [firm.id, owner.id, row.caseNumber, row.county, parseDate(row.filingDate)!.toISODate(), row.address, row.resident, courtAt, firm.demo_now],
      );
      await audit(tx, firm.id, ctx.actor, "case.created", { case_number: row.caseNumber, county: row.county }, rows[0].id);
      await queueStageText(tx, firm, rows[0], "filed", ctx.actor);
    }
    await dispatchDue(tx);
    return { created: preview.valid, skipped: preview.invalid };
  });
}

const STREETS = ["Oak Street", "Maple Avenue", "Birch Lane", "Cedar Court", "Willow Road", "Elm Street", "Dogwood Drive", "Laurel Way", "Hickory Trail", "Magnolia Place"];
const FIRST = ["Avery", "Blake", "Casey", "Dana", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Logan", "Morgan", "Parker", "Quinn", "Reese", "Sawyer"];
const LAST = ["Alder", "Brookes", "Calloway", "Dunmore", "Ellery", "Fairchild", "Greaves", "Hollins", "Ingram", "Jessup"];

/** 25 good rows and 3 bad. `start` keeps case numbers fresh so the sample can be uploaded repeatedly. */
export function sampleCsv(firm: Pick<Firm, "demo_now">, start: number): string {
  const d = DateTime.fromJSDate(firm.demo_now).toUTC();
  const filing = d.toISODate()!;
  const hearing = d.plus({ days: 7 }).toISODate()!;
  const yy = d.toFormat("yy");
  const num = (i: number) => `${yy}CV${String(start + i).padStart(6, "0")}-910`;
  const row = (i: number, over: Partial<Record<(typeof CSV_COLUMNS)[number], string>> = {}) => {
    const owner = `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
    const resident = `${FIRST[(i + 7) % FIRST.length]} ${LAST[(i + 4) % LAST.length]}`;
    const base: Record<string, string> = {
      "case number": num(i), county: "Wake", "filing date": filing,
      "property address": `${200 + i * 4} Sample ${STREETS[i % STREETS.length]}, Raleigh, NC`,
      "resident name": resident, "owner name": owner,
      "owner phone": `(984) 555-${String(1000 + ((start + i) % 8999)).padStart(4, "0")}`,
      "owner time zone": i % 8 === 3 ? "America/Los_Angeles" : "America/New_York",
      "hearing date": hearing,
    };
    return { ...base, ...over };
  };
  const rows = Array.from({ length: 25 }, (_, i) => row(i));
  rows.push(row(25, { "owner phone": "555-12", "owner time zone": "Mars/Olympus" })); // bad phone + unknown zone
  rows.push(row(26, { "case number": "" })); // missing case number
  rows.push(row(27, { "case number": num(2) })); // duplicate of row 3, same county
  return Papa.unparse({ fields: [...CSV_COLUMNS], data: rows.map((r) => CSV_COLUMNS.map((c) => r[c])) });
}
