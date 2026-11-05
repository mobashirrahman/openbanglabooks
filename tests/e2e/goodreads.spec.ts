import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { clearLocalData, expectNoHorizontalOverflow, shot } from "./helpers";

/**
 * Goodreads: the reader's export is read and matched in the browser, the
 * doubtful books are settled by hand, and the library goes back out as a
 * Goodreads-format file.
 */

const HEADER =
  "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";
const EXPORT = [
  HEADER,
  `1,Debdas,Sarat Chandra Chattopadhyay,"Chattopadhyay, Sarat Chandra",,"=""""","=""""",4,3.9,,,,,1917,2023/03/14,2023/01/02,"bengali, favorites, read",,read,"Heartbreaking.<br/>Paro &amp; Devdas.",,,1,0`,
  `2,Gora,Somebody Else,"Else, Somebody",,,,0,,,,,,,,2024/02/02,to-read,,to-read,,,,0,0`,
  `3,Pride and Prejudice,Jane Austen,"Austen, Jane",,,,5,,,,,,,2020/05/05,2020/01/01,read,,read,,,,1,0`,
  `4,The Golden Boat,Rabindranath Tagore,"Tagore, Rabindranath",,,,0,,,,,,,,2024/03/03,to-read,,to-read,,,,0,0`,
  `5,Anandamatha,Bankimchandra Chatterji,"Chatterji, Bankimchandra",,,,2,,,,,,,,2024/04/04,"did-not-finish, history",,did-not-finish,,,too slow for me,0,0`,
].join("\r\n");

type Entry = { workSlug: string; status: string; rating: number | null; favourite: boolean; reflection: string | null; finishedAt: number | null };

const library = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ entries: Entry[]; shelves: string[]; items: string[] }>((resolve) => {
        const open = indexedDB.open("openbanglabooks");
        open.onsuccess = () => {
          const tx = open.result.transaction(["library", "shelves", "shelfItems"]);
          const all = (name: string) => new Promise<unknown[]>((r) => (tx.objectStore(name).getAll().onsuccess = (e) => r((e.target as IDBRequest).result)));
          void Promise.all([all("library"), all("shelves"), all("shelfItems")]).then(([entries, shelves, items]) =>
            resolve({
              entries: (entries as Entry[]).sort((a, b) => a.workSlug.localeCompare(b.workSlug)),
              shelves: (shelves as { name: string }[]).map((s) => s.name).sort(),
              items: (items as { workSlug: string }[]).map((i) => i.workSlug).sort(),
            }),
          );
        };
      }),
  );

test.describe("Goodreads", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  test("a Goodreads export is matched, settled by hand and added; the library goes back out", async ({ page }, info) => {
    await page.goto("/library");
    await page.getByRole("link", { name: "গুডরিডস: আনা ও নেওয়া" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "গুডরিডস" })).toBeVisible();

    await page.getByTestId("goodreads-file").setInputFiles({ name: "goodreads_library_export.csv", mimeType: "text/csv", buffer: Buffer.from(EXPORT) });
    await expect(page.getByText("ফাইলে ৫টি বই। তার ৪টি আমাদের গ্রন্থাগারে আছে।")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("gr-count-match")).toHaveText("৩");
    await expect(page.getByTestId("gr-count-maybe")).toHaveText("১");
    await expect(page.getByTestId("gr-count-none")).toHaveText("১");

    // the doubtful one waits for the reader: Gora, but by someone else
    const gora = page.getByRole("combobox", { name: "“Gora”-এর জন্য আমাদের গ্রন্থাগারের বই" });
    await expect(gora).toHaveValue("");
    // books found are chosen already, and can be changed
    await expect(page.getByRole("combobox", { name: "“Debdas”-এর জন্য আমাদের গ্রন্থাগারের বই" })).toHaveValue("devdas");
    await expect(page.getByRole("combobox", { name: "“The Golden Boat”-এর জন্য আমাদের গ্রন্থাগারের বই" })).toHaveValue("sonar-tori");
    await expect(page.getByRole("button", { name: "‘আমার বই’-তে যোগ করুন (৩)" })).toBeEnabled();
    await gora.selectOption("gora");
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "goodreads-review", true);

    // a book not in the catalogue can still be pointed at one, from all books
    const none = page.locator("details").filter({ hasText: "আমাদের গ্রন্থাগারে নেই" });
    await none.locator("summary").click();
    await expect(none.getByText("Pride and Prejudice")).toBeVisible();
    await expect(none.getByRole("button", { name: "বই বেছে নিন" })).toBeVisible();

    await page.getByRole("button", { name: "‘আমার বই’-তে যোগ করুন (৪)" }).click();
    await expect(page.getByText("হয়ে গেছে। ৪টি যোগ হলো, ০টি হালনাগাদ হলো, ০টি আগেই হালনাগাদ ছিল। ২টি নতুন তাক।")).toBeVisible();

    const data = await library(page);
    expect(data.entries.map((e) => [e.workSlug, e.status, e.rating])).toEqual([
      ["anandamath", "dnf", 2],
      ["devdas", "finished", 4],
      ["gora", "want", null],
      ["sonar-tori", "want", null],
    ]);
    const devdas = data.entries.find((e) => e.workSlug === "devdas")!;
    expect(devdas.favourite).toBe(true);
    expect(devdas.reflection).toBe("Heartbreaking.\nParo & Devdas.");
    expect(new Date(devdas.finishedAt!).toDateString()).toBe(new Date(2023, 2, 14).toDateString());
    expect(data.entries.find((e) => e.workSlug === "anandamath")!.reflection).toBe("too slow for me");
    expect(data.shelves).toEqual(["bengali", "history"]);
    expect(data.items).toEqual(["anandamath", "devdas"]);

    // the same file again changes nothing
    await expect(page.getByRole("button", { name: "অন্য ফাইল বেছে নিন" })).toBeVisible();
    await page.getByTestId("goodreads-file").setInputFiles({ name: "goodreads_library_export.csv", mimeType: "text/csv", buffer: Buffer.from(EXPORT) });
    await page.getByRole("combobox", { name: "“Gora”-এর জন্য আমাদের গ্রন্থাগারের বই" }).selectOption("gora");
    await page.getByRole("button", { name: "‘আমার বই’-তে যোগ করুন (৪)" }).click();
    await expect(page.getByText("হয়ে গেছে। ০টি যোগ হলো, ০টি হালনাগাদ হলো, ৪টি আগেই হালনাগাদ ছিল।")).toBeVisible();

    // and out again, in Goodreads' own format, reflections only when asked
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "ফাইল নামান" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^openbanglabooks-goodreads-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = (await readFile((await download.path())!, "utf8")).replace(/^﻿/, "");
    const [header, ...rows] = csv.trim().split("\r\n");
    expect(header.startsWith("Book Id,Title,Author,Author l-f,")).toBe(true);
    expect(header.endsWith("OpenBanglaBooks Id,Title (Bengali),Author (Bengali)")).toBe(true);
    expect(rows).toHaveLength(4);
    const devdasRow = rows.find((r) => r.includes(",devdas,"))!;
    expect(devdasRow).toContain("Devdas,Sarat Chandra Chattopadhyay,\"Chattopadhyay, Sarat Chandra\"");
    expect(devdasRow).toContain(",2023/03/14,");
    expect(devdasRow).toContain('"read, favorites, bengali"');
    expect(devdasRow).not.toContain("Heartbreaking");
    await expect(page.getByText("ফাইলে ৪টি বই।")).toBeVisible();

    await page.getByRole("link", { name: "‘আমার বই’ খুলুন" }).click();
    await expect(page.getByRole("tab", { name: /^bengali/ })).toBeVisible();
  });

  test("a file that is not a Goodreads export is explained", async ({ page }) => {
    await page.goto("/en/library/goodreads");
    await expect(page.getByRole("heading", { name: "Bring your Goodreads books" })).toBeVisible();
    await page.getByTestId("goodreads-file").setInputFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from("name,email\nRahim,r@example.com\n") });
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("This doesn't look like a Goodreads export. It needs at least the Title and Author columns.");
    await page.getByRole("button", { name: "Download the file" }).click();
    await expect(page.getByText("Your library is empty, so there is nothing to export yet.")).toBeVisible();
  });
});
