# Docketlight

Keeps property owners updated by text while a property management firm runs their eviction cases.

**Live demo: https://eviction-updates-demo.vercel.app**

This is a pitch demo. The brand, firms, owners, residents and addresses are all fictional. No real text messages are sent. Nothing here is legal advice.

## What the demo shows

- **Court day screen.** The client's own layout: a reminder banner, one card per group, and one button that advances and texts a whole group.
- **Owner's phone.** A phone next to the team screen shows each text as it goes out, labelled with its stage. You can type replies as the owner.
- **Texting rules.** Owners must reply YES before anything else is sent. STOP works instantly. Texts only go out 8am to 9pm in the owner's own time zone.
- **Owner decision.** After the writ, the owner replies STAY or LOCKOUT, or taps a one-click link that works once. The case then moves by itself.
- **Two firms, kept apart.** Each firm sees only its own cases. Postgres enforces this, not just the app.
- **Audit log.** Every action is recorded, can't be edited, and can be checked with one button.
- **Billing.** One monthly plan with a 14-day trial, through Stripe test mode. Failed payment leads to a grace period, then read-only mode.

## Demo logins

There are no passwords. The login page has one button for each:

| Firm | Firm Admin | Team Member |
|---|---|---|
| Pinecrest Property Group | Morgan Vance | Riley Okafor |
| Harbor Lane Rentals | Sam Whitfield | Jamie Castellano |

Team Members can do everything except billing, team settings and text templates.

## Three-minute walkthrough

Press **Reset demo data** on the login page first, so the numbers match.

1. **Open the court day screen (20 seconds).** Log in as the Pinecrest Firm Admin. The banner says 12 cases are due an update, and the cards show 5, 7, 2, 1, 3, 2 and 1.
2. **Send one group (30 seconds).** Press **Send texts to these 5 owners** on Dismissed and paid. The confirm step warns that one owner is in quiet hours. Confirm. Four texts go now, and the phone shows one arriving under its stage heading.
3. **Watch quiet hours (20 seconds).** Pick Marisol Tran in the phone's dropdown. She is in Pacific time, where it's 7am, so her text is queued. Press **+1 hour** on the demo clock. It's now 8am for her, and the text arrives.
4. **Consent (40 seconds).** Press **Send texts to these 7 owners** on Possession won. The result says 5 sent, 1 held for opt-in, 1 opted out. Pick Henry Osei and press **YES** under the phone. The held text arrives. Press **STOP**: one confirmation comes back, then nothing else will.
5. **Owner decision (30 seconds).** Pick Amara Nwosu, who has a writ waiting. Tap the link in the text, then choose **Lockout**. Open the same link again: it says "Already recorded". Back on the team screen, the case has moved to Lockout scheduled.
6. **Firm isolation and the audit log (30 seconds).** Open **Audit log** and press **Verify log integrity**. Then press **Switch login**, choose Harbor Lane, and see different cases.
7. **Billing, if there's time (10 seconds).** As Firm Admin, open **Billing** and press **Payment fails**, then **Grace period ends**. Sending stops. **Payment recovers** turns it back on.

The demo is shared, so reset it again before the next person looks.

## The 13 stages

The client's flow is the source of truth, and her owner texts are used word for word as the default templates. **Her full scope sheet will set the final list.**

| No. | Stage | Owner text? | Leads to |
|---|---|---|---|
| 1 | Filed | Yes | Court date set |
| 2 | Court date set | Yes | Court day |
| 3 | Court day | No, internal | 3A, 3B, 3C or 3D |
| 3A | Dismissed and paid | Yes | Case ends |
| 3B | Possession won | Yes | Writ filed, or Appeal |
| 3C | Continued, date pending | Yes | 3D |
| 3D | Continued, new date set | Yes | Back to Court day |
| AP | Appeal filed | Yes | Pauses until the team resumes it, back to where it paused |
| 4 | Writ filed, your decision | Yes | Stay, Lockout scheduled, or Appeal |
| STAY | Stay, funds accepted | Yes | Case ends |
| 5 | Lockout scheduled | Yes | Lockout complete, or Appeal |
| 6 | Lockout complete, keys held 7 days | Yes | Possession returned |
| 7 | Possession returned, full report coming | Yes | Case ends |

**Two notes for the client:**

- Her list names 12 steps. To reach her count of 13, **Court Day is the 13th**. Her notes already refer to it ("goes back to court day"), and it's where results are recorded. It sends no text.
- The STAY confirmation is new wording, because her list didn't include one: "Confirmed. You chose to accept funds for {address}. The resident stays and this case is now closed." There's also a short "case has resumed" text after an appeal.

3A, 3B, 3C and 3D are different results of court day, not steps in a row. Allowed moves live in a database table and are enforced by Postgres, so an invalid jump is refused even through a direct API call or direct SQL.

## North Carolina references

Stages are modelled on summary ejectment under N.C.G.S. Chapter 42, Article 3. **All timings in the app are demo values, to be confirmed against the client's scope sheet and by counsel.**

The current statute pages couldn't be opened from the build environment, so this table comes from search excerpts of statutes, bills and court forms. Check each item against the current text before relying on it.

| Topic | Reference | What was found | Used in the demo |
|---|---|---|---|
| Summons and hearing | G.S. 42-28 | Appearance within 7 days of the summons being issued (seen in bill text quoting the section) | Hearing date comes from the CSV |
| Continuances | G.S. 7A-223 | Magistrate rules on continuances under Rule 40(b). The length limit wasn't confirmed | Team enters any new date |
| Service | G.S. 42-29 | First-class mail plus posting is referenced in 7A-223(b1). Not read directly | Not modelled |
| Judgment, tender of rent | G.S. 42-30, 42-33 | Not read | Stage 3A, 3B |
| Appeal | G.S. 7A-228 | 10 days after judgment (from a court form excerpt) | 10-day appeal window reminder |
| Stay on appeal | G.S. 42-34 | Tenant can stay execution by bond and paying rent to the clerk | Appeal pause |
| Writ and lockout | G.S. 42-36.2 | **Sources conflict**: 7 days (2009 code) or 5 days (a practice guide) for the sheriff to execute | Lockout defaults to 5 days after the owner chooses, moved off weekends |
| Keys and property | G.S. 42-25.9, 42-36.2 | 7-day window after a writ is executed (2015 code text) | Keys held 7 days |

## Production notes

### Twilio A2P 10DLC

Real texts to US numbers need A2P 10DLC registration first. It costs money and takes time, so start it early.

- **Register:** a brand (the firm) and a campaign (what the texts are for), through Twilio's Trust Hub.
- **Timing:** Twilio quotes up to 5 business days for standard use cases. Allow longer, because rejections are common.
- **One-time fees:** about $4.50 for a sole-proprietor brand or $41.50 for a standard brand with vetting, plus about $15 campaign vetting.
- **Monthly:** about $2 to $10 per campaign, depending on type.
- **Multi-tenant:** each firm probably needs its own brand and campaign, because each firm is the sender. Confirm this with Twilio before quoting.
- **Eviction content:** carriers review campaign wording, and this is sensitive material. Expect questions, and have the opt-in flow and its sample messages ready.

Fees change, so check Twilio's console before budgeting.

### What's simulated

| Part | In the demo | To go live |
|---|---|---|
| Sending texts | `SimulatedSender` writes to the database | `TwilioSender` is built. Set `MESSAGE_SENDER=twilio` and the Twilio keys |
| Receiving texts | Typed into the on-screen phone | `/api/twilio/inbound` is built and checks X-Twilio-Signature. Point Twilio at it |
| Time | A demo clock per firm, moved by buttons | Replace with real time, plus a scheduled job every few minutes to release queued texts |
| Logins | One-click, no password | Add real authentication and invitations |
| Billing failures | Simulator buttons, through the same webhook handler | Real Stripe events already work. Remove the buttons |

The Stripe side is real test mode: hosted Checkout, the customer portal and a signed webhook. Test card: 4242 4242 4242 4242.

One deliberate choice: **HELP is still answered after someone opts out**, because carriers expect a reply. Nothing else goes to an opted-out owner.

### Monthly running costs (estimates)

| Item | Rough monthly cost |
|---|---|
| Vercel Pro | About $20 per seat, usage billed above included credit |
| Neon Postgres | $5 minimum on the Launch plan, realistically $15 to $25 |
| Twilio number and campaign | A few dollars per firm, plus the 10DLC fees above |
| Text messages | Per-message rate plus carrier fees. Get current rates from Twilio; this is the main cost that grows with volume |
| Stripe | No monthly fee. A percentage per card payment |

Budget about **$50 to $75 a month** for hosting and one firm's messaging base, before text volume. Figures come from third-party summaries and vendor help pages, so confirm them at vercel.com/pricing, neon.com/pricing and twilio.com before quoting.

## For developers

Next.js (App Router, TypeScript, Tailwind), Postgres on Neon, plain SQL migrations in `db/migrations`, deployed to Vercel on push to `main`.

```bash
npm install
createdb dl_dev && createdb dl_test && createdb dl_e2e
DATABASE_URL=postgres://localhost/dl_dev npm run db:migrate
DATABASE_URL=postgres://localhost/dl_dev npm run db:seed
DATABASE_URL=postgres://localhost/dl_dev npm run dev   # port 3100

npm test                                                # vitest, rebuilds dl_test
DATABASE_URL=postgres://localhost/dl_e2e npm run db:migrate
DATABASE_URL=postgres://localhost/dl_e2e PLAYWRIGHT_LOCAL=1 APP_URL=http://localhost:3200 npm run build
npm run e2e
```

- **Isolation:** each request runs in a transaction as the `app_user` role, with `app.firm_id` set by `set_config(..., true)`. RLS policies key on it. See `src/lib/db.ts` and `db/migrations/004_rls.sql`.
- **Stage rules:** `advance_case()` and the `cases_guard` trigger, in `db/migrations/003_functions.sql`.
- **Audit chain:** the `audit_chain` trigger hashes each row with SHA-256 over the previous hash. `verify_audit_chain()` recomputes it. The demo reset appends to the log and never rewrites it.

Demo by [DC Tech](https://dctechltd.com)
