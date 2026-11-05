import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/** The six viewports the product is verified at, in both engines. */
const viewports = [
  { name: "mobile-375", width: 375, height: 812, touch: true, apple: "iPhone 13 Mini" },
  { name: "mobile-390", width: 390, height: 844, touch: true, apple: "iPhone 13" },
  { name: "tablet-768", width: 768, height: 1024, touch: true, apple: "iPad Mini" },
  { name: "tablet-1024", width: 1024, height: 768, touch: true, apple: "iPad Mini landscape" },
  { name: "laptop-1440", width: 1440, height: 900, touch: false, apple: "Desktop Safari" },
  { name: "desktop-1920", width: 1920, height: 1080, touch: false, apple: "Desktop Safari" },
] as const;

/**
 * Chromium projects are named after the viewport ("mobile-390"); WebKit
 * projects ("webkit-mobile-390") emulate the matching Apple device (Safari
 * user agent, pixel ratio, touch) at the same size. Tests that pick a
 * viewport read `metadata.viewport`, so they behave the same in both engines.
 *
 * WebKit here is Playwright's build of Safari's engine on Linux: it catches
 * WebKit rendering and behaviour, not every quirk of Safari on a real iPhone.
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "bn-BD",
    trace: "retain-on-failure",
    // the service worker serves kept pages and hides requests from page.route();
    // only the offline tests turn it on
    serviceWorkers: "block",
  },
  projects: [
    ...viewports.map((v) => ({
      name: v.name,
      metadata: { viewport: v.name, engine: "chromium" },
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: v.width, height: v.height },
        hasTouch: v.touch,
        isMobile: v.touch && v.width < 1024,
        deviceScaleFactor: v.touch ? 2 : 1,
      },
    })),
    ...viewports.map((v) => ({
      name: `webkit-${v.name}`,
      metadata: { viewport: v.name, engine: "webkit" },
      use: {
        ...devices[v.apple],
        viewport: { width: v.width, height: v.height },
      },
    })),
    // an iPhone as Safari really shows it: the address bar and toolbar take
    // part of the screen, which is where full-height layouts break
    {
      name: "webkit-iphone-safari-ui",
      metadata: { viewport: "iphone-safari-ui", engine: "webkit" },
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
