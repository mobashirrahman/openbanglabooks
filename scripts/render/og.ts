/**
 * Renders Open Graph images (1200×630) for the home page and every book,
 * using the running site so covers and Bengali text render exactly as on the
 * page. (Satori/next/og cannot shape Bengali conjuncts, so it is not used.)
 *
 *   pnpm render:og [--base http://localhost:3000]
 * Writes public/og/home.png and public/og/books/<slug>.png.
 */
import { chromium, type Page } from "@playwright/test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3000" } } });
const root = resolve(import.meta.dirname, "../..");
// render into a temp dir: writing into public/ while a dev server runs triggers reloads
const out = mkdtempSync(join(tmpdir(), "obb-og-"));
mkdirSync(join(out, "books"), { recursive: true });

async function card(page: Page, html: string, file: string) {
  await page.evaluate((markup) => {
    document.getElementById("og-card")?.remove();
    const el = document.createElement("div");
    el.id = "og-card";
    // never capture the dev-mode indicator
    document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
    el.innerHTML = markup;
    Object.assign(el.style, { position: "fixed", inset: "0", zIndex: "9999", width: "1200px", height: "630px" });
    document.body.append(el);
  }, html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.locator("#og-card").screenshot({ path: file });
}

const frame = (inner: string) => `
<div style="position:absolute;inset:0;background:#233B30;color:#F5EFE4;font-family:'Hind Siliguri',sans-serif;overflow:hidden">
  <div style="position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,rgb(255 255 255/.02) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgb(0 0 0/.05) 0 1px,transparent 1px 3px)"></div>
  ${inner}
  <div style="position:absolute;left:72px;bottom:52px;display:flex;align-items:center;gap:16px;font-size:26px;color:rgb(245 239 228/.82)">
    <span style="font-family:'Tiro Bangla',serif;font-size:30px;color:#F5EFE4">ওপেন বাংলা বুকস</span>
    <span style="width:1px;height:26px;background:rgb(194 160 108/.6)"></span>
    <span>বাংলা বইয়ের উন্মুক্ত পাঠাগার</span>
  </div>
</div>`;

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

// home
await page.goto(values.base + "/", { waitUntil: "load" });
const homeCovers = await page.$$eval("[data-cover]", (els) => {
  const seen = new Map<string, string>();
  for (const e of els) {
    const slug = e.getAttribute("data-cover")!;
    if (!seen.has(slug)) seen.set(slug, e.outerHTML);
  }
  return [...seen.values()].slice(1, 4);
});
await card(
  page,
  frame(`
  <div style="position:absolute;left:72px;top:100px;width:520px">
    <div style="font-family:'Tiro Bangla',serif;font-size:76px;line-height:1.25">বাংলা বই<br/>অনলাইনে পড়ুন</div>
    <div style="margin-top:22px;font-size:30px;color:#D9C29A">উপন্যাস, ছোটগল্প, কবিতা ও প্রবন্ধ</div>
  </div>
  <div style="position:absolute;right:70px;top:110px;display:flex;gap:0">
    ${homeCovers
      .map(
        (c, i) =>
          `<div style="width:190px;margin-left:${i ? -40 : 0}px;transform:rotate(${(i - 1) * 4}deg) translateY(${Math.abs(i - 1) * 14}px);box-shadow:0 30px 50px -20px rgb(0 0 0/.6)">${c}</div>`,
      )
      .join("")}
  </div>`),
  join(out, "home.png"),
);
console.log("og: home");

// books
await page.goto(values.base + "/books", { waitUntil: "load" });
const slugs = await page.$$eval("a[href^='/books/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")!.split("/")[2]))]);
await page.close();
for (const slug of slugs) {
  // a fresh tab per book keeps memory flat on small machines
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`${values.base}/books/${slug}`, { waitUntil: "load" });
  const data = await page.evaluate(() => ({
    cover: document.querySelector("header [data-cover]")?.outerHTML ?? "",
    title: document.querySelector("h1")?.childNodes[0]?.textContent ?? "",
    subtitle: document.querySelector("h1 span")?.textContent ?? "",
    author: document.querySelector("header p a")?.textContent ?? "",
  }));
  const size = [...data.title].length > 9 ? 76 : 96;
  await card(
    page,
    frame(`
    <div style="position:absolute;left:72px;top:110px;width:640px">
      <div style="font-family:'Tiro Bangla',serif;font-size:${size}px;line-height:1.2">${data.title}</div>
      ${data.subtitle ? `<div style="font-family:'Tiro Bangla',serif;font-size:40px;margin-top:8px;color:rgb(245 239 228/.8)">${data.subtitle}</div>` : ""}
      <div style="margin-top:24px;font-size:36px;color:#D9C29A">${data.author}</div>
      <div style="margin-top:30px;font-size:26px;color:rgb(245 239 228/.75)">অনলাইনে পড়ুন বিনামূল্যে</div>
    </div>
    <div style="position:absolute;right:96px;top:70px;width:300px;transform:rotate(2.5deg);box-shadow:0 40px 70px -25px rgb(0 0 0/.7)">${data.cover}</div>`),
    join(out, "books", `${slug}.png`),
  );
  await page.close();
  console.log(`og: ${slug}`);
}
await browser.close();
const dest = join(root, "public/og");
mkdirSync(dest, { recursive: true });
cpSync(out, dest, { recursive: true });
rmSync(out, { recursive: true, force: true });
console.log(`og: copied to ${dest}`);
