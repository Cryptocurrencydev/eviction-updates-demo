import { DateTime } from "luxon";
import { audit } from "./audit";
import type { Tx } from "./db";
import { signToken } from "./decision";
import { optInText } from "./messaging/outbox";
import { fmtDateTime, fmtDay, fmtTime, renderTemplate } from "./messaging/render";
import { appUrl } from "./secret";

export const DEMO_FIRMS = [
  {
    slug: "pinecrest", name: "Pinecrest Property Group", sms_number: "+19195550100", timezone: "America/New_York",
    contact_phone: "(919) 555-0100", contact_email: "help@pinecrest.example", area: "919", county: "Wake", city: "Raleigh", code: "910",
    users: [
      { email: "admin@pinecrest.example", name: "Morgan Vance", role: "admin" },
      { email: "team@pinecrest.example", name: "Riley Okafor", role: "team" },
    ],
  },
  {
    slug: "harbor-lane", name: "Harbor Lane Rentals", sms_number: "+19105550100", timezone: "America/New_York",
    contact_phone: "(910) 555-0100", contact_email: "help@harborlane.example", area: "910", county: "New Hanover", city: "Wilmington", code: "640",
    users: [
      { email: "admin@harborlane.example", name: "Sam Whitfield", role: "admin" },
      { email: "team@harborlane.example", name: "Jamie Castellano", role: "team" },
    ],
  },
] as const;

type Spec = {
  path: string[];           // stages the case has been through, last is current
  pending?: string;         // recorded result waiting on the team screen
  consent?: "opted_in" | "pending" | "opted_out";
  tz?: string;
  writ?: { filedDaysAgo: number; deadlineDays: number };
  pausedFrom?: string;
  possessionDaysAgo?: number;
  lockoutInDays?: number;
  keysDaysAgo?: number;
  courtInDays?: number;
};

const THROUGH_COURT = ["filed", "court_date_set", "court_day"];
const THROUGH_WON = [...THROUGH_COURT, "possession_won"];
const THROUGH_WRIT = [...THROUGH_WON, "writ_filed"];
const THROUGH_LOCKOUT = [...THROUGH_WRIT, "lockout_scheduled"];
const rep = (n: number, s: Spec) => Array.from({ length: n }, () => s);

/** Pinecrest opens on the client's picture: 5 + 7 due, 2 continued, 1 appeal, 3 writ, 2 lockout, 1 keys held. */
const PINECREST: Spec[] = [
  { path: THROUGH_COURT, pending: "dismissed_paid", tz: "America/Los_Angeles" },
  ...rep(4, { path: THROUGH_COURT, pending: "dismissed_paid" }),
  ...rep(5, { path: THROUGH_COURT, pending: "possession_won" }),
  { path: THROUGH_COURT, pending: "possession_won", consent: "pending" },
  { path: THROUGH_COURT, pending: "possession_won", consent: "opted_out" },
  ...rep(2, { path: THROUGH_COURT, pending: "continued_pending" }),
  { path: THROUGH_WON, pending: "appeal_filed", possessionDaysAgo: 4 },
  { path: THROUGH_WRIT, writ: { filedDaysAgo: 0, deadlineDays: 2 }, possessionDaysAgo: 12 },
  { path: THROUGH_WRIT, writ: { filedDaysAgo: 3, deadlineDays: 1 }, possessionDaysAgo: 14 },
  { path: THROUGH_WRIT, writ: { filedDaysAgo: 5, deadlineDays: -1 }, possessionDaysAgo: 16 },
  ...rep(2, { path: THROUGH_LOCKOUT, lockoutInDays: 3, possessionDaysAgo: 18 }),
  { path: THROUGH_LOCKOUT, pending: "lockout_complete", lockoutInDays: 0, possessionDaysAgo: 22 },
  // Outside her picture: gives the cases list, reminders and writ step something to show.
  { path: ["filed"], courtInDays: 7 },
  { path: ["filed", "court_date_set"], courtInDays: 1 },
  { path: ["filed", "court_date_set"], courtInDays: 3 },
  ...rep(2, { path: THROUGH_COURT }),
  { path: THROUGH_WON, possessionDaysAgo: 8 },
  { path: THROUGH_WON, possessionDaysAgo: 11 },
];

const HARBOR: Spec[] = [
  ...rep(2, { path: THROUGH_COURT, pending: "dismissed_paid" }),
  ...rep(2, { path: THROUGH_COURT, pending: "possession_won" }),
  { path: THROUGH_COURT, pending: "continued_pending" },
  { path: THROUGH_WRIT, writ: { filedDaysAgo: 1, deadlineDays: 2 }, possessionDaysAgo: 12 },
  { path: THROUGH_LOCKOUT, lockoutInDays: 4, possessionDaysAgo: 20 },
  { path: ["filed", "court_date_set"], courtInDays: 2 },
];

const STREETS = [
  "Oak Street", "Maple Avenue", "Birch Lane", "Cedar Court", "Willow Road", "Elm Street", "Dogwood Drive", "Laurel Way",
  "Hickory Trail", "Magnolia Place", "Poplar Street", "Sycamore Lane", "Chestnut Avenue", "Ash Court", "Juniper Road",
  "Holly Street", "Aspen Way", "Cypress Drive", "Linden Avenue", "Hazel Lane", "Spruce Court", "Alder Road", "Rowan Street",
  "Beech Avenue", "Tupelo Way", "Redbud Lane", "Sumac Drive", "Larch Court", "Pecan Street", "Mulberry Road",
];
const OWNERS = [
  "Marisol Tran", "Devon Ashby", "Priya Natarajan", "Theo Lindqvist", "Grace Adeyemi", "Omar Haddad", "Lena Kowalski", "Marcus Bell",
  "Yuki Tanaka", "Rosa Delgado", "Henry Osei", "Nadia Farouk", "Caleb Whitmore", "Ines Moreau", "Tobias Reed", "Amara Nwosu",
  "Jonah Feld", "Clara Sorensen", "Andre Baptiste", "Mei Lin Zhou", "Felix Brandt", "Sofia Marchetti", "Ezra Holloway", "Tessa Quinlan",
  "Ravi Menon", "Hana Suzuki", "Luis Carrasco", "Greta Nilsson", "Kofi Mensah", "Elise Fontaine",
];
const RESIDENTS = [
  "A. Sample", "B. Example", "C. Placeholder", "D. Fictional", "E. Sample", "F. Example", "G. Placeholder", "H. Fictional",
  "J. Sample", "K. Example", "L. Placeholder", "M. Fictional", "N. Sample", "P. Example", "R. Placeholder", "S. Fictional",
];

export function demoStart(tz: string): Date {
  let d = DateTime.now().setZone(tz).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toJSDate();
}

/** Courts and sheriffs don't work weekends: past dates slip back to Friday, future ones forward to Monday. */
function workday(d: DateTime, now: DateTime): DateTime {
  if (d.weekday <= 5) return d;
  const step = d < now ? -1 : 1;
  let out = d;
  while (out.weekday > 5) out = out.plus({ days: step });
  return out;
}

async function seedCases(tx: Tx, firm: (typeof DEMO_FIRMS)[number], firmId: string, specs: Spec[], now: DateTime) {
  const tz = firm.timezone;
  const templates = new Map<string, string>(
    (await tx.query("select code, default_template from stages")).rows.map((r) => [r.code, r.default_template]),
  );
  const courtToday = now.set({ hour: 9, minute: 0 });
  const insertMsg = (ownerId: string, caseId: string | null, dir: string, kind: string, stage: string | null, body: string, at: Date) =>
    tx.query(
      `insert into messages (firm_id, owner_id, case_id, direction, kind, stage_code, body, status, created_at, sent_at, provider_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)`,
      [firmId, ownerId, caseId, dir, kind, stage, body, dir === "in" ? "received" : "sent", at, dir === "in" ? null : "sim_seed"],
    );

  for (const [i, s] of specs.entries()) {
    const consent = s.consent ?? "opted_in";
    const tzOwner = s.tz ?? tz;
    const phone = `+1${firm.area}5550${String(101 + i).padStart(3, "0")}`;
    const stage = s.path[s.path.length - 1];
    const filedAt = now.minus({ days: 30 - (i % 7) });
    const wonDay = s.possessionDaysAgo ? workday(now.minus({ days: s.possessionDaysAgo }), now) : null;
    const courtAt = s.courtInDays != null ? workday(now.plus({ days: s.courtInDays }), now).set({ hour: 9, minute: 0 })
      : wonDay ? wonDay.set({ hour: 9, minute: 0 }) : courtToday;
    const possessionAt = wonDay?.set({ hour: 11, minute: 0 }) ?? null;
    const deadline = s.writ ? now.plus({ days: s.writ.deadlineDays }).set({ hour: 17, minute: 0 }) : null;
    const lockoutAt = s.lockoutInDays != null ? workday(now.plus({ days: s.lockoutInDays }), now).set({ hour: s.lockoutInDays === 0 ? 8 : 10, minute: 0 }) : null;
    const address = `${112 + i * 6} Sample ${STREETS[i % STREETS.length]}`;
    const caseNumber = `${now.toFormat("yy")}CV${String(1001 + i).padStart(6, "0")}-${firm.code}`;

    const owner = (await tx.query(
      `insert into owners (firm_id, name, phone, timezone, consent, opt_in_requested_at) values ($1,$2,$3,$4,$5,$6) returning id`,
      [firmId, OWNERS[i % OWNERS.length], phone, tzOwner, consent, filedAt.toJSDate()],
    )).rows[0].id as string;

    const c = (await tx.query(
      `insert into cases (firm_id, owner_id, case_number, county, filing_date, address, resident_name, stage, pending_stage,
         court_at, possession_at, writ_filed_at, reply_deadline, lockout_at, stage_changed_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) returning id`,
      [firmId, owner, caseNumber, firm.county, filedAt.toISODate(), address, `Resident ${RESIDENTS[i % RESIDENTS.length]}`, stage, s.pending ?? null,
       courtAt.toJSDate(), possessionAt?.toJSDate() ?? null, s.writ ? now.minus({ days: s.writ.filedDaysAgo }).toJSDate() : null,
       deadline?.toJSDate() ?? null, lockoutAt?.toJSDate() ?? null, now.minus({ days: 1 }).toJSDate()],
    )).rows[0].id as string;

    const consentText = optInText(firm);
    await insertMsg(owner, null, "out", "opt_in", null, consentText, filedAt.minus({ minutes: 10 }).toJSDate());
    if (consent === "pending") continue;
    await insertMsg(owner, null, "in", "reply", null, "YES", filedAt.minus({ minutes: 4 }).toJSDate());
    await tx.query(
      `insert into consent_events (firm_id, owner_id, kind, method, keyword, consent_text, at) values ($1,$2,'opt_in','sms_reply','YES',$3,$4)`,
      [firmId, owner, consentText, filedAt.minus({ minutes: 4 }).toJSDate()],
    );

    // When each text went out, so a thread reads in the order the case really moved.
    const writAt = s.writ ? now.minus({ days: s.writ.filedDaysAgo, hours: 1 }) : possessionAt?.plus({ days: 11 }) ?? now;
    const sentAt: Record<string, DateTime> = {
      filed: filedAt, court_date_set: filedAt.plus({ days: 2 }),
      possession_won: possessionAt ?? now, writ_filed: writAt, lockout_scheduled: writAt.plus({ days: 2 }),
    };
    for (const code of s.path) {
      const at = sentAt[code] ?? now;
      const template = templates.get(code);
      if (!template) continue;
      const when = code === "lockout_scheduled" ? lockoutAt : courtAt;
      let body = renderTemplate(template, {
        address, day: when ? fmtDay(when.toJSDate(), tz) : "", time: when ? fmtTime(when.toJSDate(), tz) : "",
        deadline: deadline ? fmtDateTime(deadline.toJSDate(), tz) : "",
      });
      if (code === "writ_filed" && deadline) {
        const token = (await tx.query(
          "insert into decision_tokens (firm_id, case_id, expires_at, created_at) values ($1,$2,$3,$4) returning id",
          [firmId, c, deadline.toJSDate(), now.toJSDate()],
        )).rows[0].id as string;
        body += `\n\nOr tap to choose: ${appUrl()}/d/${signToken({ t: token, f: firmId })}`;
      }
      if (code === "lockout_scheduled") {
        await tx.query(
          `insert into decisions (firm_id, case_id, choice, channel, decided_by, decided_at) values ($1,$2,'LOCKOUT','sms',$3,$4)`,
          [firmId, c, `${OWNERS[i % OWNERS.length]} (${phone})`, at.toJSDate()],
        );
        await insertMsg(owner, c, "in", "reply", null, "LOCKOUT", at.minus({ minutes: 20 }).toJSDate());
      }
      await insertMsg(owner, c, "out", "stage", code, body, at.toJSDate());
    }
    if (consent === "opted_out") {
      const outAt = now.minus({ hours: 18 }).toJSDate();
      await insertMsg(owner, null, "in", "reply", null, "STOP", outAt);
      await insertMsg(owner, null, "out", "compliance", null, `${firm.name}: you are unsubscribed and will get no more texts. Reply START to opt back in.`, outAt);
      await tx.query(
        `insert into consent_events (firm_id, owner_id, kind, method, keyword, at) values ($1,$2,'opt_out','sms_reply','STOP',$3)`,
        [firmId, owner, outAt],
      );
    }
  }
}

/** Puts one firm back to the opening scene. The audit log is untouched, because it is append-only. */
export async function resetFirm(tx: Tx, slug: string, actor: string) {
  const firm = DEMO_FIRMS.find((f) => f.slug === slug);
  if (!firm) throw new Error("unknown firm");
  const start = demoStart(firm.timezone);
  const { rows } = await tx.query(
    `insert into firms (slug, name, sms_number, timezone, demo_now) values ($1,$2,$3,$4,$5)
     on conflict (slug) do update set demo_now = excluded.demo_now returning id`,
    [firm.slug, firm.name, firm.sms_number, firm.timezone, start],
  );
  const firmId = rows[0].id as string;
  await tx.query(
    `insert into firm_settings (firm_id, contact_phone, contact_email) values ($1,$2,$3)
     on conflict (firm_id) do update set contact_phone = excluded.contact_phone, contact_email = excluded.contact_email`,
    [firmId, firm.contact_phone, firm.contact_email],
  );
  for (const u of firm.users) {
    await tx.query(
      "insert into users (firm_id, email, name, role) values ($1,$2,$3,$4) on conflict (email) do nothing",
      [firmId, u.email, u.name, u.role],
    );
  }
  await tx.query("delete from owners where firm_id = $1", [firmId]);
  await tx.query("delete from templates where firm_id = $1", [firmId]);
  await tx.query(
    `insert into subscriptions (firm_id, status, trial_ends_at) values ($1,'trialing',$2)
     on conflict (firm_id) do update set status = 'trialing', trial_ends_at = excluded.trial_ends_at,
       trial_ending_notice = false, grace_ends_at = null, stripe_subscription_id = null`,
    [firmId, DateTime.fromJSDate(start).plus({ days: 14 }).toJSDate()],
  );
  await seedCases(tx, firm, firmId, firm.slug === "pinecrest" ? PINECREST : HARBOR, DateTime.fromJSDate(start).setZone(firm.timezone));
  await audit(tx, firmId, actor, "demo.reset", { firm: firm.name });
  return firmId;
}
