import { test, expect } from "@playwright/test";
import { latestEmail, signIn, toBengaliDigits, uniqueEmail } from "./auth-helpers";
import { expectNoHorizontalOverflow, shot } from "./helpers";

test.describe("accounts", () => {
  test("sign in with the emailed code (typed in Bengali digits), then sign out", async ({ page }, info) => {
    const email = uniqueEmail(info);
    await page.goto("/profile");
    await expect(page.getByText("অ্যাকাউন্ট ছাড়াই পড়ছেন")).toBeVisible();
    await page.getByRole("link", { name: "সাইন ইন করুন" }).click();
    await expect(page).toHaveURL(/\/signin\?next=%2Fprofile$/);
    await expect(page.getByRole("heading", { name: "সাইন ইন", level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "signin-email");

    const sentAfter = Date.now() - 1000;
    await page.getByLabel("ইমেইল ঠিকানা").fill(email);
    await page.getByRole("button", { name: "কোড পাঠান" }).click();
    await expect(page.getByText(`${email}-এ একটি কোড পাঠানো হয়েছে।`)).toBeVisible();
    await expect(page.getByLabel("ছয় অঙ্কের কোড")).toBeFocused();
    await shot(page, info, "signin-code");

    const mail = await latestEmail(email, sentAfter);
    expect(mail.subject).toContain(mail.code);
    await page.getByLabel("ছয় অঙ্কের কোড").fill(toBengaliDigits(mail.code));
    await page.waitForURL((u) => u.pathname === "/profile");
    await expect(page.getByText(`${email} হিসেবে সাইন ইন করা আছে`)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "profile-signed-in");

    // still signed in after a reload (cookie session)
    await page.reload();
    await expect(page.getByText(`${email} হিসেবে সাইন ইন করা আছে`)).toBeVisible();

    await page.getByRole("button", { name: "সাইন আউট" }).click();
    await expect(page.getByRole("link", { name: "সাইন ইন করুন" })).toBeVisible();
    await page.reload();
    await expect(page.getByText("অ্যাকাউন্ট ছাড়াই পড়ছেন")).toBeVisible();
  });

  test("a wrong code is refused and can be retyped", async ({ page }, info) => {
    const email = uniqueEmail(info);
    await page.goto("/signin");
    const sentAfter = Date.now() - 1000;
    await page.getByLabel("ইমেইল ঠিকানা").fill(email);
    await page.getByRole("button", { name: "কোড পাঠান" }).click();
    const mail = await latestEmail(email, sentAfter);
    const wrong = mail.code === "000000" ? "111111" : "000000";
    await page.getByLabel("ছয় অঙ্কের কোড").fill(wrong);
    await expect(page.locator("#signin-error")).toHaveText("কোডটি মেলেনি, বা এর মেয়াদ শেষ হয়ে গেছে।");
    await expect(page.getByLabel("ছয় অঙ্কের কোড")).toHaveValue("");
    await page.getByLabel("ছয় অঙ্কের কোড").fill(mail.code);
    await page.waitForURL((u) => u.pathname === "/library");
  });

  test("the email link signs in on this device, and the account can be deleted", async ({ page }, info) => {
    const email = uniqueEmail(info);
    await page.goto(`/en/signin?next=${encodeURIComponent("/en/profile")}`);
    const sentAfter = Date.now() - 1000;
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    const mail = await latestEmail(email, sentAfter);
    expect(new URL(mail.link).pathname).toBe("/en/signin/confirm");
    await page.goto(mail.link);
    await page.waitForURL((u) => u.pathname === "/en/profile");
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    // the one-time link cannot be used twice
    await page.goto(mail.link);
    await expect(page.getByRole("alert").filter({ hasText: "This link" })).toHaveText("This link no longer works. Ask for a new code.");

    await page.goto("/en/profile");
    await page.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByText("Delete your account?")).toBeVisible();
    await shot(page, info, "profile-delete-confirm");
    await page.getByRole("button", { name: "Yes, delete it" }).click();
    await expect(page.getByText("Your account was deleted")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("a hostile ?next= never leaves the site", async ({ page }, info) => {
    await signIn(page, info, "/library");
    for (const next of ["//evil.example/x", "https://evil.example/", "/\\evil.example"]) {
      await page.goto(`/signin?next=${encodeURIComponent(next)}`);
      await page.getByRole("button", { name: "চালিয়ে যান" }).click();
      await page.waitForURL((u) => u.pathname === "/library");
      expect(new URL(page.url()).host).toBe(new URL(info.project.use.baseURL ?? page.url()).host);
    }
  });
});
