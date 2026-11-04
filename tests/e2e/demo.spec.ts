import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { HARBOR_ADMIN, login, reply, reset, sendGroup, TEAM, viewOwner } from "./helpers";

test.beforeEach(async ({ page }) => { await reset(page); });

test("login page shows four one-click logins and a footer credit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Firm Admin/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Team Member/ })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "DC Tech" })).toHaveAttribute("href", "https://dctechltd.com");
  await page.getByRole("button", { name: /Firm Admin/ }).first().click();
  await expect(page.getByTestId("firm-name")).toHaveText("Pinecrest Property Group");
});

test("court day opens on the client's picture", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("court-banner")).toHaveText("Reminder: Today is court day. 12 cases are due an update. Click each group to send the owner texts.");
  for (const [id, n] of [["dismissed", 5], ["possession", 7], ["continued", 2], ["appeal", 1], ["writ", 3], ["lockout", 2], ["lockout_complete", 1]] as const) {
    await expect(page.getByTestId(`badge-${id}`)).toHaveText(String(n));
  }
  await expect(page.getByTestId("send-dismissed")).toHaveText("Send texts to these 5 owners");
  await expect(page.getByTestId("send-writ")).toHaveCount(0);
  await expect(page.getByTestId("send-lockout")).toHaveCount(0);
  await expect(page.getByTestId("flow-note")).toContainText("A paid case ends at Dismissed.");
  await expect(page.getByText("Sample only, fictional property and resident")).toBeVisible();
});

test("firms only see their own cases", async ({ page }) => {
  await login(page);
  await page.goto("/cases");
  await expect(page.getByText("Sample Oak Street").first()).toBeVisible();
  const pinecrestFirst = await page.locator("td a").first().textContent();
  await login(page, HARBOR_ADMIN);
  await expect(page.getByTestId("firm-name")).toHaveText("Harbor Lane Rentals");
  await page.goto("/cases");
  await expect(page.getByText(pinecrestFirst!)).toHaveCount(0);
});

test("upload csv: sample, preview errors, commit valid rows only", async ({ page }) => {
  await login(page);
  await page.goto("/upload");
  const download = page.waitForEvent("download");
  await page.getByTestId("sample-link").click();
  const path = await (await download).path();
  expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(29);

  await page.getByTestId("csv-input").setInputFiles(path);
  await expect(page.getByTestId("preview-summary")).toHaveText("25 rows ready, 3 with errors");
  await expect(page.getByTestId("row-bad")).toHaveCount(3);
  for (const msg of ["Bad phone", "Unknown time zone", "Missing case number", "Duplicate"]) {
    await expect(page.getByText(msg).first()).toBeVisible();
  }
  await page.getByTestId("commit").click();
  await expect(page.getByTestId("upload-done")).toContainText("25 cases added");
  await page.goto("/cases");
  await expect(page.getByTestId("stage-filed").locator("tbody tr")).toHaveCount(26);
});

test("batch advance court day: record results for a group, then send", async ({ page }) => {
  await login(page);
  await page.goto("/cases");
  const group = page.getByTestId("stage-court_day");
  const before = await page.getByTestId("select-all-court_day").count();
  expect(before).toBe(1);
  // Pick only the two cases with no result yet.
  const rows = group.locator("tbody tr").filter({ hasNot: page.getByText(/Dismissed|Possession won|Continued/) });
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) await r.getByRole("checkbox").check();
  await page.getByTestId("action-court_day").selectOption({ label: "Possession won" });
  await page.getByTestId("apply-court_day").click();
  await expect(group.getByRole("status")).toContainText("2 recorded");

  await page.goto("/court-day");
  await expect(page.getByTestId("badge-possession")).toHaveText("9");
  await expect(page.getByTestId("court-banner")).toContainText("14 cases are due");
  await sendGroup(page, "possession");
  await expect(page.getByTestId("result-possession")).toContainText("7 sent, 1 held for opt-in, 1 not sent, opted out");
  await expect(page.getByTestId("court-banner")).toContainText("5 cases are due");
  await expect(page.getByTestId("phone-thread")).toContainText("3B POSSESSION WON");
  await expect(page.getByTestId("phone-thread")).toContainText("and we won possession.");
  await page.goto("/audit?action=case.advanced");
  await expect(page.getByTestId("audit-table").locator("tbody tr").first()).toContainText("possession_won");
});

test("confirm step can be cancelled", async ({ page }) => {
  await login(page);
  await page.getByTestId("send-dismissed").click();
  await expect(page.getByRole("dialog")).toContainText("1 owner in quiet hours");
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByTestId("badge-dismissed")).toHaveText("5");
});

test("owner opts in, receives the held text, replies STOP, and nothing else goes out", async ({ page }) => {
  await login(page);
  await sendGroup(page, "possession");
  await viewOwner(page, "Henry Osei");
  await expect(page.getByTestId("owner-consent")).toContainText("Opt-in pending");
  await expect(page.getByTestId("held-note")).toContainText("held until this owner replies YES");

  await reply(page, "yes");
  await expect(page.getByTestId("owner-consent")).toContainText("Opted in");
  await expect(page.getByTestId("phone-thread")).toContainText("and we won possession.");

  await page.goto("/phones");
  await viewOwner(page, "Henry Osei");
  await expect(page.getByTestId("consent-record")).toContainText("replied YES by text");
  await expect(page.getByTestId("consent-record")).toContainText("Agreed to:");

  await reply(page, "STOP");
  await expect(page.getByTestId("phone-thread")).toContainText("you are unsubscribed");
  await expect(page.getByTestId("owner-consent")).toContainText("Opted out");
  const bubbles = await page.getByTestId("bubble-out").count();

  // Move the case on: the owner gets nothing, and the firm's log shows why.
  await page.goto("/cases");
  const href = await page.getByTestId("stage-possession_won").locator("tr", { hasText: "Henry Osei" }).locator("td a").getAttribute("href");
  const r = await page.request.post("/api/cases/advance", {
    data: { caseIds: [href!.split("/").pop()], to: "writ_filed", fields: { reply_deadline: new Date(Date.now() + 5 * 86_400_000).toISOString() } },
  });
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).opted_out).toBe(1);
  await page.goto("/phones");
  await viewOwner(page, "Henry Osei");
  await expect(page.getByTestId("firm-log")).toContainText("Blocked: opted out");
  await expect(page.getByTestId("bubble-out")).toHaveCount(bubbles);
});

test("quiet hours: the Pacific owner's text is held, and the clock releases it at 8am", async ({ page }) => {
  await login(page);
  await sendGroup(page, "dismissed");
  await expect(page.getByTestId("result-dismissed")).toContainText("4 sent, 1 waiting for quiet hours");
  await expect(page.getByTestId("queued-count")).toHaveText("1 text waiting for quiet hours");
  await viewOwner(page, "Marisol Tran");
  await expect(page.getByTestId("quiet-note")).toContainText("8:00 AM PST");
  await page.getByRole("button", { name: "+1 hour" }).click();
  await expect(page.getByTestId("phone-thread")).toContainText("Good news and congratulations.");
  await expect(page.getByTestId("quiet-note")).toHaveCount(0);
  await expect(page.getByTestId("queued-count")).toHaveText("0 texts waiting for quiet hours");
});

test("writ to lockout: the team sets the deadline and the owner's reply advances the case", async ({ page }) => {
  await login(page);
  await page.goto("/court-day");
  const ready = page.getByTestId("card-possession").getByRole("link").first();
  await ready.click();
  await page.getByTestId("action-possession_won").selectOption({ label: "File writ" });
  await expect(page.getByTestId("date-possession_won")).toBeVisible();
  await page.getByTestId("apply-possession_won").click();
  await expect(page.getByTestId("case-stage")).toContainText("Writ filed");
  const owner = (await page.getByText(/\+1919555/).textContent())!.split(",")[0];
  await page.goto("/phones");
  await viewOwner(page, owner);
  await expect(page.getByTestId("phone-thread")).toContainText("Please reply by");
  await reply(page, "maybe");
  await expect(page.getByTestId("phone-thread")).toContainText("Please reply STAY to accept funds");
  await reply(page, " lockout ");
  await expect(page.getByTestId("phone-thread")).toContainText(/Lockout is scheduled for .* on /);
});

test("an invalid jump through the API is refused", async ({ page }) => {
  await login(page);
  await page.goto("/cases");
  const href = await page.getByTestId("stage-filed").locator("td a").first().getAttribute("href");
  const r = await page.request.post("/api/cases/advance", { data: { caseIds: [href!.split("/").pop()], to: "lockout_complete", direct: true } });
  expect(r.status()).toBe(422);
  expect((await r.json()).error).toBe("invalid_transition");
});

test("team members can't reach billing or settings", async ({ page }) => {
  await login(page, TEAM);
  await expect(page.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await page.goto("/billing");
  await expect(page.getByText("Firm Admins only")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("Firm Admins only")).toBeVisible();
  const r = await page.request.post("/api/settings/template", { data: { stage: "filed", body: "x" } });
  expect(r.status()).toBe(403);
  const s = await page.request.post("/api/billing/simulate", { data: { scenario: "recovered" } });
  expect(s.status()).toBe(403);
});

test("admins can edit a template and the next text uses it", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const box = page.getByTestId("template-dismissed_paid");
  await box.getByRole("textbox").fill("Dismissed for {address}. Edited by the firm.");
  await box.getByRole("button", { name: "Save" }).click();
  await expect(box.getByRole("status")).toHaveText("Saved");
  await page.goto("/court-day");
  await sendGroup(page, "dismissed");
  await expect(page.getByTestId("phone-thread")).toContainText("Edited by the firm.");
});

test("audit log verifies, filters and exports", async ({ page }) => {
  await login(page);
  await sendGroup(page, "dismissed");
  await page.goto("/audit");
  await page.getByTestId("verify").click();
  await expect(page.getByTestId("verify-result")).toContainText("Verified: all");
  await page.getByLabel("Action").selectOption("text.sent");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByTestId("audit-table").locator("tbody tr").first()).toContainText("text.sent");
  const download = page.waitForEvent("download");
  await page.getByTestId("audit-export").click();
  expect(readFileSync(await (await download).path(), "utf8")).toContain("prev_hash");
});

test("reminders show every kind", async ({ page }) => {
  await login(page);
  await page.goto("/reminders");
  for (const k of ["deadline_missed", "decision_stale", "writ_ready", "appeal_closing", "hearing"]) {
    await expect(page.getByTestId(`reminder-${k}`)).toBeVisible();
  }
});

test("billing: failed payment, grace, read-only, recovery", async ({ page }) => {
  await login(page);
  await page.goto("/billing");
  await expect(page.getByTestId("billing-status")).toHaveText("Status: Free trial");
  await page.getByTestId("sim-payment_failed").click();
  await expect(page.getByTestId("billing-banner")).toContainText("Payment failed");
  await page.getByTestId("sim-grace_over").click();
  await expect(page.getByTestId("billing-banner")).toContainText("Read-only mode");
  await page.goto("/court-day");
  await expect(page.getByTestId("send-dismissed")).toBeDisabled();
  const r = await page.request.post("/api/court-day/send", { data: { group: "dismissed" } });
  expect(r.status()).toBe(423);
  await page.goto("/billing");
  await page.getByTestId("sim-recovered").click();
  await expect(page.getByTestId("billing-status")).toHaveText("Status: Active");
  await page.goto("/court-day");
  await expect(page.getByTestId("send-dismissed")).toBeEnabled();
});
