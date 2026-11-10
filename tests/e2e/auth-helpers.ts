import { expect, type Page, type TestInfo } from "@playwright/test";

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

/** The password every test account is created with. */
export const PASSWORD = "reader-password-123";
/** A fresh address per test and project, so runs never share an account. */
export function uniqueEmail(info: TestInfo, tag = "reader") {
  const project = info.project.name.replace(/[^a-z0-9]+/gi, "-");
  return `${tag}-${project}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`.toLowerCase();
}

type Mail = { subject: string; link: string; code?: string };

/** The newest account email for an address, from the local Mailpit inbox. */
export async function latestEmail(email: string, after = 0, timeout = 15_000): Promise<Mail> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`);
    const list = (await res.json()) as { messages: { ID: string; Subject: string; Created: string }[] };
    const msg = list.messages.find((m) => Date.parse(m.Created) >= after);
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string };
      const hrefs = [...full.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
      const link = hrefs.find((h) => h.includes("/auth/v1/verify") || h.includes("token_hash"));
      const code = full.HTML.match(/>\s*(\d{6})\s*</)?.[1];
      if (link) return { subject: msg.Subject, link, code };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no account email for ${email}`);
}

const target = (next: string) => `/signin?next=${encodeURIComponent(next)}`;

/** Creates a fresh account through the real form; returns the address. */
export async function signIn(page: Page, info: TestInfo, next = "/profile", tag?: string) {
  const email = uniqueEmail(info, tag);
  await signUpAs(page, email, next);
  return email;
}

/** Creates an account with the given address, ending at `next`. */
export async function signUpAs(page: Page, email: string, next = "/profile", name = "Reader") {
  await page.goto(target(next));
  await page.getByRole("button", { name: "অ্যাকাউন্ট খুলুন", exact: true }).click();
  await page.getByLabel("নাম").fill(name);
  await page.getByLabel("ইমেইল ঠিকানা").fill(email);
  await page.getByLabel("পাসওয়ার্ড", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "অ্যাকাউন্ট তৈরি করুন" }).click();
  await page.waitForURL((u) => u.pathname === next);
}

/** Signs in a given address (a second device of the same reader). */
export async function signInAs(page: Page, email: string, next = "/profile", password = PASSWORD) {
  await page.goto(target(next));
  await page.getByLabel("ইমেইল ঠিকানা").fill(email);
  await page.getByLabel("পাসওয়ার্ড", { exact: true }).fill(password);
  await page.getByRole("button", { name: "সাইন ইন করুন" }).click();
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
