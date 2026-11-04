import { expect, test, type Page } from "@playwright/test";
import { clearLocalData, readerState, showControls, waitForReader } from "./helpers";

/**
 * Drags a finger across the book with real touch events, dispatched inside the
 * section iframe (where a reader's finger lands). `points` are page coordinates.
 */
async function drag(page: Page, points: [number, number][], stepMs = 16) {
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith("blob:"))!;
  await frame.evaluate(
    async ({ points, stepMs }) => {
      // the iframe moves when the page changes underneath (foliate scrolls it): measure every time
      const at = ([x, y]: [number, number]) => {
        const off = window.frameElement!.getBoundingClientRect();
        return [x - off.left, y - off.top] as const;
      };
      const [sx, sy] = at(points[0]);
      const target = document.elementFromPoint(sx, sy) ?? document.body;
      // WebKit has no Touch constructor, but still has the older document.createTouch
      const touch = (x: number, y: number): Touch => {
        try {
          return new Touch({ identifier: 7, target, clientX: x, clientY: y, screenX: x, screenY: y });
        } catch {
          const legacy = document as unknown as { createTouch(...a: unknown[]): Touch };
          return legacy.createTouch(window, target, 7, x + scrollX, y + scrollY, x, y);
        }
      };
      const fire = (type: string, x: number, y: number) => {
        const t = touch(x, y);
        const list = type === "touchend" ? [] : [t];
        target.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: [t], bubbles: true, cancelable: true, composed: true }));
      };
      fire("touchstart", sx, sy);
      for (const p of points.slice(1)) {
        await new Promise((r) => setTimeout(r, stepMs));
        const [x, y] = at(p);
        fire("touchmove", x, y);
      }
      const [ex, ey] = at(points[points.length - 1]);
      fire("touchend", ex, ey);
    },
    { points, stepMs },
  );
}

const line = (from: [number, number], to: [number, number], n: number) =>
  Array.from({ length: n + 1 }, (_, i): [number, number] => [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);

async function openOnText(page: Page) {
  await page.goto("/read/devdas");
  await waitForReader(page);
  for (let i = 0; i < 2; i++) {
    const before = (await readerState(page)).cfi;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
  }
  await page.waitForTimeout(700);
}

test.describe("page turns", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("a page turn curls the leaf over, then leaves nothing behind", async ({ page }) => {
    await openOnText(page);
    const before = await readerState(page);
    await page.keyboard.press("ArrowRight");
    // the curl is drawn while the turn runs…
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.curl ?? "")).not.toBe("");
    // …and gone once the new page is there
    await expect.poll(async () => (await readerState(page)).cfi).not.toBe(before.cfi);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.curl ?? "")).toBe("");
    expect((await readerState(page)).fraction).toBeGreaterThan(before.fraction);
  });

  test("a tap while the leaf is still turning turns the next page too", async ({ page }, info) => {
    await openOnText(page);
    const cfi = async () => (await readerState(page)).cfi;
    const a = await cfi();
    const box = (await page.locator("foliate-view").boundingBox())!;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150); // the curl is on screen now
    if (info.project.use.hasTouch) await page.touchscreen.tap(box.x + box.width * 0.92, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width * 0.92, box.y + box.height / 2);
    await expect.poll(cfi).not.toBe(a);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.curl ?? ""), { timeout: 10_000 }).toBe("");
    await page.waitForTimeout(400);
    // two pages forward: one step back is not the start, two steps back are
    const turnBack = async () => {
      const before = await cfi();
      await page.keyboard.press("ArrowLeft");
      await expect.poll(cfi, { timeout: 10_000 }).not.toBe(before);
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.curl ?? ""), { timeout: 10_000 }).toBe("");
      await page.waitForTimeout(300);
    };
    await turnBack();
    expect(await cfi()).not.toBe(a);
    await turnBack();
    expect(await cfi()).toBe(a);
  });

  test("on a touch screen the page follows the finger; a short drag lays it back", async ({ page }, info) => {
    test.skip(!info.project.use.hasTouch, "touch screens");
    // Playwright's WebKit can't build synthetic touch events (no Touch constructor, and
    // TouchEvent refuses legacy createTouch objects): drags are verified in Chromium only
    test.skip(info.project.name.startsWith("webkit-"), "synthetic touches are not possible in this WebKit");
    await openOnText(page);
    const box = (await page.locator("foliate-view").boundingBox())!;
    const y = box.y + box.height * 0.75;
    const right = box.x + box.width - 12;

    // a short, slow pull: the leaf lifts and settles back on the same page
    const start = (await readerState(page)).cfi;
    await drag(page, line([right, y], [right - box.width * 0.15, y], 12), 40);
    await page.waitForTimeout(900);
    expect((await readerState(page)).cfi).toBe(start);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.curl ?? "")).toBe("");

    // a long drag across the page turns it
    await drag(page, line([right, y], [box.x + box.width * 0.1, y - 40], 14));
    await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(start);
    const forward = (await readerState(page)).cfi;

    // and a drag the other way turns back
    await page.waitForTimeout(700);
    await drag(page, line([box.x + 12, y], [box.x + box.width * 0.9, y - 40], 14));
    await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).toBe(start);
    expect(forward).not.toBe(start);
  });

  test("the turn style can be changed: slide or instant", async ({ page }) => {
    await openOnText(page);
    await showControls(page);
    await page.getByRole("button", { name: "পড়ার সেটিংস" }).click();
    const sheet = page.getByRole("dialog", { name: "পড়ার সেটিংস" });
    await sheet.getByRole("radio", { name: "সরে যাওয়া" }).click();
    await page.keyboard.press("Escape");
    // Escape closed the sheet, and only the sheet: the controls are still there
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: "সূচিপত্র" })).toBeVisible();
    const before = (await readerState(page)).cfi;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).cfi).not.toBe(before);
    // the slide: foliate's own motion with the leaf shadow, no curl
    expect(await page.locator(".leaf-sweep").count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.dataset.curl ?? "")).toBe("");

    await showControls(page);
    await page.getByRole("button", { name: "পড়ার সেটিংস" }).click();
    await sheet.getByRole("radio", { name: "সরাসরি" }).click();
    await page.keyboard.press("Escape");
    const mid = (await readerState(page)).cfi;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).cfi).not.toBe(mid);
    expect(await page.evaluate(() => document.documentElement.dataset.curl ?? "")).toBe("");
  });
});
