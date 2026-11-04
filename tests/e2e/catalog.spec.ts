import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectBengaliFonts, expectNoHorizontalOverflow, shot } from "./helpers";

test.describe("public catalog", () => {
  test("home: Bengali UI, featured book, shelves, structured data", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
    await expect(page).toHaveTitle("বাংলা বই অনলাইনে পড়ুন | OpenBanglaBooks");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "বাংলা সাহিত্যের ক্লাসিক" })).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(ld).toContain('"WebSite"');
    expect(ld).toContain('"SearchAction"');
    await expectBengaliFonts(page);
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "home");
    await shot(page, info, "home-full", true);
  });

  test("book page: metadata, canonical, Book JSON-LD, TOC deep links", async ({ page }, info) => {
    await page.goto("/books/devdas");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("দেবদাস");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/books\/devdas$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", /\/en\/books\/devdas$/);
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /\/og\/books\/devdas\.png$/);
    const lds = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(lds.join()).toContain('"@type":"Book"');
    expect(lds.join()).toContain('"BreadcrumbList"');
    await expect(page.locator('a[href*="/read/devdas?at="]').first()).toBeVisible();
    await expect(page.getByRole("link", { name: "পড়া শুরু করুন" })).toHaveAttribute("href", "/read/devdas");
    await expectNoHorizontalOverflow(page);
    await shot(page, info, "book");
  });

  test("English UI lives under /en with real translations", async ({ page }) => {
    await page.goto("/en/books/gora");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "Start reading" })).toBeVisible();
    await expect(page.getByText("Calcutta at the end of the nineteenth century")).toBeVisible();
  });

  test("/bn/… redirects to the canonical unprefixed URL", async ({ page }) => {
    const res = await page.goto("/bn/books/gora");
    expect(new URL(page.url()).pathname).toBe("/books/gora");
    expect(res?.status()).toBe(200);
  });

  test("search finds misspelt Bengali and romanised titles", async ({ page, isMobile }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "খুঁজুন" }).click();
    const input = page.getByRole("combobox");
    await input.fill("দেবদাশ");
    await expect(page.getByRole("option").filter({ hasText: "দেবদাস" })).toBeVisible();
    await input.fill("gitanjoli");
    await expect(page.getByRole("option").filter({ hasText: "গীতাঞ্জলি" })).toBeVisible();
    await input.press("Enter");
    await expect(page).toHaveURL(/\/books\/gitanjali$/);
    void isMobile;
  });

  test("browse filters by genre", async ({ page }) => {
    await page.goto("/books?genre=kobita");
    await expect(page.getByText("২টি বই")).toBeVisible();
    await expect(page.getByRole("heading", { name: "গীতাঞ্জলি" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "দেবদাস" })).toHaveCount(0);
  });

  test("author page with biography and works", async ({ page }, info) => {
    await page.goto("/authors/rabindranath-tagore");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("রবীন্দ্রনাথ ঠাকুর");
    await expect(page.getByRole("heading", { name: "গোরা" })).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join()).toContain('"Person"');
    await shot(page, info, "author");
  });

  test("private and search pages are noindex; robots, sitemap and manifest exist", async ({ page, request }) => {
    for (const path of ["/library", "/profile", "/search?q=x"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
    expect((await request.get("/robots.txt")).status()).toBe(200);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/books/gora");
    expect(sitemap).toContain('hreflang="en"');
    expect(sitemap).not.toContain("/read/");
    expect((await request.get("/manifest.webmanifest")).status()).toBe(200);
  });

  test("unknown pages return 404", async ({ page }) => {
    const res = await page.goto("/books/does-not-exist");
    expect(res?.status()).toBe(404);
  });

  test("accessibility: no serious or critical axe violations", async ({ page }, info) => {
    test.skip(!["mobile-390", "laptop-1440"].includes(info.project.name), "axe on one phone and one desktop size");
    for (const path of ["/", "/books/gora", "/books", "/authors/sarat-chandra-chattopadhyay"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${path}: ${v.id} – ${v.nodes.length} nodes: ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });
});
