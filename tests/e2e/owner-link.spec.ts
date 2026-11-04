import { expect, test } from "@playwright/test";
import { login, reset, viewOwner } from "./helpers";

test("decision by link on a phone: one click, no login, second attempt says already recorded", async ({ page, browser }) => {
  await reset(page);
  await login(page);
  await page.goto("/court-day");
  const firstWrit = page.getByTestId("card-writ").getByRole("link").first();
  const caseHref = await firstWrit.getAttribute("href");
  await firstWrit.click();
  const owner = (await page.getByText(/\+1919555/).textContent())!.split(",")[0];
  await page.goto("/phones");
  await viewOwner(page, owner);
  const links = page.getByTestId("decision-link");
  await expect(links.first()).toBeVisible();
  const url = await links.last().getAttribute("href");

  // A separate browser with no session, like the owner's phone.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await fresh.newPage();
  await phone.goto(url!);
  await expect(phone.getByTestId("choose-stay")).toBeVisible();
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await expect(phone.getByRole("link", { name: "DC Tech" })).toBeVisible();

  await phone.getByTestId("choose-lockout").click();
  await expect(phone.getByTestId("already-recorded")).toContainText("Lockout");
  await phone.reload();
  await expect(phone.getByTestId("already-recorded")).toBeVisible();
  await expect(phone.getByTestId("choose-stay")).toHaveCount(0);
  await fresh.close();

  await page.goto(caseHref!);
  await expect(page.getByTestId("case-stage")).toContainText("Lockout scheduled");
  await expect(page.getByTestId("decision-record")).toContainText("one-click link");
});

test("a bad link is refused", async ({ page }) => {
  await page.goto("/d/not-a-real-token");
  await expect(page.getByTestId("link-invalid")).toBeVisible();
});
