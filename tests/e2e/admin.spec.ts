import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearLocalData, readerState, shot, waitForReader } from "./helpers";
import { signIn } from "./auth-helpers";
import { makeEditor, removeTestCatalog, testEpub } from "./admin-helpers";

/**
 * The catalogue editor, end to end: who may enter, creating an author, a
 * book and an edition, uploading (and refusing) EPUB files, publishing with
 * verified rights, and withdrawing. Test rows use a unique slug prefix and
 * are removed afterwards.
 */

// visible only: Next keeps recently visited pages mounted (hidden) for instant back navigation
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true });

const v = (l: Locator) => l.filter({ visible: true });
const save = (page: Page) => page.getByRole("button", { name: "সংরক্ষণ করুন" }).filter({ visible: true }).click();

test.describe("catalogue editor", () => {
  let tag = "";
  test.beforeEach(async ({ page }, info) => {
    tag = `e2e-${info.project.name.replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });
  // runs even when a test times out (a finally block in the test would not)
  test.afterEach(async () => {
    if (tag) await removeTestCatalog(tag);
  });

  test("readers are kept out, editors build and publish a book", async ({ page, baseURL }, info) => {
    test.slow();
      // ── a reader: no entry, no uploads
      const email = await signIn(page, info, "/profile");
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "এই অংশ শুধু সম্পাদকদের জন্য।" })).toBeVisible();
      const refused = await page.request.post("/api/admin/epub?edition=00000000-0000-0000-0000-000000000000", {
        headers: { origin: baseURL!, "content-type": "application/epub+zip" },
        data: testEpub("x"),
      });
      expect(refused.status()).toBe(403);
      const crossSite = await page.request.post("/api/admin/epub?edition=00000000-0000-0000-0000-000000000000", {
        headers: { origin: "https://evil.example", "content-type": "application/epub+zip" },
        data: testEpub("x"),
      });
      expect(crossSite.status()).toBe(403);

      // ── made an editor: the catalogue opens, and the profile links to it
      await makeEditor(email);
      await page.goto("/profile");
      await page.getByRole("link", { name: "ক্যাটালগ সম্পাদনা" }).click();
      await expect(page.getByRole("heading", { name: "বই", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /দেবদাস/ }).first()).toBeVisible();

      // ── an author
      await page.getByRole("navigation", { name: "ক্যাটালগের অংশ" }).getByRole("link", { name: "লেখক" }).click();
      await v(page.getByRole("link", { name: "নতুন লেখক" })).click();
      await field(page, "নাম (বাংলা)").fill("পরীক্ষক লেখক");
      await field(page, "নাম (ইংরেজি)").fill("Test Author");
      await field(page, "স্লাগ (ওয়েব ঠিকানা)").fill(`${tag}-author`);
      await field(page, "জন্মসাল").fill("১৮৫০");
      await field(page, "মৃত্যুসাল").fill("1840");
      await field(page, "অবস্থা").selectOption("published");
      await save(page);
      await expect(v(page.getByText("মৃত্যুসাল জন্মসালের আগে হতে পারে না।"))).toBeVisible();
      await expect(field(page, "নাম (বাংলা)")).toHaveValue("পরীক্ষক লেখক"); // nothing typed is lost
      await field(page, "মৃত্যুসাল").fill("1900");
      await save(page);
      await expect(page).toHaveURL(/\/admin\/authors\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { name: "পরীক্ষক লেখক" })).toBeVisible();

      // ── a book, first with a slug that is taken
      await page.getByRole("navigation", { name: "ক্যাটালগের অংশ" }).getByRole("link", { name: "বই" }).click();
      await v(page.getByRole("link", { name: "নতুন বই" })).click();
      await field(page, "শিরোনাম (বাংলা)").fill("পরীক্ষার বই");
      await field(page, "শিরোনাম (ইংরেজি)").fill("A Test Book");
      await field(page, "শিরোনাম (রোমান হরফে)").fill("porikkhar boi");
      await field(page, "স্লাগ (ওয়েব ঠিকানা)").fill("devdas");
      await field(page, "প্রথম প্রকাশ (সাল)").fill("1890");
      await v(page.getByLabel("লেখক বেছে নিন ১")).selectOption({ label: "পরীক্ষক লেখক (১৯০০)" });
      // the radio itself is visually hidden; its cover picture is what is clicked
      const cover5 = v(page.getByRole("radio", { name: "প্রচ্ছদ ৫" }));
      await page.locator("label").filter({ has: cover5 }).click();
      await expect(cover5).toBeChecked();
      await save(page);
      await expect(v(page.getByText("এই স্লাগ আগে থেকেই ব্যবহার হচ্ছে।"))).toBeVisible();
      await field(page, "স্লাগ (ওয়েব ঠিকানা)").fill(tag);
      await save(page);
      await expect(page).toHaveURL(/\/admin\/works\/[0-9a-f-]{36}$/);
      const workPath = new URL(page.url()).pathname;
      await expect(page.getByRole("heading", { name: "পরীক্ষার বই" })).toBeVisible();

      // publishing needs a verified rights basis
      await field(page, "অবস্থা").selectOption("published");
      await save(page);
      await expect(v(page.getByText("প্রকাশ করতে স্বত্বের কারণ লিখে যাচাই করুন।"))).toBeVisible();
      await expect(v(page.getByText("স্বয়ংক্রিয় পরীক্ষা: স্বত্বমুক্ত মনে হচ্ছে।"))).toBeVisible();
      await v(page.getByRole("button", { name: "এই কারণটি বসান" })).click();
      await expect(field(page, "কেন প্রকাশ করা যায়")).toHaveValue(/Author died 1900/);
      await v(page.getByLabel("আমি স্বত্বের তথ্য যাচাই করেছি")).check();
      await save(page);
      await expect(v(page.getByRole("status").filter({ hasText: "সংরক্ষিত হয়েছে।" }))).toBeVisible();
      await expect(v(page.getByText(/যাচাই করেছেন/))).toBeVisible();
      await shot(page, info, "admin-work", true);

      // ── an edition, and its file
      await v(page.getByRole("link", { name: "নতুন সংস্করণ" })).click();
      await field(page, "উৎস").fill("পরীক্ষার উৎস");
      await field(page, "উৎসের লিংক").fill("https://example.org/source");
      await field(page, "লাইসেন্স").fill("Public domain");
      await field(page, "অবস্থা").selectOption("published");
      await save(page);
      await expect(page).toHaveURL(/\/admin\/editions\/[0-9a-f-]{36}$/);

      const chooser = v(page.getByLabel("EPUB ফাইল বেছে নিন"));
      await chooser.setInputFiles({ name: "notes.epub", mimeType: "application/epub+zip", buffer: Buffer.from("not really a book") });
      await v(page.getByRole("button", { name: "ফাইল তুলুন" })).click();
      await expect(v(page.getByRole("alert").filter({ hasText: "ফাইলটি গ্রহণ করা যায়নি:" }))).toContainText("Not a ZIP archive");
      const token = `চিহ্ন${Date.now()}`;
      await chooser.setInputFiles({ name: "book.epub", mimeType: "application/epub+zip", buffer: testEpub(token) });
      await v(page.getByRole("button", { name: "ফাইল তুলুন" })).click();
      await expect(v(page.getByText("নতুন ফাইল চালু হয়েছে (২টি অধ্যায়)।"))).toBeVisible({ timeout: 20_000 });
      await expect(v(page.getByText("চালু", { exact: true }))).toBeVisible();
      await shot(page, info, "admin-edition");

      // ── readers find it, with its table of contents, and can read it
      await page.goto(`/books/${tag}`);
      await expect(page.getByRole("heading", { name: "পরীক্ষার বই", level: 1 })).toBeVisible();
      await expect(page.getByText("দ্বিতীয় পরিচ্ছেদ").first()).toBeVisible();
      await page.goto(`/read/${tag}`);
      await waitForReader(page);
      expect((await readerState(page)).visible).toContain(token);

      // ── withdrawn: gone from the public site at once
      await page.goto("/admin");
      await v(page.locator(`a[href="${workPath}"]`)).click();
      await expect(v(page.getByRole("heading", { name: "পরীক্ষার বই" }))).toBeVisible();
      await field(page, "অবস্থা").selectOption("withdrawn");
      await save(page);
      await expect(v(page.getByRole("status").filter({ hasText: "সংরক্ষিত হয়েছে।" }))).toBeVisible();
      const gone = await page.goto(`/books/${tag}`);
      expect(gone?.status()).toBe(404);
  });
});
