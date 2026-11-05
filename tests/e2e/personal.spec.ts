import { expect, test, type Page } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { clearLocalData, shot, waitForReader } from "./helpers";
import { signIn, signInAs, syncNow, waitForSynced } from "./auth-helpers";
import { service } from "./admin-helpers";

/**
 * A reader's own EPUB: checked and cleaned in the browser, kept on the device
 * (nothing about it reaches the account), read like any book; kept in the
 * account only when the reader asks, and then on every device.
 */

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** A small EPUB with hostile bits in it; the token makes its contents (and id) unique. */
function ownEpub(token: string, { title = "আমার নিজের বই", drm = false } = {}) {
  const chapter = (h: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="bn"><head><title>${h}</title><link rel="stylesheet" href="style.css"/></head><body><h1 onclick="window.parent.pwned=1">${h}</h1>${body}</body></html>`;
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:own:${token}</dc:identifier><dc:title>${title}</dc:title><dc:creator>অচেনা লেখক</dc:creator><dc:language>bn</dc:language></metadata>` +
        `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest>` +
        `<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>সূচি</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">প্রথম পরিচ্ছেদ</a></li><li><a href="c2.xhtml">দ্বিতীয় পরিচ্ছেদ</a></li></ol></nav></body></html>`),
    "OEBPS/c1.xhtml": strToU8(
      chapter("প্রথম পরিচ্ছেদ", `<p>পদ্মার ধারে একটি ছোট গ্রাম ছিল। ${token}</p><script>window.parent.pwned = 1</script><img src="https://tracker.example/p.gif" alt=""/>` + "<p>নৌকা ভাসিয়া চলিল দূরের ঘাটে।</p>".repeat(6)),
    ),
    "OEBPS/c2.xhtml": strToU8(chapter("দ্বিতীয় পরিচ্ছেদ", "<p>সন্ধ্যা নামিল, আকাশে তারা ফুটিল।</p>".repeat(6))),
    "OEBPS/style.css": strToU8(`@import url(https://evil.example/x.css); h1 { color: #333 }`),
    "OEBPS/cover.png": PNG,
    ...(drm ? { "META-INF/rights.xml": strToU8("<rights/>") } : {}),
  };
  return Buffer.from(zipSync(files));
}

async function importFile(page: Page, name: string, buffer: Buffer, mimeType = "application/epub+zip") {
  await page.getByTestId("import-epub").first().setInputFiles({ name, mimeType, buffer });
}

/** The imported file as stored on this device. */
async function storedFile(page: Page, id: string): Promise<Record<string, Uint8Array>> {
  const b64 = await page.evaluate(
    (bookId) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("openbanglabooks");
        open.onsuccess = () => {
          const tx = open.result.transaction(["personalBooks", "files"]);
          const get = tx.objectStore("personalBooks").get(bookId);
          get.onsuccess = () => {
            const file = tx.objectStore("files").get(get.result.fileSha);
            file.onsuccess = () => {
              const bytes = new Uint8Array(file.result.data);
              let s = "";
              for (const b of bytes) s += String.fromCharCode(b);
              resolve(btoa(s));
            };
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    id,
  );
  return unzipSync(Buffer.from(b64, "base64"));
}

const ownBookIds = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("openbanglabooks");
        open.onsuccess = () => {
          const req = open.result.transaction("personalBooks").objectStore("personalBooks").getAllKeys();
          req.onsuccess = () => resolve(req.result as string[]);
        };
      }),
  );

test.describe("a reader's own books", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("an EPUB from the reader's device is cleaned, added and read", async ({ page }, info) => {
    const token = `own${Date.now().toString(36)}`;
    await page.goto("/library");
    await expect(page.getByRole("button", { name: "নিজের বই যোগ করুন" })).toBeVisible();
    await importFile(page, "amar-boi.epub", ownEpub(token));

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("“আমার নিজের বই” আপনার লাইব্রেরিতে যোগ হয়েছে।")).toBeVisible({ timeout: 20_000 });
    // keeping it in the account is offered, never done by default
    await expect(dialog.getByText("অ্যাকাউন্টে রাখতে চাইলে আগে সাইন ইন করুন।")).toBeVisible();
    await shot(page, info, "own-book-added");

    const [id] = await ownBookIds(page);
    expect(id).toMatch(/^mine-[0-9a-f]{24}$/);
    const files = await storedFile(page, id);
    const c1 = strFromU8(files["OEBPS/c1.xhtml"]);
    expect(c1).toContain(token);
    expect(c1).not.toMatch(/script|pwned|onclick|tracker\.example/);
    expect(strFromU8(files["OEBPS/style.css"])).not.toContain("evil.example");

    await dialog.getByRole("link", { name: "পড়ুন" }).click();
    const reader = await waitForReader(page);
    await expect(reader).toHaveAttribute("data-visible", /পদ্মার ধারে|প্রথম পরিচ্ছেদ/);
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
    await shot(page, info, "own-book-reader");

    // the library lists it among the reader's own books, on this device only
    await page.goto("/library");
    await page.getByRole("tab", { name: /নিজের বই/ }).click();
    const card = page.locator(`[data-own-book="${id}"]`);
    await expect(card).toContainText("আমার নিজের বই");
    await expect(card).toContainText("শুধু এই ডিভাইসে");
    await card.scrollIntoViewIfNeeded();
    await shot(page, info, "own-books-tab");

    // renamed, everywhere it appears
    await card.getByRole("button", { name: /আরও/ }).click();
    await page.getByRole("menuitem", { name: "নাম বদলান" }).click();
    await page.getByLabel("বইয়ের নাম").fill("নতুন নাম");
    await page.getByRole("button", { name: "রাখুন" }).click();
    await expect(card).toContainText("নতুন নাম");

    // deleted, with everything in it
    page.once("dialog", (d) => void d.accept());
    await card.getByRole("button", { name: /আরও/ }).click();
    await page.getByRole("menuitem", { name: "বইটি মুছুন" }).click();
    await expect(page.getByText("বইটি মুছে ফেলা হয়েছে।")).toBeVisible();
    expect(await ownBookIds(page)).toEqual([]);
  });

  test("files that cannot be added are explained", async ({ page }, info) => {
    test.skip(!["mobile-390", "laptop-1440", "webkit-mobile-390"].includes(info.project.name), "messages, not layout");
    await page.goto("/library");
    await importFile(page, "locked.epub", ownEpub("drm", { drm: true }));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText("DRM");
    await dialog.getByRole("button", { name: "বন্ধ করুন" }).click();

    await importFile(page, "notes.pdf", Buffer.from("%PDF-1.7 not a book"), "application/pdf");
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("এটি EPUB ফাইল নয়");
    expect(await ownBookIds(page)).toEqual([]);
  });

  test("nothing about a device-only book reaches the account; kept there, it follows the reader", async ({ page, browser }, info) => {
    test.skip(!["mobile-390", "laptop-1440"].includes(info.project.name), "account flow, checked at two sizes");
    const email = await signIn(page, info, "/library");
    const token = `acct${Date.now().toString(36)}`;
    await importFile(page, "amar-boi.epub", ownEpub(token, { title: "অ্যাকাউন্টের বই" }));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/আপনার লাইব্রেরিতে যোগ হয়েছে/)).toBeVisible({ timeout: 20_000 });
    const [id] = await ownBookIds(page);

    // read a little, so there is a place and a library entry to (not) sync
    await dialog.getByRole("link", { name: "পড়ুন" }).click();
    await waitForReader(page);
    await page.goto("/library");
    await syncNow(page);
    await waitForSynced(page);

    const sb = service();
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const uid = users.users.find((u) => u.email === email)!.id;
    const serverRows = async () => {
      const count = async (table: string, column: string) => (await sb.from(table).select("id", { count: "exact", head: true }).eq("user_id", uid).eq(column, id).eq("deleted", false)).count ?? 0;
      return { book: await count("personal_books", "id"), library: await count("user_books", "work_slug"), place: await count("reading_positions", "work_slug") };
    };
    expect(await serverRows()).toEqual({ book: 0, library: 0, place: 0 });

    // the reader chooses to keep it in the account
    await page.goto("/library");
    await page.getByRole("tab", { name: /নিজের বই/ }).click();
    const card = page.locator(`[data-own-book="${id}"]`);
    await card.getByRole("button", { name: /আরও/ }).click();
    await page.getByRole("menuitem", { name: "অ্যাকাউন্টে রাখুন" }).click();
    await expect(page.getByText("বইটি আপনার অ্যাকাউন্টে রাখা হয়েছে।")).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("অ্যাকাউন্টে রাখা");
    await waitForSynced(page);
    await expect.poll(serverRows, { timeout: 15_000 }).toEqual({ book: 1, library: 1, place: 1 });
    const sha = (await sb.from("personal_books").select("file_sha").eq("user_id", uid).eq("id", id).single()).data!.file_sha as string;
    const listed = await sb.storage.from("personal-books").list(uid);
    expect(listed.data?.map((f) => f.name)).toContain(`${sha}.epub`);

    // another device of the same reader downloads it once, then reads it
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, locale: "bn-BD", viewport: { width: 1280, height: 800 } });
    const other = await context.newPage();
    try {
      await signInAs(other, email, "/library");
      await other.getByRole("tab", { name: /নিজের বই/ }).click({ timeout: 20_000 });
      await other.locator(`[data-own-book="${id}"]`).getByRole("link").click();
      await other.getByRole("button", { name: "এই ডিভাইসে আনুন" }).click();
      await waitForReader(other);
    } finally {
      await context.close();
    }

    // deleting it removes it from the account and its file from storage
    page.once("dialog", (d) => void d.accept());
    await page.goto("/library");
    await page.getByRole("tab", { name: /নিজের বই/ }).click();
    await card.getByRole("button", { name: /আরও/ }).click();
    await page.getByRole("menuitem", { name: "বইটি মুছুন" }).click();
    await expect(page.getByText("বইটি মুছে ফেলা হয়েছে।")).toBeVisible();
    await waitForSynced(page);
    await expect.poll(serverRows, { timeout: 15_000 }).toEqual({ book: 0, library: 0, place: 0 });
    expect((await sb.storage.from("personal-books").list(uid)).data ?? []).toHaveLength(0);
  });
});
