import { expect, test } from "@playwright/test";
import { clearLocalData, expectNoSeriousViolations, viewportOf } from "./helpers";

/**
 * Accessibility of the reader's own pages (the catalogue has its own check
 * in catalog.spec.ts): no serious or critical axe violations, in the light
 * and the dark theme. The library, notes and profile fill in on the device,
 * so each page is checked once it has settled.
 */

const PAGES = ["/library", "/library/goodreads", "/library/hardcover", "/notes", "/profile", "/offline", "/signin", "/search?q=গোরা", "/en/library", "/en/profile"];

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!["mobile-390", "laptop-1440"].includes(viewportOf(info)) || info.project.name.startsWith("webkit-"), "axe on one phone and one desktop size");
    await page.goto("/robots.txt");
    await clearLocalData(page);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const path of PAGES) {
      test(`${path}, ${scheme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
        // what fills in on the device (the library, the session) has settled
        await page.waitForLoadState("networkidle");
        await expect(page.locator("[aria-busy=true]")).toHaveCount(0, { timeout: 10_000 });
        await expectNoSeriousViolations(page, `${path} (${scheme})`);
      });
    }
  }
});
