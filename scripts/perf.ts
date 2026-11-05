/**
 * A mid-range Android phone, roughly: Chromium at 412×915, CPU slowed 4×
 * and the network throttled as Lighthouse's mobile preset does (slow 4G:
 * 562.5 ms round trip, 1.47 Mbit/s down). Each page is loaded cold a few
 * times; the medians are printed.
 *
 *   node scripts/perf.ts [--base http://localhost:3100] [--runs 3] [--only home,book]
 *
 * FCP and LCP come from the browser's own entries; TBT is the time beyond
 * 50 ms of every long task until the page settles; "JS" is the script
 * transferred (compressed). "Reader" is the time until the first page of a
 * book is laid out and showing.
 */
import { chromium, type Page } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3100").replace(/\/$/, "");
const RUNS = Number(arg("runs", "3"));
const ONLY = arg("only", "")
  .split(",")
  .filter(Boolean);

const PAGES: { name: string; path: string; reader?: boolean }[] = [
  { name: "home", path: "/" },
  { name: "book", path: "/books/gora" },
  { name: "author", path: "/authors/rabindranath-tagore" },
  { name: "browse", path: "/books" },
  { name: "search", path: "/search?q=রবীন্দ্রনাথ" },
  { name: "library", path: "/library" },
  { name: "profile", path: "/profile" },
  { name: "goodreads", path: "/library/goodreads" },
  { name: "reader", path: "/read/gora", reader: true },
];

type Sample = { fcp: number; lcp: number; cls: number; tbt: number; js: number; total: number; ready?: number };

async function measure(page: Page, path: string, reader: boolean): Promise<Sample> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    const w = window as unknown as { __perf: { lcp: number; cls: number; long: { start: number; duration: number }[] } };
    w.__perf = { lcp: 0, cls: 0, long: [] };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__perf.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => {
        const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) w.__perf.cls += shift.value;
      }),
    ).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__perf.long.push({ start: e.startTime, duration: e.duration }))).observe({ type: "longtask", buffered: true });
  });

  const started = Date.now();
  await page.goto(BASE + path, { waitUntil: "load", timeout: 120_000 });
  let ready: number | undefined;
  if (reader) {
    await page.locator('.reader[data-phase="ready"]').waitFor({ timeout: 120_000 });
    ready = Date.now() - started;
  }
  // let late work (hydration, idle tasks) show up as long tasks
  await page.waitForTimeout(3000);

  return page.evaluate((ready) => {
    const w = window as unknown as { __perf: { lcp: number; cls: number; long: { start: number; duration: number }[] } };
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const tbt = w.__perf.long.filter((t) => t.start >= fcp).reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const js = resources.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js")).reduce((s, r) => s + r.transferSize, 0);
    const total = resources.reduce((s, r) => s + r.transferSize, 0) + (nav?.transferSize ?? 0);
    return { fcp, lcp: w.__perf.lcp, cls: w.__perf.cls, tbt, js, total, ready };
  }, ready);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function main() {
  const browser = await chromium.launch();
  const rows: Record<string, string>[] = [];
  for (const p of PAGES.filter((p) => !ONLY.length || ONLY.includes(p.name))) {
    const samples: Sample[] = [];
    for (let i = 0; i < RUNS; i++) {
      const context = await browser.newContext({
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
        locale: "bn-BD",
        serviceWorkers: "block",
        userAgent: "Mozilla/5.0 (Linux; Android 14; moto g power (2024)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      });
      const page = await context.newPage();
      samples.push(await measure(page, p.path, !!p.reader));
      await context.close();
    }
    const m = (k: keyof Sample) => median(samples.map((s) => (s[k] as number) ?? 0));
    rows.push({
      page: p.name,
      FCP: `${(m("fcp") / 1000).toFixed(1)} s`,
      LCP: `${(m("lcp") / 1000).toFixed(1)} s`,
      TBT: `${Math.round(m("tbt"))} ms`,
      CLS: m("cls").toFixed(3),
      JS: `${Math.round(m("js") / 1024)} KB`,
      total: `${Math.round(m("total") / 1024)} KB`,
      ...(p.reader ? { reader: `${(m("ready") / 1000).toFixed(1)} s` } : {}),
    });
    console.log(rows.at(-1));
  }
  await browser.close();
  console.table(rows);
}

void main();
