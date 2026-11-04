import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";

/** The viewport a project emulates ("mobile-390"…): the same in every browser engine. */
export const viewportOf = (info: TestInfo) => String(info.project.metadata?.viewport ?? info.project.name);

/** Saves a screenshot for visual review under test-results/screenshots/<project>/. */
export async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  const dir = `test-results/screenshots/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  // finite CSS animations are fast-forwarded to their end: review shots show the settled UI
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage, animations: "disabled" });
}

export async function expectBengaliFonts(page: Page) {
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      ui: document.fonts.check('16px "Hind Siliguri"', "বাংলা"),
      display: document.fonts.check('16px "Tiro Bangla"', "বাংলা"),
    };
  });
  expect(ok.ui, "Hind Siliguri loaded").toBe(true);
  expect(ok.display, "Tiro Bangla loaded").toBe(true);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(0);
}

/** Waits until the reader has rendered a location with visible text. */
export async function waitForReader(page: Page) {
  const reader = page.locator(".reader");
  await expect(reader).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expect(reader).toHaveAttribute("data-cfi", /^epubcfi\(/, { timeout: 15_000 });
  // let the opening transition finish
  await page.waitForTimeout(1200);
  return reader;
}

/**
 * Shows the reader controls deterministically: the controls appear when a
 * book opens and hide themselves after a moment, and Escape toggles them.
 * Waiting for the first auto-hide means Escape always *shows* them.
 */
export async function showControls(page: Page) {
  const contents = page.getByRole("button", { name: "সূচিপত্র" });
  await expect(contents).toBeHidden({ timeout: 8_000 });
  await page.keyboard.press("Escape");
  await expect(contents).toBeVisible();
}

/** A point inside the book (fractions of its width/height), not on the desk around it. */
export async function bookPoint(page: Page, fx: number, fy = 0.5) {
  const box = await page.locator("foliate-view").boundingBox();
  if (!box) throw new Error("the book is not rendered");
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Selects a run of text that is fully on screen inside the book (the section
 * iframe is wider than the view: most of its text is on other pages) and
 * returns it with its box in page coordinates.
 */
export async function selectVisibleText(page: Page, length = 22): Promise<{ text: string; box: Box }> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || !frame.url().startsWith("blob:")) continue;
    const found = await frame.evaluate((len) => {
      const f = window.frameElement!.getBoundingClientRect();
      const W = window.parent.innerWidth;
      const H = window.parent.innerHeight;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? "";
        const start = text.indexOf(" ") + 1;
        if (start <= 0 || text.length < start + len + 4) continue;
        const r = document.createRange();
        r.setStart(n, start);
        r.setEnd(n, start + len);
        const rects = r.getClientRects();
        if (rects.length !== 1) continue; // one line, so the box is the text
        const b = rects[0];
        const x = b.left + f.left;
        const y = b.top + f.top;
        if (x < 30 || x + b.width > W - 30 || y < 90 || y + b.height > H - 110) continue;
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        return { text: r.toString(), box: { x, y, width: b.width, height: b.height } };
      }
      return null;
    }, length);
    if (found) return found;
  }
  throw new Error("no visible text to select");
}

/** Mean colour of a screen area (what a reader actually sees there). */
export async function meanColor(page: Page, box: Box) {
  const sharp = (await import("sharp")).default;
  const png = await page.screenshot({ clip: box, animations: "disabled" });
  const { channels } = await sharp(png).stats();
  return { r: channels[0].mean, g: channels[1].mean, b: channels[2].mean };
}

export async function readerState(page: Page) {
  return page.locator(".reader").evaluate((el) => ({
    cfi: el.getAttribute("data-cfi") ?? "",
    fraction: Number(el.getAttribute("data-fraction") ?? 0),
    section: Number(el.getAttribute("data-section") ?? 0),
    columns: Number(el.getAttribute("data-columns") ?? 1),
    visible: el.getAttribute("data-visible") ?? "",
  }));
}

export async function clearLocalData(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("openbanglabooks");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
}
