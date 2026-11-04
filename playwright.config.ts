import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * The six viewports the product is verified at. Touch viewports emulate
 * mobile Chromium (WebKit needs system libraries that this machine lacks).
 */
const viewports = [
  { name: "mobile-375", width: 375, height: 812, touch: true },
  { name: "mobile-390", width: 390, height: 844, touch: true },
  { name: "tablet-768", width: 768, height: 1024, touch: true },
  { name: "tablet-1024", width: 1024, height: 768, touch: true },
  { name: "laptop-1440", width: 1440, height: 900, touch: false },
  { name: "desktop-1920", width: 1920, height: 1080, touch: false },
] as const;

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
  },
  projects: viewports.map((v) => ({
    name: v.name,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: v.width, height: v.height },
      hasTouch: v.touch,
      isMobile: v.touch && v.width < 1024,
      deviceScaleFactor: v.touch ? 2 : 1,
    },
  })),
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
