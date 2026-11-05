import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { clearLocalData, readerState, selectVisibleText, shot, showControls, waitForReader } from "./helpers";
import { signIn, signInAs, syncNow, waitForSynced } from "./auth-helpers";

/**
 * Two devices of one reader: the test's page is the first device (the
 * project's phone, tablet or desktop), a second browser context is a laptop.
 */
const BOOK = "devdas";

async function laptop(browser: Browser, info: TestInfo) {
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    locale: "bn-BD",
    viewport: { width: 1280, height: 800 },
  });
  return context.newPage();
}

async function turn(page: Page, mobile: boolean) {
  const before = (await readerState(page)).cfi;
  if (mobile) await page.touchscreen.tap(page.viewportSize()!.width - 20, page.viewportSize()!.height / 2);
  else await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
}

async function openOnText(page: Page, mobile: boolean) {
  await page.goto(`/read/${BOOK}`);
  await waitForReader(page);
  for (let i = 0; i < 2; i++) await turn(page, mobile);
  await page.waitForTimeout(400);
}

/** Opens the table of contents and jumps to a chapter by its label. */
async function jumpToChapter(page: Page, label: string) {
  await page.keyboard.press("t");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("sync between devices", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("guest reading data is claimed on sign-in and follows the reader to another device", async ({ page, browser }, info) => {
    test.slow();
    const mobile = Boolean(info.project.use.isMobile);

    // ── device 1, no account yet: a highlight with a note, a bookmark, a saved book
    await page.goto("/books/kapalkundala");
    await page.getByRole("button", { name: "লাইব্রেরিতে রাখুন" }).first().click();
    await expect(page.getByRole("button", { name: "লাইব্রেরিতে আছে" }).first()).toBeVisible();

    await openOnText(page, mobile);
    const { text } = await selectVisibleText(page);
    const menu = page.getByRole("toolbar", { name: "হাইলাইট" });
    await menu.getByRole("button", { name: "নীল" }).click();
    await menu.getByRole("button", { name: "নোট লিখুন" }).click();
    const note = "প্রথম ডিভাইসে লেখা নোট";
    await page.getByRole("textbox", { name: "নোট" }).fill(note);
    await page.getByRole("button", { name: "সংরক্ষণ করুন" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await showControls(page);
    await page.getByRole("button", { name: "বুকমার্ক করুন" }).click();
    await expect(page.getByRole("button", { name: "বুকমার্ক সরান" })).toBeVisible();

    // ── sign in: the guest data goes up to the new account
    const email = await signIn(page, info, "/profile");
    await waitForSynced(page);
    await shot(page, info, "profile-synced");
    await expect(page.locator('[data-sync="idle"]')).toBeVisible();

    // ── device 2 signs in to the same account and finds everything
    const second = await laptop(browser, info);
    await signInAs(second, email, "/notes");
    await expect(second.getByText(note)).toBeVisible({ timeout: 20_000 });
    await expect(second.locator("blockquote").first()).toContainText(text.trim().slice(2, 12));
    await second.goto("/library");
    await expect(second.getByRole("heading", { name: "পড়ছি" })).toBeVisible();
    await expect(second.getByText("দেবদাস").first()).toBeVisible();
    await expect(second.getByText("কপালকুণ্ডলা").first()).toBeVisible();
    await expect(second.getByRole("heading", { name: "বুকমার্ক" })).toBeVisible();
    await expect(second.locator("li").filter({ has: second.getByRole("button", { name: /সরান: দেবদাস/ }) })).toHaveCount(1);
    await shot(second, info, "second-device-library");

    // ── device 2 edits the note; device 1 sees it
    await second.goto("/notes");
    await second.getByRole("button", { name: "নোট বদলান" }).click();
    const edited = "দ্বিতীয় ডিভাইসে বদলানো নোট";
    await second.getByRole("textbox", { name: "নোট" }).fill(edited);
    await second.getByRole("button", { name: "সংরক্ষণ করুন" }).click();
    await expect(second.getByRole("dialog")).toHaveCount(0);
    await expect(second.getByText(edited)).toBeVisible();
    await waitForSynced(second);

    await page.goto("/notes");
    await expect
      .poll(
        async () => {
          await syncNow(page);
          return page.getByText(edited).count();
        },
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect(page.getByText(note)).toHaveCount(0);

    // ── device 1 deletes the highlight; it disappears on device 2
    await page.getByRole("button", { name: "হাইলাইট মুছুন" }).click();
    await expect(page.getByText(edited)).toHaveCount(0); // deleted here before leaving the page
    await waitForSynced(page);
    await second.goto("/notes");
    await expect
      .poll(
        async () => {
          await syncNow(second);
          return second.getByText(edited).count();
        },
        { timeout: 20_000 },
      )
      .toBe(0);

    // ── signing out removes the account's data from that device only
    await second.goto("/profile");
    await second.getByRole("button", { name: "সাইন আউট" }).click();
    await expect(second.getByText("অ্যাকাউন্ট ছাড়াই পড়ছেন")).toBeVisible();
    await second.goto("/library");
    await expect(second.getByText("কপালকুণ্ডলা")).toHaveCount(0);
    await page.goto("/library");
    await expect(page.getByText("কপালকুণ্ডলা").first()).toBeVisible();

    await second.context().close();
  });

  test("the reader offers a newer place from another device", async ({ page, browser }, info) => {
    test.slow();
    const mobile = Boolean(info.project.use.isMobile);
    const email = await signIn(page, info, "/profile");
    await openOnText(page, mobile);
    await page.waitForTimeout(700); // position saved (debounced)
    const first = (await readerState(page)).fraction;
    await syncNow(page);
    await waitForSynced(page);

    // the laptop opens the book where the first device left off
    const second = await laptop(browser, info);
    await signInAs(second, email, "/library");
    await expect(second.getByText("দেবদাস").first()).toBeVisible({ timeout: 20_000 });
    await second.goto(`/read/${BOOK}`);
    await waitForReader(second);
    expect(Math.abs((await readerState(second)).fraction - first)).toBeLessThan(0.02);

    // the first device reads on, much further
    await page.goto(`/read/${BOOK}`);
    await waitForReader(page);
    await jumpToChapter(page, "অষ্টম পরিচ্ছেদ");
    await page.waitForTimeout(800);
    const further = (await readerState(page)).fraction;
    expect(further).toBeGreaterThan(first + 0.1);
    await waitForSynced(page);

    // the open reader on the laptop offers that place, and goes there on request
    const offer = second.getByRole("status").filter({ hasText: "অন্য ডিভাইসে" });
    await expect
      .poll(
        async () => {
          await syncNow(second);
          return offer.count();
        },
        { timeout: 20_000 },
      )
      .toBe(1);
    await shot(second, info, "other-device-offer");
    await offer.getByRole("button", { name: "সেখানে যান" }).click();
    await expect.poll(async () => Math.abs((await readerState(second)).fraction - further), { timeout: 10_000 }).toBeLessThan(0.02);

    await second.context().close();
  });
});
