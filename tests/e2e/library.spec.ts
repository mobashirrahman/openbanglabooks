import { expect, test, type Page } from "@playwright/test";
import { clearLocalData, meanColor, readerState, selectVisibleText, shot, waitForReader } from "./helpers";

/** The library button on a book page, by the status it shows. */
const libraryButton = (page: Page, status: string) => page.getByRole("button", { name: `লাইব্রেরিতে আছে: ${status}` }).first();

/** Reads the stored highlights straight from IndexedDB. */
async function storedAnnotations(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open("openbanglabooks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("annotations").objectStore("annotations").getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** Replaces the stored highlights (raw IndexedDB, as if written by an older version of the book). */
async function putAnnotations(page: Page, rows: Record<string, unknown>[]) {
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openbanglabooks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("annotations", "readwrite");
          const store = tx.objectStore("annotations");
          store.clear();
          for (const r of rows) store.put(r);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    rows,
  );
}

test.describe("library: statuses, shelves, ratings and reflections", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("a book is given a status, a heart, a shelf, a rating and a private reflection", async ({ page }, info) => {
    test.slow(); // many steps; the WebKit phone project needs more than the default minute
    await page.goto("/books/kapalkundala");
    await page.getByRole("button", { name: "লাইব্রেরিতে রাখুন" }).first().click();

    // status
    await libraryButton(page, "পরে পড়ব").click();
    // the menu is named by its button ("in the library: …")
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await shot(page, info, "library-menu");
    await menu.getByRole("menuitemradio", { name: "পড়া শেষ" }).click();
    await expect(menu).toHaveCount(0);

    // favourite (the menu stays open for ticking)
    await libraryButton(page, "পড়া শেষ").click();
    await menu.getByRole("menuitemcheckbox", { name: "প্রিয়" }).click();
    await expect(menu.getByRole("menuitemcheckbox", { name: "প্রিয়" })).toHaveAttribute("aria-checked", "true");

    // a new shelf, with the book on it
    await menu.getByRole("menuitem", { name: "নতুন তাক" }).click();
    const dialog = page.getByRole("dialog", { name: "নতুন তাক" });
    await dialog.getByRole("textbox", { name: "তাকের নাম" }).fill("ছোটবেলার বই");
    await dialog.getByRole("button", { name: "তৈরি করুন" }).click();
    await expect(dialog).toHaveCount(0);
    await libraryButton(page, "পড়া শেষ").click();
    await expect(menu.getByRole("menuitemcheckbox", { name: "ছোটবেলার বই" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // the reader's own page: a rating and a reflection, kept across a reload
    const own = page.getByRole("region", { name: "আপনার পাতা" });
    await own.getByRole("radio", { name: "৪ তারা" }).click();
    await expect(own.getByRole("radio", { name: "৪ তারা" })).toHaveAttribute("aria-checked", "true");
    const reflection = "সমুদ্রতীরের সেই প্রশ্ন — “পথিক, তুমি পথ হারাইয়াছ?” — মনে থেকে যায়।";
    await own.getByRole("textbox", { name: "নিজের জন্য ভাবনা" }).fill(reflection);
    await expect(own.getByRole("status")).toHaveText("সংরক্ষিত");
    await shot(page, info, "book-own-page");
    await page.reload();
    await expect(own.getByRole("radio", { name: "৪ তারা" })).toHaveAttribute("aria-checked", "true");
    await expect(own.getByRole("textbox", { name: "নিজের জন্য ভাবনা" })).toHaveValue(reflection);

    // the library: by status, favourites, the shelf, and history
    await page.goto("/library");
    const tabs = page.getByRole("tablist", { name: "তাকগুলো" });
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("heading", { name: "পড়া শেষ" })).toBeVisible();
    await expect(panel.getByLabel("৪ তারা")).toBeVisible();
    await tabs.getByRole("tab", { name: /প্রিয় বই/ }).click();
    await expect(panel.getByRole("link", { name: /কপালকুণ্ডলা/ }).first()).toBeVisible();
    await tabs.getByRole("tab", { name: /পরে পড়ব/ }).click();
    await expect(panel.getByText("এখানে এখনও কোনো বই নেই।")).toBeVisible();

    await tabs.getByRole("tab", { name: /ছোটবেলার বই/ }).click();
    await expect(panel.getByRole("heading", { name: "ছোটবেলার বই" })).toBeVisible();
    await expect(panel.getByRole("link", { name: /কপালকুণ্ডলা/ }).first()).toBeVisible();
    await shot(page, info, "library-shelf");
    await panel.getByRole("button", { name: "নাম বদলান" }).click();
    const rename = page.getByRole("dialog", { name: "নাম বদলান" });
    await rename.getByRole("textbox", { name: "তাকের নাম" }).fill("বঙ্কিমের বই");
    await rename.getByRole("button", { name: "নাম বদলান" }).click();
    await expect(tabs.getByRole("tab", { name: /বঙ্কিমের বই/ })).toHaveAttribute("aria-selected", "true");

    await tabs.getByRole("tab", { name: "ইতিহাস" }).click();
    await expect(panel.getByText("১টি বই শেষ")).toBeVisible();
    await expect(panel.getByText(/শেষ করেছেন/)).toBeVisible();
    await shot(page, info, "library-history");

    // deleting the shelf keeps the book in the library
    await tabs.getByRole("tab", { name: /বঙ্কিমের বই/ }).click();
    page.once("dialog", (d) => void d.accept());
    await panel.getByRole("button", { name: "তাক মুছুন" }).click();
    await expect(tabs.getByRole("tab", { name: /বঙ্কিমের বই/ })).toHaveCount(0);
    await expect(tabs.getByRole("tab", { name: "সব" })).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("link", { name: /কপালকুণ্ডলা/ }).first()).toBeVisible();

    // removal from the book page
    await page.goto("/books/kapalkundala");
    await libraryButton(page, "পড়া শেষ").click();
    await menu.getByRole("menuitem", { name: "লাইব্রেরি থেকে সরান" }).click();
    await expect(page.getByRole("button", { name: "লাইব্রেরিতে রাখুন" }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "আপনার পাতা" })).toHaveCount(0);
  });

  test("highlights from an older file of a book are found again, or kept as orphaned", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await page.goto("/read/devdas");
    await waitForReader(page);
    for (let i = 0; i < 2; i++) {
      const before = (await readerState(page)).cfi;
      if (mobile) await page.touchscreen.tap(page.viewportSize()!.width - 20, page.viewportSize()!.height / 2);
      else await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
    }
    await page.waitForTimeout(500);
    const { box } = await selectVisibleText(page);
    await page.getByRole("toolbar", { name: "হাইলাইট" }).getByRole("button", { name: "সবুজ" }).click();
    await expect.poll(async () => (await storedAnnotations(page)).length).toBe(1);
    await page.waitForTimeout(800); // position saved

    // as if both highlights had been made on an older file of the book
    await page.goto("/robots.txt");
    const [real] = await storedAnnotations(page);
    const sha = real.fileSha as string;
    const old = "0".repeat(64);
    await putAnnotations(page, [
      { ...real, fileSha: old, cfi: "epubcfi(/6/2!/4/2,/1:0,/1:1)" },
      { ...real, id: "gone", fileSha: old, quote: "এই বাক্যটি বইয়ের নতুন সংস্করণে আর নেই", prefix: "", suffix: "", note: "হারানো অংশের নোট" },
    ]);

    await page.goto("/read/devdas");
    await waitForReader(page);
    await expect
      .poll(async () => (await storedAnnotations(page)).map((a) => [a.id, a.fileSha === sha, Boolean(a.orphaned)]).sort(), { timeout: 15_000 })
      .toEqual(
        [
          ["gone", false, true],
          [real.id, true, false],
        ].sort(),
      );
    // the found one is drawn where it was
    await expect
      .poll(async () => {
        const c = await meanColor(page, box);
        return c.g - c.r;
      })
      .toBeGreaterThan(10);

    // the notes page keeps the orphan, says so, and offers no place to open it at
    await page.goto("/notes");
    await expect(page.getByText("বইয়ের নতুন সংস্করণে এই অংশটি খুঁজে পাওয়া যায়নি")).toHaveCount(1);
    await expect(page.getByText("হারানো অংশের নোট")).toBeVisible();
    await expect(page.getByRole("link", { name: "বইয়ে দেখুন" })).toHaveCount(1);
    await shot(page, info, "notes-orphaned");
  });
});
