import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { clearLocalData, meanColor, readerState, selectVisibleText, shot, waitForReader, type Box } from "./helpers";

const BOOK = "devdas";

async function openBookPage(page: Page, mobile: boolean) {
  await page.goto(`/read/${BOOK}`);
  await waitForReader(page);
  // past the title page, onto text
  for (let i = 0; i < 2; i++) {
    const before = (await readerState(page)).cfi;
    if (mobile) await page.touchscreen.tap(page.viewportSize()!.width - 20, page.viewportSize()!.height / 2);
    else await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
  }
  await page.waitForTimeout(500);
}

/**
 * How much green outweighs red in an area. Paper and ink are warm or neutral
 * (green ≤ red, below 0); the green marker lifts green well above red.
 * (Never measured as a baseline while text is selected: the selection tint is browner.)
 */
const greenness = async (page: Page, box: Box) => {
  const c = await meanColor(page, box);
  return c.g - c.r;
};
const MARKED = 10;
const UNMARKED = 2;

test.describe("highlights and notes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("highlight a passage in a colour, add a note, and find it again", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openBookPage(page, mobile);
    const { text, box } = await selectVisibleText(page);

    const menu = page.getByRole("toolbar", { name: "হাইলাইট" });
    await expect(menu).toBeVisible();
    await shot(page, info, "highlight-menu");
    await menu.getByRole("button", { name: "সবুজ" }).click();
    await expect(menu.getByRole("button", { name: "সবুজ" })).toHaveAttribute("aria-pressed", "true");
    // the words on screen are now marked in green
    await expect.poll(() => greenness(page, box)).toBeGreaterThan(MARKED);

    await menu.getByRole("button", { name: "নোট লিখুন" }).click();
    const note = "পাঠশালার দৃশ্যটি চমৎকার";
    await page.getByRole("textbox", { name: "নোট" }).fill(note);
    await shot(page, info, "highlight-note-editor");
    await page.getByRole("button", { name: "সংরক্ষণ করুন" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // it survives a reload, in the same place
    await page.reload();
    await waitForReader(page);
    await expect.poll(() => greenness(page, box), { timeout: 10_000 }).toBeGreaterThan(MARKED);

    // listed in the reader's contents sheet
    await page.keyboard.press("t");
    await page.getByRole("tab", { name: /হাইলাইট/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(note)).toBeVisible();
    await page.keyboard.press("Escape");

    // and on the notes page, with its note, ready to export
    await page.goto("/notes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("আমার নোট");
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.locator("blockquote").first()).toContainText(text.trim().slice(2, 12));
    await shot(page, info, "notes-page");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Markdown ফাইল" }).click();
    const md = await readFile((await (await download).path())!, "utf8");
    expect(md).toContain("# আমার নোট");
    expect(md).toContain("## দেবদাস");
    expect(md).toContain(note);
  });

  test("a passage can be saved and shared as an image", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openBookPage(page, mobile);
    await selectVisibleText(page, 24);
    await page.getByRole("toolbar", { name: "হাইলাইট" }).getByRole("button", { name: "ছবি হিসেবে শেয়ার করুন" }).click();
    const dialog = page.getByRole("dialog", { name: "উদ্ধৃতির ছবি" });
    const canvas = dialog.locator("canvas[data-ready=true]");
    await expect(canvas).toBeVisible();
    const size = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(size).toEqual({ w: 1080, h: 1350 });
    await shot(page, info, "quote-card-dialog");

    await dialog.getByRole("radio", { name: "কাগজ" }).click();
    await expect(dialog.getByRole("radio", { name: "কাগজ" })).toHaveAttribute("aria-checked", "true");
    // the paper card is light ivory (the book's cloth is dark green)
    const corner = () =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const [r, g, b] = c.getContext("2d")!.getImageData(20, 20, 1, 1).data;
        return (r + g + b) / 3;
      });
    await expect.poll(corner).toBeGreaterThan(220);
    await dialog.getByRole("radio", { name: "প্রচ্ছদের রং" }).click();
    await expect.poll(corner).toBeLessThan(90);

    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "ছবি সংরক্ষণ করুন" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("devdas-quote.png");
    const png = await readFile((await file.path())!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(30_000);
    await mkdir(`test-results/screenshots/${info.project.name}`, { recursive: true });
    await writeFile(`test-results/screenshots/${info.project.name}/quote-card.png`, png);
  });

  test("tapping a highlight opens its menu; delete can be undone", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openBookPage(page, mobile);
    const { box } = await selectVisibleText(page);
    const menu = page.getByRole("toolbar", { name: "হাইলাইট" });
    await menu.getByRole("button", { name: "সবুজ" }).click();
    await expect.poll(() => greenness(page, box)).toBeGreaterThan(MARKED);

    // a tap elsewhere closes the menu without turning the page
    const cfi = (await readerState(page)).cfi;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120);
    await expect(menu).toBeHidden();
    expect((await readerState(page)).cfi).toBe(cfi);

    // tapping the highlight brings its menu back, with delete
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(menu.getByRole("button", { name: "হাইলাইট মুছুন" })).toBeVisible();
    expect((await readerState(page)).cfi).toBe(cfi);
    await menu.getByRole("button", { name: "হাইলাইট মুছুন" }).click();
    await expect.poll(() => greenness(page, box)).toBeLessThan(UNMARKED);
    await page.getByRole("button", { name: "ফিরিয়ে আনুন" }).click();
    await expect.poll(() => greenness(page, box)).toBeGreaterThan(MARKED);
  });
});
