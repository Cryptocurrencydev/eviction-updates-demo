import { expect, type Page } from "@playwright/test";

export const ADMIN = "admin@pinecrest.example";
export const TEAM = "team@pinecrest.example";
export const HARBOR_ADMIN = "admin@harborlane.example";

export async function reset(page: Page) {
  const r = await page.request.post("/api/demo/reset");
  expect(r.ok()).toBeTruthy();
}

export async function login(page: Page, email = ADMIN) {
  const r = await page.request.post("/api/auth/login", { data: { email } });
  expect(r.ok()).toBeTruthy();
  await page.goto("/court-day");
  await expect(page.getByTestId("court-banner")).toBeVisible();
}

/** Opens an owner's phone by their name in the picker. */
export async function viewOwner(page: Page, name: string | RegExp) {
  const picker = page.getByTestId("owner-picker");
  await expect(picker.locator("option").first()).toBeAttached();
  const options = await picker.locator("option").allTextContents();
  const label = options.find((o) => (typeof name === "string" ? o.includes(name) : name.test(o)));
  expect(label, `owner ${name}`).toBeTruthy();
  await picker.selectOption({ label: label! });
  await expect(page.getByTestId("owner-consent")).toContainText(label!.split(",")[0]);
}

export const reply = async (page: Page, text: string) => {
  await page.getByTestId("phone-input").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("bubble-in").last()).toHaveText(text);
};

export async function sendGroup(page: Page, id: string) {
  await page.getByTestId(`send-${id}`).click();
  await page.getByTestId(`confirm-${id}`).click();
  await expect(page.getByTestId(`result-${id}`)).toBeVisible();
}
