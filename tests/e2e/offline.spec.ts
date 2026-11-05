import { expect, test, type Page } from "@playwright/test";
import { readerState, shot, waitForReader } from "./helpers";

/**
 * The service worker: a book read once opens again with no network, and so
 * do the library and notes; any other page falls back to the offline page,
 * which lists the books on this device.
 */
test.use({ serviceWorkers: "allow" });

const BOOK = "devdas";
// one phone and one desktop size per engine is enough for caching behaviour
const PROJECTS = new Set(["mobile-390", "laptop-1440", "webkit-mobile-390", "webkit-laptop-1440"]);

/** Paths of the pages the worker keeps. */
async function keptPages(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys())
      if (name.startsWith("obb-pages-")) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
}

/** Waits until these pages, and every build script this page has loaded, are kept. */
async function waitUntilKept(page: Page, paths: string[]) {
  await expect.poll(async () => {
    const kept = new Set(await keptPages(page));
    return paths.filter((p) => !kept.has(p));
  }, { timeout: 30_000, message: "pages kept for offline use" }).toEqual([]);
  await expect.poll(
    () =>
      page.evaluate(async () => {
        const loaded = performance
          .getEntriesByType("resource")
          .map((e) => new URL(e.name))
          .filter((u) => u.origin === location.origin && u.pathname.startsWith("/_next/static/") && !u.search);
        const missing: string[] = [];
        for (const u of loaded) if (!(await caches.match(u.href))) missing.push(u.pathname);
        return missing;
      }),
    { timeout: 30_000, message: "scripts kept for offline use" },
  ).toEqual([]);
}

test.describe("offline", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!PROJECTS.has(info.project.name), "caching is checked at one phone and one desktop size");
    await page.goto("/robots.txt");
    const supported = await page.evaluate(() => "serviceWorker" in navigator);
    test.skip(!supported, "this browser build has no service workers");
  });

  test("a book read once opens again offline, with the library and notes", async ({ page, context }, info) => {
    await page.goto(`/read/${BOOK}`);
    await waitForReader(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitUntilKept(page, [`/read/${BOOK}`, "/", "/library", "/notes", "/offline"]);

    await context.setOffline(true);
    try {
      await page.reload();
      const reader = await waitForReader(page);
      await expect(reader).toHaveAttribute("data-visible", /\S/);
      await shot(page, info, "offline-reader");

      await page.goto("/library");
      await expect(page.getByRole("heading", { level: 1, name: "আমার বই" })).toBeVisible();
      await expect(page.getByRole("link", { name: /দেবদাস/ }).first()).toBeVisible();

      await page.goto("/notes");
      await expect(page.getByRole("heading", { level: 1, name: "আমার নোট" })).toBeVisible();

      // the profile counts the books that open without a connection
      await page.goto("/profile");
      await expect(page.getByTestId("offline-count")).toContainText("১টি বই");
    } finally {
      await context.setOffline(false);
    }
  });

  test("a page not kept shows the offline page, which opens the books on this device", async ({ page, context }, info) => {
    await page.goto(`/read/${BOOK}`);
    await waitForReader(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitUntilKept(page, [`/read/${BOOK}`, "/offline"]);

    await context.setOffline(true);
    try {
      await page.goto("/authors/never-visited-here");
      await expect(page.getByRole("heading", { level: 1, name: "এখন ইন্টারনেট নেই" })).toBeVisible();
      const book = page.getByRole("link", { name: /দেবদাস/ });
      await expect(book).toBeVisible();
      await shot(page, info, "offline-page");
      await book.click();
      await waitForReader(page);
    } finally {
      await context.setOffline(false);
    }
  });

  test("a link to a place in a book works offline", async ({ page, context }) => {
    await page.goto(`/read/${BOOK}`);
    const start = (await readerState(await waitForReader(page).then(() => page))).cfi;
    // a place further on: two pages forward
    for (let i = 0; i < 2; i++) {
      const before = (await readerState(page)).cfi;
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
      await page.waitForTimeout(700);
    }
    const later = (await readerState(page)).cfi;
    expect(later).not.toBe(start);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitUntilKept(page, [`/read/${BOOK}`]);
    // forget the saved place, so only the link can bring the reader there
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("openbanglabooks");
          open.onsuccess = () => {
            const tx = open.result.transaction("positions", "readwrite");
            tx.objectStore("positions").clear();
            tx.oncomplete = () => (open.result.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
    );

    await context.setOffline(true);
    try {
      await page.goto(`/read/${BOOK}?cfi=${encodeURIComponent(later)}`);
      await waitForReader(page);
      await expect.poll(async () => (await readerState(page)).cfi).toBe(later);
    } finally {
      await context.setOffline(false);
    }
  });
});
