import { test, expect } from "@playwright/test";
import { latestEmail, PASSWORD, signIn, uniqueEmail } from "./auth-helpers";
import { expectNoHorizontalOverflow, shot } from "./helpers";

test.describe("accounts", () => {
  test("creates an account with a password, signs out, then signs back in", async ({ page }, info) => {
    const email = uniqueEmail(info);
    await page.goto("/profile");
    await expect(page.getByText("অ্যাকাউন্ট ছাড়াই পড়ছেন")).toBeVisible();
    await page.getByRole("link", { name: "সাইন ইন করুন" }).click();
    await expect(page).toHaveURL(/\/signin\?next=%2Fprofile$/);
    await expect(page.getByRole("heading", { name: "সাইন ইন বা অ্যাকাউন্ট খুলুন", level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "signin");

    await page.getByRole("button", { name: "অ্যাকাউন্ট খুলুন", exact: true }).click();
    await page.getByLabel("নাম").fill("পাঠক");
    await page.getByLabel("ইমেইল ঠিকানা").fill(email);
    await page.getByLabel("পাসওয়ার্ড", { exact: true }).fill(PASSWORD);
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "signup");

    await page.getByRole("button", { name: "অ্যাকাউন্ট তৈরি করুন" }).click();
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

    // the password signs the same reader back in
    await page.getByRole("link", { name: "সাইন ইন করুন" }).click();
    await page.getByLabel("ইমেইল ঠিকানা").fill(email);
    await page.getByLabel("পাসওয়ার্ড", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "সাইন ইন করুন" }).click();
    await page.waitForURL((u) => u.pathname === "/profile");
    await expect(page.getByText(`${email} হিসেবে সাইন ইন করা আছে`)).toBeVisible();
  });

  test("a wrong password is refused and can be retyped", async ({ page }, info) => {
    const email = await signIn(page, info, "/profile");
    await page.getByRole("button", { name: "সাইন আউট" }).click();
    await expect(page.getByRole("link", { name: "সাইন ইন করুন" })).toBeVisible();

    await page.goto("/signin");
    await page.getByLabel("ইমেইল ঠিকানা").fill(email);
    await page.getByLabel("পাসওয়ার্ড", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "সাইন ইন করুন" }).click();
    await expect(page.locator("#auth-error")).toHaveText("ইমেইল বা পাসওয়ার্ড মেলেনি।");

    await page.getByLabel("পাসওয়ার্ড", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "সাইন ইন করুন" }).click();
    await page.waitForURL((u) => u.pathname === "/library");
  });

  test("a reset link sets a new password, and the account can be deleted", async ({ page }, info) => {
    const email = await signIn(page, info, "/en/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/en/signin?next=%2Fen%2Fprofile");
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    const sentAfter = Date.now() - 1000;
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    await shot(page, info, "reset-sent");

    const mail = await latestEmail(email, sentAfter);
    await page.goto(mail.link);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "reset-form");

    const nextPassword = "new-reader-password-456";
    await page.getByLabel("New password").fill(nextPassword);
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForURL((u) => u.pathname === "/en/profile");
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/en/signin?next=%2Fen%2Fprofile");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(nextPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/en/profile");

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
      await page.getByRole("button", { name: "চালিয়ে যান", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/library");
      expect(new URL(page.url()).host).toBe(new URL(info.project.use.baseURL ?? page.url()).host);
    }
  });
});
