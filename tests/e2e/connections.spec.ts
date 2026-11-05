import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth-helpers";
import { clearLocalData, expectNoHorizontalOverflow, expectNoSeriousViolations, shot } from "./helpers";

/**
 * Hardcover and Readwise, against the stand-ins in mock-upstreams.ts (the
 * app server must be started with tests/e2e/upstreams.env). Hardcover is
 * connected through its consent screen, read in, and written to; Readwise
 * gets the reader's highlights. Nothing moves until the reader asks.
 */

const MOCK = "http://127.0.0.1:3199";
const PROJECTS = new Set(["mobile-390", "laptop-1440", "webkit-mobile-390"]);

type Seed = { library?: Record<string, unknown>[]; annotations?: Record<string, unknown>[] };

/** Writes records straight into the app's IndexedDB (opened by the page already). */
const seed = (page: Page, data: Seed) =>
  page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openbanglabooks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(["library", "annotations"], "readwrite");
          for (const e of data.library ?? []) tx.objectStore("library").put(e);
          for (const a of data.annotations ?? []) tx.objectStore("annotations").put(a);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    data,
  );

const libraryOf = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ workSlug: string; status: string; rating: number | null }[]>((resolve) => {
        const open = indexedDB.open("openbanglabooks");
        open.onsuccess = () => {
          const req = open.result.transaction("library").objectStore("library").getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve((req.result as { workSlug: string; status: string; rating?: number | null }[]).map((e) => ({ workSlug: e.workSlug, status: e.status, rating: e.rating ?? null })).sort((a, b) => a.workSlug.localeCompare(b.workSlug)));
          };
        };
      }),
  );

const snapshot = (slug: string, title_bn: string, author: string) => ({ slug, title_bn, subtitle_bn: null, cover_variant: 3, authors: [{ name_bn: author }] });

async function hardcoverState(username: string) {
  return (await (await fetch(`${MOCK}/__state/hardcover/${username}`)).json()) as {
    library: { book_id: number; status_id: number; rating: number | null; user_date?: string; imported?: boolean }[];
    refreshes: number;
    revoked: boolean;
    throttled: number;
  };
}

test.describe("connections", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!PROJECTS.has(info.project.name), "account flows, checked at one phone and one desktop size and in WebKit");
    const up = await fetch(`${MOCK}/__health`).catch(() => null);
    test.skip(!up?.ok, "the upstream stand-ins are not running (node tests/e2e/mock-upstreams.ts)");
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  /** Signs in and opens the Connections section; skips when the server was started without the test settings. */
  async function connections(page: Page, info: Parameters<typeof signIn>[1]) {
    await signIn(page, info);
    const section = page.locator("#connections");
    await expect(section.getByRole("heading", { name: "সংযোগ" })).toBeVisible();
    const card = section.getByTestId("hardcover-card");
    await expect(card.getByRole("link", { name: "হার্ডকভার জুড়ুন" }).or(card.getByText("এই সাইটে এখনও চালু হয়নি।"))).toBeVisible({ timeout: 15_000 });
    test.skip(await card.getByText("এই সাইটে এখনও চালু হয়নি।").isVisible(), "the app server was started without tests/e2e/upstreams.env");
    return section;
  }

  test("Hardcover: connect, bring the shelves in, send the library out, disconnect", async ({ page }, info) => {
    const section = await connections(page, info);
    const card = section.getByTestId("hardcover-card");
    await card.getByRole("link", { name: "হার্ডকভার জুড়ুন" }).click();

    // Hardcover's consent screen, then back to the profile
    await expect(page.getByRole("heading", { name: "Allow OpenBanglaBooks to use your Hardcover account?" })).toBeVisible();
    await expect(page.getByText("read:me:content, read:library, write:library, read:catalog:search")).toBeVisible();
    await page.getByRole("link", { name: "Allow" }).click();
    await page.waitForURL((u) => u.pathname === "/profile");
    await expect(page.getByText("হার্ডকভার যুক্ত হয়েছে।")).toBeVisible();
    // the outcome is not left in the address for a reload to repeat
    await expect.poll(() => new URL(page.url()).search).toBe("");
    const connected = card.getByText(/^@reader\d+ হিসেবে যুক্ত$/);
    await expect(connected).toBeVisible();
    const username = (await connected.textContent())!.match(/@(reader\d+)/)![1];
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousViolations(page, "profile, Hardcover connected");
    await shot(page, info, "connections-hardcover");

    // bringing books in: the same review as a Goodreads file
    await card.getByRole("link", { name: "বই আনুন বা পাঠান" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "হার্ডকভার" })).toBeVisible();
    await page.getByRole("button", { name: "আমার হার্ডকভার তাক পড়ুন" }).click();
    // four on the shelves, one of them "ignored" there
    await expect(page.getByText("হার্ডকভারের তাকে ৩টি বই। তার ২টি আমাদের গ্রন্থাগারে আছে।")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("gr-count-match")).toHaveText("২");
    await expect(page.getByTestId("gr-count-none")).toHaveText("১");
    await page.getByRole("button", { name: "‘আমার বই’-তে যোগ করুন (২)" }).click();
    await expect(page.getByText("হয়ে গেছে। ২টি যোগ হলো, ০টি হালনাগাদ হলো, ০টি আগেই হালনাগাদ ছিল।")).toBeVisible();
    expect(await libraryOf(page)).toEqual([
      { workSlug: "anandamath", status: "dnf", rating: 2 },
      { workSlug: "gora", status: "want", rating: null },
    ]);

    // the reader finishes Gora and adds Devdas; one of their own books is never sent
    await seed(page, {
      library: [
        { workSlug: "gora", status: "finished", rating: 4, addedAt: Date.now(), finishedAt: new Date(2024, 4, 10, 12).getTime(), updatedAt: Date.now(), work: snapshot("gora", "গোরা", "রবীন্দ্রনাথ ঠাকুর") },
        { workSlug: "devdas", status: "want", rating: null, addedAt: Date.now(), updatedAt: Date.now(), work: snapshot("devdas", "দেবদাস", "শরৎচন্দ্র চট্টোপাধ্যায়") },
        { workSlug: "mine-0123456789abcdef01234567", status: "reading", addedAt: Date.now(), updatedAt: Date.now(), work: snapshot("mine-0123456789abcdef01234567", "আমার খাতা", "আমি") },
      ],
    });

    await page.getByRole("button", { name: "হার্ডকভারে আমার বই খুঁজুন" }).click();
    await expect(page.getByText("৩টির মধ্যে ৩টি বই হার্ডকভারে পাওয়া গেছে।")).toBeVisible({ timeout: 15_000 });
    // two Devdas listings: the reader settles it
    const check = page.locator("section").filter({ has: page.getByRole("heading", { name: /^এগুলো মিলিয়ে নিন/ }) });
    const devdas = check.getByRole("combobox", { name: "“দেবদাস”-এর জন্য হার্ডকভারের বই" });
    await expect(devdas).toHaveValue("0");
    await expect(page.getByRole("combobox", { name: "“গোরা”-এর জন্য হার্ডকভারের বই" })).toHaveValue("2001");
    await expect(page.getByRole("combobox", { name: "“আনন্দমঠ”-এর জন্য হার্ডকভারের বই" })).toHaveValue("2004");
    await expect(page.getByText("আমার খাতা")).toHaveCount(0);
    await devdas.selectOption({ label: "Devdas — Sarat Chandra Chattopadhyay — 1917" });
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousViolations(page, "Hardcover send review");
    await shot(page, info, "hardcover-send-review", true);

    await page.getByRole("button", { name: "হার্ডকভারে পাঠান (৩)" }).click();
    await expect(page.getByText("হয়ে গেছে। ১টি যোগ হলো, ১টি হালনাগাদ হলো, ১টি আগেই হালনাগাদ ছিল।")).toBeVisible({ timeout: 15_000 });
    let state = await hardcoverState(username);
    const byBook = new Map(state.library.map((u) => [u.book_id, u]));
    expect(byBook.get(2001)).toMatchObject({ status_id: 3, rating: 4, user_date: "2024-05-10" });
    expect(byBook.get(2002)).toMatchObject({ status_id: 1, imported: true });
    expect(byBook.get(2004)).toMatchObject({ status_id: 5, rating: 2 });
    // each of the three calls (read, find, send) refreshed, the stand-in's tokens being short, and no refresh token was used twice
    expect(state.refreshes).toBe(3);
    expect(state.revoked).toBe(false);
    // and the rate limit (a bucket of ten) was never hit
    expect(state.throttled).toBe(0);

    // the choices are remembered: a second send needs no second look, and changes nothing
    await page.getByRole("button", { name: "আবার খুঁজুন" }).click();
    await expect(page.getByRole("heading", { name: /^এগুলো মিলিয়ে নিন/ })).toHaveCount(0);
    await page.getByRole("button", { name: "হার্ডকভারে পাঠান (৩)" }).click();
    await expect(page.getByText("হয়ে গেছে। ০টি যোগ হলো, ০টি হালনাগাদ হলো, ৩টি আগেই হালনাগাদ ছিল।")).toBeVisible({ timeout: 15_000 });

    // disconnecting withdraws the tokens at Hardcover too
    await page.goto("/profile");
    await page.getByTestId("hardcover-card").getByRole("button", { name: "সংযোগ ছিন্ন করুন" }).click();
    await expect(page.getByTestId("hardcover-card").getByRole("link", { name: "হার্ডকভার জুড়ুন" })).toBeVisible();
    state = await hardcoverState(username);
    expect(state.revoked).toBe(true);
    await page.goto("/library/hardcover");
    await expect(page.getByText("আগে প্রোফাইলে গিয়ে হার্ডকভার জুড়ুন।")).toBeVisible();
  });

  test("Hardcover: a refused consent links nothing", async ({ page }, info) => {
    const section = await connections(page, info);
    await section.getByTestId("hardcover-card").getByRole("link", { name: "হার্ডকভার জুড়ুন" }).click();
    await page.getByRole("link", { name: "Deny" }).click();
    await page.waitForURL((u) => u.pathname === "/profile");
    await expect(page.getByText("আপনি অনুমতি দেননি, তাই কিছু জোড়া হয়নি।")).toBeVisible();
    await expect(section.getByTestId("hardcover-card").getByRole("link", { name: "হার্ডকভার জুড়ুন" })).toBeVisible();
  });

  test("Readwise: a token is checked, highlights go once and update after", async ({ page }, info) => {
    const section = await connections(page, info);
    const card = section.getByTestId("readwise-card");
    const field = card.getByLabel("রিডওয়াইজ অ্যাকসেস টোকেন");

    await field.fill("not-a-readwise-token-at-all");
    await card.getByRole("button", { name: "জুড়ুন" }).click();
    await expect(card.getByTestId("readwise-status")).toHaveText("হলো না: টোকেনটি দেখে আবার চেষ্টা করুন।");

    // "slow" makes the stand-in ask for a pause once, as Readwise does under load
    const token = `rwtestslow${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.padEnd(30, "x");
    await field.fill(token);
    await card.getByRole("button", { name: "জুড়ুন" }).click();
    await expect(card.getByText("যুক্ত", { exact: true })).toBeVisible();
    await expect(field).toHaveCount(0);

    const now = Date.now();
    const base = { fileSha: "x", prefix: "", suffix: "", color: "yellow", style: "highlight", chapter: null, work: snapshot("gora", "গোরা", "রবীন্দ্রনাথ ঠাকুর"), workSlug: "gora" };
    await seed(page, {
      annotations: [
        { ...base, id: "h1", cfi: "epubcfi(/6/4!/4/2,/1:0,/1:20)", quote: "সে কোনো জাতের নয়", note: "মনে রাখার মতো", fraction: 0.12, createdAt: now - 2000, updatedAt: now - 2000 },
        { ...base, id: "h2", cfi: "epubcfi(/6/8!/4/2,/1:0,/1:20)", quote: "ভারতবর্ষের মানুষ", note: null, fraction: 0.4, createdAt: now - 1000, updatedAt: now - 1000 },
        // a copy kept after an edit conflict, and a highlight in a book kept only on this device: neither goes
        { ...base, id: "h2-copy", conflictOf: "h2", cfi: "epubcfi(/6/8!/4/2,/1:0,/1:20)", quote: "ভারতবর্ষের মানুষ", note: "আরেক ডিভাইসের নোট", fraction: 0.4, createdAt: now - 1000, updatedAt: now - 500 },
        { ...base, id: "h3", workSlug: "mine-0123456789abcdef01234567", work: snapshot("mine-0123456789abcdef01234567", "আমার খাতা", "আমি"), cfi: "epubcfi(/6/2!/4/2)", quote: "নিজের লেখা", note: null, fraction: 0.1, createdAt: now, updatedAt: now },
      ],
    });

    await card.getByRole("button", { name: "নতুন হাইলাইট পাঠান" }).click();
    await expect(card.getByTestId("readwise-status")).toHaveText("২টি হাইলাইট পাঠানো হয়েছে।", { timeout: 20_000 });
    let state = (await (await fetch(`${MOCK}/__state/readwise/${token}`)).json()) as { posts: number; highlights: Record<string, unknown>[] };
    expect(state.highlights).toHaveLength(2);
    const first = state.highlights.find((h) => h.text === "সে কোনো জাতের নয়")!;
    expect(first).toMatchObject({ title: "গোরা", author: "রবীন্দ্রনাথ ঠাকুর", note: "মনে রাখার মতো", category: "books", source_type: "openbanglabooks", location_type: "order", location: 120000 });
    expect(String(first.highlight_url)).toMatch(/\/read\/gora\?cfi=epubcfi.*&h=h1$/);
    await expect(card.getByText(/^এই ডিভাইস থেকে শেষ পাঠানো:/)).toBeVisible();

    // nothing new: nothing sent; sending all again updates the same two, never doubles them
    await card.getByRole("button", { name: "নতুন হাইলাইট পাঠান" }).click();
    await expect(card.getByTestId("readwise-status")).toHaveText("পাঠানোর মতো নতুন হাইলাইট নেই।");
    await card.getByRole("button", { name: "সব হাইলাইট আবার পাঠান" }).click();
    await expect(card.getByTestId("readwise-status")).toHaveText("২টি হাইলাইট পাঠানো হয়েছে।");
    state = (await (await fetch(`${MOCK}/__state/readwise/${token}`)).json()) as typeof state;
    expect(state.posts).toBe(2);
    expect(state.highlights).toHaveLength(2);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousViolations(page, "profile, Readwise connected");
    await shot(page, info, "connections-readwise");

    await card.getByRole("button", { name: "সংযোগ ছিন্ন করুন" }).click();
    await expect(card.getByLabel("রিডওয়াইজ অ্যাকসেস টোকেন")).toBeVisible();
  });
});
