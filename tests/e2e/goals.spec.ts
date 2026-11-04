import { expect, test, type Page } from "@playwright/test";
import { clearLocalData, readerState, showControls, waitForReader } from "./helpers";

/** Seconds read on days relative to today (0 = today, 1 = yesterday…), written straight into IndexedDB. */
async function seedDays(page: Page, days: Record<number, number>) {
  await page.evaluate(async (days) => {
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("openbanglabooks");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("days", "readwrite");
        for (const [ago, seconds] of Object.entries(days)) {
          const d = new Date();
          d.setDate(d.getDate() - Number(ago));
          tx.objectStore("days").put({ day: key(d), seconds, updatedAt: Date.now() });
        }
        tx.oncomplete = () => (open.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
    });
  }, days);
}

async function todaySeconds(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const d = new Date();
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const open = indexedDB.open("openbanglabooks");
        open.onsuccess = () => {
          const req = open.result.transaction("days").objectStore("days").get(day);
          req.onsuccess = () => (open.result.close(), resolve(req.result?.seconds ?? 0));
          req.onerror = () => resolve(-1);
        };
        open.onerror = () => resolve(-1);
      }),
  );
}

test.describe("reading goals and time left", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("the library shows today's reading against the goal, the streak and the week", async ({ page }) => {
    await page.goto("/library"); // opens the local database
    const goal = page.getByRole("region", { name: "আজকের পড়া" });
    await expect(goal).toBeVisible();
    await seedDays(page, { 0: 300, 1: 700, 2: 900, 4: 650 });
    await page.reload();
    await expect(goal).toContainText("৫"); // five minutes today
    await expect(goal).toContainText("টানা ২ দিন"); // yesterday and the day before (today is still open)
    await expect(goal.getByRole("img")).toHaveCount(7);

    // a smaller goal: today is now met, and the streak runs through today
    await goal.getByLabel("প্রতিদিনের লক্ষ্য").selectOption("5");
    await expect(goal).toContainText("আজকের লক্ষ্য পূর্ণ");
    await expect(goal).toContainText("টানা ৩ দিন");
  });

  test("the time left in a book is estimated from its real length", async ({ page }) => {
    await page.goto("/read/gora"); // about 827,000 characters of text
    await waitForReader(page);
    for (let i = 0; i < 3; i++) {
      const before = (await readerState(page)).cfi;
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
    }
    const left = async () => Number((await page.locator(".reader").getAttribute("data-chars-left"))?.split(",")[1] ?? 0);
    await expect.poll(left).toBeGreaterThan(650_000);
    expect(await left()).toBeLessThan(900_000);
  });

  test("reading time is counted while reading, and the time left is shown", async ({ page }) => {
    await page.clock.install();
    await page.goto("/read/devdas");
    await waitForReader(page);
    for (let i = 0; i < 2; i++) {
      const before = (await readerState(page)).cfi;
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
    }
    await showControls(page);
    await expect(page.getByText(/অধ্যায়ে আর প্রায় .+ মিনিট|অধ্যায় প্রায় শেষ/)).toBeVisible();

    // fifteen seconds of reading later, today's total has grown
    const before = await todaySeconds(page);
    await page.clock.fastForward("00:16");
    await expect.poll(() => todaySeconds(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(before + 15);
  });
});
