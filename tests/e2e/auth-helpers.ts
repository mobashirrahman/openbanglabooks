import { expect, type Page, type TestInfo } from "@playwright/test";

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

/** A fresh address per test and project, so runs never share an account. */
export function uniqueEmail(info: TestInfo, tag = "reader") {
  const project = info.project.name.replace(/[^a-z0-9]+/gi, "-");
  return `${tag}-${project}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`.toLowerCase();
}

type Mail = { subject: string; code: string; link: string };

/** The newest sign-in email for an address, from the local Mailpit inbox. */
export async function latestEmail(email: string, after = 0, timeout = 15_000): Promise<Mail> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`);
    const list = (await res.json()) as { messages: { ID: string; Subject: string; Created: string }[] };
    const msg = list.messages.find((m) => Date.parse(m.Created) >= after);
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string };
      const code = full.HTML.match(/>\s*(\d{6})\s*</)?.[1];
      const link = full.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
      if (code && link) return { subject: msg.Subject, code, link };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no sign-in email for ${email}`);
}

export const toBengaliDigits = (s: string) => s.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/** Signs in through the real form with the emailed code; returns the address. */
export async function signIn(page: Page, info: TestInfo, next = "/profile", tag?: string) {
  const email = uniqueEmail(info, tag);
  await signInAs(page, email, next);
  return email;
}

/** Signs in a given address (a second device of the same reader). */
export async function signInAs(page: Page, email: string, next = "/profile") {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  const sentAfter = Date.now() - 1000;
  await page.getByLabel("ইমেইল ঠিকানা").fill(email);
  await page.getByRole("button", { name: "কোড পাঠান" }).click();
  const mail = await latestEmail(email, sentAfter);
  await page.getByLabel("ছয় অঙ্কের কোড").fill(mail.code);
  await page.waitForURL((u) => u.pathname === next);
}

/** Asks the page's sync engine to sync now. */
export async function syncNow(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("obb:sync-now")));
}

/** Waits until the profile page reports everything synced. */
export async function waitForSynced(page: Page) {
  await page.goto("/profile");
  const status = page.getByTestId("sync-status");
  await expect(status).toContainText("সব ডিভাইসে মিলিয়ে রাখা হয়েছে", { timeout: 20_000 });
}
