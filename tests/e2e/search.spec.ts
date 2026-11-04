import { expect, test } from "@playwright/test";
import { clearLocalData, readerState, selectVisibleText, shot, waitForReader } from "./helpers";

test.describe("search inside the book", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("finds a word across the book and jumps to a result", async ({ page }, info) => {
    await page.goto("/read/devdas");
    await waitForReader(page);
    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "বইয়ে খুঁজুন" });
    const input = sheet.getByRole("searchbox", { name: "বইয়ে খুঁজুন" });
    await input.fill("পার্ব্বতী");
    await expect(sheet.getByRole("status")).toHaveText(/টি ফলাফল/, { timeout: 20_000 });
    const results = sheet.getByRole("button").filter({ has: page.locator("mark") });
    expect(await results.count()).toBeGreaterThan(5);
    await expect(results.first().locator("mark")).toHaveText("পার্ব্বতী");
    await shot(page, info, "search-results");

    // a result further into the book
    await results.nth(6).click();
    await expect(sheet).toBeHidden();
    await expect.poll(async () => (await readerState(page)).visible, { timeout: 10_000 }).toContain("পার্ব্বতী");
    expect((await readerState(page)).fraction).toBeGreaterThan(0);

    // reopening keeps the search
    await page.keyboard.press("/");
    await expect(input).toHaveValue("পার্ব্বতী");
  });

  test("says when nothing matches, and asks for two letters", async ({ page }) => {
    await page.goto("/read/devdas");
    await waitForReader(page);
    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "বইয়ে খুঁজুন" });
    const input = sheet.getByRole("searchbox");
    await input.fill("ক");
    await expect(sheet.getByRole("status")).toHaveText("অন্তত দুটি অক্ষর লিখুন");
    await input.fill("জাহাজঘাটা");
    await expect(sheet.getByRole("status")).toHaveText("এই বইয়ে “জাহাজঘাটা” পাওয়া যায়নি।", { timeout: 20_000 });
  });

  test("a short selection can be looked up in the whole book", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await page.goto("/read/devdas");
    await waitForReader(page);
    for (let i = 0; i < 2; i++) {
      const before = (await readerState(page)).cfi;
      if (mobile) await page.touchscreen.tap(page.viewportSize()!.width - 20, page.viewportSize()!.height / 2);
      else await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
    }
    const { text } = await selectVisibleText(page, 8);
    await page.getByRole("toolbar", { name: "হাইলাইট" }).getByRole("button", { name: "বইয়ে খুঁজুন" }).click();
    const sheet = page.getByRole("dialog", { name: "বইয়ে খুঁজুন" });
    // the selection may have grown to whole letters at its end
    await expect.poll(() => sheet.getByRole("searchbox").inputValue()).toMatch(new RegExp(`^${text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(sheet.getByRole("status")).toHaveText(/টি ফলাফল/, { timeout: 20_000 });
  });
});
