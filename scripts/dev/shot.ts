/**
 * Screenshots for visual review.
 *   tsx scripts/dev/shot.ts <path> [--vp 390x844,1440x900] [--full] [--dark] [--name x] [--wait ms] [--base url]
 * Writes test-results/screenshots/<name>-<vp>.png and prints console errors.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    vp: { type: "string", default: "390x844,1440x900" },
    full: { type: "boolean", default: false },
    dark: { type: "boolean", default: false },
    name: { type: "string" },
    wait: { type: "string", default: "600" },
    base: { type: "string", default: "http://localhost:3000" },
    click: { type: "string" },
  },
});

const path = positionals[0] ?? "/";
const name = values.name ?? (path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home");
mkdirSync("test-results/screenshots", { recursive: true });

const browser = await chromium.launch();
for (const vp of values.vp!.split(",")) {
  const [width, height] = vp.split("x").map(Number);
  const touch = width < 1024;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: touch ? 2 : 1,
    isMobile: touch && width < 800,
    hasTouch: touch,
    colorScheme: values.dark ? "dark" : "light",
    locale: "bn-BD",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(values.base + path, { waitUntil: "networkidle" });
  if (values.click) await page.click(values.click);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(Number(values.wait));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const file = `test-results/screenshots/${name}-${vp}${values.dark ? "-dark" : ""}.png`;
  await page.screenshot({ path: file, fullPage: values.full });
  console.log(`${file}${overflow > 0 ? `  ⚠ horizontal overflow ${overflow}px` : ""}`);
  for (const e of errors) console.log(`  console: ${e.slice(0, 300)}`);
  await context.close();
}
await browser.close();
